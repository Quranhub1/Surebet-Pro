import axios from 'axios';
import { sql } from '../lib/db';

interface ApiLeague { name: string; slug: string; sport: string; }

interface NormalizedEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  league_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: { key: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
}

export interface LiveFootballMatch {
  id: string; league: string; homeTeam: string; awayTeam: string;
  homeScore: number | null; awayScore: number | null; status: string;
  startTime: string; minute: number | null;
}

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';

export class OddsApiService {
  private async getApiConfig() {
    try {
      const rows = await sql`SELECT odds_api_key, api_base_url, api_endpoint_odds FROM system_settings WHERE id = 1`;
      const data = rows[0];
      return {
        key: data?.odds_api_key || process.env.API_FOOTBALL_KEY || process.env.ODDS_API_KEY || '',
        baseUrl: process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY
          ? API_FOOTBALL_BASE_URL
          : (data?.api_base_url || process.env.ODDS_API_BASE_URL || 'https://api.odds-api.io/v3').replace(/\/$/, ''),
        endpoint: data?.api_endpoint_odds || '/odds',
        apiFootball: Boolean(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY),
      };
    } catch (error) {
      console.error('[OddsApiService] Error loading Neon API configuration:', error);
      return {
        key: process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY || process.env.ODDS_API_KEY || '',
        baseUrl: API_FOOTBALL_BASE_URL,
        endpoint: '/odds',
        apiFootball: Boolean(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY),
      };
    }
  }

  private async requestFootball(path: string, params: Record<string, string | number>) {
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY;
    if (!key) throw new Error('No API-Football key configured.');
    const response = await axios.get(`${API_FOOTBALL_BASE_URL}${path}`, {
      params,
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
    });
    if (response.data?.errors && Object.keys(response.data.errors).length > 0) {
      throw new Error(Object.values(response.data.errors).join('; '));
    }
    return response.data;
  }

  private async request(path: string, params: Record<string, string | number>) {
    const config = await this.getApiConfig();
    if (config.apiFootball) return this.requestFootball(path, params);
    if (!config.key) throw new Error('No Odds API key configured.');
    const response = await axios.get(`${config.baseUrl}${path}`, {
      params: { ...params, apiKey: config.key },
      headers: { Accept: 'application/json' },
    });
    return response.data;
  }

  public async getActiveLeagues(activeSportGroups: string[]): Promise<ApiLeague[]> {
    if (activeSportGroups.length === 0) return [];
    try {
      const config = await this.getApiConfig();
      if (config.apiFootball) {
        const data = await this.requestFootball('/leagues', { season: new Date().getUTCFullYear() });
        return (data.results || []).map((item: any) => ({
          name: item.league?.name || 'Unknown League',
          slug: String(item.league?.id || item.league?.name || '').toLowerCase(),
          sport: String(item.league?.type || 'football').toLowerCase(),
        }));
      }
      const sports = await this.request('/sports', {});
      const wanted = new Set(activeSportGroups.map(value => value.toLowerCase()));
      const matchedSports = (Array.isArray(sports) ? sports : []).filter((sport: any) => wanted.has(String(sport.slug || sport.name).toLowerCase()));
      const leagues: ApiLeague[] = [];
      for (const sport of matchedSports) {
        const sportSlug = sport.slug || sport.name;
        const sportLeagues = await this.request('/leagues', { sport: sportSlug, all: 'true' });
        for (const league of Array.isArray(sportLeagues) ? sportLeagues : []) leagues.push({ name: league.name, slug: league.slug, sport: sportSlug });
      }
      return leagues;
    } catch (error: any) {
      console.warn('[OddsApiService] Could not load sports/leagues:', error.message);
      return [];
    }
  }

  public async getOddsForSport(sportKey: string, leagueKey: string, activeMarkets: string[], activeBookmakers: string[]): Promise<NormalizedEvent[]> {
    try {
      const config = await this.getApiConfig();
      if (config.apiFootball) {
        const fixtureData = await this.requestFootball('/fixtures', { league: Number(leagueKey), season: new Date().getUTCFullYear() });
        const fixtures = Array.isArray(fixtureData.results) ? fixtureData.results : [];
        return this.getFootballOddsForFixtures(fixtures, activeMarkets);
      }
      const events = await this.request('/events', { sport: sportKey, league: leagueKey, status: 'pending', limit: 100 });
      return this.getOddsForEvents(Array.isArray(events) ? events : [], activeMarkets, activeBookmakers);
    } catch (error: any) {
      console.error(`[OddsApiService] Error fetching odds for ${sportKey}/${leagueKey}:`, error.message);
      return [];
    }
  }

  public async getLiveOdds(activeSportGroups: string[], activeMarkets: string[], activeBookmakers: string[]): Promise<NormalizedEvent[]> {
    try {
      const config = await this.getApiConfig();
      if (config.apiFootball) {
        const data = await this.requestFootball('/fixtures', { live: 'all' });
        const fixtures = Array.isArray(data.results) ? data.results : [];
        return this.getFootballOddsForFixtures(fixtures, activeMarkets);
      }
      const liveEvents = await this.request('/events/live', {});
      const wantedSports = new Set(activeSportGroups.map(value => value.toLowerCase()));
      const filteredEvents = (Array.isArray(liveEvents) ? liveEvents : []).filter((event: any) => {
        const sportKey = String(event.sport?.slug || event.sport?.name || '').toLowerCase();
        return wantedSports.size === 0 || wantedSports.has(sportKey);
      });
      return this.getOddsForEvents(filteredEvents, activeMarkets, activeBookmakers);
    } catch (error: any) {
      console.error('[OddsApiService] Error fetching live odds:', error.message);
      return [];
    }
  }

  public async getLiveFootballMatches(): Promise<LiveFootballMatch[]> {
    try {
      const config = await this.getApiConfig();
      if (config.apiFootball) {
        const data = await this.requestFootball('/fixtures', { live: 'all' });
        return (Array.isArray(data.results) ? data.results : []).map((fixture: any) => ({
          id: String(fixture.fixture?.id), league: fixture.league?.name || 'Football',
          homeTeam: fixture.teams?.home?.name || 'Home', awayTeam: fixture.teams?.away?.name || 'Away',
          homeScore: this.toScore(fixture.goals?.home), awayScore: this.toScore(fixture.goals?.away),
          status: String(fixture.fixture?.status?.short || fixture.fixture?.status?.long || 'LIVE'),
          startTime: fixture.fixture?.date || new Date().toISOString(),
          minute: this.toScore(fixture.fixture?.status?.elapsed),
        }));
      }
      const liveEvents = await this.request('/events/live', {});
      const footballEvents = (Array.isArray(liveEvents) ? liveEvents : []).filter((event: any) => {
        const sport = `${event.sport?.slug || ''} ${event.sport?.name || ''}`.toLowerCase();
        return sport.includes('soccer') || sport.includes('football');
      });
      return footballEvents.map((event: any) => ({
        id: String(event.id), league: event.league?.name || 'Football', homeTeam: event.home || 'Home', awayTeam: event.away || 'Away',
        homeScore: this.toScore(event.homeScore ?? event.scores?.home ?? event.score?.home),
        awayScore: this.toScore(event.awayScore ?? event.scores?.away ?? event.score?.away),
        status: String(event.status || event.state || 'LIVE'), startTime: event.date || event.startTime || new Date().toISOString(),
        minute: this.toScore(event.minute ?? event.timer ?? event.clock?.minute),
      }));
    } catch (error: any) {
      console.error('[OddsApiService] Error fetching live football matches:', error.message);
      return [];
    }
  }

  private async getFootballOddsForFixtures(fixtures: any[], activeMarkets: string[]): Promise<NormalizedEvent[]> {
    const results: NormalizedEvent[] = [];
    for (const fixture of fixtures.slice(0, 20)) {
      try {
        const data = await this.requestFootball('/odds', { fixture: fixture.fixture?.id });
        const bookmakers = this.normalizeFootballOdds(data.results?.[0], fixture, activeMarkets);
        if (bookmakers.length >= 2) {
          results.push({
            id: String(fixture.fixture?.id), sport_key: 'soccer', sport_title: 'Football',
            league_title: fixture.league?.name || 'Unknown League', home_team: fixture.teams?.home?.name,
            away_team: fixture.teams?.away?.name, commence_time: fixture.fixture?.date, bookmakers,
          });
        }
      } catch (error: any) {
        console.warn(`[OddsApiService] Could not load odds for fixture ${fixture.fixture?.id}:`, error.message);
      }
    }
    return results;
  }

  private normalizeFootballOdds(oddsResult: any, fixture: any, activeMarkets: string[]) {
    const wanted = new Set(activeMarkets.map(key => key.toLowerCase()));
    const bookmakers: { key: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[] = [];
    for (const bookmaker of oddsResult?.bookmakers || []) {
      const markets: { key: string; outcomes: { name: string; price: number }[] }[] = [];
      for (const bet of bookmaker.bets || []) {
        const name = String(bet.name || '').toLowerCase();
        const key = name.includes('match winner') || name === '1x2' ? 'h2h' : name.replace(/[^a-z0-9]+/g, '_');
        if (wanted.size > 0 && !wanted.has(key) && !(key === 'h2h' && wanted.has('ml'))) continue;
        const outcomes = (bet.values || []).map((value: any) => ({
          name: String(value.value), price: Number(value.odd),
        })).filter((outcome: any) => Number.isFinite(outcome.price) && outcome.price > 1);
        if (outcomes.length >= 2) markets.push({ key, outcomes });
      }
      if (markets.length > 0) bookmakers.push({ key: String(bookmaker.id || bookmaker.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'), markets });
    }
    return bookmakers;
  }

  private toScore(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private async getOddsForEvents(events: any[], activeMarkets: string[], activeBookmakers: string[]): Promise<NormalizedEvent[]> {
    const results: NormalizedEvent[] = [];
    const bookmakersParam = activeBookmakers.join(',');
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      if (batch.length === 0) continue;
      const oddsData = await this.request('/odds/multi', { eventIds: batch.map((event: any) => event.id).join(','), bookmakers: bookmakersParam });
      for (const event of Array.isArray(oddsData) ? oddsData : []) results.push(this.normalizeEvent(event, activeMarkets));
    }
    return results.filter(event => event.bookmakers.length >= 2);
  }

  private normalizeEvent(event: any, activeMarkets: string[]): NormalizedEvent {
    const marketAliases: Record<string, string> = { h2h: 'ML', moneyline: 'ML', spread: 'Spread', totals: 'Over/Under' };
    const wantedMarkets = new Set(activeMarkets.map(key => marketAliases[key] || key));
    const bookmakers = Object.entries(event.bookmakers || {}).map(([bookmakerKey, markets]) => {
      const normalizedMarkets: { key: string; outcomes: { name: string; price: number }[] }[] = [];
      for (const market of (markets as any[]) || []) {
        if (wantedMarkets.size > 0 && !wantedMarkets.has(market.name)) continue;
        const odds = Array.isArray(market.odds) ? market.odds[0] : null;
        if (!odds) continue;
        const outcomes: { name: string; price: number }[] = [];
        const addOutcome = (name: string, value: unknown) => { const price = Number(value); if (Number.isFinite(price) && price > 1) outcomes.push({ name, price }); };
        if (odds.home !== undefined) addOutcome(event.home, odds.home);
        if (odds.draw !== undefined) addOutcome('Draw', odds.draw);
        if (odds.away !== undefined) addOutcome(event.away, odds.away);
        if (odds.over !== undefined) addOutcome(`Over ${odds.max ?? ''}`.trim(), odds.over);
        if (odds.under !== undefined) addOutcome(`Under ${odds.max ?? ''}`.trim(), odds.under);
        if (outcomes.length >= 2) {
          const key = market.name === 'ML' ? 'h2h' : market.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          normalizedMarkets.push({ key, outcomes });
        }
      }
      return { key: bookmakerKey, markets: normalizedMarkets };
    }).filter(bookmaker => bookmaker.markets.length > 0);
    return {
      id: String(event.id), sport_key: event.sport?.slug || sportKeyFallback(event), sport_title: event.sport?.name || 'Unknown',
      league_title: event.league?.name || 'Unknown League', home_team: event.home, away_team: event.away, commence_time: event.date, bookmakers,
    };
  }
}

function sportKeyFallback(event: any): string { return event.sport?.slug || 'unknown'; }
export const oddsApiService = new OddsApiService();
