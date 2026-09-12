import { aiPredictionService } from '../services/AiPredictionService';
import { acquireAnalysisLock, releaseAnalysisLock, sql } from '../lib/db';

const ANALYSIS_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ANALYSIS_GAME_LIMIT = 40;

export class ScannerScheduler {
  private isRunning = false;
  private analysisTimer?: ReturnType<typeof setTimeout>;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[AI] Automatic football analysis engine started.');
    console.log(`[AI] Each cycle targets up to ${ANALYSIS_GAME_LIMIT} games with dynamic Gemini/Groq routing.`);
    await this.runAnalysisIfDue();
    this.scheduleNextAnalysis();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
  }

  private scheduleNextAnalysis(): void {
    if (!this.isRunning) return;
    this.analysisTimer = setTimeout(async () => {
      await this.executeAnalysis();
      this.scheduleNextAnalysis();
    }, ANALYSIS_INTERVAL_MS);
    console.log('[AI] Next automatic football analysis is scheduled in approximately 12 hours.');
  }

  private async runAnalysisIfDue(): Promise<void> {
    try {
      const rows = await sql`SELECT analysis_last_run_at, analysis_last_run_status, analysis_lock_at FROM system_settings WHERE id = 1`;
      const data = rows[0];
      const lastRunAt = data?.analysis_last_run_at ? new Date(data.analysis_last_run_at).getTime() : 0;
      const hasActiveCycle = data?.analysis_last_run_status === 'running';
      const activeFixtures = await sql`SELECT COUNT(*)::int AS count FROM football_fixtures WHERE analysis_expires_at > NOW()`;
      const resumable = Number(activeFixtures[0]?.count || 0) > 0;
      if (hasActiveCycle || resumable || !lastRunAt || Date.now() - lastRunAt >= ANALYSIS_INTERVAL_MS) {
        await this.executeAnalysis();
      } else {
        console.log(`[AI] Previous analysis is current. Next cycle is due in approximately ${((ANALYSIS_INTERVAL_MS - (Date.now() - lastRunAt)) / 3600000).toFixed(1)} hours.`);
      }
    } catch (error) {
      console.error('[AI] Could not determine the analysis schedule:', error);
      await this.executeAnalysis();
    }
  }

  private async executeAnalysis(): Promise<void> {
    if (!await acquireAnalysisLock()) {
      console.log('[AI] Another analysis worker owns the persistent lock. Skipping this cycle.');
      return;
    }
    try {
      console.log(`[AI] Starting/resuming football analysis cycle for up to ${ANALYSIS_GAME_LIMIT} games...`);
      const predictions = await aiPredictionService.runAutomaticAnalysis(ANALYSIS_GAME_LIMIT);
      await releaseAnalysisLock(predictions.length ? 'success' : 'no_fixtures');
      console.log(`[AI] Cycle finished. ${predictions.length}/${ANALYSIS_GAME_LIMIT} games have valid analyses.`);
    } catch (error) {
      console.error('[AI] Automatic football analysis failed:', error);
      await releaseAnalysisLock('error');
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
