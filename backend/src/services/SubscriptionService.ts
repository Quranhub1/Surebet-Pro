import { sql, newId } from '../lib/db';

export const TRIAL_DAYS = 3;
export const PAYMENT_NUMBER = '0749846848';
export const PAYMENT_NAME = 'Kabali Madina';
export const PAYMENT_PLANS = {
  weekly: { name: 'Weekly', amountUgx: 5000, durationDays: 7 },
  monthly: { name: 'Monthly', amountUgx: 15000, durationDays: 30 },
  annual: { name: 'Annual', amountUgx: 200000, durationDays: 365 },
} as const;
export const DEFAULT_PLAN = 'monthly';
export const SUBSCRIPTION_PRICE_UGX = PAYMENT_PLANS.monthly.amountUgx;

export type SubscriptionPlan = keyof typeof PAYMENT_PLANS;
export type SubscriptionStatus = 'trial' | 'expired' | 'pending' | 'active' | 'banned' | 'permanent_active';

export interface SubscriptionInfo {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  trialEndsAt: string;
  requestedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
}

const STAFF_ROLES = new Set(['ADMIN', 'SUPERADMIN', 'OWNER']);

let schemaReady = false;
async function ensureSubscriptionSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan text NOT NULL DEFAULT 'monthly', status text NOT NULL DEFAULT 'trial', trial_started_at timestamptz NOT NULL DEFAULT now(), trial_ends_at timestamptz NOT NULL, requested_at timestamptz, approved_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'monthly'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id)`;
  schemaReady = true;
}

export async function ensureUserSubscription(userId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  await sql`INSERT INTO subscriptions (id, user_id, plan, status, trial_started_at, trial_ends_at) VALUES (${newId()}, ${userId}, ${DEFAULT_PLAN}, 'trial', NOW(), NOW() + INTERVAL '3 days') ON CONFLICT (user_id) DO NOTHING`;
  const rows = await sql`SELECT s.id, s.user_id, s.plan, s.status, s.trial_ends_at, s.requested_at, s.approved_at, s.expires_at FROM subscriptions s WHERE s.user_id = ${userId} LIMIT 1`;
  return mapSubscription(rows[0]);
}

export async function getEffectiveSubscription(userId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  const userRows = await sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`;
  const role = String(userRows[0]?.role || '').toUpperCase();
  if (STAFF_ROLES.has(role)) {
    await sql`INSERT INTO subscriptions (id, user_id, plan, status, trial_started_at, trial_ends_at, requested_at, approved_at, expires_at) VALUES (${newId()}, ${userId}, ${DEFAULT_PLAN}, 'permanent_active', NOW(), NOW() + INTERVAL '3 days', NULL, NOW(), NULL) ON CONFLICT (user_id) DO UPDATE SET status = 'permanent_active', approved_at = COALESCE(subscriptions.approved_at, NOW()), requested_at = NULL, expires_at = NULL, updated_at = NOW()`;
    const rows = await sql`SELECT id, user_id, plan, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE user_id = ${userId} LIMIT 1`;
    return mapSubscription(rows[0]);
  }

  const subscription = await ensureUserSubscription(userId);
  if (subscription.status === 'trial' && new Date(subscription.trialEndsAt).getTime() <= Date.now()) {
    await sql`UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE user_id = ${userId} AND status = 'trial' AND trial_ends_at <= NOW()`;
    return ensureUserSubscription(userId);
  }
  if (subscription.status === 'active' && subscription.expiresAt && new Date(subscription.expiresAt).getTime() <= Date.now()) {
    await sql`UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE user_id = ${userId} AND status = 'active' AND expires_at <= NOW()`;
    return ensureUserSubscription(userId);
  }
  return subscription;
}

export async function requestPayment(userId: string, requestedPlan: string = DEFAULT_PLAN): Promise<SubscriptionInfo> {
  const userRows = await sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`;
  const role = String(userRows[0]?.role || '').toUpperCase();
  if (STAFF_ROLES.has(role)) throw new Error('Administrator accounts have permanent active access and do not need a subscription request.');
  const plan = requestedPlan as SubscriptionPlan;
  if (!Object.prototype.hasOwnProperty.call(PAYMENT_PLANS, plan)) throw new Error('Invalid subscription plan. Choose weekly, monthly, or annual.');
  const current = await getEffectiveSubscription(userId);
  if (current.status === 'active') throw new Error('Your Pro subscription is already active.');
  if (current.status === 'banned') throw new Error('Your account is banned.');
  await sql`UPDATE subscriptions SET plan = ${plan}, status = 'pending', requested_at = NOW(), updated_at = NOW() WHERE user_id = ${userId}`;
  return ensureUserSubscription(userId);
}

export async function listSubscriptions(): Promise<any[]> {
  await ensureSubscriptionSchema();
  return sql`SELECT s.id, s.user_id, u.name, u.email, u.role, s.plan,
    CASE WHEN UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'SUPERADMIN', 'OWNER') THEN 'permanent_active' ELSE s.status END AS status,
    s.trial_ends_at, s.requested_at,
    CASE WHEN UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'SUPERADMIN', 'OWNER') THEN COALESCE(s.approved_at, s.created_at) ELSE s.approved_at END AS approved_at,
    CASE WHEN UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'SUPERADMIN', 'OWNER') THEN NULL ELSE s.expires_at END AS expires_at,
    s.created_at, s.updated_at
    FROM subscriptions s JOIN users u ON u.id = s.user_id
    ORDER BY CASE WHEN UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'SUPERADMIN', 'OWNER') THEN 2 WHEN s.status = 'pending' THEN 0 WHEN s.status = 'expired' THEN 1 WHEN s.status = 'active' THEN 2 WHEN s.status = 'trial' THEN 3 WHEN s.status = 'banned' THEN 4 ELSE 5 END, s.updated_at DESC`;
}

export async function approveSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  const rows = await sql`SELECT s.plan, u.role FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = ${subscriptionId} LIMIT 1`;
  if (!rows[0]) throw new Error('Subscription not found.');
  if (STAFF_ROLES.has(String(rows[0].role || '').toUpperCase())) return getEffectiveSubscription(String((await sql`SELECT user_id FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`)[0].user_id));
  const plan = Object.prototype.hasOwnProperty.call(PAYMENT_PLANS, String(rows[0].plan)) ? String(rows[0].plan) as SubscriptionPlan : DEFAULT_PLAN;
  const durationDays = PAYMENT_PLANS[plan].durationDays;
  await sql`UPDATE subscriptions SET plan = ${plan}, status = 'active', approved_at = NOW(), requested_at = COALESCE(requested_at, NOW()), expires_at = NOW() + (${durationDays} || ' days')::interval, updated_at = NOW() WHERE id = ${subscriptionId}`;
  const updated = await sql`SELECT id, user_id, plan, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
  return mapSubscription(updated[0]);
}

export async function banSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  await sql`UPDATE subscriptions SET status = 'banned', updated_at = NOW() WHERE id = ${subscriptionId}`;
  const rows = await sql`SELECT id, user_id, plan, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
  if (!rows[0]) throw new Error('Subscription not found.');
  return mapSubscription(rows[0]);
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  await ensureSubscriptionSchema();
  await sql`UPDATE subscriptions SET status = 'banned', requested_at = NULL, approved_at = NULL, expires_at = NULL, updated_at = NOW() WHERE id = ${subscriptionId}`;
}

function mapSubscription(row: any): SubscriptionInfo {
  if (!row) throw new Error('Subscription not found.');
  const plan = Object.prototype.hasOwnProperty.call(PAYMENT_PLANS, String(row.plan)) ? String(row.plan) as SubscriptionPlan : DEFAULT_PLAN;
  return { id: String(row.id), userId: String(row.user_id), plan, status: String(row.status) as SubscriptionStatus, trialEndsAt: new Date(row.trial_ends_at).toISOString(), requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null, approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null };
}
