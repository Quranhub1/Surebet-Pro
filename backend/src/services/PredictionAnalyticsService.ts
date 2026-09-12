import { sql } from '../lib/db';

export async function ensurePredictionAnalytics(): Promise<void> {
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS data_quality double precision`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS ensemble_winner text`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS ensemble_confidence double precision`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS model_agreement boolean`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS prediction_version integer NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE football_ai_predictions ADD COLUMN IF NOT EXISTS last_changed_at timestamptz`;
  await sql`CREATE TABLE IF NOT EXISTS football_prediction_audit (id bigserial PRIMARY KEY, fixture_id text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), action text NOT NULL, old_winner text, new_winner text, old_confidence double precision, new_confidence double precision, old_provider text, new_provider text)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prediction_audit_fixture ON football_prediction_audit (fixture_id, changed_at DESC)`;
  await sql`CREATE OR REPLACE FUNCTION audit_football_prediction() RETURNS trigger AS $$ BEGIN IF TG_OP='INSERT' THEN INSERT INTO football_prediction_audit(fixture_id,action,new_winner,new_confidence,new_provider) VALUES(NEW.fixture_id,'created',NEW.winner,NEW.confidence,NEW.ai_provider); ELSIF OLD.winner IS DISTINCT FROM NEW.winner OR OLD.confidence IS DISTINCT FROM NEW.confidence OR OLD.ai_provider IS DISTINCT FROM NEW.ai_provider THEN INSERT INTO football_prediction_audit(fixture_id,action,old_winner,new_winner,old_confidence,new_confidence,old_provider,new_provider) VALUES(NEW.fixture_id,'prediction_changed',OLD.winner,NEW.winner,OLD.confidence,NEW.confidence,OLD.ai_provider,NEW.ai_provider); END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
  await sql`DROP TRIGGER IF EXISTS trg_audit_football_prediction ON football_ai_predictions`;
  await sql`CREATE TRIGGER trg_audit_football_prediction AFTER INSERT OR UPDATE ON football_ai_predictions FOR EACH ROW EXECUTE FUNCTION audit_football_prediction()`;
}

export async function getPredictionAnalytics(from?: string, to?: string) {
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new Error('Invalid analytics date range.');
  const [overall, providers, calibration, categories, daily, teams, audit] = await Promise.all([
    sql`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE p.prediction_result='true')::int correct, COUNT(*) FILTER (WHERE p.prediction_result='lose')::int failed, COUNT(*) FILTER (WHERE p.prediction_result IS NULL OR p.prediction_result='pending')::int pending, COALESCE(AVG(p.confidence) FILTER (WHERE p.prediction_result IN ('true','lose')),0)::float avg_confidence FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE f.kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()}`,
    sql`SELECT p.ai_provider provider, COUNT(*)::int total, COUNT(*) FILTER (WHERE p.prediction_result='true')::int correct, COUNT(*) FILTER (WHERE p.prediction_result='lose')::int failed, COALESCE(AVG(p.confidence),0)::float avg_confidence FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE f.kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()} GROUP BY p.ai_provider ORDER BY correct DESC`,
    sql`SELECT CASE WHEN p.confidence<60 THEN '0-59' WHEN p.confidence<70 THEN '60-69' WHEN p.confidence<80 THEN '70-79' WHEN p.confidence<90 THEN '80-89' ELSE '90-100' END band, COUNT(*)::int total, COUNT(*) FILTER (WHERE p.prediction_result='true')::int correct, COALESCE(AVG(p.confidence),0)::float avg_confidence FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE f.kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()} AND p.prediction_result IN ('true','lose') GROUP BY band ORDER BY MIN(p.confidence)`,
    sql`SELECT CASE WHEN p.winner='draw' THEN 'draw' WHEN p.winner=f.home_team THEN 'home' WHEN p.winner=f.away_team THEN 'away' ELSE 'other' END category, COUNT(*)::int total, COUNT(*) FILTER (WHERE p.prediction_result='true')::int correct FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE f.kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()} GROUP BY category ORDER BY total DESC`,
    sql`SELECT DATE(f.kickoff_at) date, COUNT(*) FILTER (WHERE p.prediction_result IN ('true','lose'))::int settled, COUNT(*) FILTER (WHERE p.prediction_result='true')::int correct, ROUND(100.0*COUNT(*) FILTER (WHERE p.prediction_result='true')/NULLIF(COUNT(*) FILTER (WHERE p.prediction_result IN ('true','lose')),0),1)::float accuracy FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE f.kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()} GROUP BY DATE(f.kickoff_at) ORDER BY date`,
    sql`SELECT team, COUNT(*)::int games, COUNT(*) FILTER (WHERE won)::int wins, COUNT(*) FILTER (WHERE drawn)::int draws, COUNT(*) FILTER (WHERE lost)::int losses, COALESCE(SUM(goals_for),0)::int goals_for, COALESCE(SUM(goals_against),0)::int goals_against FROM (SELECT home_team team, home_score goals_for, away_score goals_against, home_score>away_score won, home_score=away_score drawn, home_score<away_score lost FROM football_fixtures WHERE status IN ('FT','AET','PEN') AND kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()} UNION ALL SELECT away_team, away_score, home_score, away_score>home_score, away_score=home_score, away_score<home_score FROM football_fixtures WHERE status IN ('FT','AET','PEN') AND kickoff_at BETWEEN ${start.toISOString()} AND ${end.toISOString()}) x GROUP BY team ORDER BY games DESC LIMIT 100`,
    sql`SELECT COUNT(*)::int audit_events, COUNT(*) FILTER (WHERE action='prediction_changed')::int prediction_changes FROM football_prediction_audit WHERE changed_at BETWEEN ${start.toISOString()} AND ${end.toISOString()}`,
  ]);
  return { range: { from: start.toISOString(), to: end.toISOString() }, overall: overall[0] || {}, providers, calibration, categories, daily, teams, audit: audit[0] || {} };
}

export async function getSystemHealth() {
  const [db, pending, recent, audit] = await Promise.all([
    sql`SELECT NOW() AS database_time`,
    sql`SELECT COUNT(*)::int count FROM football_ai_predictions p JOIN football_fixtures f ON f.id=p.fixture_id WHERE p.settled_at IS NULL AND f.kickoff_at < NOW()`,
    sql`SELECT analysis_last_run_at, analysis_last_run_status FROM system_settings WHERE id=1`,
    sql`SELECT COUNT(*)::int count FROM football_prediction_audit WHERE changed_at >= NOW()-INTERVAL '24 hours'`,
  ]);
  return { database: true, databaseTime: db[0]?.database_time, pendingSettlement: Number(pending[0]?.count || 0), lastAnalysis: recent[0] || {}, auditEvents24h: Number(audit[0]?.count || 0), checkedAt: new Date().toISOString() };
}
