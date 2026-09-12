const { realtimeSettlementService } = require('./services/RealtimeSettlementService');

const isPlaceholder = value => {
  const text = String(value ?? '').trim().toLowerCase();
  return !text || ['home', 'away', 'home team', 'away team', 'unknown', 'unknown team', 'unknown league', 'tbd', 'n/a', 'na'].includes(text);
};

if (realtimeSettlementService && typeof realtimeSettlementService.getEventsForDate === 'function') {
  // Never allow a placeholder fixture to enter the settlement queue. These rows
  // are legacy/corrupt metadata and cannot be reliably matched to a result.
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

  // Share an in-flight date-feed request between all fixtures for the same day.
  // Without this, concurrent settlement jobs can all miss the cache at once and
  // each download the same 198-event BSD feed. Humanity has invented mutexes;
  // apparently we should use them.
  const originalGetEventsForDate = realtimeSettlementService.getEventsForDate.bind(realtimeSettlementService);
  const inFlightDateFeeds = new Map();
  realtimeSettlementService.getEventsForDate = function(date, key) {
    const cached = this.dateCache?.get(date);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.events);

    const existing = inFlightDateFeeds.get(date);
    if (existing) return existing;

    const promise = originalGetEventsForDate(date, key).finally(() => {
      inFlightDateFeeds.delete(date);
    });
    inFlightDateFeeds.set(date, promise);
    return promise;
  };

  // The date feed is already paginated and cached. Searching BSD once per team
  // creates a storm of slow requests and still often misses renamed teams.
  realtimeSettlementService.fetchFromBsd = async function(row, key) {
    const date = new Date(row.kickoff_at).toISOString().slice(0, 10);
    const events = await this.getEventsForDate(date, key);
    const match = this.findBestMatch(events, row);
    if (!match) throw new Error(`Result event not found for ${row.home_team} vs ${row.away_team} on ${date}`);
    console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using BSD date feed.`);
    return match;
  };

  // Only accept a result when both team identities are reasonably strong.
  // A weak fuzzy match can settle the wrong fixture, which is much worse than
  // leaving a legitimate prediction pending until BSD has the result.
  realtimeSettlementService.findBestMatch = function(events, row) {
    const unique = Array.from(new Map(events.map(event => [this.extractEventId(event) || JSON.stringify(event), event])).values());
    let best = null;
    for (const event of unique) {
      const home = this.extractTeamName(event?.home_team ?? event?.homeTeam ?? event?.home ?? event?.teams?.home ?? event?.event?.home_team ?? event?.event?.home);
      const away = this.extractTeamName(event?.away_team ?? event?.awayTeam ?? event?.away ?? event?.teams?.away ?? event?.event?.away_team ?? event?.event?.away);
      if (!home || !away) continue;
      const direct = this.teamSimilarity(home, row.home_team) + this.teamSimilarity(away, row.away_team);
      const swapped = this.teamSimilarity(home, row.away_team) + this.teamSimilarity(away, row.home_team);
      const teamScore = Math.max(direct, swapped);
      if (teamScore < 1.5) continue;
      const eventKickoff = event?.kickoff_at ?? event?.kickoff ?? event?.date ?? event?.start_time ?? event?.event?.kickoff_at ?? event?.event?.date;
      const score = eventKickoff && this.kickoffMatches(eventKickoff, row.kickoff_at) ? teamScore + 0.25 : teamScore;
      if (!best || score > best.score) best = { event, score };
    }
    return best?.event || null;
  };

  console.log('[History] BSD settlement runtime patch loaded: shared date-feed matching enabled, cache stampede prevented, weak matches blocked, slow per-team searches disabled, and placeholder jobs blocked.');
}
