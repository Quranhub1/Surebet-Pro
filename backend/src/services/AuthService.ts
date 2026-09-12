import 'dotenv/config';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { sql, newId } from '../lib/db';
import { ensureUserSubscription, getEffectiveSubscription } from './SubscriptionService';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for application authentication.');
const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || createHash('sha256').update(databaseUrl).digest('hex');
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;
const GOOGLE_CREDENTIAL_PREFIX = '__GOOGLE_ID_TOKEN__:';

export interface AuthUser { id: string; email: string; name: string; role: string; plan: string; subscriptionStatus: string; trialEndsAt: string; subscriptionExpiresAt: string | null; }
function hashPassword(password: string): string { const salt = randomBytes(16).toString('hex'); const hash = scryptSync(password, salt, 64).toString('hex'); return `${salt}:${hash}`; }
function verifyPassword(password: string, stored: string): boolean { const [salt, expected] = stored.split(':'); if (!salt || !expected) return false; const actual = scryptSync(password, salt, 64).toString('hex'); const a = Buffer.from(actual, 'hex'); const b = Buffer.from(expected, 'hex'); return a.length === b.length && timingSafeEqual(a, b); }
function encode(value: string): string { return Buffer.from(value).toString('base64url'); }
function decode(value: string): string { return Buffer.from(value, 'base64url').toString('utf8'); }
export function createSession(user: AuthUser): string { const payload = encode(JSON.stringify({ sub: user.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })); const signature = createHmac('sha256', secret).update(payload).digest('base64url'); return `${payload}.${signature}`; }
export function verifySession(token: string): string | null { try { const [payload, signature] = token.split('.'); if (!payload || !signature) return null; const expected = createHmac('sha256', secret).update(payload).digest('base64url'); if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; const data = JSON.parse(decode(payload)) as { sub: string; exp: number }; return data.exp > Date.now() ? data.sub : null; } catch { return null; } }
async function toAuthUser(row: any): Promise<AuthUser> { const id = String(row.id); const subscription = await getEffectiveSubscription(id); const plan = subscription.status === 'active' ? 'PRO' : subscription.status === 'trial' ? 'TRIAL' : 'FREE'; return { id, email: String(row.email), name: String(row.name), role: String(row.role), plan, subscriptionStatus: subscription.status, trialEndsAt: subscription.trialEndsAt, subscriptionExpiresAt: subscription.expiresAt }; }
export async function register(email: string, password: string, name: string): Promise<AuthUser> {
  if (password.startsWith(GOOGLE_CREDENTIAL_PREFIX)) return googleLogin(password.slice(GOOGLE_CREDENTIAL_PREFIX.length));
  const normalizedEmail = email.trim().toLowerCase(); if (!normalizedEmail || password.length < 8 || !name.trim()) throw new Error('Name, email and a password of at least 8 characters are required.'); const existing = await sql`SELECT id FROM users WHERE email = ${normalizedEmail} LIMIT 1`; if (existing.length) throw new Error('An account with that email already exists.'); const id = newId(); await sql`INSERT INTO users (id, email, password_hash, name, role) VALUES (${id}, ${normalizedEmail}, ${hashPassword(password)}, ${name.trim()}, 'USER')`; await ensureUserSubscription(id); return getUser(id) as Promise<AuthUser>;
}
export async function login(email: string, password: string): Promise<AuthUser> { const normalizedEmail = email.trim().toLowerCase(); const rows = await sql`SELECT id, email, password_hash, name, role FROM users WHERE email = ${normalizedEmail} LIMIT 1`; const user = rows[0]; if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password.'); return toAuthUser(user); }
export async function googleLogin(credential: string): Promise<AuthUser> {
  if (!googleClient || !googleClientId) throw new Error('Google sign-in is not configured on the server.');
  if (!credential) throw new Error('Google credential is required.');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) throw new Error('Google account could not be verified.');
  const email = payload.email.trim().toLowerCase();
  const existing = await sql`SELECT id, email, name, role, google_sub, password_hash FROM users WHERE email = ${email} LIMIT 1`;
  let userId: string;
  if (existing.length) {
    const user = existing[0];
    if (user.google_sub && user.google_sub !== payload.sub) throw new Error('This email is linked to a different Google account.');
    if (!user.google_sub && user.password_hash) throw new Error('An account with this email already exists. Sign in with your password first.');
    userId = String(user.id);
    await sql`UPDATE users SET google_sub = ${payload.sub}, name = ${String(payload.name || user.name || 'Google User').trim()} WHERE id = ${userId}`;
  } else {
    userId = newId();
    await sql`INSERT INTO users (id, email, password_hash, name, role, google_sub) VALUES (${userId}, ${email}, NULL, ${String(payload.name || email.split('@')[0]).trim()}, 'USER', ${payload.sub})`;
  }
  await ensureUserSubscription(userId);
  return getUser(userId) as Promise<AuthUser>;
}
export async function getUser(userId: string): Promise<AuthUser | null> { const rows = await sql`SELECT id, email, name, role FROM users WHERE id = ${userId} LIMIT 1`; if (!rows[0]) return null; return toAuthUser(rows[0]); }
