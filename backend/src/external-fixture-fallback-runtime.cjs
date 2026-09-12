const axios = require('axios');
const { AiPredictionService } = require('./services/AiPredictionService');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';

function mapEspn(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.map((event) => {
    const competition = event?.competitions?.[0];
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const home = competitors.find((item) => item?.homeAway === 'home') || competitors[0];
    const away = competitors.find((item) => item?.homeAway === 'away') || competitors[1];
    const league = payload?.leagues?.[0] || event?.league || {};
    const state = String(event?.status?.type?.state || '').toLowerCase();
    return {
      fixture: {
        id: `espn-${String(event?.id || '').trim()}`,
        date: event?.date || competition?.date || null,
        status: { short: state === 'in' ? 'LIVE' : state === 'post' ? 'FT' : 'NS' },
      },
      league: {
        id: league?.id || null,
        name: league?.name || event?.season?.slug || 'Football',
        country: league?.country || '',
        season: event?.season?.year || null,
      },
      teams: {
        home: { id: home?.team?.id || null, name: home?.team?.displayName || home?.team?.name || '' },
        away: { id: away?.team?.id || null, name: away?.team?.displayName || away?.team?.name || '' },
      },
      goals: {
        home: home?.score != null ? Number(home.score) : null,
        away: away?.score != null ? Number(away.score) : null,
      },
      __surebetSource: 'espn',
    };
  });
}

function validFixture(item, now) {
  const home = String(item?.teams?.home?.name || '').trim();
  const away = String(item?.teams?.away?.name || '').trim();
  const date = new Date(item?.fixture?.date || 0);
  return item?.fixture?.id && home && away && !/^(home|away|unknown|tbd|n\/a)$/i.test(home) && !/^(home|away|unknown|tbd|n\/a)$/i.test(away) && Number.isFinite(date.getTime()) && date.getTime() >= now;
}

async function fetchEspn(date, limit, known) {
  const response = await axios.get(ESPN_BASE, {
    params: { dates: date.replace(/-/g, ''), limit: 1000 },
    headers: { Accept: 'application/json' },
    timeout: 15_000,
  });
  const now = Date.now();
  const mapped = mapEspn(response.data).filter((item) => validFixture(item, now));
  const fresh = mapped.filter((item) => {
    const id = String(item.fixture.id);
    if (known.has(id)) return false;
    known.add(id);
    return true;
  });
  console.log(`[AI] ESPN external fixture fallback returned ${fresh.length} valid upcoming games for ${date}.`);
  return fresh.slice(0, limit);
}

const original = AiPredictionService.prototype.fetchUpcomingFixtures;
AiPredictionService.prototype.fetchUpcomingFixtures = async function(limit = 40) {
  const primary = await original.call(this, limit);
  if (primary.length >= limit) return primary;

  const found = primary.slice();
  const known = new Set(found.map((item) => String(item?.fixture?.id ?? item?.id ?? '')));
  for (let offset = 0; offset < 7 && found.length < limit; offset += 1) {
    const date = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    try {
      const external = await fetchEspn(date, limit - found.length, known);
      found.push(...external);
    } catch (error) {
      console.warn(`[AI] ESPN external fixture fallback failed for ${date}:`, error?.message || error);
    }
  }
  found.sort((a, b) => new Date(a.fixture?.date || 0).getTime() - new Date(b.fixture?.date || 0).getTime());
  if (found.length > primary.length) console.log(`[AI] ESPN emergency fallback published ${found.length - primary.length} additional real games; ${found.length}/${limit} collected.`);
  return found.slice(0, limit);
};

console.log('[AI] External fixture fallback loaded. ESPN public soccer scoreboard is the emergency source when API-Football/BSD are unavailable.');
