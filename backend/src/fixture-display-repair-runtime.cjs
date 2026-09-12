const { neon } = require('@neondatabase/serverless');
const axios = require('axios');

const PLACEHOLDERS = new Set(['', 'home', 'away', 'home team', 'away team', 'team home', 'team away', 'unknown', 'unknown league', 'football', 'tbd', 'n/a', 'na', 'null']);
const bad = value => PLACEHOLDERS.has(String(value ?? '').trim().toLowerCase());
const text = value => {
  if (typeof value === 'string' && value.trim() && !bad(value)) return value.trim();
  if (value && typeof value === 'object') {
    for (const key of ['name', 'team_name', 'teamName', 'displayName', 'title', 'shortName', 'longName', 'value']) {
      if (typeof value[key] === 'string' && value[key].trim() && !bad(value[key])) return value[key].trim();
    }
  }
  return null;
};
const find = (value, keys, depth = 0, seen = new Set()) => {
  if (depth > 16 || value == null) return null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const found = text(value[key]);
      if (found) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = find(child, keys, depth + 1, seen);
    if (found) return found;
  }
  return null;
};
const namesFromRaw = raw => ({
  home: find(raw, new Set(['home_team_name', 'homeTeamName', 'home_team', 'homeTeam', 'home_name', 'homeName', 'home'])),
  away: find(raw, new Set(['away_team_name', 'awayTeamName', 'away_team', 'awayTeam', 'away_name', 'awayName', 'away'])),
  league: find(raw, new Set(['league_name', 'leagueName', 'competition_name', 'competitionName', 'tournament_name', 'tournamentName', 'league', 'competition', 'tournament']))
});

function apiFootballKey() {
  return process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY || process.env.FOOTBALL_API_KEY || process.env.API_KEY || '';
}

async function fetchProviderFixture(id) {
  const key = apiFootballKey();
  if (!key || !id) return null;
  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { id: String(id) },
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
      timeout: 12000,
    });
    return Array.isArray(response.data?.response) ? response.data.response[0] || null : null;
  } catch (error) {
    console.warn(`[DB] Provider fixture lookup failed for ${id}:`, error?.message || error);
    return null;
  }
}

async function repairDatabase(sql) {
  const rows = await sql`SELECT id, home_team, away_team, league_name, raw_data FROM football_fixtures WHERE LOWER(BTRIM(COALESCE(home_team,''))) IN ('','home','home team','team home','unknown','tbd','n/a','na','null') OR LOWER(BTRIM(COALESCE(away_team,''))) IN ('','away','away team','team away','unknown','tbd','n/a','na','null') OR LOWER(BTRIM(COALESCE(league_name,''))) IN ('','unknown','unknown league','football','tbd','n/a','na','null') LIMIT 5000`;
  let repaired = 0;
  for (const row of rows) {
    let names = namesFromRaw(row.raw_data);
    if (bad(row.home_team) || bad(row.away_team) || bad(row.league_name)) {
      const provider = await fetchProviderFixture(String(row.id));
      if (provider) {
        const providerNames = namesFromRaw(provider);
        names = { home: providerNames.home || names.home, away: providerNames.away || names.away, league: providerNames.league || names.league };
        await sql`UPDATE football_fixtures SET raw_data=${JSON.stringify(provider)}, updated_at=NOW() WHERE id=${String(row.id)}`;
      }
    }
    const home = bad(row.home_team) ? names.home : row.home_team;
    const away = bad(row.away_team) ? names.away : row.away_team;
    const league = bad(row.league_name) ? names.league : row.league_name;
    if ((home && !bad(home)) || (away && !bad(away)) || (league && !bad(league))) {
      await sql`UPDATE football_fixtures SET home_team=COALESCE(NULLIF(${home && !bad(home) ? home : ''},''),home_team), away_team=COALESCE(NULLIF(${away && !bad(away) ? away : ''},''),away_team), league_name=COALESCE(NULLIF(${league && !bad(league) ? league : ''},''),league_name), updated_at=NOW() WHERE id=${String(row.id)}`;
      repaired += 1;
    }
  }
  return repaired;
}

async function enrichPredictionResponse(body, sql) {
  if (!body || !Array.isArray(body.predictions) || !body.predictions.length) return body;
  const ids = body.predictions.map(p => String(p?.id || p?.fixtureId || p?.fixture_id || '')).filter(Boolean);
  if (!ids.length) return body;
  const rows = await sql`SELECT id, home_team, away_team, league_name, raw_data FROM football_fixtures WHERE id = ANY(${ids})`;
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const predictions = [];
  for (const prediction of body.predictions) {
    const id = String(prediction?.id || prediction?.fixtureId || prediction?.fixture_id || '');
    const row = byId.get(id);
    let names = row ? namesFromRaw(row.raw_data) : {};
    let providerFixture = null;
    const needsHome = bad(prediction.homeTeam);
    const needsAway = bad(prediction.awayTeam);
    const needsLeague = bad(prediction.league);
    if ((needsHome || needsAway || needsLeague) && (!row || (bad(row.home_team) && bad(row.away_team)))) {
      providerFixture = await fetchProviderFixture(id);
      if (providerFixture) {
        const providerNames = namesFromRaw(providerFixture);
        names = { home: providerNames.home || names.home, away: providerNames.away || names.away, league: providerNames.league || names.league };
      }
    }
    const home = !needsHome ? prediction.homeTeam : (!bad(row?.home_team) ? row.home_team : names.home);
    const away = !needsAway ? prediction.awayTeam : (!bad(row?.away_team) ? row.away_team : names.away);
    const league = !needsLeague ? prediction.league : (!bad(row?.league_name) ? row.league_name : names.league);
    const fixed = { ...prediction, homeTeam: home && !bad(home) ? home : null, awayTeam: away && !bad(away) ? away : null, league: league && !bad(league) ? league : null };
    if (providerFixture && row) {
      const p = namesFromRaw(providerFixture);
      await sql`UPDATE football_fixtures SET home_team=COALESCE(NULLIF(${p.home || ''},''),home_team), away_team=COALESCE(NULLIF(${p.away || ''},''),away_team), league_name=COALESCE(NULLIF(${p.league || ''},''),league_name), raw_data=${JSON.stringify(providerFixture)}, updated_at=NOW() WHERE id=${String(row.id)}`;
    }
    predictions.push(fixed);
  }
  return { ...body, predictions };
}

function installResponseRepair() {
  try {
    const express = require('express');
    const originalJson = express.response.json;
    if (originalJson.__surebetRealTeamsPatch) return;
    const patchedJson = async function patchedJson(body) {
      if (this.req?.path === '/api/football/predictions' || this.req?.originalUrl?.startsWith('/api/football/predictions')) {
        try {
          const sql = neon(process.env.DATABASE_URL);
          body = await enrichPredictionResponse(body, sql);
        } catch (error) {
          console.warn('[DB] Prediction display enrichment failed:', error?.message || error);
        }
      }
      return originalJson.call(this, body);
    };
    patchedJson.__surebetRealTeamsPatch = true;
    express.response.json = patchedJson;
    console.log('[DB] Real-team response repair installed for /api/football/predictions.');
  } catch (error) {
    console.warn('[DB] Could not install prediction response repair:', error?.message || error);
  }
}

installResponseRepair();
setTimeout(async () => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
    const sql = neon(process.env.DATABASE_URL);
    const repaired = await repairDatabase(sql);
    console.log(`[DB] Runtime fixture repair completed: ${repaired} fixture(s) repaired.`);
  } catch (error) {
    console.error('[DB] Runtime fixture repair failed:', error?.message || error);
  }
}, 30000);
console.log('[DB] Fixture display repair runtime loaded; database repair scheduled for 30 seconds after process start.');