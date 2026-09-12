import axios from 'axios';
import { sql } from '../lib/db';

const BSD_BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const SETTLEMENT_DELAY_MS = 135 * 60 * 1000;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const MAX_RETRIES = 18;

type PendingMatch = { fixture_id: string; winner: string | null; home_team: string; away_team: string; kickoff_at: string };

class RealtimeSettlementService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retries = new Map<string, number>();
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
  }

  public async refreshSchedules(): Promise<void> {
    const pending = await sql<PendingMatch[]>`
      SELECT p.fixture_id, p.winner, f.home_team, f.away_team, f.kickoff_at
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
    this.timers.set(fixtureId, setTimeout(() => {
      void this.checkFixture(row);
    }, delay));
  }

  private async checkFixture(row: PendingMatch): Promise<void> {
    const fixtureId = String(row.fixture_id);
    this.timers.delete(fixtureId);
    try {
      const fixture = await this.fetchEvent(fixtureId);
      const status = this.normalizeStatus(fixture);
      const homeScore = this.readScore(fixture, 'home');
      const awayScore = this.readScore(fixture, 'away');

      if (['FT', 'AET', 'PEN'].includes(status) && homeScore !== null && awayScore !== null) {
        const actualWinner = homeScore > awayScore ? row.home_team : homeScore < awayScore ? row.away_team : 'draw';
        const predictionResult = row.winner && row.winner === actualWinner ? 'true' : 'lose';
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
        console.log(`[History] ${row.home_team} vs ${row.away_team} is not final yet. Retry ${retry}/${MAX_RETRIES} in 10 minutes.`);
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

  private async fetchEvent(fixtureId: string): Promise<any> {
    const key = String(process.env.BSD_API_KEY || '').trim();
    if (!key) throw new Error('BSD_API_KEY is not configured.');
    const response = await axios.get(`${BSD_BASE_URL}/events/${encodeURIComponent(fixtureId)}/`, {
      headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
      timeout: 20_000,
    });
    const data = response.data;
    return data?.event || data?.result || (Array.isArray(data?.results) ? data.results[0] : data?.results) || data;
  }

  private normalizeStatus(fixture: any): string {
    const raw = String(fixture?.status || fixture?.event_status || '').toLowerCase();
    if (['finished', 'ft', 'ended', 'completed'].includes(raw)) return 'FT';
    if (['aet'].includes(raw)) return 'AET';
    if (['pen', 'penalties'].includes(raw)) return 'PEN';
    return raw.toUpperCase();
  }

  private readScore(fixture: any, side: 'home' | 'away'): number | null {
    const value = side === 'home'
      ? fixture?.home_score ?? fixture?.score?.home ?? fixture?.scores?.home
      : fixture?.away_score ?? fixture?.score?.away ?? fixture?.scores?.away;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
}

export const realtimeSettlementService = new RealtimeSettlementService();
