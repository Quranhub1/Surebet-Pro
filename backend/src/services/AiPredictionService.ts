import axios from 'axios';
import { sql } from '../lib/db';
import { generateSingleWithAi, getAiModels, type AiProvider } from './AiModelService';

export interface AiMatchPrediction {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; advice: string | null; analysis: string | null; keyFactors: string[];
  confidence: number | null; homeWin: number | null; draw: number | null; awayWin: number | null;
  underOver: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  aiProvider: AiProvider | null; aiModel: string | null;
}

export interface PredictionHistoryItem extends AiMatchPrediction {
  actualHomeScore: number | null;
  actualAwayScore: number | null;
  predictionResult: 'true' | 'lose' | 'pending' | null;
  settledAt: string | null;
}

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const FREE_PLAN_MINUTE_DELAY_MS = 6500;
const ANALYSIS_TTL_MS = 12 * 60 * 60 * 1000;
const AI_MAX_OUTPUT_TOKENS = 850;
const PROVIDER_WINDOW_MS = 60_000;
const PROVIDER_BUDGETS: Record<AiProvider, number> = { gemini: 20_000, groq: 6_500 };

interface ProviderState { usedTokens: number[]; cooldownUntil: number; successes: number; failures: number; }

const providerState: Record<AiProvider, ProviderState> = {
  gemini: { usedTokens: [], cooldownUntil: 0, successes: 0, failures: 0 },
  groq: { usedTokens: [], cooldownUntil: 0, successes: 0, failures: 0 },
};

export class AiPredictionService {
  private cache: { expiresAt: number; data: AiMatchPrediction[] } | null = null;

  private async requestFootball(path: string, params: Record<string, string | number>) {
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY;
    if (!key) throw new Error('No API-Football key configured.');
    const response = await axios.get(`${API_FOOTBALL_BASE_URL}${path}`, {
      params,
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
      timeout: 30_000,
    });
    const errors = response.data?.errors;
    if (errors && ((Array.isArray(errors) && errors.length) || Object.keys(errors).length)) {
      throw new Error(Array.isArray(errors) ? errors.join('; ') : Object.values(errors).join('; '));
    }
    return response.data;
  }

  private async sleep(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }

  public async runAutomaticAnalysis(limit = 40): Promise<AiMatchPrediction[]> {
    const models = getAiModels().filter(model => model.configured);
    if (!models.length) throw new Error('Neither Gemini nor Groq API key is configured.');
    if (!(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY)) throw new Error('API-Football key is not configured.');

    await this.settleCompletedPredictions();
    const cycleExpiresAt = new Date(Date.now() + ANALYSIS_TTL_MS);
    const freshFixtures = await this.fetchUpcomingFixtures(limit);
    const selected: any[] = [];
    const known = new Set<string>();
    for (const fixture of freshFixtures) {
      const id = String(fixture.fixture?.id ?? fixture.id ?? '');
      if (!id || known.has(id)) continue;
      known.add(id);
      selected.push(fixture);
      if (selected.length >= limit) break;
    }

    if (selected.length < limit) {
      const existing = await sql`
        SELECT id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, analysis_expires_at
        FROM football_fixtures
        WHERE analysis_expires_at > NOW() AND status IN ('NS', 'TBD')
        ORDER BY kickoff_at ASC LIMIT ${limit}`;
      for (const row of existing) {
        const id = String(row.id);
        if (known.has(id)) continue;
        known.add(id);
        selected.push(this.rowToFixture(row));
        if (selected.length >= limit) break;
      }
    }

    if (!selected.length) {
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      return [];
    }

    await Promise.all(selected.map(async fixture => {
      await this.storeFixture(fixture.raw || fixture, cycleExpiresAt);
      await sql`UPDATE football_fixtures SET analysis_expires_at = COALESCE(analysis_expires_at, ${cycleExpiresAt.toISOString()}), updated_at = NOW() WHERE id = ${String(fixture.id ?? fixture.fixture?.id)}`;
    }));

    console.log(`[AI] Dynamic cycle loaded ${selected.length} unique games. All fixtures are published before incremental AI processing.`);
    const results: AiMatchPrediction[] = [];

    for (const [index, fixture] of selected.entries()) {
      await sql`UPDATE system_settings SET analysis_lock_at = NOW() WHERE id = 1 AND analysis_last_run_status = 'running'`;
      const base = this.normalizeFixture(fixture.raw || fixture);
      console.log(`[AI] Processing game ${index + 1}/${selected.length}: ${base.home} vs ${base.away} (fixture ${base.id})`);

      const existingPrediction = await this.getValidPrediction(base.id);
      if (existingPrediction) {
        results.push(existingPrediction);
        console.log(`[AI] Reusing existing 12-hour analysis for ${base.home} vs ${base.away}.`);
        continue;
      }

      let context: any = { ...base, apiPrediction: null, comparison: {}, h2h: [], storedHistory: [] };
      try {
        const predictionData = await this.requestFootball('/predictions', { fixture: base.id });
        const item = predictionData.response?.[0];
        const prediction = item?.predictions || {};
        context = {
          ...base,
          apiPrediction: {
            winner: prediction.winner?.name || null,
            winnerComment: prediction.winner?.comment || null,
            advice: prediction.advice || null,
            underOver: prediction.under_over || null,
            goals: prediction.goals || {},
            percent: prediction.percent || {},
            winOrDraw: prediction.win_or_draw ?? null,
          },
          comparison: item?.comparison || {},
          h2h: Array.isArray(item?.h2h) ? item.h2h.slice(0, 5).map((match: any) => ({
            date: match.fixture?.date || null,
            home: match.teams?.home?.name || null,
            away: match.teams?.away?.name || null,
            homeGoals: match.goals?.home ?? null,
            awayGoals: match.goals?.away ?? null,
          })) : [],
          storedHistory: await this.getStoredHistory(base),
        };
      } catch (error) {
        console.warn(`[AI] Limited analysis context for fixture ${base.id}:`, error instanceof Error ? error.message : error);
        context.storedHistory = await this.getStoredHistory(base);
      }

      const result = await this.generateOnePrediction(context, selected.length, index + 1);
      if (result) {
        await this.storePrediction(result, context, new Date(Date.now() + ANALYSIS_TTL_MS));
        results.push(result);
        this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: results.slice() };
        console.log(`[AI] Published prediction ${index + 1}/${selected.length}: ${result.homeTeam} vs ${result.awayTeam} via ${result.aiProvider}.`);
      }

      await this.sleep(FREE_PLAN_MINUTE_DELAY_MS);
    }

    this.cache = { expiresAt: Date.now() + ANALYSIS_TTL_MS, data: results };
    console.log(`[AI] Dynamic football analysis completed: ${results.length}/${selected.length} games have valid analyses.`);
    return results;
  }

  public async getHistory(from?: string, to?: string): Promise<{ items: PredictionHistoryItem[]; summary: { total: number; correct: number; failed: number; pending: number; accuracy: number } }> {
    await this.settleCompletedPredictions();
    const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
    const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error('Invalid history date range.');

    const rows = await sql`
      SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at,
             p.winner, p.advice, p.analysis, p.key_factors, p.confidence, p.home_win, p.draw, p.away_win,
             p.under_over, p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model,
             p.actual_home_score, p.actual_away_score, p.prediction_result, p.settled_at
      FROM football_ai_predictions p
      JOIN football_fixtures f ON f.id = p.fixture_id
      WHERE f.kickoff_at >= ${start.toISOString()} AND f.kickoff_at <= ${end.toISOString()}
      ORDER BY f.kickoff_at DESC`;
    const items = rows.map((row: any) => this.mapHistoryRow(row));
    const correct = items.filter(item => item.predictionResult === 'true').length;
    const failed = items.filter(item => item.predictionResult === 'lose').length;
    const pending = items.filter(item => item.predictionResult === 'pending' || item.predictionResult === null).length;
    const total = items.length;
    return { items, summary: { total, correct, failed, pending, accuracy: correct + failed ? Number(((correct / (correct + failed)) * 100).toFixed(1)) : 0 } };
  }

  public async settleCompletedPredictions(): Promise<void> {
    const pending = await sql`
      SELECT p.fixture_id, p.winner, f.home_team, f.away_team, f.kickoff_at
      FROM football_ai_predictions p
      JOIN football_fixtures f ON f.id = p.fixture_id
      WHERE p.settled_at IS NULL AND f.kickoff_at < NOW()
      ORDER BY f.kickoff_at ASC LIMIT 200`;
    if (!pending.length) return;

    const dates = new Set(pending.map((row: any) => this.formatDate(new Date(row.kickoff_at))));
    const byId = new Map<string, any>();
    for (const date of dates) {
      try {
        const data = await this.requestFootball('/fixtures', { date });
        for (const fixture of Array.isArray(data.response) ? data.response : []) byId.set(String(fixture.fixture?.id), fixture);
      } catch (error) {
        console.warn(`[History] Could not refresh completed fixtures for ${date}:`, error instanceof Error ? error.message : error);
      }
    }

    let settled = 0;
    for (const row of pending) {
      const fixture = byId.get(String(row.fixture_id));
      const status = String(fixture?.fixture?.status?.short || '');
      if (!['FT', 'AET', 'PEN'].includes(status)) continue;
      const homeScore = Number(fixture.goals?.home);
      const awayScore = Number(fixture.goals?.away);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
      const actualWinner = homeScore > awayScore ? row.home_team : homeScore < awayScore ? row.away_team : 'draw';
      const predictionResult = row.winner && row.winner === actualWinner ? 'true' : 'lose';
      await sql`
        UPDATE football_fixtures
        SET status = ${status}, home_score = ${homeScore}, away_score = ${awayScore}, raw_data = ${JSON.stringify(fixture)}, updated_at = NOW()
        WHERE id = ${String(row.fixture_id)}`;
      await sql`
        UPDATE football_ai_predictions
        SET actual_home_score = ${homeScore}, actual_away_score = ${awayScore}, prediction_result = ${predictionResult}, settled_at = NOW(), updated_at = NOW()
        WHERE fixture_id = ${String(row.fixture_id)} AND settled_at IS NULL`;
      settled += 1;
    }
    if (settled) console.log(`[History] Settled ${settled} completed AI predictions.`);
  }

  private async fetchUpcomingFixtures(limit: number): Promise<any[]> {
    const found: any[] = [];
    const known = new Set<string>();
    const today = new Date();
    for (let offset = 0; offset < 7 && found.length < limit; offset += 1) {
      const date = this.formatDate(new Date(today.getTime() + offset * 86400000));
      try {
        const data = await this.requestFootball('/fixtures', { date });
        const fixtures = Array.isArray(data.response)
          ? data.response.filter((fixture: any) => ['NS', 'TBD'].includes(String(fixture.fixture?.status?.short)))
          : [];
        for (const fixture of fixtures) {
          const id = String(fixture.fixture?.id ?? '');
          if (!id || known.has(id)) continue;
          known.add(id);
          found.push(fixture);
          if (found.length >= limit) break;
        }
        console.log(`[AI] Found ${fixtures.length} upcoming games for ${date}; ${found.length}/${limit} unique fixtures collected.`);
      } catch (error) {
        console.warn(`[AI] Skipping unavailable API-Football date ${date}:`, error instanceof Error ? error.message : error);
      }
    }
    found.sort((a, b) => new Date(a.fixture?.date || 0).getTime() - new Date(b.fixture?.date || 0).getTime());
    return found;
  }

  private async generateOnePrediction(context: any, total: number, position: number): Promise<AiMatchPrediction | null> {
    const system = `You are SureBet Pro's football analysis AI. Analyze one upcoming football match only. Do not discuss bookmakers, odds, stakes, ROI, arbitrage or gambling. Use only the supplied evidence. Never invent injuries, lineups, statistics or results. Return ONLY JSON. Schema: {"winner":"home team or away team or draw or null","advice":"short football outcome","analysis":"2-3 evidence-based sentences","keyFactors":["3-5 short factors"],"confidence":0-100,"homeWin":0-100,"draw":0-100,"awayWin":0-100,"underOver":"short goal outlook","predictedHomeGoals":number,"predictedAwayGoals":number}. Probabilities should total about 100.`;
    const prompt = `Match ${position}/${total}: ${context.home} vs ${context.away}. League: ${context.league}. Kickoff: ${context.kickoff}.\nAPI-Football forecast: ${JSON.stringify(context.apiPrediction)}\nComparison: ${JSON.stringify(this.compactObject(context.comparison))}\nH2H: ${JSON.stringify(context.h2h)}\nStored recent completed games: ${JSON.stringify(context.storedHistory?.slice?.(0, 8) || [])}\nMake a cautious, evidence-based prediction. Return the JSON object only.`;
    const estimatedTokens = Math.ceil((system.length + prompt.length) / 4) + AI_MAX_OUTPUT_TOKENS;
    const providers = this.rankProviders(position, estimatedTokens);
    let lastError: unknown = null;

    for (const provider of providers) {
      const state = providerState[provider];
      const wait = state.cooldownUntil - Date.now();
      if (wait > 0) continue;
      try {
        const raw = await generateSingleWithAi({ provider, system, prompt, temperature: 0.15, maxTokens: AI_MAX_OUTPUT_TOKENS });
        this.recordProviderUsage(provider, estimatedTokens, true);
        const item = this.parseJson(raw);
        const normalized = this.normalizeAiItem(item, context, provider);
        if (!normalized) throw new Error('AI returned an unusable prediction object');
        return normalized;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.recordProviderUsage(provider, estimatedTokens, false, message);
        console.warn(`[AI] ${provider.toUpperCase()} failed for ${context.home} vs ${context.away}; dynamic router will try the next provider.`, message);
      }
    }

    console.error(`[AI] Both AI providers failed for ${context.home} vs ${context.away}:`, lastError);
    return null;
  }

  private rankProviders(position: number, estimatedTokens: number): AiProvider[] {
    const configured = getAiModels().filter(item => item.configured).map(item => item.provider);
    const now = Date.now();
    if (configured.length <= 1) return configured;
    const preferred: AiProvider = position % 2 === 1 ? 'gemini' : 'groq';
    const ordered = [preferred, preferred === 'gemini' ? 'groq' : 'gemini'];
    return ordered.filter(provider => {
      const state = providerState[provider];
      state.usedTokens = state.usedTokens.filter(timestamp => timestamp > now - PROVIDER_WINDOW_MS);
      const projected = state.usedTokens.length * 0 + estimatedTokens;
      const withinBudget = projected <= PROVIDER_BUDGETS[provider];
      const available = state.cooldownUntil <= now;
      return configured.includes(provider) && (withinBudget || provider === ordered[1]) && available;
    });
  }

  private recordProviderUsage(provider: AiProvider, estimatedTokens: number, success: boolean, errorMessage = ''): void {
    const state = providerState[provider];
    const now = Date.now();
    state.usedTokens = state.usedTokens.filter(timestamp => timestamp > now - PROVIDER_WINDOW_MS);
    state.usedTokens.push(now);
    if (success) state.successes += 1;
    else {
      state.failures += 1;
      const lower = errorMessage.toLowerCase();
      if (lower.includes('429') || lower.includes('rate limit') || lower.includes('resource_exhausted') || lower.includes('413') || lower.includes('too large')) {
        state.cooldownUntil = now + (lower.includes('413') ? 5 * 60_000 : 30_000);
      }
    }
    void estimatedTokens;
  }

  public async getPredictions(limit = 40): Promise<AiMatchPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data.slice(0, limit);
    const rows = await sql`
      SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at, p.winner, p.advice, p.analysis,
             p.key_factors, p.confidence, p.home_win, p.draw, p.away_win, p.under_over,
             p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model
      FROM football_fixtures f
      LEFT JOIN football_ai_predictions p ON p.fixture_id = f.id AND p.expires_at > NOW()
      WHERE f.analysis_expires_at > NOW()
      ORDER BY f.kickoff_at ASC LIMIT ${limit}`;
    const data = rows.map((row: any) => this.mapRow(row));
    if (data.length) this.cache = { expiresAt: Date.now() + 15_000, data };
    return data;
  }

  private async getValidPrediction(id: string): Promise<AiMatchPrediction | null> {
    const rows = await sql`
      SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at, p.winner, p.advice, p.analysis,
             p.key_factors, p.confidence, p.home_win, p.draw, p.away_win, p.under_over,
             p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model
      FROM football_fixtures f JOIN football_ai_predictions p ON p.fixture_id = f.id
      WHERE f.id = ${id} AND p.expires_at > NOW() LIMIT 1`;
    return rows.length ? this.mapRow(rows[0]) : null;
  }

  private async syncCompletedHistory(selected: any[]): Promise<void> {
    const teamIds = new Set(selected.flatMap((fixture: any) => [fixture.teams?.home?.id, fixture.teams?.away?.id]).filter(Boolean).map(Number));
    if (!teamIds.size) return;
    const from = this.formatDate(new Date(Date.now() - 14 * 86400000));
    const to = this.formatDate(new Date(Date.now() - 86400000));
    try {
      const data = await this.requestFootball('/fixtures', { from, to });
      const completed = Array.isArray(data.response) ? data.response.filter((fixture: any) => {
        const status = String(fixture.fixture?.status?.short);
        const homeId = Number(fixture.teams?.home?.id);
        const awayId = Number(fixture.teams?.away?.id);
        return ['FT', 'AET', 'PEN'].includes(status) && (teamIds.has(homeId) || teamIds.has(awayId));
      }) : [];
      await Promise.all(completed.map((fixture: any) => this.storeFixture(fixture)));
      console.log(`[AI] Stored ${completed.length} completed historical games for the selected teams.`);
    } catch (error) {
      console.warn('[AI] Could not sync completed history:', error instanceof Error ? error.message : error);
    }
  }

  private async storeFixture(fixture: any, cycleExpiresAt?: Date): Promise<void> {
    const f = this.normalizeFixture(fixture);
    await sql`
      INSERT INTO football_fixtures (id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, analysis_expires_at, updated_at)
      VALUES (${f.id}, ${f.leagueId}, ${f.league}, ${f.country}, ${f.season}, ${f.homeId}, ${f.home}, ${f.awayId}, ${f.away}, ${f.kickoff}, ${f.status}, ${f.homeScore}, ${f.awayScore}, ${JSON.stringify(fixture)}, ${cycleExpiresAt?.toISOString() || null}, NOW())
      ON CONFLICT (id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, country=EXCLUDED.country, season=EXCLUDED.season,
        home_team_id=EXCLUDED.home_team_id, home_team=EXCLUDED.home_team, away_team_id=EXCLUDED.away_team_id, away_team=EXCLUDED.away_team,
        kickoff_at=EXCLUDED.kickoff_at, status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score,
        raw_data=EXCLUDED.raw_data, analysis_expires_at=COALESCE(football_fixtures.analysis_expires_at, EXCLUDED.analysis_expires_at), updated_at=NOW()`;
  }

  private async storePrediction(prediction: AiMatchPrediction, context: any, expiresAt: Date): Promise<void> {
    await sql`
      INSERT INTO football_ai_predictions (fixture_id, winner, advice, analysis, key_factors, confidence, home_win, draw, away_win, under_over, predicted_home_goals, predicted_away_goals, ai_provider, ai_model, source_prediction, expires_at, updated_at)
      VALUES (${prediction.id}, ${prediction.winner}, ${prediction.advice}, ${prediction.analysis}, ${JSON.stringify(prediction.keyFactors)}, ${prediction.confidence}, ${prediction.homeWin}, ${prediction.draw}, ${prediction.awayWin}, ${prediction.underOver}, ${prediction.predictedHomeGoals}, ${prediction.predictedAwayGoals}, ${prediction.aiProvider}, ${prediction.aiModel}, ${JSON.stringify(context?.apiPrediction || null)}, ${expiresAt.toISOString()}, NOW())
      ON CONFLICT (fixture_id) DO UPDATE SET winner=EXCLUDED.winner, advice=EXCLUDED.advice, analysis=EXCLUDED.analysis, key_factors=EXCLUDED.key_factors,
        confidence=EXCLUDED.confidence, home_win=EXCLUDED.home_win, draw=EXCLUDED.draw, away_win=EXCLUDED.away_win, under_over=EXCLUDED.under_over,
        predicted_home_goals=EXCLUDED.predicted_home_goals, predicted_away_goals=EXCLUDED.predicted_away_goals, ai_provider=EXCLUDED.ai_provider,
        ai_model=EXCLUDED.ai_model, source_prediction=EXCLUDED.source_prediction, expires_at=EXCLUDED.expires_at, updated_at=NOW()`;
  }

  private async getStoredHistory(fixture: any) {
    const homeId = fixture.homeId ?? null; const awayId = fixture.awayId ?? null;
    if (!homeId && !awayId) return [];
    return sql`SELECT id, league_name AS league, home_team, away_team, kickoff_at, status, home_score, away_score FROM football_fixtures WHERE kickoff_at < ${fixture.kickoff} AND status IN ('FT','AET','PEN') AND (home_team_id IN (${homeId}, ${awayId}) OR away_team_id IN (${homeId}, ${awayId})) ORDER BY kickoff_at DESC LIMIT 12`;
  }

  private normalizeAiItem(raw: any, fixture: any, provider: AiProvider): AiMatchPrediction | null {
    const item = raw?.prediction || raw;
    if (!item || typeof item !== 'object') return null;
    const winner = this.stringOrNull(item.winner);
    const allowedWinner = winner === fixture.home || winner === fixture.away || winner === 'draw' ? winner : null;
    return {
      id: fixture.id, league: fixture.league, homeTeam: fixture.home, awayTeam: fixture.away, startTime: fixture.kickoff,
      winner: allowedWinner, advice: this.stringOrNull(item.advice), analysis: this.stringOrNull(item.analysis),
      keyFactors: Array.isArray(item.keyFactors) ? item.keyFactors.filter((value: unknown): value is string => typeof value === 'string').slice(0, 5) : [],
      confidence: this.toNumber(item.confidence), homeWin: this.toNumber(item.homeWin), draw: this.toNumber(item.draw), awayWin: this.toNumber(item.awayWin),
      underOver: this.stringOrNull(item.underOver), predictedHomeGoals: this.toNumber(item.predictedHomeGoals), predictedAwayGoals: this.toNumber(item.predictedAwayGoals),
      aiProvider: provider, aiModel: provider === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
    };
  }

  private mapRow(row: any): AiMatchPrediction {
    return { id: String(row.id), league: row.league_name, homeTeam: row.home_team, awayTeam: row.away_team, startTime: new Date(row.kickoff_at).toISOString(), winner: row.winner || null, advice: row.advice || null, analysis: row.analysis || null, keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [], confidence: this.toNumber(row.confidence), homeWin: this.toNumber(row.home_win), draw: this.toNumber(row.draw), awayWin: this.toNumber(row.away_win), underOver: row.under_over || null, predictedHomeGoals: this.toNumber(row.predicted_home_goals), predictedAwayGoals: this.toNumber(row.predicted_away_goals), aiProvider: row.ai_provider === 'gemini' || row.ai_provider === 'groq' ? row.ai_provider : null, aiModel: row.ai_model || null };
  }

  private mapHistoryRow(row: any): PredictionHistoryItem {
    return { ...this.mapRow(row), actualHomeScore: row.actual_home_score == null ? null : Number(row.actual_home_score), actualAwayScore: row.actual_away_score == null ? null : Number(row.actual_away_score), predictionResult: row.prediction_result === 'true' || row.prediction_result === 'lose' || row.prediction_result === 'pending' ? row.prediction_result : null, settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null };
  }

  private rowToFixture(row: any): any {
    return { id: String(row.id), league: row.league_name, home: row.home_team, away: row.away_team, kickoff: new Date(row.kickoff_at).toISOString(), status: row.status, raw: row.raw_data || { fixture: { id: row.id, date: row.kickoff_at, status: { short: row.status } }, league: { id: row.league_id, name: row.league_name, country: row.country, season: row.season }, teams: { home: { id: row.home_team_id, name: row.home_team }, away: { id: row.away_team_id, name: row.away_team } }, goals: { home: row.home_score, away: row.away_score } } };
  }

  private compactObject(value: any): any { if (!value || typeof value !== 'object') return {}; const output: Record<string, unknown> = {}; for (const [key, entry] of Object.entries(value).slice(0, 10)) output[key] = entry; return output; }
  private parseJson(raw: string): any { const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error('AI returned invalid football analysis JSON'); } }
  private stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
  private toNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(String(value).replace('%', '').trim()); return Number.isFinite(n) ? n : null; }
  private normalizeFixture(item: any) { return { id: String(item.fixture?.id ?? item.id), leagueId: item.league?.id ? Number(item.league.id) : null, league: item.league?.name || item.league_name || 'Football', country: item.league?.country || item.country || '', season: item.league?.season ? Number(item.league.season) : item.season ? Number(item.season) : null, homeId: item.teams?.home?.id ? Number(item.teams.home.id) : item.home_team_id ? Number(item.home_team_id) : null, home: item.teams?.home?.name || item.home_team || item.home || 'Home', awayId: item.teams?.away?.id ? Number(item.teams.away.id) : item.away_team_id ? Number(item.away_team_id) : null, away: item.teams?.away?.name || item.away_team || item.away || 'Away', kickoff: item.fixture?.date || item.kickoff_at || new Date().toISOString(), status: String(item.fixture?.status?.short || item.status || 'NS'), homeScore: this.toNumber(item.goals?.home ?? item.home_score), awayScore: this.toNumber(item.goals?.away ?? item.away_score) }; }
  private formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
}

export const aiPredictionService = new AiPredictionService();
