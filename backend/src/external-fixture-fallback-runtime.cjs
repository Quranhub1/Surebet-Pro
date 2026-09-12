const axios = require('axios');
const { AiPredictionService } = require('./services/AiPredictionService');

const SOURCES = [
  {
    name: 'Matchora',
    url: 'https://matchora.to/api/v1/schedule',
    map(payload) {
      const events = Array.isArray(payload?.events) ? payload.events : Array.isArray(payload?.data) ? payload.data : [];
      return events.map((event) => {
        const kickoff = Number(event?.kickoff);
        return {
          fixture: {
            id: String(event?.id ?? '').trim(),
            date: Number.isFinite(kickoff) ? new Date(kickoff * 1000).toISOString() : event?.kickoff_at || event?.kickoffAt || event?.date || null,
            status: { short: event?.live ? 'LIVE' : 'NS' },
          },
          league: { id: null, name: event?.league || event?.competition || 'Football', country: '', season: null },
          teams: { home: { id: null, name: event?.home || '' }, away: { id: null, name: event?.away || '' } },
          goals: { home: null, away: null },
          __surebetSource: 'matchora',
        };
      });
    },
  },
  {
    name: 'OpenFoot',
    url: 'https://openfootapi.com/v1/matches',
    map(payload) {
      const events = Array.isArray(payload?.data) ? payload.data : [];
      return events.map((event) => ({
        fixture: { id: String(event?.id ?? '').trim(), date: event?.kickoffAt || null, status: { short: event?.status === 'live' ? 'LIVE' : 'NS' } },
        league: { id: null, name: event?.competitionName || event?.competition?.name || event?.competitionId || 'Football', country: '', season: null },
        teams: { home: { id: event?.homeTeam?.id || null, name: event?.homeTeam?.name || '' }, away: { id: event?.awayTeam?.id || null, name: event?.awayTeam?.name || '' } },
        goals: { home: null, away: null },
        __surebetSource: 'openfoot',
      }));
    },
  },
];

function validFixture(item, now) {
  const home = String(item?.teams?.home?.name || '').trim();
  const away = String(item?.teams?.away?.name || '').trim();
  const date = new Date(item?.fixture?.date || 0);
  return item?.fixture?.id && home && away && !/^(home|away|unknown|tbd|n\/a)$/i.test(home) && !/^(home|away|unknown|tbd|n\/a)$/i.test(away) && Number.isFinite(date.getTime()) && date.getTime() >= now;
}

async function fetchExternal(date, limit, known) {
  const now = Date.now();
  for (const source of SOURCES) {
    try {
      const response = await axios.get(source.url, {
        params: source.name === 'OpenFoot' ? { date, status: 'scheduled' } : { date },
        headers: { Accept: 'application/json' },
        timeout: 10_000,
      });
      const mapped = source.map(response.data).filter((item) => validFixture(item, now));
      const fresh = mapped.filter((item) => {
        const id = String(item.fixture.id);
        if (known.has(id)) return false;
        known.add(id);
        return true;
      });
      console.log(`[AI] ${source.name} external fixture fallback returned ${fresh.length} valid games for ${date}.`);
      if (fresh.length) return fresh.slice(0, limit);
    } catch (error) {
      console.warn(`[AI] ${source.name} external fixture fallback failed for ${date}:`, error?.message || error);
    }
  }
  return [];
}

const original = AiPredictionService.prototype.fetchUpcomingFixtures;
AiPredictionService.prototype.fetchUpcomingFixtures = async function(limit = 40) {
  const primary = await original.call(this, limit);
  if (primary.length >= limit) return primary;

  const found = primary.slice();
  const known = new Set(found.map((item) => String(item?.fixture?.id ?? item?.id ?? '')));
  for (let offset = 0; offset < 7 && found.length < limit; offset += 1) {
    const date = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const external = await fetchExternal(date, limit - found.length, known);
    found.push(...external);
  }
  found.sort((a, b) => new Date(a.fixture?.date || 0).getTime() - new Date(b.fixture?.date || 0).getTime());
  if (found.length > primary.length) console.log(`[AI] External fixture fallback published ${found.length - primary.length} additional real games; ${found.length}/${limit} collected.`);
  return found.slice(0, limit);
};

console.log('[AI] External fixture fallback loaded. Matchora is primary emergency fixture source; OpenFoot is secondary.');
