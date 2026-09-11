import { aiPredictionService } from '../services/AiPredictionService';
import { sql } from '../lib/db';

const ANALYSIS_INTERVAL_MS = 12 * 60 * 60 * 1000;

export class ScannerScheduler {
  private isRunning = false;
  private analysisTimer?: ReturnType<typeof setTimeout>;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[AI] Automatic football analysis engine started.');
    console.log('[AI] Upcoming games are stored in Neon and completed games are retained for future analysis.');
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
    console.log(`[AI] Next automatic football analysis in approximately 12 hours.`);
  }

  private async runAnalysisIfDue(): Promise<void> {
    try {
      const rows = await sql`SELECT analysis_last_run_at FROM system_settings WHERE id = 1`;
      const lastRunAt = rows[0]?.analysis_last_run_at ? new Date(rows[0].analysis_last_run_at).getTime() : 0;
      if (!lastRunAt || Date.now() - lastRunAt >= ANALYSIS_INTERVAL_MS) await this.executeAnalysis();
      else console.log(`[AI] Previous analysis is current. Next cycle is due in approximately ${((ANALYSIS_INTERVAL_MS - (Date.now() - lastRunAt)) / 3600000).toFixed(1)} hours.`);
    } catch (error) {
      console.error('[AI] Could not determine the analysis schedule:', error);
      await this.executeAnalysis();
    }
  }

  private async executeAnalysis(): Promise<void> {
    try {
      console.log('[AI] Starting automatic football analysis cycle...');
      const predictions = await aiPredictionService.runAutomaticAnalysis(8);
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = ${predictions.length ? 'success' : 'no_fixtures'} WHERE id = 1`;
      console.log(`[AI] Cycle finished. ${predictions.length} upcoming games analyzed and stored.`);
    } catch (error) {
      console.error('[AI] Automatic football analysis failed:', error);
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = 'error' WHERE id = 1`;
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
