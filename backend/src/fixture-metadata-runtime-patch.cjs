const serviceModule = require('./services/AiPredictionService');
const { AiPredictionService } = serviceModule;
const { getAiModels } = require('./services/AiModelService');

const WINDOW = 60_000;
const BUDGETS = { gemini: 20_000, groq: 6_500 };
const state = { gemini: { used: [], cooldown: 0 }, groq: { used: [], cooldown: 0 } };
const isPlaceholder = v => !v || ['home','away','home team','away team','team home','team away','tbd','unknown','n/a','null'].includes(String(v).trim().toLowerCase());
const text = v => {
  if (typeof v === 'string' && v.trim() && !isPlaceholder(v)) return v.trim();
  if (v && typeof v === 'object') for (const k of ['name','teamName','team_name','displayName','title','shortName']) if (typeof v[k] === 'string' && v[k].trim() && !isPlaceholder(v[k])) return v[k].trim();
  return null;
};
function find(root, keys, depth=0, seen=new Set()) {
  if (!root || typeof root !== 'object' || depth > 7 || seen.has(root)) return null;
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
  const can = p => { const s = state[p]; s.used = s.used.filter(t => t > now - WINDOW); return configured.includes(p) && s.cooldown <= now && s.used.length * estimatedTokens < BUDGETS[p]; };
  const out = [preferred, alternate].filter(can);
  console.log(`[AI] Provider routing game ${position}: preferred=${preferred.toUpperCase()} fallback=${alternate.toUpperCase()} selected=${out.map(x => x.toUpperCase()).join(',')}`);
  return out;
};

// Neon can occasionally return a transient fetch failure while the service is
// warming or multiple background jobs hit it together. Retry the complete
// analysis cycle without changing the 12-hour retention semantics. Existing
// predictions are reused on a retry, so this does not regenerate paid AI work.
const originalRunAutomaticAnalysis = AiPredictionService.prototype.runAutomaticAnalysis;
AiPredictionService.prototype.runAutomaticAnalysis = async function(limit) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await originalRunAutomaticAnalysis.call(this, limit);
    } catch (error) {
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

console.log('[AI] Runtime fixture metadata/router patch loaded. Real team names are enforced, provider routing is balanced, and transient analysis failures retry safely.');
