import { sql, newId } from '../lib/db';

export const TRIAL_DAYS = 3;
export const SUBSCRIPTION_PRICE_UGX = 5000;
export const PAYMENT_NUMBER = '0749846848';
export const PAYMENT_NAME = 'Kabali Madina';

export type SubscriptionStatus = 'trial' | 'expired' | 'pending' | 'active' | 'banned';

export interface SubscriptionInfo {
  id: string;
  userId: string;
  status: SubscriptionStatus;
  trialEndsAt: string;
  requestedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
}

let schemaReady = false;
async function ensureSubscriptionSchema(): Promise<void> {
  if (schemaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS subscriptions (id text PRIMARY KEY, user_id text UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'trial', trial_started_at timestamptz NOT NULL DEFAULT now(), trial_ends_at timestamptz NOT NULL, requested_at timestamptz, approved_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id)`;
  schemaReady = true;
}

export async function ensureUserSubscription(userId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  await sql`INSERT INTO subscriptions (id, user_id, status, trial_started_at, trial_ends_at) VALUES (${newId()}, ${userId}, 'trial', NOW(), NOW() + INTERVAL '3 days') ON CONFLICT (user_id) DO NOTHING`;
  const rows = await sql`SELECT id, user_id, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE user_id = ${userId} LIMIT 1`;
  return mapSubscription(rows[0]);
}

export async function getEffectiveSubscription(userId: string): Promise<SubscriptionInfo> {
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

export async function requestPayment(userId: string): Promise<SubscriptionInfo> {
  const current = await getEffectiveSubscription(userId);
  if (current.status === 'active') throw new Error('Your Pro subscription is already active.');
  if (current.status === 'banned') throw new Error('Your account is banned.');
  if (current.status === 'pending' && current.requestedAt) return current;
  await sql`UPDATE subscriptions SET status = 'pending', requested_at = NOW(), updated_at = NOW() WHERE user_id = ${userId}`;
  return ensureUserSubscription(userId);
}

export async function listSubscriptions(): Promise<any[]> {
  await ensureSubscriptionSchema();
  return sql`SELECT s.id, s.user_id, u.name, u.email, u.role, s.status, s.trial_ends_at, s.requested_at, s.approved_at, s.expires_at, s.created_at, s.updated_at FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'expired' THEN 1 WHEN 'active' THEN 2 WHEN 'trial' THEN 3 WHEN 'banned' THEN 4 ELSE 5 END, s.updated_at DESC`;
}

export async function approveSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  await sql`UPDATE subscriptions SET status = 'active', approved_at = NOW(), requested_at = COALESCE(requested_at, NOW()), expires_at = NOW() + INTERVAL '30 days', updated_at = NOW() WHERE id = ${subscriptionId}`;
  const rows = await sql`SELECT id, user_id, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
  if (!rows[0]) throw new Error('Subscription not found.');
  return mapSubscription(rows[0]);
}

export async function banSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  await ensureSubscriptionSchema();
  await sql`UPDATE subscriptions SET status = 'banned', updated_at = NOW() WHERE id = ${subscriptionId}`;
  const rows = await sql`SELECT id, user_id, status, trial_ends_at, requested_at, approved_at, expires_at FROM subscriptions WHERE id = ${subscriptionId} LIMIT 1`;
  if (!rows[0]) throw new Error('Subscription not found.');
  return mapSubscription(rows[0]);
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  await ensureSubscriptionSchema();
  await sql`DELETE FROM subscriptions WHERE id = ${subscriptionId}`;
}

function mapSubscription(row: any): SubscriptionInfo {
  if (!row) throw new Error('Subscription not found.');
  return { id: String(row.id), userId: String(row.user_id), status: String(row.status) as SubscriptionStatus, trialEndsAt: new Date(row.trial_ends_at).toISOString(), requestedAt: row.requested_at ? new Date(row.requested_at).toISOString() : null, approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null };
}
