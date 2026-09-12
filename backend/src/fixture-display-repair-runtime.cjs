const { neon } = require('@neondatabase/serverless');

const PLACEHOLDERS = new Set(['', 'home', 'away', 'home team', 'away team', 'unknown', 'unknown league', 'football', 'tbd', 'n/a', 'na', 'null']);
const bad = value => PLACEHOLDERS.has(String(value ?? '').trim().toLowerCase());
const text = value => {
  if (typeof value === 'string' && value.trim() && !bad(value)) return value.trim();
  if (value && typeof value === 'object') {
    for (const key of ['name', 'team_name', 'teamName', 'displayName', 'title', 'shortName', 'league_name', 'leagueName', 'competition_name', 'competitionName']) {
      if (typeof value[key] === 'string' && value[key].trim() && !bad(value[key])) return value[key].trim();
    }
  }
  return null;
};
const find = (value, keys, depth = 0, seen = new Set()) => {
  if (depth > 14 || value == null) return null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) {
      const found = text(child);
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
  home: find(raw, new Set(['home', 'home_team', 'homeTeam', 'home_team_name', 'homeTeamName', 'homeName'])),
  away: find(raw, new Set(['away', 'away_team', 'awayTeam', 'away_team_name', 'awayTeamName', 'awayName'])),
  league: find(raw, new Set(['league', 'league_name', 'leagueName', 'competition', 'competition_name', 'competitionName', 'tournament', 'tournament_name', 'tournamentName']))
});

async function repairDatabase(sql) {
  const rows = await sql`SELECT id, home_team, away_team, league_name, raw_data FROM football_fixtures WHERE LOWER(BTRIM(COALESCE(home_team,''))) IN ('','home','home team','unknown','tbd','n/a','na','null') OR LOWER(BTRIM(COALESCE(away_team,''))) IN ('','away','away team','unknown','tbd','n/a','na','null') OR LOWER(BTRIM(COALESCE(league_name,''))) IN ('','unknown','unknown league','football','tbd','n/a','na','null') LIMIT 5000`;
  let repaired = 0;
  for (const row of rows) {
    const names = namesFromRaw(row.raw_data);
    const home = bad(row.home_team) ? names.home : row.home_team;
    const away = bad(row.away_team) ? names.away : row.away_team;
    const league = bad(row.league_name) ? names.league : row.league_name;
    if (home || away || league) {
      await sql`UPDATE football_fixtures SET home_team=COALESCE(NULLIF(${home || ''},''),home_team), away_team=COALESCE(NULLIF(${away || ''},''),away_team), league_name=COALESCE(NULLIF(${league || ''},''),league_name), updated_at=NOW() WHERE id=${String(row.id)}`;
      repaired += 1;
    }
  }
  return repaired;
}

async function enrichPredictionResponse(body, sql) {
  if (!body || !Array.isArray(body.predictions) || !body.predictions.length) return body;
  const ids = body.predictions.map(p => String(p?.id || '')).filter(Boolean);
  if (!ids.length) return body;
  const rows = await sql`SELECT id, home_team, away_team, league_name, raw_data FROM football_fixtures WHERE id = ANY(${ids})`;
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const predictions = body.predictions.map(prediction => {
    const row = byId.get(String(prediction.id));
    if (!row) return prediction;
    const names = namesFromRaw(row.raw_data);
    const home = !bad(prediction.homeTeam) ? prediction.homeTeam : (!bad(row.home_team) ? row.home_team : names.home);
    const away = !bad(prediction.awayTeam) ? prediction.awayTeam : (!bad(row.away_team) ? row.away_team : names.away);
    const league = !bad(prediction.league) ? prediction.league : (!bad(row.league_name) ? row.league_name : names.league);
    return { ...prediction, homeTeam: home || null, awayTeam: away || null, league: league || null };
  });
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
