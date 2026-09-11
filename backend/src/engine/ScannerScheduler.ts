import { oddsApiService } from '../services/OddsApiService';
import { ArbitrageEngine, SurebetOpportunity } from './ArbitrageEngine';
import { newId, sql } from '../lib/db';

const FULL_SCAN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LIVE_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

export class ScannerScheduler {
  private isRunning = false;
  private fullScanTimer?: ReturnType<typeof setTimeout>;
  private liveRefreshTimer?: ReturnType<typeof setTimeout>;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scanner] Automatic engine started. Full match generation runs every 12 hours.');
    console.log('[Scanner] Live odds refresh runs every 2 minutes for matches currently in progress.');

    await this.runFullScanIfDue();
    await this.refreshLiveMatches();
    await this.scheduleNextFullScan();
    this.scheduleNextLiveRefresh();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.fullScanTimer) clearTimeout(this.fullScanTimer);
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
  }

  private async scheduleNextFullScan(): Promise<void> {
    if (!this.isRunning) return;
    let delay = FULL_SCAN_INTERVAL_MS;
    try {
      const rows = await sql`SELECT last_run_at FROM system_settings WHERE id = 1`;
      const lastRunAt = rows[0]?.last_run_at ? new Date(rows[0].last_run_at).getTime() : 0;
      if (lastRunAt) delay = Math.max(1000, FULL_SCAN_INTERVAL_MS - (Date.now() - lastRunAt));
    } catch (error) {
      console.error('[Scanner] Could not calculate the next full scan time:', error);
    }

    console.log(`[Scanner] Next full match generation cycle in approximately ${(delay / 3600000).toFixed(1)} hours.`);
    this.fullScanTimer = setTimeout(async () => {
      await this.executeFullScan();
      await this.scheduleNextFullScan();
    }, delay);
  }

  private scheduleNextLiveRefresh(): void {
    if (!this.isRunning) return;
    this.liveRefreshTimer = setTimeout(async () => {
      await this.refreshLiveMatches();
      this.scheduleNextLiveRefresh();
    }, LIVE_REFRESH_INTERVAL_MS);
  }

  private async runFullScanIfDue(): Promise<void> {
    try {
      const rows = await sql`SELECT last_run_at FROM system_settings WHERE id = 1`;
      const lastRunAt = rows[0]?.last_run_at ? new Date(rows[0].last_run_at).getTime() : 0;
      if (!lastRunAt || Date.now() - lastRunAt >= FULL_SCAN_INTERVAL_MS) {
        await this.executeFullScan();
      } else {
        const remainingHours = ((FULL_SCAN_INTERVAL_MS - (Date.now() - lastRunAt)) / 3600000).toFixed(1);
        console.log(`[Scanner] Full scan already completed recently. Next cycle is due in approximately ${remainingHours} hours.`);
      }
    } catch (error) {
      console.error('[Scanner] Could not determine the full scan schedule:', error);
      await this.executeFullScan();
    }
  }

  private async executeFullScan(): Promise<void> {
    const runDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    let runStatus = 'success';

    try {
      const settings = await sql`SELECT min_roi FROM system_settings WHERE id = 1`;
      const minRoi = Number(settings[0]?.min_roi ?? 1);
      const { activeSportGroups, activeMarkets, activeBookmakers } = await this.getActiveConfiguration();
      console.log('[Scanner] Starting automatic 12-hour match generation cycle...');

      if (activeBookmakers.length < 2) {
        console.log('[Scanner] WARNING: Fewer than 2 active bookmakers. Arbitrage requires at least two.');
      } else if (activeSportGroups.length === 0) {
        console.log('[Scanner] No active sports configured. The automatic cycle will retry in 12 hours.');
      } else {
        const leaguesToScan = await oddsApiService.getActiveLeagues(activeSportGroups);
        console.log(`[Scanner] Found ${leaguesToScan.length} active leagues to scan.`);
        for (const league of leaguesToScan) {
          const events = await oddsApiService.getOddsForSport(league.sport, league.slug, activeMarkets, activeBookmakers);
          let foundInLeague = 0;
          for (const event of events) {
            if (new Date(event.commence_time).getTime() <= Date.now()) continue;
            for (const opportunity of ArbitrageEngine.analyzeEvent(event)) {
              if (opportunity.roi >= minRoi) {
                await this.saveOpportunityToDb(opportunity);
                foundInLeague++;
              }
            }
          }
          if (foundInLeague > 0) console.log(`[Engine] ${foundInLeague} surebet opportunities saved for ${league.name}.`);
        }
      }
    } catch (error) {
      console.error('[Scanner] Automatic full scan failed:', error);
      runStatus = 'error';
    } finally {
      await sql`UPDATE system_settings SET last_run_date = ${runDate}, last_run_at = NOW(), last_run_status = ${runStatus} WHERE id = 1`;
    }
  }

  private async refreshLiveMatches(): Promise<void> {
    try {
      const settings = await sql`SELECT min_roi FROM system_settings WHERE id = 1`;
      const minRoi = Number(settings[0]?.min_roi ?? 1);
      const { activeSportGroups, activeMarkets, activeBookmakers } = await this.getActiveConfiguration();
      if (activeBookmakers.length < 2 || activeSportGroups.length === 0) return;

      const liveEvents = await oddsApiService.getLiveOdds(activeSportGroups, activeMarkets, activeBookmakers);
      if (liveEvents.length === 0) return;

      let updatedCount = 0;
      for (const event of liveEvents) {
        await this.upsertEvent(event);
        for (const opportunity of ArbitrageEngine.analyzeEvent(event)) {
          if (opportunity.roi >= minRoi) {
            await this.saveOpportunityToDb(opportunity);
            updatedCount++;
          }
        }
      }
      console.log(`[Live] Refreshed ${liveEvents.length} live matches and ${updatedCount} active opportunities.`);
    } catch (error) {
      console.error('[Live] Live odds refresh failed:', error);
    }
  }

  private async getActiveConfiguration(): Promise<{ activeSportGroups: string[]; activeMarkets: string[]; activeBookmakers: string[] }> {
    const [sports, markets, bookmakers] = await Promise.all([
      sql`SELECT key FROM sports WHERE active = true ORDER BY title`,
      sql`SELECT key FROM markets WHERE active = true ORDER BY title`,
      sql`SELECT key FROM bookmakers WHERE active = true ORDER BY title`,
    ]);
    return {
      activeSportGroups: sports.map(row => String(row.key).toLowerCase()),
      activeMarkets: markets.map(row => String(row.key)),
      activeBookmakers: bookmakers.map(row => String(row.key)),
    };
  }

  private async upsertEvent(event: { id: string; sport_key: string; league_title: string; home_team: string; away_team: string; commence_time: string }): Promise<void> {
    await sql`
      INSERT INTO events (id, sport_key, league_title, home_team, away_team, commence_time)
      VALUES (${event.id}, ${event.sport_key}, ${event.league_title}, ${event.home_team}, ${event.away_team}, ${event.commence_time})
      ON CONFLICT (id) DO UPDATE SET
        sport_key = EXCLUDED.sport_key,
        league_title = EXCLUDED.league_title,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        commence_time = EXCLUDED.commence_time
    `;
  }

  private async saveOpportunityToDb(opportunity: SurebetOpportunity): Promise<void> {
    try {
      await this.upsertEvent(opportunity);
      const existing = await sql`
        SELECT id FROM surebet_opportunities
        WHERE event_id = ${opportunity.eventId} AND market_key = ${opportunity.marketKey} AND is_active = true
        ORDER BY created_at DESC LIMIT 1
      `;
      const opportunityId = existing[0]?.id || newId();

      await sql`
        INSERT INTO surebet_opportunities (id, event_id, market_key, roi, profit, created_at, is_active)
        VALUES (${opportunityId}, ${opportunity.eventId}, ${opportunity.marketKey}, ${opportunity.roi}, ${opportunity.profit}, NOW(), true)
        ON CONFLICT (id) DO UPDATE SET roi = EXCLUDED.roi, profit = EXCLUDED.profit, is_active = true
      `;
      await sql`DELETE FROM surebet_legs WHERE opportunity_id = ${opportunityId}`;
      for (const leg of opportunity.legs) {
        await sql`
          INSERT INTO surebet_legs (id, opportunity_id, outcome_name, bookmaker, price, stake_percentage)
          VALUES (${newId()}, ${opportunityId}, ${leg.outcomeName}, ${leg.bookmaker}, ${leg.price}, ${leg.stakePercentage})
        `;
      }
    } catch (error) {
      console.error('[DB] Error saving opportunity to Neon:', error);
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
