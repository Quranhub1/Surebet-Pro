const axios = require('axios');

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const BSD_BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const originalGet = axios.get.bind(axios);

const key = () => String(process.env.BSD_API_KEY || '').trim();
const placeholder = value => !value || ['home', 'away', 'home team', 'away team', 'unknown', 'unknown league', 'tbd', 'n/a', 'na', 'null'].includes(String(value).trim().toLowerCase());

function name(value) {
  if (typeof value === 'string') return placeholder(value) ? null : value.trim();
  if (!value || typeof value !== 'object') return null;
  for (const k of ['name', 'team_name', 'teamName', 'displayName', 'display_name', 'title', 'shortName', 'short_name']) {
    if (typeof value[k] === 'string' && !placeholder(value[k])) return value[k].trim();
  }
  return null;
}

function fixture(event) {
  const homeValue = event?.home_team ?? event?.home ?? event?.homeTeam ?? event?.home_team_name ?? event?.homeTeamName;
  const awayValue = event?.away_team ?? event?.away ?? event?.awayTeam ?? event?.away_team_name ?? event?.awayTeamName;
  const leagueValue = event?.league ?? event?.competition ?? event?.tournament ?? event?.league_name ?? event?.leagueName ?? event?.competition_name ?? event?.competitionName;
  const home = name(homeValue);
  const away = name(awayValue);
  const league = name(leagueValue);
  if (!home || !away || !league) return null;
  const status = String(event?.status || '').toLowerCase();
  const short = status === 'finished' ? 'FT' : status === 'live' ? 'LIVE' : status === 'cancelled' ? 'CANC' : status === 'postponed' ? 'PST' : 'NS';
  return {
    fixture: { id: event?.id, date: event?.kickoff_at || event?.date || event?.start_time || event?.startTime, status: { short } },
    league: { id: event?.league_id ?? event?.leagueId ?? null, name: league, country: event?.country ?? '', season: event?.season_year ?? event?.season ?? null },
    teams: { home: { id: event?.home_team_id ?? event?.homeTeamId ?? null, name: home }, away: { id: event?.away_team_id ?? event?.awayTeamId ?? null, name: away } },
    goals: { home: event?.home_score ?? event?.score?.home ?? null, away: event?.away_score ?? event?.score?.away ?? null },
    __bsd_metadata_valid: true,
    __provider: 'bsd',
  };
}

function prediction(item) {
  const markets = item?.markets || {};
  const result = markets?.match_result || {};
  const expected = markets?.expected_goals || {};
  const overUnder = markets?.over_under || {};
  const predicted = String(result?.predicted || '').toLowerCase();
  const event = item?.event || {};
  const home = name(event?.home_team ?? event?.home ?? event?.homeTeam ?? event?.home_team_name ?? event?.homeTeamName);
  const away = name(event?.away_team ?? event?.away ?? event?.awayTeam ?? event?.away_team_name ?? event?.awayTeamName);
  const winner = predicted === 'home' ? home : predicted === 'away' ? away : predicted === 'draw' ? 'Draw' : null;
  return { predictions: { winner: winner ? { name: winner, comment: null } : null, advice: item?.recommendations?.favorite ? `${item.recommendations.favorite} outcome` : null, under_over: overUnder?.prob_over_25 != null ? (Number(overUnder.prob_over_25) >= 50 ? 'Over 2.5' : 'Under 2.5') : null, goals: { home: expected?.home ?? null, away: expected?.away ?? null }, percent: { home: result?.prob_home ?? null, draw: result?.prob_draw ?? null, away: result?.prob_away ?? null }, win_or_draw: predicted === 'draw' ? 'draw' : null }, comparison: {}, h2h: [] };
}

async function bsd(path, params = {}) {
  const token = key();
  if (!token) throw new Error('BSD_API_KEY is not configured.');
  const response = await originalGet(`${BSD_BASE_URL}${path}`, { params, headers: { Authorization: `Token ${token}`, Accept: 'application/json' }, timeout: 30_000 });
  return response.data;
}

function apiHasError(data) {
  const errors = data?.errors;
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return typeof errors === 'object' ? Object.keys(errors).length > 0 : Boolean(errors);
}

async function fallbackFixtures(params) {
  const dates = [];
  if (typeof params?.date === 'string') dates.push(params.date);
  if (typeof params?.from === 'string' && typeof params?.to === 'string') {
    const from = new Date(`${params.from}T00:00:00Z`);
    const to = new Date(`${params.to}T00:00:00Z`);
    for (let cursor = from; cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  }
  if (!dates.length) return null;
  const events = [];
  for (const date of dates) {
    const data = await bsd('/events/', { date_from: date, date_to: date, limit: 200 });
    if (Array.isArray(data?.results)) events.push(...data.results);
  }
  const results = Array.from(new Map(events.map(f => [String(f?.id), fixture(f)]).filter(([, f]) => f)).values());
  return { errors: [], results: results.length, paging: { current: 1, total: 1 }, response: results };
}

axios.get = async function footballProviderFallback(url, config = {}) {
  if (!url.startsWith(API_FOOTBALL_BASE_URL) || !key()) return originalGet(url, config);
  try {
    const response = await originalGet(url, config);
    if (!apiHasError(response.data)) return response;
    throw new Error(JSON.stringify(response.data.errors));
  } catch (error) {
    const params = config?.params || {};
    if (url === `${API_FOOTBALL_BASE_URL}/fixtures`) {
      try {
        const data = await fallbackFixtures(params);
        if (data) {
          console.warn('[AI] API-Football unavailable; using BSD fixture feed fallback for this request.');
          return { status: 200, statusText: 'OK', headers: {}, config, data };
        }
      } catch (fallbackError) {
        console.warn('[AI] BSD fixture fallback failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
      }
    }
    if (url === `${API_FOOTBALL_BASE_URL}/predictions` && params?.fixture != null) {
      try {
        const data = await bsd(`/events/${encodeURIComponent(String(params.fixture))}/prediction/`);
        const item = Array.isArray(data) ? data[0] : data;
        if (item) {
          console.warn('[AI] API-Football prediction unavailable; using BSD prediction fallback.');
          return { status: 200, statusText: 'OK', headers: {}, config, data: { errors: [], results: 1, paging: { current: 1, total: 1 }, response: [prediction(item)] } };
        }
      } catch (fallbackError) {
        console.warn('[AI] BSD prediction fallback failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
      }
    }
    throw error;
  }
};

console.log('[AI] Football provider fallback loaded. API-Football suspension/errors can fall back to BSD without disabling the analysis cycle.');
