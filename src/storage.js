const { Pool } = require('pg');

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } }) : null;
const memory = new Map();
let ready = false;

async function init() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    fixture_date TIMESTAMPTZ NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    league TEXT,
    fixture_status TEXT,
    generated_at TIMESTAMPTZ NOT NULL,
    prediction JSONB NOT NULL,
    result_status TEXT NOT NULL DEFAULT 'PENDING',
    actual_home_goals INTEGER,
    actual_away_goals INTEGER,
    actual_result TEXT,
    settled_at TIMESTAMPTZ,
    UNIQUE(id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS automation_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    run_hour INTEGER NOT NULL DEFAULT 6,
    run_minute INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'Africa/Kampala',
    last_run_date DATE,
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  ready = true;
}

async function savePredictions(items) {
  for (const x of items) {
    const p = x.ai || {};
    if (pool) {
      await pool.query(`INSERT INTO predictions (id, fixture_date, home_team, away_team, league, fixture_status, generated_at, prediction)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET fixture_status=EXCLUDED.fixture_status`,
        [x.id, x.utcDate, x.homeTeam, x.awayTeam, x.league, x.status, x.generatedAt || new Date().toISOString(), JSON.stringify(p)]);
    } else memory.set(x.id, { ...x, resultStatus: 'PENDING' });
  }
}

async function listPredictions({ history = false, limit = 500 } = {}) {
  if (!pool) return [...memory.values()].slice(-limit).reverse().filter(x => history || x.resultStatus !== 'SETTLED');
  const q = history ? `SELECT * FROM predictions ORDER BY fixture_date DESC LIMIT $1` : `SELECT * FROM predictions WHERE result_status <> 'SETTLED' ORDER BY fixture_date ASC LIMIT $1`;
  const r = await pool.query(q, [limit]);
  return r.rows.map(row => ({ id: row.id, utcDate: row.fixture_date, homeTeam: row.home_team, awayTeam: row.away_team, league: row.league, status: row.fixture_status, generatedAt: row.generated_at, ai: row.prediction, resultStatus: row.result_status, actualHomeGoals: row.actual_home_goals, actualAwayGoals: row.actual_away_goals, actualResult: row.actual_result, settledAt: row.settled_at }));
}

async function settlePrediction(id, homeGoals, awayGoals, fixtureStatus = 'FINISHED') {
  const result = homeGoals > awayGoals ? 'HOME' : homeGoals < awayGoals ? 'AWAY' : 'DRAW';
  if (!pool) {
    const row = memory.get(id); if (!row) return false;
    const verdict = row.ai?.verdict;
    const correct = verdict === result;
    memory.set(id, { ...row, status: fixtureStatus, resultStatus: correct ? 'WIN' : 'LOSE', actualHomeGoals: homeGoals, actualAwayGoals: awayGoals, actualResult: result, settledAt: new Date().toISOString() });
    return true;
  }
  const r = await pool.query(`SELECT prediction FROM predictions WHERE id=$1`, [id]);
  if (!r.rowCount) return false;
  const verdict = r.rows[0].prediction?.verdict;
  const outcome = verdict === result ? 'WIN' : 'LOSE';
  await pool.query(`UPDATE predictions SET fixture_status=$2, actual_home_goals=$3, actual_away_goals=$4, actual_result=$5, result_status=$6, settled_at=NOW() WHERE id=$1`, [id, fixtureStatus, homeGoals, awayGoals, result, outcome]);
  return true;
}

async function getAutomation() {
  if (!pool) return { enabled: false, runHour: 6, runMinute: 0, timezone: 'Africa/Kampala', lastRunDate: null, lastRunAt: null, lastRunStatus: 'DATABASE_REQUIRED' };
  const r = await pool.query('SELECT * FROM automation_settings WHERE id=1');
  const x = r.rows[0];
  return { enabled: x.enabled, runHour: x.run_hour, runMinute: x.run_minute, timezone: x.timezone, lastRunDate: x.last_run_date, lastRunAt: x.last_run_at, lastRunStatus: x.last_run_status };
}

async function setAutomation({ enabled, runHour, runMinute, timezone }) {
  if (!pool) throw new Error('DATABASE_URL is required for persistent automation.');
  await pool.query(`UPDATE automation_settings SET enabled=$1, run_hour=$2, run_minute=$3, timezone=$4, updated_at=NOW() WHERE id=1`, [!!enabled, Number(runHour), Number(runMinute), timezone || 'Africa/Kampala']);
  return getAutomation();
}
async function markRun(date, status) {
  if (!pool) return;
  await pool.query(`UPDATE automation_settings SET last_run_date=$1,last_run_at=NOW(),last_run_status=$2 WHERE id=1`, [date, status]);
}
async function getPerformance() {
  if (!pool) return { total: memory.size, settled: 0, wins: 0, losses: 0, pending: memory.size, accuracy: null };
  const r = await pool.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE result_status IN ('WIN','LOSE'))::int settled, COUNT(*) FILTER (WHERE result_status='WIN')::int wins, COUNT(*) FILTER (WHERE result_status='LOSE')::int losses, COUNT(*) FILTER (WHERE result_status='PENDING')::int pending FROM predictions`);
  const x = r.rows[0]; return { ...x, accuracy: x.settled ? Number((x.wins / x.settled * 100).toFixed(2)) : null };
}
module.exports = { pool, init, savePredictions, listPredictions, settlePrediction, getAutomation, setAutomation, markRun, getPerformance };