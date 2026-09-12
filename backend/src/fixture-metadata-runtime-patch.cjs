const axios = require('axios');
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
  return { id: String(root.fixture?.id ?? root.fixture_id ?? root.match_id ?? root.event_id ?? root.id ?? '').trim(), leagueId: Number(lObj?.id ?? root.league_id ?? root.leagueId ?? 0) || null, league: league || 'Football', country: lObj?.country || root.country || root.league_country || '', season: Number(lObj?.season ?? root.season ?? 0) || null, homeId: Number(hObj?.id ?? root.home_team_id ?? root.homeTeamId ?? 0) || null, home: home || 'Home', awayId: Number(aObj?.id ?? root.away_team_id ?? root.awayTeamId ?? 0) || null, away: away || 'Away', kickoff: root.fixture?.date || root.kickoff_at || root.kickoff || root.startTime || root.start_time || root.event?.startTime || root.event?.date || new Date().toISOString(), status: String(root.fixture?.status?.short || root.status?.short || root.status || 'NS'), homeScore: num(root.goals?.home ?? root.home_score), awayScore: num(root.goals?.away ?? root.away_score) };
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

function bsdEventToApiFixture(event) {
  const normalized = normalize(event);
  if (!normalized.id || isPlaceholder(normalized.home) || isPlaceholder(normalized.away)) return null;
  const kickoffMs = new Date(normalized.kickoff).getTime();
  if (!Number.isFinite(kickoffMs)) return null;
  return {
    fixture: { id: normalized.id, date: new Date(kickoffMs).toISOString(), status: { short: 'NS' } },
    league: { id: normalized.leagueId, name: normalized.league, country: normalized.country, season: normalized.season },
    teams: { home: { id: normalized.homeId, name: normalized.home }, away: { id: normalized.awayId, name: normalized.away } },
    goals: { home: null, away: null },
    __surebetSource: 'bsd',
  };
}

const originalFetchUpcomingFixtures = AiPredictionService.prototype.fetchUpcomingFixtures;
AiPredictionService.prototype.fetchUpcomingFixtures = async function(limit = 40) {
  const primary = await originalFetchUpcomingFixtures.call(this, limit);
  if (primary.length >= limit) return primary;

  const bsdKey = String(process.env.BSD_API_KEY || '').trim();
  if (!bsdKey) return primary;

  const found = primary.slice();
  const known = new Set(found.map(item => String(item.fixture?.id ?? item.id ?? '')));
  const now = Date.now();
  const bsdEvents = [];

  for (let offset = 0; offset < 3 && found.length < limit; offset += 1) {
    const date = new Date(now + offset * 86400000).toISOString().slice(0, 10);
    try {
      const events = [];
      for (let pageOffset = 0; pageOffset < 20 * 200; pageOffset += 200) {
        const response = await axios.get('https://sports.bzzoiro.com/api/v2/events/', {
          params: { date_from: date, date_to: date, limit: 200, offset: pageOffset },
          headers: { Authorization: `Token ${bsdKey}`, Accept: 'application/json' },
          timeout: 12_000,
        });
        const page = Array.isArray(response.data?.results) ? response.data.results : [];
        events.push(...page);
        const count = Number(response.data?.count);
        if (!page.length || !response.data?.next || (Number.isFinite(count) && events.length >= count)) break;
      }
      for (const event of events) {
        const fixture = bsdEventToApiFixture(event);
        if (!fixture || new Date(fixture.fixture.date).getTime() < now) continue;
        const id = String(fixture.fixture.id);
        if (known.has(id)) continue;
        known.add(id);
        found.push(fixture);
        bsdEvents.push(fixture);
        if (found.length >= limit) break;
      }
      console.log(`[AI] BSD fallback found ${bsdEvents.length} valid upcoming games for ${date}; ${found.length}/${limit} unique fixtures collected.`);
    } catch (error) {
      console.warn(`[AI] BSD fallback unavailable for ${date}:`, error instanceof Error ? error.message : error);
    }
  }

  found.sort((a, b) => new Date(a.fixture?.date || 0).getTime() - new Date(b.fixture?.date || 0).getTime());
  if (bsdEvents.length) console.log(`[AI] API-Football unavailable; using BSD fallback for ${bsdEvents.length} upcoming games.`);
  return found.slice(0, limit);
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
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) continue;
    try {
      await db`UPDATE football_fixtures SET league_id=${fixed.leagueId}, league_name=${fixed.league}, country=${fixed.country}, season=${fixed.season}, home_team_id=${fixed.homeId}, home_team=${fixed.home}, away_team_id=${fixed.awayId}, away_team=${fixed.away}, kickoff_at=${fixed.kickoff}, status=${fixed.status}, home_score=${fixed.homeScore}, away_score=${fixed.awayScore}, raw_data=${JSON.stringify(row.raw_data)}, updated_at=NOW() WHERE id=${String(row.id)}`;
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
  const db = neon(process.env.DATABASE_URL);
  let repaired = 0;
  for (const row of rows) {
    if (!isPlaceholder(row.homeTeam) && !isPlaceholder(row.awayTeam) && !isPlaceholder(row.league)) continue;
    let fixed = null;
    try {
      const stored = await db`SELECT raw_data FROM football_fixtures WHERE id = ${String(row.id)} LIMIT 1`;
      if (stored[0]?.raw_data) fixed = normalize(stored[0].raw_data);
    } catch (error) { console.warn(`[AI] Could not read raw fixture ${row.id}:`, error?.message || error); }
    if (!fixed || isPlaceholder(fixed.home) || isPlaceholder(fixed.away)) continue;
    row.homeTeam = fixed.home;
    row.awayTeam = fixed.away;
    if (!isPlaceholder(fixed.league)) row.league = fixed.league;
    repaired += 1;
    try {
      await db`UPDATE football_fixtures SET league_id=${fixed.leagueId}, league_name=${fixed.league}, country=${fixed.country}, season=${fixed.season}, home_team_id=${fixed.homeId}, home_team=${fixed.home}, away_team_id=${fixed.awayId}, away_team=${fixed.away}, kickoff_at=${fixed.kickoff}, status=${fixed.status}, home_score=${fixed.homeScore}, away_score=${fixed.awayScore}, updated_at=NOW() WHERE id=${String(row.id)}`;
    } catch (error) { console.warn(`[AI] Could not persist repaired fixture ${row.id}:`, error?.message || error); }
  }
  if (repaired) console.log(`[AI] Last-mile fixture display repair: ${repaired} prediction(s) corrected.`);
  return rows;
};

console.log('[AI] Runtime fixture metadata/router patch loaded. API-Football suspension now falls back to BSD fixtures for analysis, placeholder fixtures are blocked, real team names are enforced, and provider routing is balanced.');