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
    for (const key of ['name', 'team_name', 'teamName', 'displayName', 'title', 'shortName']) {
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
    case 'upcoming': return 'NS';
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
  return {
    fixture: {
      id: event?.id,
      date: event?.kickoff_at || event?.date || event?.start_time || event?.startTime,
      status: { short: bsdStatusToApiFootball(event?.status) },
    },
    league: {
      id: leagueId,
      name: leagueName,
      country: typeof leagueValue === 'object' ? (leagueValue?.country ?? '') : (event?.country ?? ''),
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
    __bsd_metadata_valid: Boolean(homeName && awayName && leagueName),
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

axios.get = async function resilientFootballGet(url: string, config: any = {}) {
  const params = config?.params as Record<string, string | number> | undefined;
  const isFootballRequest = url.startsWith(API_FOOTBALL_BASE_URL);
  // BSD is a fallback only. If API-Football credentials exist, never silently
  // replace its richer fixture metadata with a different provider's schema.
  if (isFootballRequest && hasBsdKey() && !hasApiFootballKey()) {
    try {
      const path = url.slice(API_FOOTBALL_BASE_URL.length);
      if (path === '/fixtures' && typeof params?.date === 'string') {
        const data = await requestBsd('/events/', { date_from: params.date, date_to: params.date, status: 'upcoming', limit: 200 });
        const results = Array.isArray(data?.results) ? data.results.map(bsdEventToFixture).filter((x: any) => x.__bsd_metadata_valid) : [];
        return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: results.length, paging: { current: 1, total: 1 }, response: results } } as any;
      }
      if (path === '/fixtures' && typeof params?.from === 'string' && typeof params?.to === 'string') {
        const data = await requestBsd('/events/', { date_from: params.from, date_to: params.to, status: 'finished', limit: 200 });
        const results = Array.isArray(data?.results) ? data.results.map(bsdEventToFixture).filter((x: any) => x.__bsd_metadata_valid) : [];
        return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: results.length, paging: { current: 1, total: 1 }, response: results } } as any;
      }
      if (path === '/fixtures') {
        const date = typeof params?.date === 'string' ? params.date : undefined;
        const data = await requestBsd('/events/', { ...(date ? { date_from: date, date_to: date } : {}), status: 'finished', limit: 200 });
        const results = Array.isArray(data?.results) ? data.results.map(bsdEventToFixture).filter((x: any) => x.__bsd_metadata_valid) : [];
        return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: results.length, paging: { current: 1, total: 1 }, response: results } } as any;
      }
      if (path === '/predictions' && params?.fixture != null) {
        const data = await requestBsd('/events/' + encodeURIComponent(String(params.fixture)) + '/prediction/', {});
        const item = Array.isArray(data) ? data[0] : data;
        return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: item ? 1 : 0, paging: { current: 1, total: 1 }, response: item ? [bsdPredictionToApiFootball(item)] : [] } } as any;
      }
    } catch (error) {
      console.warn('[BSD] Request failed, falling back to API-Football:', error instanceof Error ? error.message : error);
    }
  }

  const isFixtureRangeRequest = url.includes('/fixtures') && params && typeof params.from === 'string' && typeof params.to === 'string';
  if (!isFixtureRangeRequest) return originalAxiosGet(url, config);
  const response = await originalAxiosGet(url, config);
  const errors = response.data?.errors;
  const errorText = Array.isArray(errors) ? errors.join('; ') : errors && typeof errors === 'object' ? Object.values(errors).join('; ') : '';
  if (!/From field|To field/i.test(errorText)) return response;
  const from = new Date(`${params.from}T00:00:00Z`); const to = new Date(`${params.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return response;
  console.warn(`[AI] API-Football rejected from/to range (${params.from} -> ${params.to}); falling back to daily fixture requests.`);
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
