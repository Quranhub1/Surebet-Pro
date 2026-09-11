import axios from 'axios';
import { sql } from '../lib/db';
import { generateWithAi, getActiveAiConfig, type AiProvider } from './AiModelService';

export interface AiMatchPrediction {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; advice: string | null; analysis: string | null; keyFactors: string[];
  confidence: number | null; homeWin: number | null; draw: number | null; awayWin: number | null;
  underOver: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  aiProvider: AiProvider | null; aiModel: string | null;
}

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const FREE_PLAN_MINUTE_DELAY_MS = 6500;

export class AiPredictionService {
  private cache: { expiresAt: number; data: AiMatchPrediction[] } | null = null;

  private async requestFootball(path: string, params: Record<string, string | number>) {
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY;
    if (!key) throw new Error('No API-Football key configured.');
    const response = await axios.get(`${API_FOOTBALL_BASE_URL}${path}`, { params, headers: { 'x-apisports-key': key, Accept: 'application/json' } });
    const errors = response.data?.errors;
    if (errors && ((Array.isArray(errors) && errors.length) || Object.keys(errors).length)) throw new Error(Array.isArray(errors) ? errors.join('; ') : Object.values(errors).join('; '));
    return response.data;
  }

  private async sleep(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }

  public async runAutomaticAnalysis(limit = 8): Promise<AiMatchPrediction[]> {
    const aiConfig = getActiveAiConfig();
    if (!aiConfig.configured) throw new Error(`AI prediction model is not configured: ${aiConfig.provider}`);
    if (!(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY)) throw new Error('API-Football key is not configured.');

    const today = new Date();
    const dates = [this.formatDate(today), this.formatDate(new Date(today.getTime() + 86400000))];
    let fixtures: any[] = [];
    for (const date of dates) {
      console.log(`[AI] Fetching upcoming football games for ${date}...`);
      const data = await this.requestFootball('/fixtures', { date });
      fixtures = Array.isArray(data.response) ? data.response.filter((fixture: any) => ['NS', 'TBD'].includes(String(fixture.fixture?.status?.short))) : [];
      console.log(`[AI] ${date}: fetched ${fixtures.length} upcoming games.`);
      if (fixtures.length) break;
    }

    const selected = fixtures.slice(0, limit);
    if (!selected.length) {
      console.log('[AI] No upcoming football games found for analysis.');
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = 'no_fixtures' WHERE id = 1`;
      return [];
    }

    console.log(`[AI] Selected ${selected.length} games for this analysis cycle:`);
    selected.forEach((fixture: any, index: number) => {
      const kickoff = fixture.fixture?.date ? new Date(fixture.fixture.date).toISOString() : 'unknown kickoff';
      console.log(`[AI] Game ${index + 1}/${selected.length}: ${fixture.teams?.home?.name || 'Home'} vs ${fixture.teams?.away?.name || 'Away'} | ${fixture.league?.name || 'Football'} | kickoff ${kickoff} | fixture ${fixture.fixture?.id}`);
    });

    await Promise.all(selected.map((fixture: any) => this.storeFixture(fixture)));
    await this.syncCompletedHistory(selected);

    const enriched: any[] = [];
    for (const [index, fixture] of selected.entries()) {
      const base = this.normalizeFixture(fixture);
      console.log(`[AI] Processing game ${index + 1}/${selected.length}: ${base.home} vs ${base.away} (fixture ${base.id})`);
      try {
        const predictionData = await this.requestFootball('/predictions', { fixture: base.id });
        const history = await this.getStoredHistory(base);
        const item = predictionData.response?.[0];
        const prediction = item?.predictions || {};
        console.log(`[AI] API-Football prediction fetched for game ${index + 1}/${selected.length}: ${base.home} vs ${base.away}`);
        enriched.push({
          ...base,
          apiPrediction: { winner: prediction.winner?.name || null, winnerComment: prediction.winner?.comment || null, advice: prediction.advice || null, underOver: prediction.under_over || null, goals: prediction.goals || {}, percent: prediction.percent || {}, winOrDraw: prediction.win_or_draw ?? null },
          comparison: item?.comparison || {},
          h2h: Array.isArray(item?.h2h) ? item.h2h.slice(0, 5).map((match: any) => ({ date: match.fixture?.date || null, home: match.teams?.home?.name || null, away: match.teams?.away?.name || null, homeGoals: match.goals?.home ?? null, awayGoals: match.goals?.away ?? null })) : [],
          storedHistory: history,
        });
        await this.sleep(FREE_PLAN_MINUTE_DELAY_MS);
      } catch (error) {
        console.warn(`[AI] Limited analysis context for fixture ${base.id}:`, error instanceof Error ? error.message : error);
        enriched.push({ ...base, apiPrediction: null, comparison: {}, h2h: [], storedHistory: await this.getStoredHistory(base) });
        await this.sleep(FREE_PLAN_MINUTE_DELAY_MS);
      }
    }

    const system = `You are SureBet Pro's football analysis AI. Your sole job is football analysis, not betting. Never mention bookmakers, odds, stakes, ROI, arbitrage, gambling or betting advice. Analyze the supplied API-Football forecast, comparison signals, head-to-head context and the stored database history. The stored completed games are persistent evidence and MUST be considered when available. Do not invent injuries, lineups, statistics, form or results. If evidence is weak, say so and lower confidence. Return ONLY valid JSON with a top-level predictions array. Each prediction must contain id, winner, advice, analysis, keyFactors, confidence, homeWin, draw, awayWin, underOver, predictedHomeGoals, predictedAwayGoals. analysis must be 2-4 sentences explaining the reasoning. keyFactors must contain 3-6 short evidence-based points. confidence is 0-100. Probabilities are 0-100 and should sum to approximately 100.`;
    const prompt = `Analyze these upcoming football fixtures. The API-Football forecast is an input, not the final answer. Reconcile it with comparison signals, H2H and the historical games already stored in our database, then make your own reasoned prediction.\n\n${JSON.stringify(enriched, null, 2)}`;

    let raw: string;
    let usedProvider: AiProvider = aiConfig.provider;
    let usedModel = aiConfig.model;
    try {
      raw = await generateWithAi({ provider: aiConfig.provider, system, prompt, temperature: 0.2, maxTokens: 5000 });
    } catch (primaryError) {
      const fallback: AiProvider = aiConfig.provider === 'gemini' ? 'groq' : 'gemini';
      const configured = fallback === 'gemini' ? Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY) : Boolean(process.env.GROQ_API_KEY);
      if (!configured) throw primaryError;
      raw = await generateWithAi({ provider: fallback, system, prompt, temperature: 0.2, maxTokens: 5000 });
      usedProvider = fallback;
      usedModel = fallback === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b');
    }

    const parsed = this.parseJson(raw);
    const byId = new Map(selected.map((fixture: any) => [String(fixture.fixture?.id), fixture]));
    const results: AiMatchPrediction[] = [];
    for (const item of Array.isArray(parsed.predictions) ? parsed.predictions : []) {
      const fixture = byId.get(String(item?.id));
      if (!fixture) continue;
      const prediction: AiMatchPrediction = {
        id: String(fixture.fixture?.id), league: fixture.league?.name || 'Football', homeTeam: fixture.teams?.home?.name || 'Home', awayTeam: fixture.teams?.away?.name || 'Away', startTime: fixture.fixture?.date || new Date().toISOString(),
        winner: item?.winner === fixture.teams?.home?.name || item?.winner === fixture.teams?.away?.name ? item.winner : null,
        advice: this.stringOrNull(item?.advice), analysis: this.stringOrNull(item?.analysis), keyFactors: Array.isArray(item?.keyFactors) ? item.keyFactors.filter((value: unknown): value is string => typeof value === 'string').slice(0, 6) : [], confidence: this.toNumber(item?.confidence), homeWin: this.toNumber(item?.homeWin), draw: this.toNumber(item?.draw), awayWin: this.toNumber(item?.awayWin), underOver: this.stringOrNull(item?.underOver), predictedHomeGoals: this.toNumber(item?.predictedHomeGoals), predictedAwayGoals: this.toNumber(item?.predictedAwayGoals), aiProvider: usedProvider, aiModel: usedModel,
      };
      results.push(prediction);
      const context = enriched.find((entry: any) => entry.id === prediction.id);
      console.log(`[AI] Prediction generated ${results.length}: ${prediction.homeTeam} vs ${prediction.awayTeam} | winner: ${prediction.winner || 'undecided'} | confidence: ${prediction.confidence ?? 'n/a'}%`);
      await this.storePrediction(prediction, context);
    }

    this.cache = { expiresAt: Date.now() + 60 * 60 * 1000, data: results };
    console.log(`[AI] Automatic analysis completed: ${results.length}/${selected.length} matches analyzed and stored using ${usedProvider}/${usedModel}.`);
    return results;
  }

  public async getPredictions(limit = 8): Promise<AiMatchPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data.slice(0, limit);
    const rows = await sql`SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at, p.winner, p.advice, p.analysis, p.key_factors, p.confidence, p.home_win, p.draw, p.away_win, p.under_over, p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model FROM football_fixtures f JOIN football_ai_predictions p ON p.fixture_id = f.id WHERE f.kickoff_at >= NOW() - INTERVAL '2 hours' AND f.kickoff_at <= NOW() + INTERVAL '48 hours' ORDER BY f.kickoff_at ASC LIMIT ${limit}`;
    const data = rows.map((row: any) => ({ id: String(row.id), league: row.league_name, homeTeam: row.home_team, awayTeam: row.away_team, startTime: new Date(row.kickoff_at).toISOString(), winner: row.winner || null, advice: row.advice || null, analysis: row.analysis || null, keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [], confidence: this.toNumber(row.confidence), homeWin: this.toNumber(row.home_win), draw: this.toNumber(row.draw), awayWin: this.toNumber(row.away_win), underOver: row.under_over || null, predictedHomeGoals: this.toNumber(row.predicted_home_goals), predictedAwayGoals: this.toNumber(row.predicted_away_goals), aiProvider: row.ai_provider === 'gemini' || row.ai_provider === 'groq' ? row.ai_provider : null, aiModel: row.ai_model || null }));
    if (data.length) this.cache = { expiresAt: Date.now() + 30 * 60 * 1000, data };
    return data;
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

  private async storeFixture(fixture: any): Promise<void> {
    const f = this.normalizeFixture(fixture);
    await sql`INSERT INTO football_fixtures (id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, updated_at) VALUES (${f.id}, ${f.leagueId}, ${f.league}, ${f.country}, ${f.season}, ${f.homeId}, ${f.home}, ${f.awayId}, ${f.away}, ${f.kickoff}, ${f.status}, ${f.homeScore}, ${f.awayScore}, ${JSON.stringify(fixture)}, NOW()) ON CONFLICT (id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, country=EXCLUDED.country, season=EXCLUDED.season, home_team_id=EXCLUDED.home_team_id, home_team=EXCLUDED.home_team, away_team_id=EXCLUDED.away_team_id, away_team=EXCLUDED.away_team, kickoff_at=EXCLUDED.kickoff_at, status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, raw_data=EXCLUDED.raw_data, updated_at=NOW()`;
  }

  private async storePrediction(prediction: AiMatchPrediction, context: any): Promise<void> {
    await sql`INSERT INTO football_ai_predictions (fixture_id, winner, advice, analysis, key_factors, confidence, home_win, draw, away_win, under_over, predicted_home_goals, predicted_away_goals, ai_provider, ai_model, source_prediction, updated_at) VALUES (${prediction.id}, ${prediction.winner}, ${prediction.advice}, ${prediction.analysis}, ${JSON.stringify(prediction.keyFactors)}, ${prediction.confidence}, ${prediction.homeWin}, ${prediction.draw}, ${prediction.awayWin}, ${prediction.underOver}, ${prediction.predictedHomeGoals}, ${prediction.predictedAwayGoals}, ${prediction.aiProvider}, ${prediction.aiModel}, ${JSON.stringify(context?.apiPrediction || null)}, NOW()) ON CONFLICT (fixture_id) DO UPDATE SET winner=EXCLUDED.winner, advice=EXCLUDED.advice, analysis=EXCLUDED.analysis, key_factors=EXCLUDED.key_factors, confidence=EXCLUDED.confidence, home_win=EXCLUDED.home_win, draw=EXCLUDED.draw, away_win=EXCLUDED.away_win, under_over=EXCLUDED.under_over, predicted_home_goals=EXCLUDED.predicted_home_goals, predicted_away_goals=EXCLUDED.predicted_away_goals, ai_provider=EXCLUDED.ai_provider, ai_model=EXCLUDED.ai_model, source_prediction=EXCLUDED.source_prediction, updated_at=NOW()`;
  }

  private async getStoredHistory(fixture: any) {
    const homeId = fixture.homeId ?? null; const awayId = fixture.awayId ?? null;
    if (!homeId && !awayId) return [];
    return sql`SELECT id, league_name AS league, home_team, away_team, kickoff_at, status, home_score, away_score FROM football_fixtures WHERE kickoff_at < ${fixture.kickoff} AND status IN ('FT','AET','PEN') AND (home_team_id IN (${homeId}, ${awayId}) OR away_team_id IN (${homeId}, ${awayId})) ORDER BY kickoff_at DESC LIMIT 12`;
  }

  private normalizeFixture(item: any) {
    return { id: String(item.fixture?.id), leagueId: item.league?.id ? Number(item.league.id) : null, league: item.league?.name || 'Football', country: item.league?.country || '', season: item.league?.season ? Number(item.league.season) : null, homeId: item.teams?.home?.id ? Number(item.teams.home.id) : null, home: item.teams?.home?.name || 'Home', awayId: item.teams?.away?.id ? Number(item.teams.away.id) : null, away: item.teams?.away?.name || 'Away', kickoff: item.fixture?.date || new Date().toISOString(), status: String(item.fixture?.status?.short || 'NS'), homeScore: this.toNumber(item.goals?.home), awayScore: this.toNumber(item.goals?.away) };
  }

  private parseJson(raw: string): any { const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error('AI returned invalid football analysis JSON'); } }
  private stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
  private toNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(String(value).replace('%', '').trim()); return Number.isFinite(n) ? n : null; }
  private formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
}

export const aiPredictionService = new AiPredictionService();
