const { realtimeSettlementService } = require('./services/RealtimeSettlementService');

const isPlaceholder = value => {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || ['home', 'away', 'home team', 'away team', 'unknown', 'unknown team', 'unknown league', 'tbd', 'n/a', 'na'].includes(text);
};

const extractName = value => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  for (const key of ['name', 'team_name', 'teamName', 'displayName', 'display_name', 'title', 'shortName', 'short_name']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  for (const key of ['team', 'home_team', 'away_team', 'homeTeam', 'awayTeam']) {
    const nested = extractName(value[key]);
    if (nested) return nested;
  }
  return null;
};

if (realtimeSettlementService && typeof realtimeSettlementService.getEventsForDate === 'function') {
  const originalSchedule = realtimeSettlementService.schedule;
  realtimeSettlementService.schedule = function(row) {
    if (isPlaceholder(row?.home_team) || isPlaceholder(row?.away_team)) {
      const fixtureId = String(row?.fixture_id ?? '');
      if (fixtureId && this.timers?.has(fixtureId)) {
        clearTimeout(this.timers.get(fixtureId));
        this.timers.delete(fixtureId);
      }
      this.retries?.delete(fixtureId);
      console.warn(`[History] Skipping settlement for fixture ${fixtureId || 'unknown'} because team metadata is unresolved.`);
      return;
    }
    return originalSchedule.call(this, row);
  };

  const originalGetEventsForDate = realtimeSettlementService.getEventsForDate.bind(realtimeSettlementService);
  const inFlightDateFeeds = new Map();
  realtimeSettlementService.getEventsForDate = function(date, key) {
    const cached = this.dateCache?.get(date);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.events);
    const existing = inFlightDateFeeds.get(date);
    if (existing) return existing;
    const promise = originalGetEventsForDate(date, key).finally(() => inFlightDateFeeds.delete(date));
    inFlightDateFeeds.set(date, promise);
    return promise;
  };

  realtimeSettlementService.fetchFromBsd = async function(row, key) {
    const kickoff = new Date(row.kickoff_at);
    if (!Number.isFinite(kickoff.getTime())) throw new Error(`Invalid kickoff time for ${row.home_team} vs ${row.away_team}`);
    const dates = [-1, 0, 1].map(delta => {
      const d = new Date(kickoff.getTime() + delta * 86400000);
      return d.toISOString().slice(0, 10);
    });
    const uniqueDates = [...new Set(dates)];
    let best = null;
    for (const date of uniqueDates) {
      const events = await this.getEventsForDate(date, key);
      const match = this.findBestMatch(events, row);
      if (match) {
        best = match;
        break;
      }
    }
    if (!best) throw new Error(`Result event not found for ${row.home_team} vs ${row.away_team} around ${uniqueDates.join('/')}`);
    console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using BSD date feed.`);
    return best;
  };

  realtimeSettlementService.findBestMatch = function(events, row) {
    const fixtureId = String(row?.fixture_id ?? '').trim();
    const unique = Array.from(new Map(events.map(event => [this.extractEventId(event) || JSON.stringify(event), event])).values());

    // BSD predictions created after API-Football fallback use the BSD event id
    // as fixture_id, so an exact id match is authoritative and avoids fuzzy-name ambiguity.
    if (fixtureId) {
      const byId = unique.find(event => String(this.extractEventId(event) || '').trim() === fixtureId);
      if (byId) {
        console.log(`[History] BSD settlement matched fixture ${fixtureId} by exact event id.`);
        return byId;
      }
    }

    let best = null;
    for (const event of unique) {
      const home = extractName(event?.home_team ?? event?.homeTeam ?? event?.home ?? event?.teams?.home ?? event?.event?.home_team ?? event?.event?.home);
      const away = extractName(event?.away_team ?? event?.awayTeam ?? event?.away ?? event?.teams?.away ?? event?.event?.away_team ?? event?.event?.away);
      if (!home || !away) continue;
      const direct = this.teamSimilarity(home, row.home_team) + this.teamSimilarity(away, row.away_team);
      const swapped = this.teamSimilarity(home, row.away_team) + this.teamSimilarity(away, row.home_team);
      const teamScore = Math.max(direct, swapped);
      if (teamScore < 1.0) continue;
      const eventKickoff = event?.event_date ?? event?.eventDate ?? event?.kickoff_at ?? event?.kickoff ?? event?.date ?? event?.start_time ?? event?.startTime ?? event?.event?.event_date ?? event?.event?.kickoff_at ?? event?.event?.date;
      const kickoffScore = eventKickoff && this.kickoffMatches(eventKickoff, row.kickoff_at) ? 0.25 : eventKickoff ? -0.75 : 0;
      if (kickoffScore < 0) continue;
      const score = teamScore + kickoffScore;
      if (!best || score > best.score) best = { event, score, home, away };
    }
    if (best) console.log(`[History] BSD candidate matched ${row.home_team} vs ${row.away_team} -> ${best.home} vs ${best.away} (score ${best.score.toFixed(2)}).`);
    return best?.event || null;
  };

  console.log('[History] BSD settlement runtime patch loaded: shared date-feed matching, exact BSD event-id matching, +/-1 day timezone tolerance, event_date support, robust team extraction, cache stampede prevention, and slow per-team searches disabled.');
}
