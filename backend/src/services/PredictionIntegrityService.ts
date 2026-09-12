import { sql } from '../lib/db';

export async function ensurePredictionIntegrity(): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION prevent_started_prediction_rewrite() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM football_fixtures WHERE id = OLD.fixture_id AND kickoff_at <= NOW()) THEN
        IF NEW.winner IS DISTINCT FROM OLD.winner
          OR NEW.advice IS DISTINCT FROM OLD.advice
          OR NEW.analysis IS DISTINCT FROM OLD.analysis
          OR NEW.key_factors IS DISTINCT FROM OLD.key_factors
          OR NEW.confidence IS DISTINCT FROM OLD.confidence
          OR NEW.home_win IS DISTINCT FROM OLD.home_win
          OR NEW.draw IS DISTINCT FROM OLD.draw
          OR NEW.away_win IS DISTINCT FROM OLD.away_win
          OR NEW.under_over IS DISTINCT FROM OLD.under_over
          OR NEW.predicted_home_goals IS DISTINCT FROM OLD.predicted_home_goals
          OR NEW.predicted_away_goals IS DISTINCT FROM OLD.predicted_away_goals
          OR NEW.ai_provider IS DISTINCT FROM OLD.ai_provider
          OR NEW.ai_model IS DISTINCT FROM OLD.ai_model
          OR NEW.source_prediction IS DISTINCT FROM OLD.source_prediction THEN
          RAISE EXCEPTION 'Prediction analysis is immutable after kickoff for fixture %', OLD.fixture_id;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
  await sql`DROP TRIGGER IF EXISTS trg_prediction_integrity ON football_ai_predictions`;
  await sql`CREATE TRIGGER trg_prediction_integrity BEFORE UPDATE ON football_ai_predictions FOR EACH ROW EXECUTE FUNCTION prevent_started_prediction_rewrite()`;
}
