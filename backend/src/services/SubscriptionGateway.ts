import express from 'express';
import { sql } from '../lib/db';
import { verifySession } from './AuthService';

const TRIAL_DAYS = 3;
const PAYMENT_AMOUNT_UGX = 5000;
const PAYMENT_NUMBER = '0749846848';
const PAYMENT_NAME = 'Kabali Madina';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/register', '/api/auth/login', '/api/auth/me', '/api/subscription', '/api/subscription/request']);

function sessionUserId(req: express.Request): string | null { const header = req.headers.authorization || ''; return header.startsWith('Bearer ') ? verifySession(header.slice(7)) : null; }
function configuredAdminEmail(): string { return String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); }
async function isAdmin(userId: string): Promise<boolean> { const adminEmail = configuredAdminEmail(); if (!adminEmail) return false; const rows = await sql`SELECT email FROM users WHERE id = ${userId} LIMIT 1`; return String(rows[0]?.email || '').trim().toLowerCase() === adminEmail; }

async function ensureUserSubscriptionColumns(): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_requested_at TIMESTAMPTZ`;
}

async function subscriptionState(userId: string) {
  let rows = await sql`SELECT id, email, trial_started_at, subscription_status, subscription_expires_at, subscription_requested_at FROM users WHERE id = ${userId} LIMIT 1`;
  if (!rows[0]) return null;
  if (!rows[0].trial_started_at) rows = await sql`UPDATE users SET trial_started_at = NOW() WHERE id = ${userId} AND trial_started_at IS NULL RETURNING id, email, trial_started_at, subscription_status, subscription_expires_at, subscription_requested_at`;
  const row = rows[0];
  const trialStartedAt = row.trial_started_at ? new Date(row.trial_started_at) : new Date();
  const trialExpiresAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const subscriptionExpiresAt = row.subscription_expires_at ? new Date(row.subscription_expires_at) : null;
  const active = String(row.subscription_status) === 'active' && !!subscriptionExpiresAt && subscriptionExpiresAt.getTime() > Date.now();
  const trialActive = !active && Date.now() < trialExpiresAt.getTime();
  if (String(row.subscription_status) === 'active' && subscriptionExpiresAt && subscriptionExpiresAt.getTime() <= Date.now()) await sql`UPDATE users SET subscription_status = 'expired' WHERE id = ${userId} AND subscription_status = 'active'`;
  return { trialActive, trialStartedAt: trialStartedAt.toISOString(), trialExpiresAt: trialExpiresAt.toISOString(), subscriptionStatus: active ? 'active' : String(row.subscription_status) === 'pending' ? 'pending' : String(row.subscription_status) === 'active' ? 'expired' : String(row.subscription_status), subscriptionExpiresAt: subscriptionExpiresAt?.toISOString() || null, paymentAmountUgx: PAYMENT_AMOUNT_UGX, paymentNumber: PAYMENT_NUMBER, paymentName: PAYMENT_NAME };
}

async function requireAppSubscription(req: express.Request, res: express.Response, next: express.NextFunction) {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
  try {
    if (await isAdmin(userId)) return next();
    const state = await subscriptionState(userId);
    if (!state) return res.status(401).json({ ok: false, error: 'User account not found' });
    if (state.trialActive || state.subscriptionStatus === 'active') return next();
    return res.status(402).json({ ok: false, error: 'Subscription required', subscription: state });
  } catch (error) { console.error('[Subscription] Access check failed:', error); return res.status(503).json({ ok: false, error: 'Subscription service temporarily unavailable' }); }
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<string | null> {
  const userId = sessionUserId(req);
  if (!userId) { res.status(401).json({ ok: false, error: 'Authentication required' }); return null; }
  if (!configuredAdminEmail()) { res.status(503).json({ ok: false, error: 'ADMIN_EMAIL is not configured on the server' }); return null; }
  if (!await isAdmin(userId)) { res.status(403).json({ ok: false, error: 'Admin access required' }); return null; }
  return userId;
}

export const subscriptionRouter = express.Router();

subscriptionRouter.get('/api/subscription', async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
  try {
    const admin = await isAdmin(userId);
    const state = await subscriptionState(userId);
    return res.json({ ok: true, isAdmin: admin, subscription: state });
  } catch (error) {
    console.error('[Subscription] State lookup failed:', error);
    return res.status(503).json({ ok: false, error: 'Failed to load subscription status' });
  }
});

subscriptionRouter.post('/api/subscription/request', async (req, res) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
  try {
    if (await isAdmin(userId)) return res.json({ ok: true, isAdmin: true });
    await subscriptionState(userId);
    await sql`UPDATE users SET subscription_status = 'pending', subscription_requested_at = NOW() WHERE id = ${userId}`;
    const state = await subscriptionState(userId);
    return res.json({ ok: true, subscription: state, message: 'Payment marked as submitted. An administrator must verify the payment before the 7-day subscription is activated.' });
  } catch (error) {
    console.error('[Subscription] Payment request failed:', error);
    return res.status(500).json({ ok: false, error: 'Could not submit payment request' });
  }
});

subscriptionRouter.get('/api/admin/subscriptions/users', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const rows = await sql`SELECT id, email, name, role, trial_started_at, subscription_status, subscription_expires_at, subscription_requested_at FROM users ORDER BY CASE WHEN subscription_status = 'pending' THEN 0 ELSE 1 END, subscription_requested_at DESC NULLS LAST, email ASC`;
    return res.json({ ok: true, users: rows.map((row: any) => ({ id: String(row.id), email: String(row.email), name: String(row.name || ''), role: String(row.role || 'USER'), trialStartedAt: row.trial_started_at ? new Date(row.trial_started_at).toISOString() : null, subscriptionStatus: String(row.subscription_status || 'inactive'), subscriptionExpiresAt: row.subscription_expires_at ? new Date(row.subscription_expires_at).toISOString() : null, paymentRequestedAt: row.subscription_requested_at ? new Date(row.subscription_requested_at).toISOString() : null })) });
  } catch (error) { console.error('[Admin] User subscription list failed:', error); return res.status(500).json({ ok: false, error: 'Failed to load users' }); }
});

subscriptionRouter.post('/api/admin/subscriptions/:userId/approve', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const rows = await sql`UPDATE users SET subscription_status = 'active', subscription_expires_at = GREATEST(COALESCE(subscription_expires_at, NOW()), NOW()) + INTERVAL '7 days', subscription_requested_at = NULL WHERE id = ${req.params.userId} RETURNING id, email, subscription_status, subscription_expires_at`;
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'User not found' });
    return res.json({ ok: true, user: { id: String(rows[0].id), email: String(rows[0].email), subscriptionStatus: String(rows[0].subscription_status), subscriptionExpiresAt: new Date(rows[0].subscription_expires_at).toISOString() } });
  } catch (error) { console.error('[Admin] Subscription approval failed:', error); return res.status(500).json({ ok: false, error: 'Failed to approve subscription' }); }
});

subscriptionRouter.post('/api/admin/subscriptions/:userId/revoke', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const rows = await sql`UPDATE users SET subscription_status = 'inactive', subscription_expires_at = NULL, subscription_requested_at = NULL WHERE id = ${req.params.userId} RETURNING id, email, subscription_status`;
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'User not found' });
    return res.json({ ok: true, user: { id: String(rows[0].id), email: String(rows[0].email), subscriptionStatus: String(rows[0].subscription_status) } });
  } catch (error) { console.error('[Admin] Subscription revoke failed:', error); return res.status(500).json({ ok: false, error: 'Failed to revoke subscription' }); }
});

let installed = false;
export function installSubscriptionGateway(): void {
  if (installed) return;
  installed = true;
  const proto = express.application as any;
  for (const method of ['get', 'post', 'patch', 'delete', 'put']) {
    const original = proto[method];
    proto[method] = function patchedRoute(path: any, ...handlers: any[]) {
      if (typeof path === 'string' && path.startsWith('/api/') && !PUBLIC_PATHS.has(path) && !path.startsWith('/api/admin/')) return original.call(this, path, requireAppSubscription, ...handlers);
      return original.call(this, path, ...handlers);
    };
  }
}

export { ensureUserSubscriptionColumns };
