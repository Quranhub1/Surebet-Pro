import axios from 'axios';
import { generateWithAi, getActiveAiConfig, type AiProvider } from './AiModelService';

export interface AiMatchPrediction {
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

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';

export class AiPredictionService {
  private cache: { expiresAt: number; data: AiMatchPrediction[] } | null = null;

  private async requestFootball(path: string, params: Record<string, string | number>) {
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY;
    if (!key) throw new Error('No API-Football key configured.');
    const response = await axios.get(`${API_FOOTBALL_BASE_URL}${path}`, {
      params,
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
    });
    const errors = response.data?.errors;
    if (errors && ((Array.isArray(errors) && errors.length) || Object.keys(errors).length)) {
      throw new Error(Array.isArray(errors) ? errors.join('; ') : Object.values(errors).join('; '));
    }
    return response.data;
  }

  public async getPredictions(limit = 8): Promise<AiMatchPrediction[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data;

    const aiConfig = getActiveAiConfig();
    if (!aiConfig.configured) throw new Error(`AI prediction model is not configured: ${aiConfig.provider}`);
    if (!(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY)) return [];

    const today = new Date();
    const dates = [this.formatDate(today), this.formatDate(new Date(today.getTime() + 86400000))];
    let fixtures: any[] = [];

    for (const date of dates) {
      const data = await this.requestFootball('/fixtures', { date });
      fixtures = Array.isArray(data.response)
        ? data.response.filter((fixture: any) => ['NS', 'TBD'].includes(String(fixture.fixture?.status?.short)))
        : [];
      if (fixtures.length) break;
    }

    const selected = fixtures.slice(0, limit).map((fixture: any) => ({
      id: String(fixture.fixture?.id || ''),
      league: fixture.league?.name || 'Football',
      country: fixture.league?.country || '',
      homeTeam: fixture.teams?.home?.name || 'Home',
      awayTeam: fixture.teams?.away?.name || 'Away',
      homeId: fixture.teams?.home?.id || null,
      awayId: fixture.teams?.away?.id || null,
      leagueId: fixture.league?.id || null,
      season: fixture.league?.season || new Date().getUTCFullYear(),
      startTime: fixture.fixture?.date || null,
    })).filter((fixture: any) => fixture.id);

    if (!selected.length) {
      this.cache = { expiresAt: Date.now() + 15 * 60 * 1000, data: [] };
      return [];
    }

    const enriched = await Promise.all(selected.map(async (fixture: any) => {
      try {
        const data = await this.requestFootball('/predictions', { fixture: fixture.id });
        const item = data.response?.[0];
        const prediction = item?.predictions || {};
        const comparison = item?.comparison || {};
        const h2h = Array.isArray(item?.h2h) ? item.h2h.slice(0, 5) : [];
        return {
          ...fixture,
          apiPrediction: {
            winner: prediction.winner?.name || null,
            winnerComment: prediction.winner?.comment || null,
            advice: prediction.advice || null,
            underOver: prediction.under_over || null,
            goals: prediction.goals || {},
            percent: prediction.percent || {},
            winOrDraw: prediction.win_or_draw ?? null,
          },
          comparison,
          h2h: h2h.map((match: any) => ({
            date: match.fixture?.date || null,
            home: match.teams?.home?.name || null,
            away: match.teams?.away?.name || null,
            homeGoals: match.goals?.home ?? null,
            awayGoals: match.goals?.away ?? null,
          })),
        };
      } catch (error) {
        console.warn(`[AI] No API-Football prediction context for fixture ${fixture.id}:`, error instanceof Error ? error.message : error);
        return { ...fixture, apiPrediction: null, comparison: {}, h2h: [] };
      }
    }));

    const system = `You are SureBet Pro's football analysis AI. Your job is to analyze real football data supplied by API-Football and produce a transparent pre-match prediction. Use the supplied statistical model output, team comparison signals and recent head-to-head context as evidence. Do not invent injuries, lineups, form, statistics or facts that are not supplied. If evidence is weak or conflicting, say so and reduce confidence. This is analysis, not a guarantee and must never mention betting, bookmakers, odds, staking or gambling. Return ONLY valid JSON with a top-level predictions array. Each prediction must contain: id, winner, advice, analysis, keyFactors, confidence, homeWin, draw, awayWin, underOver, predictedHomeGoals, predictedAwayGoals. analysis should be 2-4 sentences explaining the decision. advice should be one concise sentence. keyFactors should contain 2-4 short evidence-based factors. confidence must be 0-100. Probabilities must be numbers from 0-100 and should sum to approximately 100.`;
    const prompt = `Analyze these upcoming fixtures. API-Football's prediction endpoint is a statistical input, not the final answer. Reconcile it with the comparison and head-to-head information, then make your own reasoned prediction.\n\n${JSON.stringify(enriched, null, 2)}`;

    let raw: string;
    let usedProvider: AiProvider = aiConfig.provider;
    let usedModel = aiConfig.model;

    try {
      raw = await generateWithAi({ provider: aiConfig.provider, system, prompt, temperature: 0.2, maxTokens: 5000 });
    } catch (primaryError) {
      const fallback: AiProvider = aiConfig.provider === 'gemini' ? 'groq' : 'gemini';
      const configured = fallback === 'gemini'
        ? Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY)
        : Boolean(process.env.GROQ_API_KEY);
      if (!configured) throw primaryError;
      raw = await generateWithAi({ provider: fallback, system, prompt, temperature: 0.2, maxTokens: 5000 });
      usedProvider = fallback;
      usedModel = fallback === 'gemini'
        ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite')
        : (process.env.GROQ_MODEL || 'openai/gpt-oss-120b');
    }

    const parsed = this.parseJson(raw);
    const byId = new Map(selected.map((fixture: any) => [fixture.id, fixture]));
    const results: AiMatchPrediction[] = [];

    for (const item of Array.isArray(parsed.predictions) ? parsed.predictions : []) {
      const fixture = byId.get(String(item?.id));
      if (!fixture) continue;
      results.push({
        id: fixture.id,
        league: fixture.league,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        startTime: fixture.startTime,
        winner: item?.winner === fixture.homeTeam || item?.winner === fixture.awayTeam ? item.winner : null,
        advice: typeof item?.advice === 'string' ? item.advice : null,
        analysis: typeof item?.analysis === 'string' ? item.analysis : null,
        keyFactors: Array.isArray(item?.keyFactors) ? item.keyFactors.filter((value: unknown) => typeof value === 'string').slice(0, 4) : [],
        confidence: this.toPercent(item?.confidence),
        homeWin: this.toPercent(item?.homeWin),
        draw: this.toPercent(item?.draw),
        awayWin: this.toPercent(item?.awayWin),
        underOver: typeof item?.underOver === 'string' ? item.underOver : null,
        predictedHomeGoals: this.toNumber(item?.predictedHomeGoals),
        predictedAwayGoals: this.toNumber(item?.predictedAwayGoals),
        aiProvider: usedProvider,
        aiModel: usedModel,
      });
    }

    this.cache = { expiresAt: Date.now() + 60 * 60 * 1000, data: results };
    console.log(`[AI] Generated ${results.length} data-backed football analyses with ${usedProvider}/${usedModel}.`);
    return results;
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

  private formatDate(date: Date): string { return date.toISOString().slice(0, 10); }
  private toPercent(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace('%', ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
}

export const aiPredictionService = new AiPredictionService();
