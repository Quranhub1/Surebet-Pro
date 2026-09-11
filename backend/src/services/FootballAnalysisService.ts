import axios from 'axios';
import { sql } from '../lib/db';
import { generateWithAi, getActiveAiConfig, type AiProvider } from './AiModelService';

const API_BASE_URL = 'https://v3.football.api-sports.io';

type Fixture = {
  id: string;
  leagueId: number | null;
  league: string;
  country: string;
  season: number | null;
  homeId: number | null;
  home: string;
  awayId: number | null;
  away: string;
  kickoff: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  raw: any;
};

export interface FootballPrediction {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  winner: string | null;
  advice: string | null;
  analysis: string | null;
  keyFactors: string[];
  confidence: number | null;
  homeWin: number | null;
  draw: number | null;
  awayWin: number | null;
  underOver: string | null;
  predictedHomeGoals: number | null;
  predictedAwayGoals: number | null;
  aiProvider: AiProvider | null;
  aiModel: string | null;
}

export class FootballAnalysisService {
  private cache: { expiresAt: number; data: FootballPrediction[] } | null = null;

  private async api(path: string, params: Record<string, string | number>) {
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY;
    if (!key) throw new Error('API-Football key is not configured');
    const response = await axios.get(`${API_BASE_URL}${path}`, {
      params,
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
    });
    if (response.data?.errors && Object.keys(response.data.errors).length) {
      throw new Error(Object.values(response.data.errors).join('; '));
    }
    return response.data;
  }

  public async runAutomaticAnalysis(limit = 8): Promise<FootballPrediction[]> {
    const ai = getActiveAiConfig();
    if (!ai.configured) throw new Error(`AI prediction model is not configured: ${ai.provider}`);

    const today = new Date();
    const dates = [this.date(today), this.date(new Date(today.getTime() + 86400000))];
    let fixtures: Fixture[] = [];

    for (const date of dates) {
      const data = await this.api('/fixtures', { date });
      fixtures = (data.results || []).map((item: any) => this.normalizeFixture(item))
        .filter((fixture: Fixture) => ['NS', 'TBD'].includes(fixture.status));
      if (fixtures.length) break;
    }

    fixtures = fixtures.slice(0, limit);
    if (!fixtures.length) {
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      return [];
    }

    await Promise.all(fixtures.map(fixture => this.storeFixture(fixture)));

    const predictions: FootballPrediction[] = [];
    for (const fixture of fixtures) {
      try {
        const result = await this.analyzeFixture(fixture, ai);
        if (result) predictions.push(result);
      } catch (error) {
        console.error(`[AI] Failed to analyze ${fixture.home} vs ${fixture.away}:`, error instanceof Error ? error.message : error);
      }
    }

    this.cache = { expiresAt: Date.now() + 60 * 60 * 1000, data: predictions };
    await sql`UPDATE system_settings SET last_run_at = NOW(), last_run_status = ${predictions.length ? 'success' : 'no_fixtures'} WHERE id = 1`;
    console.log(`[AI] Automatic football analysis completed: ${predictions.length}/${fixtures.length} matches analyzed and stored.`);
    return predictions;
  }

  public async getPredictions(limit = 8): Promise<FootballPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data.slice(0, limit);

    const rows = await sql`
      SELECT f.id, f.league_name, f.home_team, f.away_team, f.kickoff_at,
             p.winner, p.advice, p.analysis, p.key_factors, p.confidence,
             p.home_win, p.draw, p.away_win, p.under_over,
             p.predicted_home_goals, p.predicted_away_goals, p.ai_provider, p.ai_model
      FROM football_fixtures f
      JOIN football_ai_predictions p ON p.fixture_id = f.id
      WHERE f.kickoff_at >= NOW() - INTERVAL '2 hours'
        AND f.kickoff_at <= NOW() + INTERVAL '48 hours'
      ORDER BY f.kickoff_at ASC
      LIMIT ${limit}
    `;

    const data = rows.map((row: any) => this.mapStoredPrediction(row));
    if (data.length) this.cache = { expiresAt: Date.now() + 30 * 60 * 1000, data };
    return data;
  }

  public async getStoredFixtureCount(): Promise<number> {
    const rows = await sql`SELECT COUNT(*)::int AS count FROM football_fixtures`;
    return Number(rows[0]?.count || 0);
  }

  private async analyzeFixture(fixture: Fixture, ai: { provider: AiProvider; model: string }): Promise<FootballPrediction | null> {
    const [source, history] = await Promise.all([
      this.api('/predictions', { fixture: Number(fixture.id) }),
      this.getStoredHistory(fixture),
    ]);

    const apiPrediction = source.results?.[0]?.predictions || {};
    const teams = source.results?.[0]?.teams || {};
    const sourcePayload = {
      winner: apiPrediction.winner,
      winOrDraw: apiPrediction.win_or_draw,
      underOver: apiPrediction.under_over,
      goals: apiPrediction.goals,
      percent: apiPrediction.percent,
      advice: apiPrediction.advice,
      teams,
    };

    const system = `You are the primary football analysis engine for SureBet Pro. Analyze each fixture using the supplied API-Football forecast and the stored historical results. Your job is analysis, not betting. Never mention bookmakers, odds, stakes, ROI, arbitrage or betting advice. Do not invent injuries, lineups, statistics or results. If evidence is weak, say so. Return valid JSON with exactly these fields: winner, advice, analysis, keyFactors, confidence, homeWin, draw, awayWin, underOver, predictedHomeGoals, predictedAwayGoals. confidence is 0-100. keyFactors is an array of 3-6 short evidence-based points. Probabilities are 0-100 and should sum to about 100. analysis must explain the reasoning in 2-4 sentences.`;
    const prompt = `Analyze this upcoming football match. The database is the application's memory: stored completed games are historical evidence and should be considered alongside the current API forecast.\n\nMATCH:\n${JSON.stringify({ id: fixture.id, league: fixture.league, country: fixture.country, home: fixture.home, away: fixture.away, kickoff: fixture.kickoff }, null, 2)}\n\nAPI-FOOTBALL FORECAST:\n${JSON.stringify(sourcePayload, null, 2)}\n\nSTORED HISTORICAL GAMES FOR THESE TEAMS:\n${JSON.stringify(history, null, 2)}`;

    let raw: string;
    let provider = ai.provider;
    let model = ai.model;
    try {
      raw = await generateWithAi({ provider: ai.provider, system, prompt, temperature: 0.15, maxTokens: 3000 });
    } catch (error) {
      const fallback: AiProvider = ai.provider === 'gemini' ? 'groq' : 'gemini';
      const configured = fallback === 'gemini'
        ? Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY)
        : Boolean(process.env.GROQ_API_KEY);
      if (!configured) throw error;
      raw = await generateWithAi({ provider: fallback, system, prompt, temperature: 0.15, maxTokens: 3000 });
      provider = fallback;
      model = fallback === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite') : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b');
    }

    const parsed = this.parseJson(raw);
    const prediction: FootballPrediction = {
      id: fixture.id,
      league: fixture.league,
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      startTime: fixture.kickoff,
      winner: parsed.winner === fixture.home || parsed.winner === fixture.away ? parsed.winner : null,
      advice: this.stringOrNull(parsed.advice),
      analysis: this.stringOrNull(parsed.analysis),
      keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors.filter((v: unknown): v is string => typeof v === 'string').slice(0, 6) : [],
      confidence: this.numberOrNull(parsed.confidence),
      homeWin: this.numberOrNull(parsed.homeWin),
      draw: this.numberOrNull(parsed.draw),
      awayWin: this.numberOrNull(parsed.awayWin),
      underOver: this.stringOrNull(parsed.underOver),
      predictedHomeGoals: this.numberOrNull(parsed.predictedHomeGoals),
      predictedAwayGoals: this.numberOrNull(parsed.predictedAwayGoals),
      aiProvider: provider,
      aiModel: model,
    };

    await sql`
      INSERT INTO football_ai_predictions
        (fixture_id, winner, advice, analysis, key_factors, confidence, home_win, draw, away_win, under_over, predicted_home_goals, predicted_away_goals, ai_provider, ai_model, source_prediction, updated_at)
      VALUES
        (${fixture.id}, ${prediction.winner}, ${prediction.advice}, ${prediction.analysis}, ${JSON.stringify(prediction.keyFactors)}, ${prediction.confidence}, ${prediction.homeWin}, ${prediction.draw}, ${prediction.awayWin}, ${prediction.underOver}, ${prediction.predictedHomeGoals}, ${prediction.predictedAwayGoals}, ${provider}, ${model}, ${JSON.stringify(sourcePayload)}, NOW())
      ON CONFLICT (fixture_id) DO UPDATE SET
        winner = EXCLUDED.winner, advice = EXCLUDED.advice, analysis = EXCLUDED.analysis,
        key_factors = EXCLUDED.key_factors, confidence = EXCLUDED.confidence,
        home_win = EXCLUDED.home_win, draw = EXCLUDED.draw, away_win = EXCLUDED.away_win,
        under_over = EXCLUDED.under_over, predicted_home_goals = EXCLUDED.predicted_home_goals,
        predicted_away_goals = EXCLUDED.predicted_away_goals, ai_provider = EXCLUDED.ai_provider,
        ai_model = EXCLUDED.ai_model, source_prediction = EXCLUDED.source_prediction, updated_at = NOW()
    `;

    return prediction;
  }

  private async storeFixture(fixture: Fixture): Promise<void> {
    await sql`
      INSERT INTO football_fixtures
        (id, league_id, league_name, country, season, home_team_id, home_team, away_team_id, away_team, kickoff_at, status, home_score, away_score, raw_data, updated_at)
      VALUES
        (${fixture.id}, ${fixture.leagueId}, ${fixture.league}, ${fixture.country}, ${fixture.season}, ${fixture.homeId}, ${fixture.home}, ${fixture.awayId}, ${fixture.away}, ${fixture.kickoff}, ${fixture.status}, ${fixture.homeScore}, ${fixture.awayScore}, ${JSON.stringify(fixture.raw)}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        league_id = EXCLUDED.league_id, league_name = EXCLUDED.league_name, country = EXCLUDED.country,
        season = EXCLUDED.season, home_team_id = EXCLUDED.home_team_id, home_team = EXCLUDED.home_team,
        away_team_id = EXCLUDED.away_team_id, away_team = EXCLUDED.away_team, kickoff_at = EXCLUDED.kickoff_at,
        status = EXCLUDED.status, home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
        raw_data = EXCLUDED.raw_data, updated_at = NOW()
    `;
  }

  private async getStoredHistory(fixture: Fixture) {
    if (!fixture.homeId && !fixture.awayId) return [];
    const rows = await sql`
      SELECT id, league_name AS league, home_team, away_team, kickoff_at, status, home_score, away_score
      FROM football_fixtures
      WHERE kickoff_at < ${fixture.kickoff}
        AND status IN ('FT', 'AET', 'PEN')
        AND (home_team_id = ${fixture.homeId} OR away_team_id = ${fixture.homeId} OR home_team_id = ${fixture.awayId} OR away_team_id = ${fixture.awayId})
      ORDER BY kickoff_at DESC
      LIMIT 12
    `;
    return rows;
  }

  private normalizeFixture(item: any): Fixture {
    return {
      id: String(item.fixture?.id),
      leagueId: item.league?.id ? Number(item.league.id) : null,
      league: item.league?.name || 'Football',
      country: item.league?.country || '',
      season: item.league?.season ? Number(item.league.season) : null,
      homeId: item.teams?.home?.id ? Number(item.teams.home.id) : null,
      home: item.teams?.home?.name || 'Home',
      awayId: item.teams?.away?.id ? Number(item.teams.away.id) : null,
      away: item.teams?.away?.name || 'Away',
      kickoff: item.fixture?.date || new Date().toISOString(),
      status: String(item.fixture?.status?.short || 'NS'),
      homeScore: this.toNumber(item.goals?.home),
      awayScore: this.toNumber(item.goals?.away),
      raw: item,
    };
  }

  private mapStoredPrediction(row: any): FootballPrediction {
    return {
      id: String(row.id), league: row.league_name, homeTeam: row.home_team, awayTeam: row.away_team,
      startTime: new Date(row.kickoff_at).toISOString(), winner: row.winner || null, advice: row.advice || null,
      analysis: row.analysis || null, keyFactors: Array.isArray(row.key_factors) ? row.key_factors : [],
      confidence: this.numberOrNull(row.confidence), homeWin: this.numberOrNull(row.home_win), draw: this.numberOrNull(row.draw),
      awayWin: this.numberOrNull(row.away_win), underOver: row.under_over || null,
      predictedHomeGoals: this.numberOrNull(row.predicted_home_goals), predictedAwayGoals: this.numberOrNull(row.predicted_away_goals),
      aiProvider: row.ai_provider === 'gemini' || row.ai_provider === 'groq' ? row.ai_provider : null,
      aiModel: row.ai_model || null,
    };
  }

  private parseJson(raw: string): any {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
      throw new Error('AI returned invalid football analysis JSON');
    }
  }

  private numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace('%', ''));
    return Number.isFinite(n) ? n : null;
  }

  private stringOrNull(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
  private toNumber(value: unknown): number | null { return this.numberOrNull(value); }
  private date(value: Date): string { return value.toISOString().slice(0, 10); }
}

export const footballAnalysisService = new FootballAnalysisService();
