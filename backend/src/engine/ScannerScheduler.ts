import { oddsApiService } from '../services/OddsApiService';
import { ArbitrageEngine, SurebetOpportunity } from './ArbitrageEngine';
import { supabase } from '../lib/supabase';

function getTimeInZone(timezone: string): { hour: number; minute: number; date: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export class ScannerScheduler {
  private isRunning = false;
  private hasTriggeredToday = false;

  constructor() {
    console.log('[Scanner] Inicializado. Aguardando agendamento...');
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scanner] Motor de busca ativado.');
    void this.runCycle();
  }

  public stop() {
    this.isRunning = false;
  }

  private async runCycle() {
    while (this.isRunning) {
      try {
        const { data: settings } = await supabase
          .from('system_settings')
          .select('*')
          .eq('id', 1)
          .single();

        const schedulerEnabled = settings?.scheduler_enabled ?? false;
        const runHour = settings?.run_hour ?? 6;
        const runMinute = settings?.run_minute ?? 0;
        const timezone = settings?.timezone || 'Africa/Kampala';
        const minRoi = settings?.min_roi ?? 1.0;

        if (!schedulerEnabled) {
          console.log('[Scanner] Aguardando agendamento...');
          await this.sleep(60000);
          continue;
        }

        const { hour, minute, date } = getTimeInZone(timezone);

        if (hour === runHour && minute === runMinute && !this.hasTriggeredToday) {
          this.hasTriggeredToday = true;
          await this.executeScanCycle(minRoi, date);
        } else if (hour !== runHour || minute !== runMinute) {
          this.hasTriggeredToday = false;
        }

        await this.sleep(60000);
      } catch (error) {
        console.error('[Scanner] Erro crítico no ciclo:', error);
        await this.sleep(60000);
      }
    }
  }

  private async executeScanCycle(minRoi: number, runDate: string) {
    let runStatus = 'success';

    try {
      const { data: sports } = await supabase.from('sports').select('key').eq('active', true);
      const activeSportGroups = sports?.map(s => s.key.toLowerCase()) || [];

      const { data: markets } = await supabase.from('markets').select('key').eq('active', true);
      const activeMarkets = markets?.map(m => m.key) || ['h2h'];

      const { data: bookmakers } = await supabase.from('bookmakers').select('key').eq('active', true);
      const activeBookmakers = bookmakers?.map(b => b.key) || ['superbet', 'novibet'];

      console.log('\n[Scanner] 🔄 Iniciando novo ciclo de busca agendado...');

      if (activeBookmakers.length < 2) {
        console.log('[Scanner] AVISO: Menos de 2 casas de apostas ativas. Arbitragem impossível.');
      } else if (activeSportGroups.length === 0) {
        console.log('[Scanner] Nenhum grupo de esporte ativo. Pulando ciclo.');
      } else {
        console.log('[Scanner] Consultando API para descobrir ligas dos esportes selecionados...');
        const leaguesToScan = await oddsApiService.getActiveLeagues(activeSportGroups);
        console.log(`[Scanner] Mapeamento concluído: ${leaguesToScan.length} ligas encontradas.`);

        for (const league of leaguesToScan) {
          console.log(`[Scanner] Buscando odds para a liga: ${league.name} (${league.slug})...`);

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
            for (const opp of opportunities) {
              if (opp.roi >= minRoi) {
                foundInLeague++;
                await this.saveOpportunityToDb(opp);
              }
            }
          }

          if (foundInLeague > 0) {
            console.log(`[Engine] 🔥 ${foundInLeague} surebets salvas em ${league.name}!`);
          }

          await this.sleep(1000);
        }
      }
    } catch (error) {
      console.error('[Scanner] Erro no ciclo agendado:', error);
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

  private async saveOpportunityToDb(opp: SurebetOpportunity) {
    try {
      await supabase.from('events').upsert({
        id: opp.eventId,
        sport_key: opp.sportKey,
        league_title: opp.leagueTitle,
        home_team: opp.homeTeam,
        away_team: opp.awayTeam,
        commence_time: opp.commenceTime,
      }, { onConflict: 'id' });

      const { data: savedOpp, error: oppError } = await supabase.from('surebet_opportunities').insert({
        event_id: opp.eventId,
        market_key: opp.marketKey,
        roi: opp.roi,
        profit: opp.profit,
        is_active: true,
      }).select().single();

      if (oppError || !savedOpp) throw oppError || new Error('Opportunity was not saved');

      const legsToInsert = opp.legs.map(leg => ({
        opportunity_id: savedOpp.id,
        outcome_name: leg.outcomeName,
        bookmaker: leg.bookmaker,
        price: leg.price,
        stake_percentage: leg.stakePercentage,
      }));

      await supabase.from('surebet_legs').insert(legsToInsert);
    } catch (error) {
      console.error('[DB] Erro ao salvar oportunidade:', error);
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const scannerScheduler = new ScannerScheduler();
