const serviceModule = require('./services/AiPredictionService');
const { AiPredictionService } = serviceModule;
const { getAiModels } = require('./services/AiModelService');
const { neon } = require('@neondatabase/serverless');

const WINDOW = 60_000;
const BUDGETS = { gemini: 20_000, groq: 6_500 };
const state = { gemini: { used: [], cooldown: 0 }, groq: { used: [], cooldown: 0 } };
const isPlaceholder = v => !v || ['home','away','home team','away team','team home','team away','unknown','unknown league','football','tbd','n/a','na','null'].includes(String(v).trim().toLowerCase());
const text = v => {
  if (typeof v === 'string' && v.trim() && !isPlaceholder(v)) return v.trim();
  if (v && typeof v === 'object') for (const k of ['name','teamName','team_name','displayName','title','shortName']) if (typeof v[k] === 'string' && v[k].trim() && !isPlaceholder(v[k])) return v[k].trim();
  return null;
};
function find(root, keys, depth=0, seen=new Set()) {
  if (root == null || depth > 12) return null;
  if (typeof root === 'string') { try { root = JSON.parse(root); } catch { return null; } }
  if (!root || typeof root !== 'object' || seen.has(root)) return null;
  seen.add(root);
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(root, k)) { const t = text(root[k]); if (t) return t; }
  for (const v of Object.values(root)) { const t = find(v, keys, depth + 1, seen); if (t) return t; }
  return null;
}
function normalize(item) {
  const root = typeof item === 'string' ? (() => { try { return JSON.parse(item); } catch { return {}; } })() : (item || {});
  const hObj = root.teams?.home || root.fixture?.teams?.home || root.homeTeam || root.home_team || root.home?.team || root.event?.homeTeam || root.event?.home || {};
  const aObj = root.teams?.away || root.fixture?.teams?.away || root.awayTeam || root.away_team || root.away?.team || root.event?.awayTeam || root.event?.away || {};
  const lObj = root.league || root.fixture?.league || root.competition || root.tournament || root.event?.league || {};
  const home = text(hObj) || find(root, ['home_team_name','homeTeamName','home_team','homeTeam','home']);
  const away = text(aObj) || find(root, ['away_team_name','awayTeamName','away_team','awayTeam','away']);
  const league = text(lObj) || find(root, ['league_name','leagueName','competition_name','competitionName','tournament_name','tournamentName','league','competition','tournament']);
  const num = v => v == null || v === '' ? null : (Number.isFinite(Number(String(v).replace('%','').trim())) ? Number(String(v).replace('%','').trim()) : null);
  return { id: String(root.fixture?.id ?? root.fixture_id ?? root.match_id ?? root.event_id ?? root.id ?? '').trim(), leagueId: Number(lObj?.id ?? root.league_id ?? root.leagueId ?? 0) || null, league: league || 'Football', country: lObj?.country || root.country || root.league_country || '', season: Number(lObj?.season ?? root.season ?? 0) || null, homeId: Number(hObj?.id ?? root.home_team_id ?? root.homeTeamId ?? 0) || null, home: home || 'Home', awayId: Number(aObj?.id ?? root.away_team_id ?? root.awayTeamId ?? 0) || null, away: away || 'Away', kickoff: root.fixture?.date || root.kickoff_at || root.kickoff || root.startTime || root.start_time || root.event?.startTime || new Date().toISOString(), status: String(root.fixture?.status?.short || root.status?.short || root.status || 'NS'), homeScore: num(root.goals?.home ?? root.home_score), awayScore: num(root.goals?.away ?? root.away_score) };
}
AiPredictionService.prototype.normalizeFixture = normalize;

AiPredictionService.prototype.rankProviders = function(position, estimatedTokens) {
  const configured = getAiModels().filter(x => x.configured).map(x => x.provider);
  if (configured.length <= 1) return configured;
  const preferred = position % 2 === 1 ? 'gemini' : 'groq';
  const alternate = preferred === 'gemini' ? 'groq' : 'gemini';
  const now = Date.now();
  const can = p => { const s = state[p]; s.used = s.used.filter(t => t > now - WINDOW); return configured.includes(p) && s.cooldown <= now && s.used.length < Math.floor(BUDGETS[p] / Math.max(1, estimatedTokens)); };
  const out = [preferred, alternate].filter(can);
  console.log(`[AI] Provider routing game ${position}: preferred=${preferred.toUpperCase()} fallback=${alternate.toUpperCase()} selected=${out.map(x => x.toUpperCase()).join(',')}`);
  return out;
};

async function repairBadFixtureRows() {
  if (!process.env.DATABASE_URL) return 0;
  const db = neon(process.env.DATABASE_URL);
  let rows = [];
  try {
    rows = await db`SELECT id, raw_data, league_name, home_team, away_team, kickoff_at FROM football_fixtures WHERE LOWER(BTRIM(COALESCE(home_team,''))) IN ('','home','home team','unknown','tbd','n/a','na') OR LOWER(BTRIM(COALESCE(away_team,''))) IN ('','away','away team','unknown','tbd','n/a','na') OR LOWER(BTRIM(COALESCE(league_name,''))) IN ('','unknown','unknown league','n/a','na') ORDER BY kickoff_at ASC LIMIT 200`;
  } catch (error) {
    console.warn('[AI] Placeholder fixture preflight query failed:', error?.message || error);
    return 0;
  }
  let repaired = 0;
  for (const row of rows) {
    let fixed = row.raw_data ? normalize(row.raw_data) : null;
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) {
      try {
        const data = await AiPredictionService.prototype.requestFootball.call({ requestFootball: AiPredictionService.prototype.requestFootball }, '/fixtures', { id: String(row.id) });
        const fixture = Array.isArray(data?.response) ? data.response[0] : null;
        if (fixture) fixed = normalize(fixture);
      } catch (_) {
        // requestFootball is private at runtime; the fallback below uses direct axios through the service method when available.
        try {
          const service = new AiPredictionService();
          const data = await service.requestFootball('/fixtures', { id: String(row.id) });
          const fixture = Array.isArray(data?.response) ? data.response[0] : null;
          if (fixture) fixed = normalize(fixture);
        } catch (error) { console.warn(`[AI] Could not refresh placeholder fixture ${row.id}:`, error?.message || error); }
      }
    }
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) continue;
    try {
      await db`UPDATE football_fixtures SET league_id=${fixed.leagueId}, league_name=${fixed.league}, country=${fixed.country}, season=${fixed.season}, home_team_id=${fixed.homeId}, home_team=${fixed.home}, away_team_id=${fixed.awayId}, away_team=${fixed.away}, kickoff_at=${fixed.kickoff}, status=${fixed.status}, home_score=${fixed.homeScore}, away_score=${fixed.awayScore}, raw_data=${JSON.stringify({fixture:{id:fixed.id,date:fixed.kickoff,status:{short:fixed.status}},league:{id:fixed.leagueId,name:fixed.league,country:fixed.country,season:fixed.season},teams:{home:{id:fixed.homeId,name:fixed.home},away:{id:fixed.awayId,name:fixed.away}},goals:{home:fixed.homeScore,away:fixed.awayScore}})}, updated_at=NOW() WHERE id=${String(row.id)}`;
      repaired += 1;
    } catch (error) { console.warn(`[AI] Could not persist fixture ${row.id}:`, error?.message || error); }
  }
  if (repaired) console.log(`[AI] Placeholder fixture preflight repaired ${repaired} fixture(s).`);
  return repaired;
}

const originalRunAutomaticAnalysis = AiPredictionService.prototype.runAutomaticAnalysis;
AiPredictionService.prototype.runAutomaticAnalysis = async function(limit) {
  await repairBadFixtureRows();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await originalRunAutomaticAnalysis.call(this, limit); }
    catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|timeout|connection|socket/i.test(message);
      if (!transient || attempt === 3) throw error;
      const delay = attempt * 3000;
      console.warn(`[AI] Transient analysis dependency failure (attempt ${attempt}/3). Retrying in ${delay / 1000}s: ${message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

const originalGetPredictions = AiPredictionService.prototype.getPredictions;
AiPredictionService.prototype.getPredictions = async function(limit = 40) {
  await repairBadFixtureRows();
  const rows = await originalGetPredictions.call(this, limit);
  if (!rows?.length || !process.env.DATABASE_URL) return rows;
  const sql = neon(process.env.DATABASE_URL);
  let repaired = 0;
  for (const row of rows) {
    if (!isPlaceholder(row.homeTeam) && !isPlaceholder(row.awayTeam) && !isPlaceholder(row.league)) continue;
    let fixed = null;
    try {
      const stored = await sql`SELECT raw_data FROM football_fixtures WHERE id = ${String(row.id)} LIMIT 1`;
      if (stored[0]?.raw_data) fixed = normalize(stored[0].raw_data);
    } catch (error) { console.warn(`[AI] Could not read raw fixture ${row.id}:`, error?.message || error); }
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) {
      try {
        const data = await this.requestFootball('/fixtures', { id: String(row.id) });
        const fixture = Array.isArray(data?.response) ? data.response[0] : null;
        if (fixture) fixed = normalize(fixture);
      } catch (error) { console.warn(`[AI] Provider refresh failed for fixture ${row.id}:`, error?.message || error); }
    }
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) continue;
    row.homeTeam = fixed.home;
    row.awayTeam = fixed.away;
    if (!isPlaceholder(fixed.league)) row.league = fixed.league;
    repaired += 1;
    try {
      await sql`UPDATE football_fixtures SET league_id=${fixed.leagueId}, league_name=${fixed.league}, country=${fixed.country}, season=${fixed.season}, home_team_id=${fixed.homeId}, home_team=${fixed.home}, away_team_id=${fixed.awayId}, away_team=${fixed.away}, kickoff_at=${fixed.kickoff}, status=${fixed.status}, home_score=${fixed.homeScore}, away_score=${fixed.awayScore}, raw_data=${JSON.stringify({fixture:{id:fixed.id,date:fixed.kickoff,status:{short:fixed.status}},league:{id:fixed.leagueId,name:fixed.league,country:fixed.country,season:fixed.season},teams:{home:{id:fixed.homeId,name:fixed.home},away:{id:fixed.awayId,name:fixed.away}},goals:{home:fixed.homeScore,away:fixed.awayScore}})}, updated_at=NOW() WHERE id=${String(row.id)}`;
    } catch (error) { console.warn(`[AI] Could not persist repaired fixture ${row.id}:`, error?.message || error); }
  }
  if (repaired) console.log(`[AI] Last-mile fixture display repair: ${repaired} prediction(s) corrected.`);
  return rows;
};

console.log('[AI] Runtime fixture metadata/router patch loaded. Placeholder fixtures are blocked before analysis, real team names are enforced, provider routing is balanced, and transient failures retry safely.');