import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Neon PostgreSQL.');
export const sql = neon(databaseUrl);

export async function ensureDatabase(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS system_settings (id integer PRIMARY KEY, min_roi double precision NOT NULL DEFAULT 1, deep_scan boolean NOT NULL DEFAULT true, odds_api_key text, api_base_url text, api_endpoint_odds text, last_run_date text, last_run_at timestamptz, last_run_status text)`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS min_roi double precision NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS deep_scan boolean NOT NULL DEFAULT true`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS odds_api_key text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS api_base_url text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS api_endpoint_odds text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_date text`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_at timestamptz`;
  await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS last_run_status text`;
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
  await sql`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, name text NOT NULL, role text NOT NULL DEFAULT 'USER', created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS user_alerts (id text PRIMARY KEY, user_id text NOT NULL, min_roi double precision NOT NULL, sport_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_user_alerts_user ON user_alerts (user_id, created_at DESC)`;
  await sql`INSERT INTO markets (key, title, description, active) VALUES ('h2h', 'Match Result', 'Home, draw and away result', true) ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO bookmakers (key, title, active) VALUES ('superbet', 'Superbet', true), ('novibet', 'Novibet', true) ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO sports (key, title, description, active) VALUES ('soccer', 'Football', 'Football and soccer leagues', true) ON CONFLICT (key) DO NOTHING`;
}

export function newId(): string { return randomUUID(); }
