import { aiPredictionService } from '../services/AiPredictionService';
import { sql } from '../lib/db';

const ANALYSIS_INTERVAL_MS = 12 * 60 * 60 * 1000;

export class ScannerScheduler {
  private isRunning = false;
  private analysisTimer?: ReturnType<typeof setTimeout>;
  private lastCycleStartedAt: string | null = null;
  private lastCycleFinishedAt: string | null = null;
  private lastCycleStatus: string | null = null;
  private nextRunAt: string | null = null;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[AI] Automatic football analysis engine started.');
    console.log('[AI] Automatic cycles process every upcoming football fixture returned by football-data.org in six-game AI batches.');
    console.log('[AI] Upcoming games are stored in Neon and completed games are retained for future analysis.');
    await this.runAnalysisIfDue();
    this.scheduleNextAnalysis();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    this.analysisTimer = undefined;
    this.nextRunAt = null;
  }

  public getStatus() {
    return { running: this.isRunning, intervalHours: 12, lastCycleStartedAt: this.lastCycleStartedAt, lastCycleFinishedAt: this.lastCycleFinishedAt, lastCycleStatus: this.lastCycleStatus, nextRunAt: this.nextRunAt };
  }

  private scheduleNextAnalysis(): void {
    if (!this.isRunning) return;
    this.nextRunAt = new Date(Date.now() + ANALYSIS_INTERVAL_MS).toISOString();
    this.analysisTimer = setTimeout(async () => {
      await this.executeAnalysis();
      this.scheduleNextAnalysis();
    }, ANALYSIS_INTERVAL_MS);
    console.log(`[AI] Next automatic football analysis at ${this.nextRunAt}.`);
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
    this.lastCycleStartedAt = new Date().toISOString();
    this.lastCycleStatus = 'running';
    try {
      console.log('[AI] Starting automatic football analysis cycle for all upcoming games...');
      const predictions = await aiPredictionService.runAutomaticAnalysis(Number.MAX_SAFE_INTEGER);
      this.lastCycleFinishedAt = new Date().toISOString();
      this.lastCycleStatus = predictions.length ? 'success' : 'no_fixtures';
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = ${this.lastCycleStatus} WHERE id = 1`;
      console.log(`[AI] Cycle finished. ${predictions.length} upcoming games analyzed and stored.`);
    } catch (error) {
      this.lastCycleFinishedAt = new Date().toISOString();
      this.lastCycleStatus = 'error';
      console.error('[AI] Automatic football analysis failed:', error);
      await sql`UPDATE system_settings SET analysis_last_run_at = NOW(), analysis_last_run_status = 'error' WHERE id = 1`;
    }
  }
}

export const scannerScheduler = new ScannerScheduler();
