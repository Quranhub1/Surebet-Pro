import { oddsApiService } from '../services/OddsApiService';
import { ArbitrageEngine, SurebetOpportunity } from './ArbitrageEngine';
import { supabase } from '../lib/supabase';

function getTimeInZone(timezone: string): { hour: number; minute: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return { hour, minute };
}

export class ScannerScheduler {
  private isRunning = false;
  private hasTriggeredToday = false;

  constructor() {
    console.log(`[Scanner] Inicializado. Aguardando partida...`);
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scanner] Motor de busca ativado.');
    this.runCycle();
  }

  private async runCycle() {
    while (this.isRunning) {
      try {
        const { data: settings } = await supabase.from('system_settings').select('*').single();

        const schedulerEnabled = settings?.scheduler_enabled ?? false;
        const runHour = settings?.run_hour ?? 6;
        const runMinute = settings?.run_minute ?? 0;
        const timezone = settings?.timezone || 'Africa/Kampala';
        const minRoi = settings?.min_roi || 1.0;

        if (!schedulerEnabled) {
          console.log('[Scanner] Aguardando agendamento...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }

        const { hour, minute } = getTimeInZone(timezone);
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        if (hour === runHour && minute === runMinute && !this.hasTriggeredToday) {
          this.hasTriggeredToday = true;
          await this.executeScanCycle(minRoi, todayStr);
        } else if (hour !== runHour || minute !== runMinute) {
          this.hasTriggeredToday = false;
        }

        await new Promise(resolve => setTimeout(resolve, 60000));
      } catch (error) {
        console.error(`[Scanner] Erro crítico no ciclo:`, error);
        await new Promise(resolve => setTimeout(resolve, 60000));
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

      console.log(`\n[Scanner] 🔄 Iniciando novo ciclo de busca agendado...`);

      if (activeBookmakers.length < 2) {
        console.log(`[Scanner] AVISO: Menos de 2 casas de apostas ativas. Arbitragem impossível.`);
      } else if (activeSportGroups.length === 0) {
        console.log(`[Scanner] Nenhum grupo de esporte ativo. Pulando ciclo.`);
      } else {
        console.log(`[Scanner] Consultando API para descobrir todas as ligas ativas no mundo...`);
        const allApiSports = await oddsApiService.getActiveLeagues();

        const leaguesToScan = allApiSports.filter(apiSport =>
          activeSportGroups.includes(apiSport.group.toLowerCase())
        );

        console.log(`[Scanner] Mapeamento concluído: ${leaguesToScan.length} ligas encontradas para os esportes selecionados.`);

        for (const league of leaguesToScan) {
          console.log(`[Scanner] Buscando odds para a liga: ${league.title} (${league.key})...`);

          const events = await oddsApiService.getOddsForSport(league.key, activeMarkets, activeBookmakers);
          let foundInLeague = 0;

          for (const event of events) {
            const commenceTime = new Date(event.commence_time).getTime();
            if (commenceTime <= Date.now()) continue;

            const opportunities = ArbitrageEngine.analyzeEvent(event);

            for (const opp of opportunities) {
              if (opp.roi >= minRoi) {
                foundInLeague++;
                await this.saveOpportunityToDb(opp);
              }
            }
          }

          if (foundInLeague > 0) {
            console.log(`[Engine] 🔥 ${foundInLeague} surebets salvas em ${league.title}!`);
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error(`[Scanner] Erro no ciclo agendado:`, error);
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

      if (oppError || !savedOpp) throw oppError;

      const legsToInsert = opp.legs.map(leg => ({
        opportunity_id: savedOpp.id,
        outcome_name: leg.outcomeName,
        bookmaker: leg.bookmaker,
        price: leg.price,
        stake_percentage: leg.stakePercentage,
      }));

      await supabase.from('surebet_legs').insert(legsToInsert);
    } catch (error) {
      console.error(`[DB] Erro ao salvar oportunidade:`, error);
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
