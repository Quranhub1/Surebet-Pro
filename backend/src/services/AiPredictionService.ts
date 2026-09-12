import { sql } from '../lib/db';
import { generateSingleWithAi, getActiveAiConfig, type AiProvider } from './AiModelService';
import { footballDataService, type FootballDataMatch } from './FootballDataService';

export interface AiMatchPrediction {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; advice: string | null; analysis: string | null; keyFactors: string[];
  confidence: number | null; homeWin: number | null; draw: number | null; awayWin: number | null;
  underOver: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  aiProvider: AiProvider | null; aiModel: string | null;
}

const AI_BATCH_SIZE = 6;
const AI_OUTPUT_TOKENS = 3000;
const ANALYSIS_CACHE_MS = 12 * 60 * 60 * 1000;

export class AiPredictionService {
  private cache: { expiresAt: number; data: AiMatchPrediction[] } | null = null;

  public async runAutomaticAnalysis(_limit = Number.MAX_SAFE_INTEGER): Promise<AiMatchPrediction[]> {
    const aiConfig = getActiveAiConfig();
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
    const groqConfigured = Boolean(process.env.GROQ_API_KEY);
    if (!geminiConfigured && !groqConfigured) throw new Error('Neither Gemini nor Groq API key is configured.');
    if (!footballDataService.isConfigured()) throw new Error('FOOTBALL_DATA_API_TOKEN is not configured.');

    const upcoming = await footballDataService.getUpcomingMatches(7);
    const selected = upcoming;
    console.log(`[FootballData] Loaded ${upcoming.length} upcoming matches from football-data.org; selected ${selected.length} for complete analysis.`);

    if (!selected.length) {
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      await this.syncCompletedHistory(7);
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = 'no_fixtures' WHERE id = 1`;
      return [];
    }

    selected.forEach((match, index) => console.log(`[AI] Game ${index + 1}/${selected.length}: ${match.homeTeam} vs ${match.awayTeam} | ${match.league} | kickoff ${match.kickoff} | football-data ${match.id}`));
    await Promise.all(selected.map(match => this.storeFixture(match)));
    await this.syncCompletedHistory(7);

    const enriched = await Promise.all(selected.map(async match => ({ fixture: this.normalizeFixture(match), history: await this.getStoredHistory(match) })));
    const system = `You are SureBet Pro's football analysis AI. Analyze football only. Never mention bookmakers, odds, stakes, ROI, arbitrage, gambling or betting advice. Use only the supplied fixture data and stored completed-game history. Do not invent injuries, lineups, statistics, form or results. Return ONLY valid JSON with a top-level predictions array. Every supplied fixture must receive exactly one prediction. Each prediction must contain id, winner, advice, analysis, keyFactors, confidence, homeWin, draw, awayWin, underOver, predictedHomeGoals, predictedAwayGoals. analysis must be 2-4 sentences. keyFactors must contain 3-6 short evidence-based points. confidence and probabilities are 0-100; probabilities should sum to approximately 100.`;

    const results: AiMatchPrediction[] = [];
    const configuredProviders: AiProvider[] = [...(geminiConfigured ? ['gemini' as AiProvider] : []), ...(groqConfigured ? ['groq' as AiProvider] : [])];
    if (!configuredProviders.length) throw new Error('No configured AI provider is available.');
    const providerPreference = await this.getProviderPreference(configuredProviders, aiConfig.provider);
    console.log(`[AI] Dynamic provider preference: ${providerPreference.join(' -> ')}.`);

    for (let batchStart = 0; batchStart < enriched.length; batchStart += AI_BATCH_SIZE) {
      const batch = enriched.slice(batchStart, batchStart + AI_BATCH_SIZE);
      const batchNumber = Math.floor(batchStart / AI_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(enriched.length / AI_BATCH_SIZE);
      const primary = providerPreference[(batchNumber - 1) % providerPreference.length];
      const fallback = providerPreference.find(provider => provider !== primary);
      const prompt = `Analyze ONLY these ${batch.length} upcoming fixtures. Preserve each fixture id exactly. The fixture feed is authoritative for team names, competition and kickoff. Historical games are evidence when available.\n\n${JSON.stringify(batch, null, 2)}`;
      let raw = '';
      let usedProvider: AiProvider | null = null;
      try {
        raw = await generateSingleWithAi({ provider: primary, system, prompt, temperature: 0.2, maxTokens: AI_OUTPUT_TOKENS });
        usedProvider = primary;
        console.log(`[AI] Batch ${batchNumber}/${totalBatches} completed with ${primary} (${batch.length} games).`);
      } catch (error) {
        console.warn(`[AI] Batch ${batchNumber}/${totalBatches} ${primary} failed:`, error instanceof Error ? error.message : error);
        if (fallback) {
          try {
            raw = await generateSingleWithAi({ provider: fallback, system, prompt, temperature: 0.2, maxTokens: AI_OUTPUT_TOKENS });
            usedProvider = fallback;
            console.log(`[AI] Batch ${batchNumber}/${totalBatches} fallback completed with ${fallback} (${batch.length} games).`);
          } catch (fallbackError) {
            console.error(`[AI] Batch ${batchNumber}/${totalBatches} fallback ${fallback} failed:`, fallbackError instanceof Error ? fallbackError.message : fallbackError);
          }
        }
      }
      if (!raw || !usedProvider) { console.error(`[AI] Batch ${batchNumber}/${totalBatches} produced no analysis; continuing so other fetched games are still processed.`); continue; }
      try {
        const parsed = this.parseJson(raw);
        const aiItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.predictions) ? parsed.predictions : parsed?.prediction ? [parsed.prediction] : [];
        const byId = new Map(batch.map(entry => [String(entry.fixture.id), entry.fixture]));
        const byTeams = new Map(batch.map(entry => [`${entry.fixture.home.trim().toLowerCase()}|${entry.fixture.away.trim().toLowerCase()}`, entry.fixture]));
        const generatedIds = new Set<string>();
        for (const item of aiItems) {
          const rawId = item?.id ?? item?.fixtureId ?? item?.fixture_id;
          let match = rawId != null ? byId.get(String(rawId)) : undefined;
          if (!match) {
            const home = item?.homeTeam ?? item?.home_team ?? item?.home;
            const away = item?.awayTeam ?? item?.away_team ?? item?.away;
            if (home && away) match = byTeams.get(`${String(home).trim().toLowerCase()}|${String(away).trim().toLowerCase()}`);
          }
          if (!match || generatedIds.has(String(match.id))) continue;
          generatedIds.add(String(match.id));
          const prediction: AiMatchPrediction = {
            id: String(match.id), league: match.league, homeTeam: match.home, awayTeam: match.away, startTime: match.kickoff,
            winner: item?.winner === match.home || item?.winner === match.away ? item.winner : null,
            advice: this.stringOrNull(item?.advice), analysis: this.stringOrNull(item?.analysis),
            keyFactors: Array.isArray(item?.keyFactors) ? item.keyFactors.filter((v: unknown): v is string => typeof v === 'string').slice(0, 6) : [],
            confidence: this.toNumber(item?.confidence), homeWin: this.toNumber(item?.homeWin), draw: this.toNumber(item?.draw), awayWin: this.toNumber(item?.awayWin),
            underOver: this.stringOrNull(item?.underOver), predictedHomeGoals: this.toNumber(item?.predictedHomeGoals), predictedAwayGoals: this.toNumber(item?.predictedAwayGoals),
            aiProvider: usedProvider, aiModel: usedProvider === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
          };
          results.push(prediction);
          const context = batch.find(entry => entry.fixture.id === prediction.id);
          await this.storePrediction(prediction, context);
          console.log(`[AI] Prediction generated ${results.length}/${selected.length}: ${prediction.homeTeam} vs ${prediction.awayTeam} | ${prediction.league} | ${usedProvider}`);
        }
        const missing = batch.filter(entry => !generatedIds.has(entry.fixture.id)).map(entry => `${entry.fixture.home} vs ${entry.fixture.away}`);
        if (missing.length) console.warn(`[AI] Batch ${batchNumber}/${totalBatches} returned ${missing.length} fixture(s) without predictions: ${missing.join('; ')}`);
      } catch (error) { console.error(`[AI] Batch ${batchNumber}/${totalBatches} returned invalid analysis JSON:`, error instanceof Error ? error.message : error); }
    }
    this.cache = { expiresAt: Date.now() + ANALYSIS_CACHE_MS, data: results };
    console.log(`[AI] Automatic analysis completed: ${results.length}/${selected.length} matches stored across ${Math.ceil(selected.length / AI_BATCH_SIZE)} small AI batches.`);
    return results;
  }

  public async getPredictions(limit = 100): Promise<AiMatchPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data.slice(0, limit);
    const rows = await sql`SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at, p.winner, p.advice, p.analysis, p.key_factors, p.confidence, p.home_win, p.draw, p.away_win, p.under_over, p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model FROM football_fixtures f JOIN football_ai_predictions p ON p.fixture_id = f.id WHERE f.kickoff_at >= NOW() - INTERVAL '2 hours' AND f.kickoff_at <= NOW() + INTERVAL '7 days' ORDER BY f.kickoff_at ASC LIMIT ${limit}`;
    const data = rows.map((row: any) => this.rowToPrediction(row));
    if (data.length) this.cache = { expiresAt: Date.now() + 30 * 60 * 1000, data };
    return data;
  }

  private async getProviderPreference(configured: AiProvider[], preferred: AiProvider): Promise<AiProvider[]> {
    if (configured.length < 2) return configured;
    try {
      const rows = await sql`SELECT p.ai_provider, COUNT(*)::int AS evaluated, SUM(CASE WHEN p.winner = CASE WHEN f.home_score > f.away_score THEN f.home_team WHEN f.away_score > f.home_score THEN f.away_team ELSE 'Draw' END THEN 1 ELSE 0 END)::int AS correct FROM football_ai_predictions p JOIN football_fixtures f ON f.id = p.fixture_id WHERE p.ai_provider IN ('gemini','groq') AND f.status IN ('FINISHED','AWAITING_PENALTIES','FINISHED_AET','FINISHED_PEN','FT','AET','PEN') GROUP BY p.ai_provider`;
      const scores = new Map<string, number>();
      for (const row of rows as any[]) {
        const evaluated = Number(row.evaluated) || 0;
        const correct = Number(row.correct) || 0;
        scores.set(String(row.ai_provider), evaluated >= 5 ? correct / evaluated : 0.5);
      }
      return [...configured].sort((a, b) => {
        const scoreDiff = (scores.get(b) ?? 0.5) - (scores.get(a) ?? 0.5);
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
        if (a === preferred) return -1;
        if (b === preferred) return 1;
        return a.localeCompare(b);
      });
    } catch (error) {
      console.warn('[AI] Provider performance lookup failed; using configured preference:', error instanceof Error ? error.message : error);
      return [...configured].sort(provider => provider === preferred ? -1 : 1);
    }
  }

  private async syncCompletedHistory(daysBack: number): Promise<void> {
    try {
      const completed = await footballDataService.getCompletedMatches(daysBack);
      if (!completed.length) { console.log(`[History] No completed football-data.org matches found in the last ${daysBack} days.`); return; }
      await Promise.all(completed.map(match => this.storeFixture(match)));
      console.log(`[History] Saved ${completed.length} completed football-data.org matches for prediction history.`);
    } catch (error) { console.warn('[History] Completed-game sync failed:', error instanceof Error ? error.message : error); }
  }

  private async storeFixture(match: FootballDataMatch): Promise<void> {
    await sql`INSERT INTO football_fixtures (id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, updated_at) VALUES (${match.id}, ${null}, ${match.league}, ${match.country}, ${match.season}, ${match.homeId}, ${match.homeTeam}, ${match.awayId}, ${match.awayTeam}, ${match.kickoff}, ${match.status}, ${match.homeScore}, ${match.awayScore}, ${JSON.stringify(match.raw)}, NOW()) ON CONFLICT (id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, country=EXCLUDED.country, season=EXCLUDED.season, home_team_id=EXCLUDED.home_team_id, home_team=EXCLUDED.home_team, away_team_id=EXCLUDED.away_team_id, away_team=EXCLUDED.away_team, kickoff_at=EXCLUDED.kickoff_at, status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, raw_data=EXCLUDED.raw_data, updated_at=NOW()`;
  }

  private async storePrediction(prediction: AiMatchPrediction, context: any): Promise<void> {
    await sql`INSERT INTO football_ai_predictions (fixture_id, winner, advice, analysis, key_factors, confidence, home_win, draw, away_win, under_over, predicted_home_goals, predicted_away_goals, ai_provider, ai_model, source_prediction, updated_at) VALUES (${prediction.id}, ${prediction.winner}, ${prediction.advice}, ${prediction.analysis}, ${JSON.stringify(prediction.keyFactors)}, ${prediction.confidence}, ${prediction.homeWin}, ${prediction.draw}, ${prediction.awayWin}, ${prediction.underOver}, ${prediction.predictedHomeGoals}, ${prediction.predictedAwayGoals}, ${prediction.aiProvider}, ${prediction.aiModel}, ${JSON.stringify(context?.fixture?.raw || null)}, NOW()) ON CONFLICT (fixture_id) DO UPDATE SET winner=EXCLUDED.winner, advice=EXCLUDED.advice, analysis=EXCLUDED.analysis, key_factors=EXCLUDED.key_factors, confidence=EXCLUDED.confidence, home_win=EXCLUDED.home_win, draw=EXCLUDED.draw, away_win=EXCLUDED.away_win, under_over=EXCLUDED.under_over, predicted_home_goals=EXCLUDED.predicted_home_goals, predicted_away_goals=EXCLUDED.predicted_away_goals, ai_provider=EXCLUDED.ai_provider, ai_model=EXCLUDED.ai_model, source_prediction=EXCLUDED.source_prediction, updated_at=NOW()`;
  }

  private async getStoredHistory(match: FootballDataMatch) {
    if (!match.homeId && !match.awayId) return [];
    return sql`SELECT id, league_name AS league, home_team, away_team, kickoff_at, status, home_score, away_score FROM football_fixtures WHERE kickoff_at < ${match.kickoff} AND status IN ('FINISHED','AWAITING_PENALTIES','FINISHED_AET','FINISHED_PEN','FT','AET','PEN') AND (home_team_id IN (${match.homeId}, ${match.awayId}) OR away_team_id IN (${match.homeId}, ${match.awayId})) ORDER BY kickoff_at DESC LIMIT 12`;
  }

  private normalizeFixture(match: FootballDataMatch) { return { id: match.id, league: match.league, country: match.country, home: match.homeTeam, away: match.awayTeam, kickoff: match.kickoff, status: match.status, homeScore: match.homeScore, awayScore: match.awayScore, raw: match.raw }; }
  private rowToPrediction(row: any): AiMatchPrediction { return { id: String(row.id), league: row.league_name || 'Football', homeTeam: row.home_team || 'Home', awayTeam: row.away_team || 'Away', startTime: new Date(row.kickoff_at).toISOString(), winner: row.winner || null, advice: row.advice || null, analysis: row.analysis || null, keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [], confidence: this.toNumber(row.confidence), homeWin: this.toNumber(row.home_win), draw: this.toNumber(row.draw), awayWin: this.toNumber(row.away_win), underOver: row.under_over || null, predictedHomeGoals: this.toNumber(row.predicted_home_goals), predictedAwayGoals: this.toNumber(row.predicted_away_goals), aiProvider: row.ai_provider === 'gemini' || row.ai_provider === 'groq' ? row.ai_provider : null, aiModel: row.ai_model || null }; }
  private parseJson(raw: string): any { const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error('AI returned invalid football analysis JSON'); } }
  private stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
  private toNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(String(value).replace('%', '').trim()); return Number.isFinite(n) ? n : null; }
}

export const aiPredictionService = new AiPredictionService();
