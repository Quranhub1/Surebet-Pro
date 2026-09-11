import { oddsApiService } from '../services/OddsApiService';
import { ArbitrageEngine, SurebetOpportunity } from './ArbitrageEngine';
import { supabase } from '../lib/supabase';

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
    this.scheduleNextFullScan();
    this.scheduleNextLiveRefresh();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.fullScanTimer) clearTimeout(this.fullScanTimer);
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer);
  }

  private scheduleNextFullScan(): void {
    if (!this.isRunning) return;
    this.fullScanTimer = setTimeout(async () => {
      await this.executeFullScan();
      this.scheduleNextFullScan();
    }, FULL_SCAN_INTERVAL_MS);
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
      const { data } = await supabase
        .from('system_settings')
        .select('last_run_at')
        .eq('id', 1)
        .single();

      const lastRunAt = data?.last_run_at ? new Date(data.last_run_at).getTime() : 0;
      const due = !lastRunAt || Date.now() - lastRunAt >= FULL_SCAN_INTERVAL_MS;

      if (due) {
        await this.executeFullScan();
      } else {
        const remainingHours = ((FULL_SCAN_INTERVAL_MS - (Date.now() - lastRunAt)) / 3600000).toFixed(1);
        console.log(`[Scanner] Next full scan is due in approximately ${remainingHours} hours.`);
      }
    } catch (error) {
      console.error('[Scanner] Could not determine the next full scan:', error);
      await this.executeFullScan();
    }
  }

  private async executeFullScan(): Promise<void> {
    const runDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    let runStatus = 'success';

    try {
      const { data: settings } = await supabase
        .from('system_settings')
        .select('min_roi')
        .eq('id', 1)
        .single();

      const minRoi = settings?.min_roi ?? 1.0;
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
          const events = await oddsApiService.getOddsForSport(
            league.sport,
            league.slug,
            activeMarkets,
            activeBookmakers
          );

          let foundInLeague = 0;
          for (const event of events) {
            if (new Date(event.commence_time).getTime() <= Date.now()) continue;

            const opportunities = ArbitrageEngine.analyzeEvent(event);
            for (const opportunity of opportunities) {
              if (opportunity.roi >= minRoi) {
                foundInLeague++;
                await this.saveOpportunityToDb(opportunity);
              }
            }
          }

          if (foundInLeague > 0) {
            console.log(`[Engine] ${foundInLeague} surebet opportunities saved for ${league.name}.`);
          }
        }
      }
    } catch (error) {
      console.error('[Scanner] Automatic full scan failed:', error);
      runStatus = 'error';
    } finally {
      await supabase
        .from('system_settings')
        .update({
          last_run_date: runDate,
          last_run_at: new Date().toISOString(),
          last_run_status: runStatus,
        })
        .eq('id', 1);
    }
  }

  private async refreshLiveMatches(): Promise<void> {
    try {
      const { data: settings } = await supabase
        .from('system_settings')
        .select('min_roi')
        .eq('id', 1)
        .single();

      const minRoi = settings?.min_roi ?? 1.0;
      const { activeSportGroups, activeMarkets, activeBookmakers } = await this.getActiveConfiguration();

      if (activeBookmakers.length < 2 || activeSportGroups.length === 0) return;

      const liveEvents = await oddsApiService.getLiveOdds(
        activeSportGroups,
        activeMarkets,
        activeBookmakers
      );

      if (liveEvents.length === 0) return;

      let updatedCount = 0;
      for (const event of liveEvents) {
        await supabase.from('events').upsert({
          id: event.id,
          sport_key: event.sport_key,
          league_title: event.league_title,
          home_team: event.home_team,
          away_team: event.away_team,
          commence_time: event.commence_time,
        }, { onConflict: 'id' });

        const opportunities = ArbitrageEngine.analyzeEvent(event);
        for (const opportunity of opportunities) {
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

  private async getActiveConfiguration(): Promise<{
    activeSportGroups: string[];
    activeMarkets: string[];
    activeBookmakers: string[];
  }> {
    const [{ data: sports }, { data: markets }, { data: bookmakers }] = await Promise.all([
      supabase.from('sports').select('key').eq('active', true),
      supabase.from('markets').select('key').eq('active', true),
      supabase.from('bookmakers').select('key').eq('active', true),
    ]);

    return {
      activeSportGroups: sports?.map(s => s.key.toLowerCase()) || [],
      activeMarkets: markets?.map(m => m.key) || ['h2h'],
      activeBookmakers: bookmakers?.map(b => b.key) || ['superbet', 'novibet'],
    };
  }

  private async saveOpportunityToDb(opportunity: SurebetOpportunity): Promise<void> {
    try {
      await supabase.from('events').upsert({
        id: opportunity.eventId,
        sport_key: opportunity.sportKey,
        league_title: opportunity.leagueTitle,
        home_team: opportunity.homeTeam,
        away_team: opportunity.awayTeam,
        commence_time: opportunity.commenceTime,
      }, { onConflict: 'id' });

      const { data: existing } = await supabase
        .from('surebet_opportunities')
        .select('id')
        .eq('event_id', opportunity.eventId)
        .eq('market_key', opportunity.marketKey)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let opportunityId = existing?.id;

      if (opportunityId) {
        await supabase
          .from('surebet_opportunities')
          .update({
            roi: opportunity.roi,
            profit: opportunity.profit,
            is_active: true,
          })
          .eq('id', opportunityId);

        await supabase.from('surebet_legs').delete().eq('opportunity_id', opportunityId);
      } else {
        const { data: saved, error } = await supabase
          .from('surebet_opportunities')
          .insert({
            event_id: opportunity.eventId,
            market_key: opportunity.marketKey,
            roi: opportunity.roi,
            profit: opportunity.profit,
            is_active: true,
          })
          .select('id')
          .single();

        if (error || !saved) throw error || new Error('Opportunity was not saved');
        opportunityId = saved.id;
      }

      await supabase.from('surebet_legs').insert(
        opportunity.legs.map(leg => ({
          opportunity_id: opportunityId,
          outcome_name: leg.outcomeName,
          bookmaker: leg.bookmaker,
          price: leg.price,
          stake_percentage: leg.stakePercentage,
        }))
      );
    } catch (error) {
      console.error('[DB] Error saving opportunity:', error);
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
