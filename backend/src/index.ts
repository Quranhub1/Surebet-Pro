import axios from 'axios';
import dotenv from 'dotenv';
import { ensureDatabase } from './lib/db';
import { ensurePredictionIntegrity } from './services/PredictionIntegrityService';
import { ensurePredictionAnalytics } from './services/PredictionAnalyticsService';
import { ensureUserSubscriptionColumns } from './services/SubscriptionGateway';
import { scannerScheduler } from './engine/ScannerScheduler';

dotenv.config();

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const BSD_BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const originalAxiosGet = axios.get.bind(axios);

function hasBsdKey(): boolean {
  return Boolean(String(process.env.BSD_API_KEY || '').trim());
}

function hasApiFootballKey(): boolean {
  return Boolean(String(
    process.env.API_FOOTBALL_KEY ||
    process.env.API_FOOTBALL_API_KEY ||
    process.env.FOOTBALL_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim());
}

function isPlaceholder(value: unknown): boolean {
  return !value || ['home', 'away', 'home team', 'away team', 'unknown', 'unknown league', 'tbd', 'n/a', 'na', 'null'].includes(String(value).trim().toLowerCase());
}

function entityName(value: any): string | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name && !isPlaceholder(name) ? name : null;
  }
  if (value && typeof value === 'object') {
    for (const key of ['name', 'team_name', 'teamName', 'displayName', 'display_name', 'title', 'shortName', 'short_name']) {
      const name = typeof value[key] === 'string' ? value[key].trim() : '';
      if (name && !isPlaceholder(name)) return name;
    }
  }
  return null;
}

function entityId(value: any): number | string | null {
  if (value && typeof value === 'object') return value.id ?? value.team_id ?? value.league_id ?? null;
  return null;
}

function bsdStatusToApiFootball(status: unknown): string {
  switch (String(status || '').toLowerCase()) {
    case 'upcoming':
    case 'scheduled': return 'NS';
    case 'live': return 'LIVE';
    case 'finished': return 'FT';
    case 'cancelled': return 'CANC';
    case 'postponed': return 'PST';
    default: return 'TBD';
  }
}

function bsdEventToFixture(event: any): any {
  const homeValue = event?.home_team ?? event?.home ?? event?.homeTeam ?? event?.home_team_name ?? event?.homeTeamName;
  const awayValue = event?.away_team ?? event?.away ?? event?.awayTeam ?? event?.away_team_name ?? event?.awayTeamName;
  const leagueValue = event?.league ?? event?.competition ?? event?.tournament ?? event?.league_name ?? event?.leagueName ?? event?.competition_name ?? event?.competitionName;
  const homeName = entityName(homeValue);
  const awayName = entityName(awayValue);
  const leagueName = entityName(leagueValue);
  const homeId = entityId(homeValue) ?? event?.home_team_id ?? event?.homeTeamId ?? null;
  const awayId = entityId(awayValue) ?? event?.away_team_id ?? event?.awayTeamId ?? null;
  const leagueId = entityId(leagueValue) ?? event?.league_id ?? event?.leagueId ?? null;
  const kickoff = event?.event_date || event?.kickoff_at || event?.date || event?.start_time || event?.startTime;
  return {
    fixture: {
      id: event?.id,
      date: kickoff,
      status: { short: bsdStatusToApiFootball(event?.status) },
    },
    league: {
      id: leagueId,
      name: leagueName,
      country: typeof leagueValue === 'object' ? (leagueValue?.country ?? leagueValue?.country_code ?? '') : (event?.country ?? ''),
      season: typeof event?.season === 'object' ? (event.season?.year ?? null) : (event?.season_year ?? event?.season ?? null),
    },
    teams: {
      home: { id: homeId, name: homeName },
      away: { id: awayId, name: awayName },
    },
    goals: {
      home: event?.home_score ?? event?.score?.home ?? null,
      away: event?.away_score ?? event?.score?.away ?? null,
    },
    __bsd_metadata_valid: Boolean(homeName && awayName && leagueName && kickoff),
    __provider: 'bsd',
  };
}

function bsdPredictionToApiFootball(item: any): any {
  const markets = item?.markets || {};
  const result = markets?.match_result || {};
  const expected = markets?.expected_goals || {};
  const overUnder = markets?.over_under || {};
  const predicted = String(result?.predicted || '').toLowerCase();
  const event = item?.event || {};
  const home = entityName(event?.home_team ?? event?.home ?? event?.homeTeam ?? event?.home_team_name ?? event?.homeTeamName);
  const away = entityName(event?.away_team ?? event?.away ?? event?.awayTeam ?? event?.away_team_name ?? event?.awayTeamName);
  const winnerName = predicted === 'home' ? home : predicted === 'away' ? away : null;
  return {
    predictions: {
      winner: winnerName ? { name: winnerName, comment: null } : predicted === 'draw' ? { name: 'Draw', comment: null } : null,
      advice: item?.recommendations?.favorite ? `${item.recommendations.favorite} outcome` : null,
      under_over: overUnder?.prob_over_25 != null ? (Number(overUnder.prob_over_25) >= 50 ? 'Over 2.5' : 'Under 2.5') : null,
      goals: { home: expected?.home ?? null, away: expected?.away ?? null },
      percent: { home: result?.prob_home ?? null, draw: result?.prob_draw ?? null, away: result?.prob_away ?? null },
      win_or_draw: predicted === 'draw' ? 'draw' : null,
    },
    comparison: {},
    h2h: [],
  };
}

async function requestBsd(path: string, params: Record<string, string | number>) {
  const key = String(process.env.BSD_API_KEY || '').trim();
  if (!key) throw new Error('BSD_API_KEY is not configured.');
  const response = await originalAxiosGet(`${BSD_BASE_URL}${path}`, {
    params,
    headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
    timeout: 30_000,
  });
  if (response.status >= 400) throw new Error(`BSD HTTP ${response.status}`);
  return response.data;
}

function hasApiError(data: any): boolean {
  const errors = data?.errors;
  return Boolean(errors && ((Array.isArray(errors) && errors.length) || (typeof errors === 'object' && Object.keys(errors).length) || (typeof errors !== 'object' && errors)));
}

async function bsdFallback(path: string, params: Record<string, string | number> | undefined, config: any): Promise<any> {
  if (!hasBsdKey()) throw new Error('BSD_API_KEY is not configured.');
  if (path === '/fixtures') {
    const dates: string[] = [];
    if (typeof params?.date === 'string') dates.push(params.date);
    if (typeof params?.from === 'string' && typeof params?.to === 'string') {
      const from = new Date(`${params.from}T00:00:00Z`);
      const to = new Date(`${params.to}T00:00:00Z`);
      for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
    }
    if (!dates.length) return null;
    const events: any[] = [];
    for (const date of dates) {
      for (let offset = 0; offset < 20 * 200; offset += 200) {
        const data = await requestBsd('/events/', { date_from: date, date_to: date, limit: 200, offset });
        const page = Array.isArray(data?.results) ? data.results : [];
        events.push(...page);
        const count = Number(data?.count);
        if (!page.length || !data?.next || (Number.isFinite(count) && events.length >= count)) break;
      }
    }
    const results = Array.from(new Map(events.map(event => [String(event?.id), bsdEventToFixture(event)])).values()).filter((fixture: any) => fixture?.__bsd_metadata_valid);
    console.warn(`[AI] API-Football unavailable; using BSD fixture feed fallback for ${results.length} valid fixtures.`);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: results.length, paging: { current: 1, total: 1 }, response: results } } as any;
  }

  if (path === '/predictions' && params?.fixture != null) {
    const data = await requestBsd(`/events/${encodeURIComponent(String(params.fixture))}/prediction/`, {});
    const item = Array.isArray(data) ? data[0] : data;
    if (!item) return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: 0, paging: { current: 1, total: 1 }, response: [] } } as any;
    console.warn(`[AI] API-Football prediction unavailable; using BSD prediction fallback for fixture ${params.fixture}.`);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: 1, paging: { current: 1, total: 1 }, response: [bsdPredictionToApiFootball(item)] } } as any;
  }
  return null;
}

axios.get = async function resilientFootballGet(url: string, config: any = {}) {
  const params = config?.params as Record<string, string | number> | undefined;
  const isFootballRequest = url.startsWith(API_FOOTBALL_BASE_URL);

  if (isFootballRequest && hasBsdKey()) {
    const path = url.slice(API_FOOTBALL_BASE_URL.length);
    if (!hasApiFootballKey()) {
      const fallback = await bsdFallback(path, params, config);
      if (fallback) return fallback;
    } else {
      try {
        const response = await originalAxiosGet(url, config);
        if (!hasApiError(response.data)) return response;
        console.warn(`[AI] API-Football returned an error; switching to BSD for ${path}.`);
      } catch (error) {
        console.warn(`[AI] API-Football request failed; switching to BSD for ${path}:`, error instanceof Error ? error.message : error);
      }
      try {
        const fallback = await bsdFallback(path, params, config);
        if (fallback) return fallback;
      } catch (error) {
        console.warn(`[AI] BSD fallback failed for ${path}:`, error instanceof Error ? error.message : error);
      }
    }
  }

  const isFixtureRangeRequest = url.includes('/fixtures') && params && typeof params.from === 'string' && typeof params.to === 'string';
  if (!isFixtureRangeRequest) return originalAxiosGet(url, config);
  const response = await originalAxiosGet(url, config);
  const errors = response.data?.errors;
  const errorText = Array.isArray(errors) ? errors.join('; ') : errors && typeof errors === 'object' ? Object.values(errors).join('; ') : '';
  if (!/From field|To field/i.test(errorText)) return response;
  console.warn(`[AI] API-Football rejected from/to range (${params.from} -> ${params.to}); falling back to daily fixture requests.`);
  const from = new Date(`${params.from}T00:00:00Z`); const to = new Date(`${params.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return response;
  const fixtures: any[] = [];
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); const dailyParams = { ...params }; delete dailyParams.from; delete dailyParams.to; dailyParams.date = date;
    try {
      const dailyResponse = await originalAxiosGet(url, { ...config, params: dailyParams });
      const dailyErrors = dailyResponse.data?.errors;
      if (dailyErrors && ((Array.isArray(dailyErrors) && dailyErrors.length) || Object.keys(dailyErrors).length)) { const message = Array.isArray(dailyErrors) ? dailyErrors.join('; ') : Object.values(dailyErrors).join('; '); console.warn(`[AI] Daily fixture request ${date} failed: ${message}`); continue; }
      if (Array.isArray(dailyResponse.data?.response)) fixtures.push(...dailyResponse.data.response);
    } catch (error) { console.warn(`[AI] Daily fixture request ${date} failed:`, error instanceof Error ? error.message : error); }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  const uniqueFixtures = Array.from(new Map(fixtures.map(fixture => [String(fixture?.fixture?.id), fixture])).values());
  console.log(`[AI] Daily fallback recovered ${uniqueFixtures.length} fixtures for ${params.from} through ${params.to}.`);
  return { ...response, data: { ...response.data, errors: [], results: uniqueFixtures.length, paging: { current: 1, total: 1 }, response: uniqueFixtures } };
};

console.log('=========================================');
console.log('🚀 Starting SurebetPro Backend Engine');
console.log('=========================================');

async function start(): Promise<void> {
  await ensureDatabase();
  await ensurePredictionIntegrity();
  await ensurePredictionAnalytics();
  await ensureUserSubscriptionColumns();
  console.log('[DB] Connected to Neon PostgreSQL and prediction integrity, analytics audit guards, subscription gateway enabled.');
  const { startServer } = await import('./server');
  await startServer();
  await scannerScheduler.start();
}

start().catch((error) => { console.error('[Startup] Critical backend error:', error); process.exitCode = 1; });
