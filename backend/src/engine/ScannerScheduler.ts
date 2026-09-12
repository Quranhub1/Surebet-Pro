import { aiPredictionService } from '../services/AiPredictionService';
import { realtimeSettlementService } from '../services/RealtimeSettlementService';
import { acquireAnalysisLock, releaseAnalysisLock, sql } from '../lib/db';

const ANALYSIS_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ANALYSIS_GAME_LIMIT = 40;
const SETTLEMENT_REFRESH_MS = 15 * 60 * 1000;

export class ScannerScheduler {
  private isRunning = false;
  private analysisTimer?: ReturnType<typeof setTimeout>;
  private settlementRefreshTimer?: ReturnType<typeof setTimeout>;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[AI] Automatic football analysis engine started.');
    console.log(`[AI] Each cycle targets up to ${ANALYSIS_GAME_LIMIT} games with dynamic Gemini/Groq load balancing.`);
    await realtimeSettlementService.start();
    await this.runAnalysisIfDue();
    await this.scheduleNextAnalysis();
    await this.scheduleSettlementRefresh();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    if (this.settlementRefreshTimer) clearTimeout(this.settlementRefreshTimer);
    realtimeSettlementService.stop();
  }

  private async scheduleSettlementRefresh(): Promise<void> {
    if (!this.isRunning) return;
    if (this.settlementRefreshTimer) clearTimeout(this.settlementRefreshTimer);
    this.settlementRefreshTimer = setTimeout(async () => {
      try { await realtimeSettlementService.refreshSchedules(); }
      catch (error) { console.error('[History] Could not refresh realtime settlement schedules:', error); }
      await this.scheduleSettlementRefresh();
    }, SETTLEMENT_REFRESH_MS);
    console.log(`[History] Realtime result checks are scheduled per match; pending-match schedule refresh runs every ${(SETTLEMENT_REFRESH_MS / 60000).toFixed(0)} minutes.`);
  }

  private async scheduleNextAnalysis(): Promise<void> {
    if (!this.isRunning) return;
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    const rows = await sql`SELECT analysis_last_run_at FROM system_settings WHERE id = 1`;
    const lastRunAt = rows[0]?.analysis_last_run_at ? new Date(rows[0].analysis_last_run_at).getTime() : 0;
    const delay = lastRunAt ? Math.max(30_000, lastRunAt + ANALYSIS_INTERVAL_MS - Date.now()) : 30_000;
    this.analysisTimer = setTimeout(async () => { await this.executeAnalysis(); await this.scheduleNextAnalysis(); }, delay);
    console.log(`[AI] Next automatic football regeneration in approximately ${(delay / 3600000).toFixed(1)} hours.`);
  }

  private async runAnalysisIfDue(): Promise<void> {
    try {
      const rows = await sql`SELECT analysis_last_run_at, analysis_last_run_status FROM system_settings WHERE id = 1`;
      const data = rows[0]; const lastRunAt = data?.analysis_last_run_at ? new Date(data.analysis_last_run_at).getTime() : 0; const resumableRun = data?.analysis_last_run_status === 'running';
      if (resumableRun || !lastRunAt || Date.now() - lastRunAt >= ANALYSIS_INTERVAL_MS) await this.executeAnalysis();
      else console.log(`[AI] Previous analysis is current. Next regeneration is due in approximately ${((ANALYSIS_INTERVAL_MS - (Date.now() - lastRunAt)) / 3600000).toFixed(1)} hours.`);
    } catch (error) { console.error('[AI] Could not determine the analysis schedule:', error); await this.executeAnalysis(); }
  }

  private async executeAnalysis(): Promise<void> {
    if (!await acquireAnalysisLock()) { console.log('[AI] Another analysis worker owns the persistent lock. Skipping this cycle.'); return; }
    try {
      const predictions = await aiPredictionService.runAutomaticAnalysis(ANALYSIS_GAME_LIMIT);
      await releaseAnalysisLock(predictions.length ? 'success' : 'no_fixtures');
      await realtimeSettlementService.refreshSchedules();
      console.log(`[AI] Cycle finished. ${predictions.length}/${ANALYSIS_GAME_LIMIT} games have valid analyses.`);
    }
    catch (error) { console.error('[AI] Automatic football analysis failed:', error); await releaseAnalysisLock('error'); }
  }
}
export const scannerScheduler = new ScannerScheduler();
