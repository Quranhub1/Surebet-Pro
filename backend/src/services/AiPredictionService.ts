import { sql } from '../lib/db';
import { generateWithAi, getActiveAiConfig, type AiProvider } from './AiModelService';
import { footballDataService, type FootballDataMatch } from './FootballDataService';

export interface AiMatchPrediction {
  id: string; league: string; homeTeam: string; awayTeam: string; startTime: string;
  winner: string | null; advice: string | null; analysis: string | null; keyFactors: string[];
  confidence: number | null; homeWin: number | null; draw: number | null; awayWin: number | null;
  underOver: string | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null;
  aiProvider: AiProvider | null; aiModel: string | null;
}

const AI_OUTPUT_TOKENS = 12000;
const ANALYSIS_CACHE_MS = 12 * 60 * 60 * 1000;

export class AiPredictionService {
  private cache: { expiresAt: number; data: AiMatchPrediction[] } | null = null;

  public async runAutomaticAnalysis(limit = 40): Promise<AiMatchPrediction[]> {
    const aiConfig = getActiveAiConfig();
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY);
    const groqConfigured = Boolean(process.env.GROQ_API_KEY);
    if (!geminiConfigured && !groqConfigured) throw new Error('Neither Gemini nor Groq API key is configured.');
    if (!footballDataService.isConfigured()) throw new Error('FOOTBALL_DATA_API_TOKEN is not configured.');

    const upcoming = await footballDataService.getUpcomingMatches(7);
    const selected = upcoming.slice(0, limit);
    console.log(`[FootballData] Loaded ${upcoming.length} upcoming matches from football-data.org; selected ${selected.length}.`);

    if (!selected.length) {
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = 'no_fixtures' WHERE id = 1`;
      return [];
    }

    selected.forEach((match, index) => console.log(`[AI] Game ${index + 1}/${selected.length}: ${match.homeTeam} vs ${match.awayTeam} | ${match.league} | kickoff ${match.kickoff} | football-data ${match.id}`));
    await Promise.all(selected.map(match => this.storeFixture(match)));

    const enriched = await Promise.all(selected.map(async match => ({ fixture: this.normalizeFixture(match), history: await this.getStoredHistory(match) })));
    const system = `You are SureBet Pro's football analysis AI. Your sole job is football analysis, not betting. Never mention bookmakers, odds, stakes, ROI, arbitrage, gambling or betting advice. Use only the supplied football fixture data and stored completed-game history. Do not invent injuries, lineups, statistics, form or results. Return ONLY valid JSON with a top-level predictions array. Every selected fixture must receive one prediction. Each prediction must contain id, winner, advice, analysis, keyFactors, confidence, homeWin, draw, awayWin, underOver, predictedHomeGoals, predictedAwayGoals. analysis must be 2-4 sentences. keyFactors must contain 3-6 short evidence-based points. confidence and probabilities are 0-100; probabilities should sum to approximately 100.`;
    const prompt = `Analyze these upcoming football fixtures. The fixture feed is authoritative for team names, competition and kickoff. Historical games are persistent database evidence and should be considered when available. Do not invent missing facts.\n\n${JSON.stringify(enriched, null, 2)}`;

    const primaryProvider = aiConfig.provider;
    const reviewerProvider: AiProvider = primaryProvider === 'gemini' ? 'groq' : 'gemini';
    const reviewerConfigured = reviewerProvider === 'gemini' ? geminiConfigured : groqConfigured;
    let primaryRaw = '';
    let primaryUsed: AiProvider = primaryProvider;
    let finalRaw = '';
    let finalProvider: AiProvider = primaryProvider;

    try {
      if (aiConfig.configured) {
        primaryRaw = await generateWithAi({ provider: primaryProvider, system, prompt, temperature: 0.2, maxTokens: AI_OUTPUT_TOKENS });
        console.log(`[AI] Primary analysis completed with ${primaryProvider}.`);
      }
    } catch (error) {
      console.warn(`[AI] Primary ${primaryProvider} analysis failed:`, error instanceof Error ? error.message : error);
    }

    if (!primaryRaw) {
      if (!reviewerConfigured) throw new Error(`AI analysis failed and ${reviewerProvider.toUpperCase()} is not configured.`);
      primaryRaw = await generateWithAi({ provider: reviewerProvider, system, prompt, temperature: 0.2, maxTokens: AI_OUTPUT_TOKENS });
      primaryUsed = reviewerProvider;
      finalProvider = reviewerProvider;
      console.log(`[AI] Fallback analysis completed with ${reviewerProvider}.`);
    } else if (reviewerConfigured) {
      const reviewSystem = `${system} You are the second-pass reviewer. Independently check the first pass against the supplied football evidence, correct unsupported claims, normalize probabilities and ensure every selected fixture has a prediction. Return the complete corrected JSON.`;
      const reviewPrompt = `${prompt}\n\nFIRST-PASS ANALYSIS FROM ${primaryProvider.toUpperCase()}:\n${primaryRaw}\n\nReturn the complete final corrected predictions JSON. Do not omit fixtures.`;
      try {
        finalRaw = await generateWithAi({ provider: reviewerProvider, system: reviewSystem, prompt: reviewPrompt, temperature: 0.15, maxTokens: AI_OUTPUT_TOKENS });
        finalProvider = reviewerProvider;
        console.log(`[AI] Second-pass review completed with ${reviewerProvider}; both AI models were used.`);
      } catch (error) {
        console.warn(`[AI] Second-pass ${reviewerProvider} review failed; retaining ${primaryUsed} analysis:`, error instanceof Error ? error.message : error);
        finalRaw = primaryRaw;
        finalProvider = primaryUsed;
      }
    } else {
      finalRaw = primaryRaw;
    }

    const parsed = this.parseJson(finalRaw);
    const aiItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.predictions) ? parsed.predictions : parsed?.prediction ? [parsed.prediction] : [];
    const byId = new Map(selected.map(match => [String(match.id), match]));
    const byTeams = new Map(selected.map(match => [`${match.homeTeam.trim().toLowerCase()}|${match.awayTeam.trim().toLowerCase()}`, match]));
    const results: AiMatchPrediction[] = [];

    for (const item of aiItems) {
      const rawId = item?.id ?? item?.fixtureId ?? item?.fixture_id;
      let match = rawId != null ? byId.get(String(rawId)) : undefined;
      if (!match) {
        const home = item?.homeTeam ?? item?.home_team ?? item?.home;
        const away = item?.awayTeam ?? item?.away_team ?? item?.away;
        if (home && away) match = byTeams.get(`${String(home).trim().toLowerCase()}|${String(away).trim().toLowerCase()}`);
      }
      if (!match) continue;

      const prediction: AiMatchPrediction = {
        id: String(match.id), league: match.league, homeTeam: match.homeTeam, awayTeam: match.awayTeam, startTime: match.kickoff,
        winner: item?.winner === match.homeTeam || item?.winner === match.awayTeam ? item.winner : null,
        advice: this.stringOrNull(item?.advice), analysis: this.stringOrNull(item?.analysis),
        keyFactors: Array.isArray(item?.keyFactors) ? item.keyFactors.filter((v: unknown): v is string => typeof v === 'string').slice(0, 6) : [],
        confidence: this.toNumber(item?.confidence), homeWin: this.toNumber(item?.homeWin), draw: this.toNumber(item?.draw), awayWin: this.toNumber(item?.awayWin),
        underOver: this.stringOrNull(item?.underOver), predictedHomeGoals: this.toNumber(item?.predictedHomeGoals), predictedAwayGoals: this.toNumber(item?.predictedAwayGoals),
        aiProvider: finalProvider, aiModel: finalProvider === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
      };
      results.push(prediction);
      const context = enriched.find(entry => entry.fixture.id === prediction.id);
      await this.storePrediction(prediction, context);
      console.log(`[AI] Prediction generated ${results.length}: ${prediction.homeTeam} vs ${prediction.awayTeam} | winner: ${prediction.winner || 'undecided'} | confidence: ${prediction.confidence ?? 'n/a'}%`);
    }

    this.cache = { expiresAt: Date.now() + ANALYSIS_CACHE_MS, data: results };
    console.log(`[AI] Automatic analysis completed: ${results.length}/${selected.length} matches stored using ${primaryUsed} primary and ${finalProvider} final pass.`);
    return results;
  }

  public async getPredictions(limit = 40): Promise<AiMatchPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data.slice(0, limit);
    const rows = await sql`SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at, p.winner, p.advice, p.analysis, p.key_factors, p.confidence, p.home_win, p.draw, p.away_win, p.under_over, p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model FROM football_fixtures f JOIN football_ai_predictions p ON p.fixture_id = f.id WHERE f.kickoff_at >= NOW() - INTERVAL '2 hours' AND f.kickoff_at <= NOW() + INTERVAL '7 days' ORDER BY f.kickoff_at ASC LIMIT ${limit}`;
    const data = rows.map((row: any) => this.rowToPrediction(row));
    if (data.length) this.cache = { expiresAt: Date.now() + 30 * 60 * 1000, data };
    return data;
  }

  private async storeFixture(match: FootballDataMatch): Promise<void> {
    // football-data.org uses alphanumeric competition codes (e.g. BSA, PL, SA),
    // while the existing database column is integer. league_name is the canonical
    // competition value for this integration, so keep league_id NULL rather than
    // attempting to insert a string into the legacy integer column.
    await sql`INSERT INTO football_fixtures (id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, updated_at) VALUES (${match.id}, ${null}, ${match.league}, ${match.country}, ${match.season}, ${match.homeId}, ${match.homeTeam}, ${match.awayId}, ${match.awayTeam}, ${match.kickoff}, ${match.status}, ${match.homeScore}, ${match.awayScore}, ${JSON.stringify(match.raw)}, NOW()) ON CONFLICT (id) DO UPDATE SET league_id=EXCLUDED.league_id, league_name=EXCLUDED.league_name, country=EXCLUDED.country, season=EXCLUDED.season, home_team_id=EXCLUDED.home_team_id, home_team=EXCLUDED.home_team, away_team_id=EXCLUDED.away_team_id, away_team=EXCLUDED.away_team, kickoff_at=EXCLUDED.kickoff_at, status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, raw_data=EXCLUDED.raw_data, updated_at=NOW()`;
  }

  private async storePrediction(prediction: AiMatchPrediction, context: any): Promise<void> {
    await sql`INSERT INTO football_ai_predictions (fixture_id, winner, advice, analysis, key_factors, confidence, home_win, draw, away_win, under_over, predicted_home_goals, predicted_away_goals, ai_provider, ai_model, source_prediction, updated_at) VALUES (${prediction.id}, ${prediction.winner}, ${prediction.advice}, ${prediction.analysis}, ${JSON.stringify(prediction.keyFactors)}, ${prediction.confidence}, ${prediction.homeWin}, ${prediction.draw}, ${prediction.awayWin}, ${prediction.underOver}, ${prediction.predictedHomeGoals}, ${prediction.predictedAwayGoals}, ${prediction.aiProvider}, ${prediction.aiModel}, ${JSON.stringify(context?.fixture?.raw || null)}, NOW()) ON CONFLICT (fixture_id) DO UPDATE SET winner=EXCLUDED.winner, advice=EXCLUDED.advice, analysis=EXCLUDED.analysis, key_factors=EXCLUDED.key_factors, confidence=EXCLUDED.confidence, home_win=EXCLUDED.home_win, draw=EXCLUDED.draw, away_win=EXCLUDED.away_win, under_over=EXCLUDED.under_over, predicted_home_goals=EXCLUDED.predicted_home_goals, predicted_away_goals=EXCLUDED.predicted_away_goals, ai_provider=EXCLUDED.ai_provider, ai_model=EXCLUDED.ai_model, source_prediction=EXCLUDED.source_prediction, updated_at=NOW()`;
  }

  private async getStoredHistory(match: FootballDataMatch) {
    if (!match.homeId && !match.awayId) return [];
    return sql`SELECT id, league_name AS league, home_team, away_team, kickoff_at, status, home_score, away_score FROM football_fixtures WHERE kickoff_at < ${match.kickoff} AND status IN ('FINISHED','FT','AET','PEN') AND (home_team_id IN (${match.homeId}, ${match.awayId}) OR away_team_id IN (${match.homeId}, ${match.awayId})) ORDER BY kickoff_at DESC LIMIT 12`;
  }

  private normalizeFixture(match: FootballDataMatch) { return { id: match.id, league: match.league, country: match.country, home: match.homeTeam, away: match.awayTeam, kickoff: match.kickoff, status: match.status, homeScore: match.homeScore, awayScore: match.awayScore, raw: match.raw }; }

  private rowToPrediction(row: any): AiMatchPrediction {
    return { id: String(row.id), league: row.league_name || 'Football', homeTeam: row.home_team || 'Home', awayTeam: row.away_team || 'Away', startTime: new Date(row.kickoff_at).toISOString(), winner: row.winner || null, advice: row.advice || null, analysis: row.analysis || null, keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [], confidence: this.toNumber(row.confidence), homeWin: this.toNumber(row.home_win), draw: this.toNumber(row.draw), awayWin: this.toNumber(row.away_win), underOver: row.under_over || null, predictedHomeGoals: this.toNumber(row.predicted_home_goals), predictedAwayGoals: this.toNumber(row.predicted_away_goals), aiProvider: row.ai_provider === 'gemini' || row.ai_provider === 'groq' ? row.ai_provider : null, aiModel: row.ai_model || null };
  }

  private parseJson(raw: string): any { const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error('AI returned invalid football analysis JSON'); } }
  private stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
  private toNumber(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const n = Number(String(value).replace('%', '').trim()); return Number.isFinite(n) ? n : null; }
}

export const aiPredictionService = new AiPredictionService();
