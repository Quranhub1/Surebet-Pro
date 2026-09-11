import axios from 'axios';
import { supabase } from '../lib/supabase';

interface ApiLeague {
  name: string;
  slug: string;
  sport: string;
}

interface NormalizedEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  league_title: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: {
    key: string;
    markets: {
      key: string;
      outcomes: { name: string; price: number }[];
    }[];
  }[];
}

export class OddsApiService {
  private async getApiConfig() {
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('odds_api_key, api_base_url, api_endpoint_odds')
        .eq('id', 1)
        .single();

      return {
        key: data?.odds_api_key || process.env.ODDS_API_KEY || '',
        baseUrl: (data?.api_base_url || 'https://api.odds-api.io/v3').replace(/\/$/, ''),
        endpoint: data?.api_endpoint_odds || '/odds',
      };
    } catch (error) {
      console.error('[OddsApiService] Erro ao buscar configurações da API:', error);
      return {
        key: process.env.ODDS_API_KEY || '',
        baseUrl: 'https://api.odds-api.io/v3',
        endpoint: '/odds',
      };
    }
  }

  private async request(path: string, params: Record<string, string | number>) {
    const config = await this.getApiConfig();
    if (!config.key) throw new Error('Nenhuma chave de API configurada.');

    const response = await axios.get(`${config.baseUrl}${path}`, {
      params: { ...params, apiKey: config.key },
      headers: { Accept: 'application/json' },
    });

    return response.data;
  }

  public async getActiveLeagues(activeSportGroups: string[]): Promise<ApiLeague[]> {
    if (activeSportGroups.length === 0) return [];

    try {
      const sports = await this.request('/sports', {});
      const wanted = new Set(activeSportGroups.map(value => value.toLowerCase()));
      const matchedSports = (Array.isArray(sports) ? sports : []).filter((sport: any) =>
        wanted.has(String(sport.slug || sport.name).toLowerCase())
      );

      const leagues: ApiLeague[] = [];
      for (const sport of matchedSports) {
        const sportSlug = sport.slug || sport.name;
        const sportLeagues = await this.request('/leagues', { sport: sportSlug, all: 'true' });
        for (const league of Array.isArray(sportLeagues) ? sportLeagues : []) {
          leagues.push({ name: league.name, slug: league.slug, sport: sportSlug });
        }
      }

      return leagues;
    } catch (error: any) {
      console.warn('[OddsApiService] Não foi possível carregar esportes/ligas:', error.message);
      return [];
    }
  }

  public async getOddsForSport(
    sportKey: string,
    leagueKey: string,
    activeMarkets: string[],
    activeBookmakers: string[]
  ): Promise<NormalizedEvent[]> {
    try {
      const events = await this.request('/events', {
        sport: sportKey,
        league: leagueKey,
        status: 'pending',
        limit: 100,
      });

      const pendingEvents = Array.isArray(events) ? events : [];
      const results: NormalizedEvent[] = [];
      const bookmakersParam = activeBookmakers.join(',');

      for (let i = 0; i < pendingEvents.length; i += 10) {
        const batch = pendingEvents.slice(i, i + 10);
        if (batch.length === 0) continue;

        const oddsData = await this.request('/odds/multi', {
          eventIds: batch.map((event: any) => event.id).join(','),
          bookmakers: bookmakersParam,
        });

        for (const event of Array.isArray(oddsData) ? oddsData : []) {
          results.push(this.normalizeEvent(event, activeMarkets));
        }
      }

      return results.filter(event => event.bookmakers.length >= 2);
    } catch (error: any) {
      console.error(`[OddsApiService] Erro ao buscar odds para ${sportKey}/${leagueKey}:`, error.message);
      return [];
    }
  }

  private normalizeEvent(event: any, activeMarkets: string[]): NormalizedEvent {
    const marketAliases: Record<string, string> = {
      h2h: 'ML',
      moneyline: 'ML',
      spread: 'Spread',
      totals: 'Over/Under',
    };
    const wantedMarkets = new Set(activeMarkets.map(key => marketAliases[key] || key));

    const bookmakers = Object.entries(event.bookmakers || {}).map(([bookmakerKey, markets]) => {
      const normalizedMarkets: { key: string; outcomes: { name: string; price: number }[] }[] = [];

      for (const market of (markets as any[]) || []) {
        if (wantedMarkets.size > 0 && !wantedMarkets.has(market.name)) continue;
        const odds = Array.isArray(market.odds) ? market.odds[0] : null;
        if (!odds) continue;

        const outcomes: { name: string; price: number }[] = [];
        const addOutcome = (name: string, value: unknown) => {
          const price = Number(value);
          if (Number.isFinite(price) && price > 1) outcomes.push({ name, price });
        };

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
      id: String(event.id),
      sport_key: event.sport?.slug || sportKeyFallback(event),
      sport_title: event.sport?.name || 'Unknown',
      league_title: event.league?.name || 'Unknown League',
      home_team: event.home,
      away_team: event.away,
      commence_time: event.date,
      bookmakers,
    };
  }
}

function sportKeyFallback(event: any): string {
  return event.sport?.slug || 'unknown';
}

export const oddsApiService = new OddsApiService();
