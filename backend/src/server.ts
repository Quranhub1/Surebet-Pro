import express from 'express';
import cors from 'cors';
import { generateWithAi, getActiveAiConfig, getAiModels, type AiProvider } from './services/AiModelService';
import { oddsApiService } from './services/OddsApiService';
import { getUser, login, register, createSession, verifySession } from './services/AuthService';
import { sql } from './lib/db';

const app = express();
app.use(cors());
app.use(express.json());

function authUserId(req: express.Request): string | null {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? verifySession(header.slice(7)) : null;
}

export async function startServer(): Promise<void> {
  const PORT = Number(process.env.PORT || 3001);
  await new Promise<void>((resolve) => app.listen(PORT, '0.0.0.0', () => { console.log(`[API] Server running on port ${PORT}`); resolve(); }));
}

app.get('/api/health', async (_req, res) => {
  try {
    await sql`SELECT 1 AS ok`;
    res.json({ ok: true, service: 'SureBet Pro', version: '2.1.0', database: true, databaseProvider: 'Neon PostgreSQL' });
  } catch (error) {
    console.error('[Health] Neon database check failed:', error);
    res.status(503).json({ ok: false, service: 'SureBet Pro', version: '2.1.0', database: false, databaseProvider: 'Neon PostgreSQL' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await register(String(req.body?.email || ''), String(req.body?.password || ''), String(req.body?.name || ''));
    res.status(201).json({ ok: true, user, token: createSession(user) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await login(String(req.body?.email || ''), String(req.body?.password || ''));
    res.json({ ok: true, user, token: createSession(user) });
  } catch (error) {
    res.status(401).json({ ok: false, error: error instanceof Error ? error.message : 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const userId = authUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
  const user = await getUser(userId);
  if (!user) return res.status(401).json({ ok: false, error: 'Session is no longer valid' });
  res.json({ ok: true, user });
});

app.get('/api/opportunities', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT o.id, o.market_key, o.roi, o.profit, o.created_at,
        json_build_object('home_team', e.home_team, 'away_team', e.away_team, 'commence_time', e.commence_time, 'league_title', e.league_title, 'sport_key', e.sport_key) AS events,
        COALESCE(json_agg(json_build_object('id', l.id, 'outcome_name', l.outcome_name, 'bookmaker', l.bookmaker, 'price', l.price, 'stake_percentage', l.stake_percentage) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS surebet_legs
      FROM surebet_opportunities o
      JOIN events e ON e.id = o.event_id
      LEFT JOIN surebet_legs l ON l.opportunity_id = o.id
      WHERE o.is_active = true
      GROUP BY o.id, e.id
      ORDER BY o.created_at DESC
    `;
    res.json({ ok: true, opportunities: rows });
  } catch (error) {
    console.error('[API] Opportunity query failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to load opportunities', opportunities: [] });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const [sports, markets, bookmakers, settings] = await Promise.all([
      sql`SELECT key, title, description, active FROM sports ORDER BY title`,
      sql`SELECT key, title, description, active FROM markets ORDER BY title`,
      sql`SELECT key, title, active FROM bookmakers ORDER BY title`,
      sql`SELECT id, min_roi, deep_scan, last_run_date, last_run_at, last_run_status FROM system_settings WHERE id = 1`,
    ]);
    res.json({ ok: true, sports, markets, bookmakers, settings: settings[0] || { id: 1, min_roi: 1, deep_scan: true } });
  } catch (error) {
    console.error('[API] Settings query failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to load settings' });
  }
});

app.patch('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.min_roi === 'number' || typeof body.deep_scan === 'boolean') {
      await sql`UPDATE system_settings SET min_roi = COALESCE(${typeof body.min_roi === 'number' ? body.min_roi : null}, min_roi), deep_scan = COALESCE(${typeof body.deep_scan === 'boolean' ? body.deep_scan : null}, deep_scan) WHERE id = 1`;
    }
    if (body.sportKey && typeof body.active === 'boolean') await sql`UPDATE sports SET active = ${body.active} WHERE key = ${body.sportKey}`;
    if (body.marketKey && typeof body.active === 'boolean') await sql`UPDATE markets SET active = ${body.active} WHERE key = ${body.marketKey}`;
    if (body.bookmakerKey && typeof body.active === 'boolean') await sql`UPDATE bookmakers SET active = ${body.active} WHERE key = ${body.bookmakerKey}`;
    res.json({ ok: true });
  } catch (error) {
    console.error('[API] Settings update failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to update settings' });
  }
});

app.get('/api/football/live', async (_req, res) => {
  try {
    const matches = await oddsApiService.getLiveFootballMatches();
    res.json({ ok: true, updatedAt: new Date().toISOString(), count: matches.length, matches });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live football feed failed';
    console.error('[Football] Live feed failed:', message);
    res.status(502).json({ ok: false, error: message, matches: [] });
  }
});

app.get('/api/ai/models', (_req, res) => res.json({ active: getActiveAiConfig(), models: getAiModels() }));

app.post('/api/ai/generate', async (req, res) => {
  try {
    const body = req.body as { provider?: AiProvider; prompt?: string; system?: string; temperature?: number; maxTokens?: number };
    if (!body.prompt || typeof body.prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });
    if (body.provider && body.provider !== 'gemini' && body.provider !== 'groq') return res.status(400).json({ error: 'provider must be gemini or groq' });
    const content = await generateWithAi(body);
    res.json({ ok: true, provider: body.provider || getActiveAiConfig().provider, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI generation failed';
    console.error('[AI] Generation failed:', message);
    res.status(502).json({ error: message });
  }
});

app.get('/api/scheduler', async (_req, res) => {
  try {
    const rows = await sql`SELECT last_run_date, last_run_at, last_run_status FROM system_settings WHERE id = 1`;
    const data = rows[0];
    res.json({ enabled: true, intervalHours: 12, liveRefreshMinutes: 2, timezone: 'Africa/Kampala', lastRunDate: data?.last_run_date ?? null, lastRunAt: data?.last_run_at ?? null, lastRunStatus: data?.last_run_status ?? null });
  } catch {
    res.status(503).json({ enabled: true, intervalHours: 12, liveRefreshMinutes: 2, timezone: 'Africa/Kampala', lastRunDate: null, lastRunAt: null, lastRunStatus: null });
  }
});
