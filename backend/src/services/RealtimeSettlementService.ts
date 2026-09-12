import axios from 'axios';
import { sql } from '../lib/db';

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const BSD_BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const SETTLEMENT_DELAY_MS = 105 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 24;
const BSD_DATE_CACHE_MS = 5 * 60 * 1000;
const MAX_DATE_PAGES = 20;
const REQUEST_TIMEOUT_MS = 12_000;

type PendingMatch = {
  fixture_id: string;
  winner: string | null;
  predicted_home_goals: number | null;
  predicted_away_goals: number | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
};
type DateCache = { expiresAt: number; events: any[] };

class RealtimeSettlementService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retries = new Map<string, number>();
  private dateCache = new Map<string, DateCache>();
  private started = false;

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.refreshSchedules();
  }

  public stop(): void {
    this.started = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.retries.clear();
    this.dateCache.clear();
  }

  public async refreshSchedules(): Promise<void> {
    // Repair legacy placeholders from the original API-Football payload.
    // Explicitly treat Home/Away/Unknown as missing, not as valid metadata.
    await sql`
      UPDATE football_fixtures
      SET league_name = CASE
            WHEN LOWER(BTRIM(COALESCE(league_name, ''))) IN ('', 'unknown', 'unknown league', 'n/a', 'na')
              THEN COALESCE(NULLIF(BTRIM(raw_data->'league'->>'name'), ''), league_name)
            ELSE league_name
          END,
          home_team = CASE
            WHEN LOWER(BTRIM(COALESCE(home_team, ''))) IN ('', 'home', 'home team', 'unknown', 'tbd', 'n/a', 'na')
              THEN COALESCE(NULLIF(BTRIM(raw_data->'teams'->'home'->>'name'), ''), home_team)
            ELSE home_team
          END,
          away_team = CASE
            WHEN LOWER(BTRIM(COALESCE(away_team, ''))) IN ('', 'away', 'away team', 'unknown', 'tbd', 'n/a', 'na')
              THEN COALESCE(NULLIF(BTRIM(raw_data->'teams'->'away'->>'name'), ''), away_team)
            ELSE away_team
          END,
          updated_at = NOW()
      WHERE raw_data IS NOT NULL
        AND (
          LOWER(BTRIM(COALESCE(league_name, ''))) IN ('', 'unknown', 'unknown league', 'n/a', 'na')
          OR LOWER(BTRIM(COALESCE(home_team, ''))) IN ('', 'home', 'home team', 'unknown', 'tbd', 'n/a', 'na')
          OR LOWER(BTRIM(COALESCE(away_team, ''))) IN ('', 'away', 'away team', 'unknown', 'tbd', 'n/a', 'na')
        )`;

    const pending = await sql<PendingMatch[]>`
      SELECT p.fixture_id, p.winner, p.predicted_home_goals, p.predicted_away_goals,
             COALESCE(NULLIF(f.home_team, ''), NULLIF(f.raw_data->'teams'->'home'->>'name', ''), 'Home') AS home_team,
             COALESCE(NULLIF(f.away_team, ''), NULLIF(f.raw_data->'teams'->'away'->>'name', ''), 'Away') AS away_team,
             f.kickoff_at
      FROM football_ai_predictions p
      JOIN football_fixtures f ON f.id = p.fixture_id
      WHERE p.settled_at IS NULL
      ORDER BY f.kickoff_at ASC
      LIMIT 500`;

    const active = new Set(pending.map(row => String(row.fixture_id)));
    for (const [fixtureId, timer] of this.timers) {
      if (!active.has(fixtureId)) {
        clearTimeout(timer);
        this.timers.delete(fixtureId);
        this.retries.delete(fixtureId);
      }
    }

    for (const row of pending) this.schedule(row);
    console.log(`[History] Realtime settlement scheduler tracking ${pending.length} pending matches.`);
  }

  private schedule(row: PendingMatch): void {
    const fixtureId = String(row.fixture_id);
    if (this.timers.has(fixtureId)) return;

    const kickoff = new Date(row.kickoff_at).getTime();
    const target = kickoff + SETTLEMENT_DELAY_MS;
    const delay = Math.max(5_000, target - Date.now());
    this.timers.set(fixtureId, setTimeout(() => void this.checkFixture(row), delay));
    console.log(`[History] Scheduled result check for ${row.home_team} vs ${row.away_team} approximately 105 minutes after kickoff.`);
  }

  private async checkFixture(row: PendingMatch): Promise<void> {
    const fixtureId = String(row.fixture_id);
    this.timers.delete(fixtureId);
    try {
      const fixture = await this.fetchEvent(row);
      const status = this.normalizeStatus(fixture);
      const homeScore = this.readScore(fixture, 'home');
      const awayScore = this.readScore(fixture, 'away');

      if (['FT', 'AET', 'PEN'].includes(status) && homeScore !== null && awayScore !== null) {
        const actualWinner = homeScore > awayScore ? row.home_team : homeScore < awayScore ? row.away_team : 'draw';
        const predictedWinner = row.winner || this.winnerFromScore(row, row.predicted_home_goals, row.predicted_away_goals);
        const predictionResult = predictedWinner && predictedWinner === actualWinner ? 'true' : 'lose';
        await sql`
          UPDATE football_fixtures
          SET status = ${status}, home_score = ${homeScore}, away_score = ${awayScore}, raw_data = ${JSON.stringify(fixture)}, updated_at = NOW()
          WHERE id = ${fixtureId}`;
        await sql`
          UPDATE football_ai_predictions
          SET actual_home_score = ${homeScore}, actual_away_score = ${awayScore}, prediction_result = ${predictionResult}, settled_at = NOW(), updated_at = NOW()
          WHERE fixture_id = ${fixtureId} AND settled_at IS NULL`;
        this.retries.delete(fixtureId);
        console.log(`[History] Settled ${row.home_team} vs ${row.away_team}: ${homeScore}-${awayScore} (${predictionResult.toUpperCase()}).`);
        await this.refreshSchedules();
        return;
      }

      this.scheduleRetry(row, `${row.home_team} vs ${row.away_team} is not final yet.`);
    } catch (error) {
      this.scheduleRetry(row, `Result refresh failed for ${row.home_team} vs ${row.away_team}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private scheduleRetry(row: PendingMatch, message: string): void {
    const fixtureId = String(row.fixture_id);
    const retry = (this.retries.get(fixtureId) || 0) + 1;
    this.retries.set(fixtureId, retry);
    if (retry <= MAX_RETRIES) {
      this.timers.set(fixtureId, setTimeout(() => void this.checkFixture(row), RETRY_DELAY_MS));
      console.log(`[History] ${message} Retry ${retry}/${MAX_RETRIES} in 5 minutes.`);
    } else {
      console.warn(`[History] ${message} Giving up active polling; the next scheduler refresh will pick it up.`);
    }
  }

  private winnerFromScore(row: PendingMatch, homeGoals: number | null, awayGoals: number | null): string | null {
    if (homeGoals === null || awayGoals === null) return null;
    if (homeGoals > awayGoals) return row.home_team;
    if (awayGoals > homeGoals) return row.away_team;
    return 'draw';
  }

  private async fetchEvent(row: PendingMatch): Promise<any> {
    const apiKey = String(process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY || '').trim();

    // Fixture IDs are created from API-Football. Use that ID first, which avoids
    // trying to rediscover the match in a second provider with different IDs.
    if (apiKey) {
      try {
        const response = await axios.get(`${API_FOOTBALL_BASE_URL}/fixtures`, {
          params: { id: row.fixture_id },
          headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        });
        const fixture = Array.isArray(response.data?.response) ? response.data.response[0] : null;
        if (fixture && this.isMatchingApiFootballFixture(fixture, row)) {
          console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using API-Football fixture ${row.fixture_id}.`);
          return fixture;
        }
      } catch (error) {
        console.warn(`[History] API-Football fixture lookup failed for ${row.home_team} vs ${row.away_team}:`, error instanceof Error ? error.message : error);
      }

      // If a stored ID came from another source, find the fixture by date and
      // team names with one API-Football request before touching BSD.
      try {
        const date = new Date(row.kickoff_at).toISOString().slice(0, 10);
        const response = await axios.get(`${API_FOOTBALL_BASE_URL}/fixtures`, {
          params: { date },
          headers: { 'x-apisports-key': apiKey, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        });
        const fixtures = Array.isArray(response.data?.response) ? response.data.response : [];
        const match = this.findBestApiFootballMatch(fixtures, row);
        if (match) {
          console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using API-Football date lookup.`);
          return match;
        }
      } catch (error) {
        console.warn(`[History] API-Football date lookup failed for ${row.home_team} vs ${row.away_team}:`, error instanceof Error ? error.message : error);
      }
    }

    // BSD is now a genuine fallback, not the primary settlement database.
    const bsdKey = String(process.env.BSD_API_KEY || '').trim();
    if (!bsdKey) throw new Error('No football result provider is configured.');
    return this.fetchFromBsd(row, bsdKey);
  }

  private isMatchingApiFootballFixture(fixture: any, row: PendingMatch): boolean {
    const home = fixture?.teams?.home?.name;
    const away = fixture?.teams?.away?.name;
    if (!home || !away) return false;
    return this.teamPairMatches(home, away, row) && this.kickoffMatches(fixture?.fixture?.date, row.kickoff_at);
  }

  private findBestApiFootballMatch(fixtures: any[], row: PendingMatch): any | null {
    let best: { fixture: any; score: number } | null = null;
    for (const fixture of fixtures) {
      const home = fixture?.teams?.home?.name;
      const away = fixture?.teams?.away?.name;
      if (!home || !away || !this.kickoffMatches(fixture?.fixture?.date, row.kickoff_at)) continue;
      const direct = this.teamSimilarity(home, row.home_team) + this.teamSimilarity(away, row.away_team);
      const swapped = this.teamSimilarity(home, row.away_team) + this.teamSimilarity(away, row.home_team);
      const score = Math.max(direct, swapped);
      if (score >= 1.5 && (!best || score > best.score)) best = { fixture, score };
    }
    return best?.fixture || null;
  }

  private async fetchFromBsd(row: PendingMatch, key: string): Promise<any> {
    const date = new Date(row.kickoff_at).toISOString().slice(0, 10);
    const candidates: any[] = [];

    // One targeted BSD query is enough in most cases. Query the less ambiguous
    // side first and only query the other side if the first produced no match.
    const names = [row.home_team, row.away_team].sort((a, b) => this.normalizeTeamName(a).length - this.normalizeTeamName(b).length);
    for (const teamName of names) {
      try {
        const response = await axios.get(`${BSD_BASE_URL}/events/`, {
          params: { date_from: date, date_to: date, team_name: teamName, limit: 200, offset: 0 },
          headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        });
        const page = Array.isArray(response.data?.results) ? response.data.results : [];
        candidates.push(...page);
        const match = this.findBestMatch(candidates, row);
        if (match) {
          console.log(`[History] Matched ${row.home_team} vs ${row.away_team} using BSD fallback.`);
          return match;
        }
      } catch (error) {
        console.warn(`[History] BSD team search failed for ${teamName}:`, error instanceof Error ? error.message : error);
      }
    }

    const events = await this.getEventsForDate(date, key);
    const match = this.findBestMatch(events, row);
    if (!match) throw new Error(`Result event not found for ${row.home_team} vs ${row.away_team} on ${date}`);
    return match;
  }

  private findBestMatch(events: any[], row: PendingMatch): any | null {
    const unique = Array.from(new Map(events.map(event => [this.extractEventId(event) || JSON.stringify(event), event])).values());
    let best: { event: any; score: number } | null = null;
    for (const event of unique) {
      const score = this.matchScore(event, row);
      if (score >= 1.5 && (!best || score > best.score)) best = { event, score };
    }
    return best?.event || null;
  }

  private matchScore(event: any, row: PendingMatch): number {
    const home = this.extractTeamName(event?.home_team ?? event?.homeTeam ?? event?.home ?? event?.teams?.home ?? event?.event?.home_team ?? event?.event?.home);
    const away = this.extractTeamName(event?.away_team ?? event?.awayTeam ?? event?.away ?? event?.teams?.away ?? event?.event?.away_team ?? event?.event?.away);
    if (!home || !away) return 0;
    const direct = this.teamSimilarity(home, row.home_team) + this.teamSimilarity(away, row.away_team);
    const swapped = this.teamSimilarity(home, row.away_team) + this.teamSimilarity(away, row.home_team);
    const teamScore = Math.max(direct, swapped);
    if (teamScore < 1.5) return 0;
    const eventKickoff = event?.kickoff_at ?? event?.kickoff ?? event?.date ?? event?.start_time ?? event?.event?.kickoff_at ?? event?.event?.date;
    if (!eventKickoff) return teamScore;
    return this.kickoffMatches(eventKickoff, row.kickoff_at) ? teamScore + 0.25 : 0;
  }

  private teamPairMatches(home: unknown, away: unknown, row: PendingMatch): boolean {
    const direct = this.teamSimilarity(home, row.home_team) + this.teamSimilarity(away, row.away_team);
    const swapped = this.teamSimilarity(home, row.away_team) + this.teamSimilarity(away, row.home_team);
    return Math.max(direct, swapped) >= 1.5;
  }

  private kickoffMatches(left: unknown, right: unknown): boolean {
    if (!left || !right) return true;
    const a = new Date(String(left)).getTime();
    const b = new Date(String(right)).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return Math.abs(a - b) <= 18 * 60 * 60 * 1000;
  }

  private async getEventsForDate(date: string, key: string): Promise<any[]> {
    const cached = this.dateCache.get(date);
    if (cached && cached.expiresAt > Date.now()) return cached.events;

    const events: any[] = [];
    for (let offset = 0; offset < MAX_DATE_PAGES * 200; offset += 200) {
      const response = await axios.get(`${BSD_BASE_URL}/events/`, {
        params: { date_from: date, date_to: date, limit: 200, offset },
        headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const page = Array.isArray(response.data?.results) ? response.data.results : [];
      events.push(...page);
      const count = Number(response.data?.count);
      if (!page.length || !response.data?.next || (Number.isFinite(count) && events.length >= count)) break;
    }
    this.dateCache.set(date, { expiresAt: Date.now() + BSD_DATE_CACHE_MS, events });
    console.log(`[History] Loaded ${events.length} BSD events for ${date} across paginated result pages.`);
    return events;
  }

  private normalizeTeamName(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\b(football|fc|cf|sc|club|women|woman|w|u19|u20|u21|u23|ii|reserves?)\b/g, ' ')
      .replace(/\b(2)\b/g, 'ii')
      .replace(/\butd\b/g, 'united')
      .replace(/\bst\b/g, 'saint')
      .replace(/\bdep\b/g, 'deportivo')
      .replace(/\batletico\s+de\b/g, 'atletico')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private teamSimilarity(a: unknown, b: unknown): number {
    const left = this.normalizeTeamName(a);
    const right = this.normalizeTeamName(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.94;
    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const jaccard = union ? intersection / union : 0;
    const containment = intersection / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
    return Math.max(jaccard, containment * 0.9);
  }

  private extractTeamName(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (!value || typeof value !== 'object') return null;
    const object = value as Record<string, unknown>;
    for (const key of ['name', 'teamName', 'team_name', 'displayName', 'display_name', 'title', 'shortName', 'short_name']) {
      const candidate = object[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    for (const key of ['team', 'home_team', 'away_team', 'homeTeam', 'awayTeam']) {
      const nested = this.extractTeamName(object[key]);
      if (nested) return nested;
    }
    return null;
  }

  private extractEventId(event: any): string | null {
    const id = event?.id ?? event?.event_id ?? event?.fixture_id ?? event?.match_id ?? event?.fixture?.id ?? event?.event?.id;
    return id === null || id === undefined || id === '' ? null : String(id);
  }

  private normalizeStatus(fixture: any): string {
    const raw = String(
      fixture?.fixture?.status?.short ??
      fixture?.status ??
      fixture?.event_status ??
      fixture?.time?.status ??
      fixture?.event?.status ??
      ''
    ).toLowerCase();
    if (['finished', 'ft', 'ended', 'completed'].includes(raw)) return 'FT';
    if (['aet'].includes(raw)) return 'AET';
    if (['pen', 'penalties'].includes(raw)) return 'PEN';
    return raw.toUpperCase();
  }

  private readScore(fixture: any, side: 'home' | 'away'): number | null {
    const value = side === 'home'
      ? fixture?.goals?.home ?? fixture?.home_score ?? fixture?.score?.home ?? fixture?.scores?.home
      : fixture?.goals?.away ?? fixture?.away_score ?? fixture?.score?.away ?? fixture?.scores?.away;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}

export const realtimeSettlementService = new RealtimeSettlementService();