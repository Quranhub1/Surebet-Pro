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

  // The date feed is already paginated and cached. Searching BSD once per team
  // creates a storm of 12-second requests and still often misses renamed teams.
  realtimeSettlementService.fetchFromBsd = async function(row, key) {
    const date = new Date(row.kickoff_at).toISOString().slice(0, 10);
    const events = await this.getEventsForDate(date, key);
    const match = this.findBestMatch(events, row);
    if (!match) throw new Error(`Result event not found for ${row.home_team} vs ${row.away_team} on ${date}`);
    console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using BSD date feed.`);
    return match;
  };

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
      if (teamScore < 1.2) continue;
      const eventKickoff = event?.kickoff_at ?? event?.kickoff ?? event?.date ?? event?.start_time ?? event?.event?.kickoff_at ?? event?.event?.date;
      const score = eventKickoff && this.kickoffMatches(eventKickoff, row.kickoff_at) ? teamScore + 0.25 : teamScore;
      if (!best || score > best.score) best = { event, score };
    }
    return best?.event || null;
  };

  console.log('[History] BSD settlement runtime patch loaded: date-feed matching enabled, slow per-team searches disabled, and placeholder jobs blocked.');
}