import axios from 'axios';
import { sql } from '../lib/db';

const BSD_BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const SETTLEMENT_DELAY_MS = 105 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRIES = 24;
const DATE_CACHE_MS = 2 * 60 * 1000;
const MAX_DATE_PAGES = 20;

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
    const pending = await sql<PendingMatch[]>`
      SELECT p.fixture_id, p.winner, p.predicted_home_goals, p.predicted_away_goals,
             f.home_team, f.away_team, f.kickoff_at
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

      const retry = (this.retries.get(fixtureId) || 0) + 1;
      this.retries.set(fixtureId, retry);
      if (retry <= MAX_RETRIES) {
        this.timers.set(fixtureId, setTimeout(() => void this.checkFixture(row), RETRY_DELAY_MS));
        console.log(`[History] ${row.home_team} vs ${row.away_team} is not final yet. Retry ${retry}/${MAX_RETRIES} in 5 minutes.`);
      } else {
        console.warn(`[History] Giving up active polling for ${row.home_team} vs ${row.away_team}; the next scheduler refresh will pick it up.`);
      }
    } catch (error) {
      const retry = (this.retries.get(fixtureId) || 0) + 1;
      this.retries.set(fixtureId, retry);
      if (retry <= MAX_RETRIES) this.timers.set(fixtureId, setTimeout(() => void this.checkFixture(row), RETRY_DELAY_MS));
      console.warn(`[History] Result refresh failed for ${row.home_team} vs ${row.away_team}:`, error instanceof Error ? error.message : error);
    }
  }

  private winnerFromScore(row: PendingMatch, homeGoals: number | null, awayGoals: number | null): string | null {
    if (homeGoals === null || awayGoals === null) return null;
    if (homeGoals > awayGoals) return row.home_team;
    if (awayGoals > homeGoals) return row.away_team;
    return 'draw';
  }

  private async fetchEvent(row: PendingMatch): Promise<any> {
    const key = String(process.env.BSD_API_KEY || '').trim();
    if (!key) throw new Error('BSD_API_KEY is not configured.');

    try {
      const response = await axios.get(`${BSD_BASE_URL}/events/${encodeURIComponent(row.fixture_id)}/`, {
        headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
        timeout: 20_000,
      });
      const data = response.data;
      const direct = data?.event || data?.result || (Array.isArray(data?.results) ? data.results[0] : data?.results) || data;
      if (direct && this.isMatchingEvent(direct, row)) return direct;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status !== 404) throw error;
    }

    const date = new Date(row.kickoff_at).toISOString().slice(0, 10);
    const events = await this.getEventsForDate(date, key);
    const match = events.find(event => this.isMatchingEvent(event, row));
    if (!match) throw new Error(`BSD event not found for ${row.home_team} vs ${row.away_team} on ${date}`);
    return match;
  }

  private async getEventsForDate(date: string, key: string): Promise<any[]> {
    const cached = this.dateCache.get(date);
    if (cached && cached.expiresAt > Date.now()) return cached.events;

    const events: any[] = [];
    for (let offset = 0; offset < MAX_DATE_PAGES * 200; offset += 200) {
      const response = await axios.get(`${BSD_BASE_URL}/events/`, {
        params: { date_from: date, date_to: date, limit: 200, offset },
        headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
        timeout: 20_000,
      });
      const page = Array.isArray(response.data?.results) ? response.data.results : [];
      events.push(...page);
      const count = Number(response.data?.count);
      if (!page.length || !response.data?.next || (Number.isFinite(count) && events.length >= count)) break;
    }

    this.dateCache.set(date, { expiresAt: Date.now() + DATE_CACHE_MS, events });
    console.log(`[History] Loaded ${events.length} BSD events for ${date} across paginated result pages.`);
    return events;
  }

  private normalizeTeamName(value: unknown): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(football|fc|cf|sc|club|women|woman|w|u19|u20|u21|ii)\b/g, ' ')
      .replace(/\b(2)\b/g, 'ii')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private teamSimilarity(a: unknown, b: unknown): number {
    const left = this.normalizeTeamName(a);
    const right = this.normalizeTeamName(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.9;
    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
    return intersection / Math.max(leftTokens.size, rightTokens.size);
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

  private isMatchingEvent(event: any, row: PendingMatch): boolean {
    // BSD fixture IDs are the authoritative join key. Use them before fuzzy
    // team matching because team naming varies considerably across competitions.
    const eventId = this.extractEventId(event);
    if (eventId && eventId === String(row.fixture_id)) return true;

    const home = this.extractTeamName(event?.home_team ?? event?.homeTeam ?? event?.home ?? event?.teams?.home ?? event?.event?.home_team ?? event?.event?.home);
    const away = this.extractTeamName(event?.away_team ?? event?.awayTeam ?? event?.away ?? event?.teams?.away ?? event?.event?.away_team ?? event?.event?.away);
    if (!home || !away) return false;

    const homeSimilarity = this.teamSimilarity(home, row.home_team);
    const awaySimilarity = this.teamSimilarity(away, row.away_team);
    if (homeSimilarity < 0.6 || awaySimilarity < 0.6) return false;

    const eventKickoff = event?.kickoff_at ?? event?.kickoff ?? event?.date ?? event?.start_time ?? event?.event?.kickoff_at ?? event?.event?.date;
    if (!eventKickoff) return true;
    const difference = Math.abs(new Date(eventKickoff).getTime() - new Date(row.kickoff_at).getTime());
    return Number.isFinite(difference) && difference <= 6 * 60 * 60 * 1000;
  }

  private normalizeStatus(fixture: any): string {
    const raw = String(fixture?.status || fixture?.event_status || fixture?.time?.status || '').toLowerCase();
    if (['finished', 'ft', 'ended', 'completed'].includes(raw)) return 'FT';
    if (['aet'].includes(raw)) return 'AET';
    if (['pen', 'penalties'].includes(raw)) return 'PEN';
    return raw.toUpperCase();
  }

  private readScore(fixture: any, side: 'home' | 'away'): number | null {
    const value = side === 'home'
      ? fixture?.home_score ?? fixture?.score?.home ?? fixture?.scores?.home ?? fixture?.goals?.home
      : fixture?.away_score ?? fixture?.score?.away ?? fixture?.scores?.away ?? fixture?.goals?.away;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}

export const realtimeSettlementService = new RealtimeSettlementService();
