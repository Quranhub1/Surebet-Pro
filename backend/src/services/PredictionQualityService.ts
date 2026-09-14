import { sql } from '../lib/db';

export type AnalysisTier = 'PRO' | 'PREMIUM' | 'TRIAL';

/**
 * Scores analysis quality from football evidence only.
 * This deliberately has no bookmaker, odds, stake or market inputs.
 */
export class PredictionQualityService {
  public async calibrate(): Promise<void> {
    await sql`
      UPDATE football_ai_predictions p
      SET quality_score = LEAST(100, GREATEST(0,
        COALESCE(p.confidence, 50) * 0.45
        + CASE
            WHEN p.home_win IS NOT NULL AND p.draw IS NOT NULL AND p.away_win IS NOT NULL
            THEN LEAST(100, GREATEST(0, 100 - ABS((p.home_win + p.draw + p.away_win) - 100) * 4)) * 0.10
            ELSE 45
          END
        + CASE
            WHEN jsonb_array_length(COALESCE(p.key_factors, '[]'::jsonb)) >= 5 THEN 100
            WHEN jsonb_array_length(COALESCE(p.key_factors, '[]'::jsonb)) >= 3 THEN 85
            WHEN jsonb_array_length(COALESCE(p.key_factors, '[]'::jsonb)) >= 1 THEN 65
            ELSE 35
          END * 0.15
        + CASE
            WHEN length(COALESCE(p.analysis, '')) >= 240 THEN 100
            WHEN length(COALESCE(p.analysis, '')) >= 140 THEN 85
            WHEN length(COALESCE(p.analysis, '')) >= 80 THEN 65
            ELSE 35
          END * 0.15
        + CASE
            WHEN p.predicted_home_goals IS NOT NULL AND p.predicted_away_goals IS NOT NULL THEN 90
            ELSE 45
          END * 0.15
      )),
      updated_at = NOW()
      WHERE p.fixture_id IS NOT NULL
    `;
  }

  /**
   * Returns a stable access band without degrading the underlying prediction.
   * Lower tiers receive fewer/less-detailed analyses, never deliberately worse predictions.
   */
  public tierForScore(score: number): AnalysisTier {
    if (score >= 70) return 'PRO';
    if (score >= 45) return 'PREMIUM';
    return 'TRIAL';
  }
}

export const predictionQualityService = new PredictionQualityService();
