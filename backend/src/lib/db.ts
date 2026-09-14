import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Neon PostgreSQL.');
export const sql = neon(databaseUrl);

export async function ensureDatabase(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS system_settings (id integer PRIMARY KEY, min_roi double precision NOT NULL DEFAULT 1, deep_scan boolean NOT NULL DEFAULT true, odds_api_key text, api_base_url text, api_endpoint_odds text, last_run_date text, last_run_at timestamptz, last_run_status text, analysis_last_run_at timestamptz, analysis_last_run_status text)`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS min_roi double precision NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS deep_scan boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS odds_api_key text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS api_base_url text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS api_endpoint_odds text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_date text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_at timestamptz`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_status text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS analysis_last_run_at timestamptz`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS analysis_last_run_status text`;
  await sql`INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  await sql`CREATE TABLE IF NOT EXISTS sports (key text PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true)`;
  await sql`ALTER TABLE sports ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE sports ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE sports ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`;
  await sql`CREATE TABLE IF NOT EXISTS markets (key text PRIMARY KEY, title text NOT NULL, description text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true)`;
  await sql`ALTER TABLE markets ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE markets ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE markets ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`;
  await sql`CREATE TABLE IF NOT EXISTS bookmakers (key text PRIMARY KEY, title text NOT NULL, active boolean NOT NULL DEFAULT true)`;
  await sql`ALTER TABLE bookmakers ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE bookmakers ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`;

  await sql`CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, sport_key text NOT NULL, league_title text NOT NULL DEFAULT 'Unknown League', home_team text NOT NULL, away_team text NOT NULL, commence_time timestamptz NOT NULL)`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS league_title text NOT NULL DEFAULT 'Unknown League'`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS sport_key text NOT NULL DEFAULT 'unknown'`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS home_team text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS away_team text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS commence_time timestamptz NOT NULL DEFAULT now()`;

  await sql`CREATE TABLE IF NOT EXISTS surebet_opportunities (id text PRIMARY KEY, event_id text NOT NULL, market_key text NOT NULL, roi double precision NOT NULL, profit double precision NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), is_active boolean NOT NULL DEFAULT true)`;
  await sql`ALTER TABLE surebet_opportunities ADD COLUMN IF NOT EXISTS profit double precision NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE surebet_opportunities ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE surebet_opportunities ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`;
  await sql`CREATE INDEX IF NOT EXISTS idx_surebet_opportunities_active_created ON surebet_opportunities (is_active, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS surebet_legs (id text PRIMARY KEY, opportunity_id text NOT NULL, outcome_name text NOT NULL, bookmaker text NOT NULL, price double precision NOT NULL, stake_percentage double precision NOT NULL)`;
  await sql`ALTER TABLE surebet_legs ADD COLUMN IF NOT EXISTS outcome_name text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE surebet_legs ADD COLUMN IF NOT EXISTS bookmaker text NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE surebet_legs ADD COLUMN IF NOT EXISTS price double precision NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE surebet_legs ADD COLUMN IF NOT EXISTS stake_percentage double precision NOT NULL DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS idx_surebet_legs_opportunity ON surebet_legs (opportunity_id)`;

  await sql`CREATE TABLE IF NOT EXISTS football_fixtures (id text PRIMARY KEY, league_id integer, league_name text NOT NULL, country text, season integer, home_team_id integer, home_team text NOT NULL, away_team_id integer, away_team text NOT NULL, kickoff_at timestamptz NOT NULL, status text NOT NULL, home_score integer, away_score integer, raw_data jsonb, updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_fixtures_home_team ON football_fixtures (home_team_id, kickoff_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_fixtures_away_team ON football_fixtures (away_team_id, kickoff_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_fixtures_kickoff ON football_fixtures (kickoff_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_fixtures_status ON football_fixtures (status, kickoff_at DESC)`;

  await sql`CREATE TABLE IF NOT EXISTS football_ai_predictions (fixture_id text PRIMARY KEY, winner text, advice text, analysis text, key_factors jsonb NOT NULL DEFAULT '[]'::jsonb, confidence double precision, home_win double precision, draw double precision, away_win double precision, under_over text, predicted_home_goals double precision, predicted_away_goals double precision, ai_provider text, ai_model text, source_prediction jsonb, quality_score double precision, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS quality_score double precision`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_ai_predictions_updated ON football_ai_predictions (updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_football_ai_predictions_quality ON football_ai_predictions (quality_score DESC NULLS LAST)`;
  await sql`CREATE OR REPLACE FUNCTION calculate_prediction_quality() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.quality_score := LEAST(100, GREATEST(0,
    COALESCE(NEW.confidence, 50) * 0.45
    + CASE WHEN NEW.home_win IS NOT NULL AND NEW.draw IS NOT NULL AND NEW.away_win IS NOT NULL THEN LEAST(100, GREATEST(0, 100 - ABS((NEW.home_win + NEW.draw + NEW.away_win) - 100) * 4)) ELSE 45 END * 0.10
    + CASE WHEN jsonb_array_length(COALESCE(NEW.key_factors, '[]'::jsonb)) >= 5 THEN 100 WHEN jsonb_array_length(COALESCE(NEW.key_factors, '[]'::jsonb)) >= 3 THEN 85 WHEN jsonb_array_length(COALESCE(NEW.key_factors, '[]'::jsonb)) >= 1 THEN 65 ELSE 35 END * 0.15
    + CASE WHEN length(COALESCE(NEW.analysis, '')) >= 240 THEN 100 WHEN length(COALESCE(NEW.analysis, '')) >= 140 THEN 85 WHEN length(COALESCE(NEW.analysis, '')) >= 80 THEN 65 ELSE 35 END * 0.15
    + CASE WHEN NEW.predicted_home_goals IS NOT NULL AND NEW.predicted_away_goals IS NOT NULL THEN 90 ELSE 45 END * 0.15)); RETURN NEW; END; $$`;
  await sql`DROP TRIGGER IF EXISTS trg_prediction_quality ON football_ai_predictions`;
  await sql`CREATE TRIGGER trg_prediction_quality BEFORE INSERT OR UPDATE ON football_ai_predictions FOR EACH ROW EXECUTE FUNCTION calculate_prediction_quality()`;
  await sql`UPDATE football_ai_predictions SET quality_score = LEAST(100, GREATEST(0, COALESCE(confidence, 50) * 0.45 + CASE WHEN home_win IS NOT NULL AND draw IS NOT NULL AND away_win IS NOT NULL THEN LEAST(100, GREATEST(0, 100 - ABS((home_win + draw + away_win) - 100) * 4)) ELSE 45 END * 0.10 + CASE WHEN jsonb_array_length(COALESCE(key_factors, '[]'::jsonb)) >= 5 THEN 100 WHEN jsonb_array_length(COALESCE(key_factors, '[]'::jsonb)) >= 3 THEN 85 WHEN jsonb_array_length(COALESCE(key_factors, '[]'::jsonb)) >= 1 THEN 65 ELSE 35 END * 0.15 + CASE WHEN length(COALESCE(analysis, '')) >= 240 THEN 100 WHEN length(COALESCE(analysis, '')) >= 140 THEN 85 WHEN length(COALESCE(analysis, '')) >= 80 THEN 65 ELSE 35 END * 0.15 + CASE WHEN predicted_home_goals IS NOT NULL AND predicted_away_goals IS NOT NULL THEN 90 ELSE 45 END * 0.15)) WHERE quality_score IS NULL`;

  await sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text, name text NOT NULL, role text NOT NULL DEFAULT 'USER', google_sub text UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text`;
  await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS user_alerts (id text PRIMARY KEY, user_id text NOT NULL, min_roi double precision NOT NULL, sport_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_alerts_user ON user_alerts (user_id, created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS user_strategies (id text PRIMARY KEY, user_id text NOT NULL, opportunity_id text NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, opportunity_id))`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_strategies_user ON user_strategies (user_id, created_at DESC)`;

  await sql`INSERT INTO markets (key, title, description, active) VALUES ('h2h', 'Match Result', 'Home, draw and away result', true) ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO bookmakers (key, title, active) VALUES ('superbet', 'Superbet', true), ('novibet', 'Novibet', true) ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO sports (key, title, description, active) VALUES ('soccer', 'Football', 'Football and soccer leagues', true) ON CONFLICT (key) DO NOTHING`;
}

export function newId(): string { return randomUUID(); }
