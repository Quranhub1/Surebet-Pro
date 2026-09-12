import axios from 'axios';
import dotenv from 'dotenv';
import { ensureDatabase } from './lib/db';
import { ensurePredictionIntegrity } from './services/PredictionIntegrityService';
import { ensurePredictionAnalytics } from './services/PredictionAnalyticsService';
import { ensureUserSubscriptionColumns, installSubscriptionGateway } from './services/SubscriptionGateway';
import { scannerScheduler } from './engine/ScannerScheduler';

dotenv.config();

/**
 * API-Football has occasionally rejected otherwise valid global from/to fixture
 * queries with its "From field need another parameter" validation response.
 * Keep the normal range request first, then transparently fall back to one
 * request per calendar day so the 40-match analysis pipeline still receives
 * the full fixture window instead of dying before selection.
 */
const originalAxiosGet = axios.get.bind(axios);
axios.get = async function resilientFootballGet(url: string, config: any = {}) {
  const params = config?.params as Record<string, string | number> | undefined;
  const isFixtureRangeRequest = url.includes('/fixtures') && params && typeof params.from === 'string' && typeof params.to === 'string';
  if (!isFixtureRangeRequest) return originalAxiosGet(url, config);
  const response = await originalAxiosGet(url, config);
  const errors = response.data?.errors;
  const errorText = Array.isArray(errors) ? errors.join('; ') : errors && typeof errors === 'object' ? Object.values(errors).join('; ') : '';
  if (!/From field|To field/i.test(errorText)) return response;
  const from = new Date(`${params.from}T00:00:00Z`); const to = new Date(`${params.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return response;
  console.warn(`[AI] API-Football rejected from/to range (${params.from} -> ${params.to}); falling back to daily fixture requests.`);
  const fixtures: any[] = [];
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10); const dailyParams = { ...params }; delete dailyParams.from; delete dailyParams.to; dailyParams.date = date;
    try {
      const dailyResponse = await originalAxiosGet(url, { ...config, params: dailyParams });
      const dailyErrors = dailyResponse.data?.errors;
      if (dailyErrors && ((Array.isArray(dailyErrors) && dailyErrors.length) || Object.keys(dailyErrors).length)) { const message = Array.isArray(dailyErrors) ? dailyErrors.join('; ') : Object.values(dailyErrors).join('; '); console.warn(`[AI] Daily fixture request ${date} failed: ${message}`); continue; }
      if (Array.isArray(dailyResponse.data?.response)) fixtures.push(...dailyResponse.data.response);
    } catch (error) { console.warn(`[AI] Daily fixture request ${date} failed:`, error instanceof Error ? error.message : error); }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  const uniqueFixtures = Array.from(new Map(fixtures.map(fixture => [String(fixture?.fixture?.id), fixture])).values());
  console.log(`[AI] Daily fallback recovered ${uniqueFixtures.length} fixtures for ${params.from} through ${params.to}.`);
  return { ...response, data: { ...response.data, errors: [], results: uniqueFixtures.length, paging: { current: 1, total: 1 }, response: uniqueFixtures } };
};

console.log('=========================================');
console.log('🚀 Starting SurebetPro Backend Engine');
console.log('=========================================');

async function start(): Promise<void> {
  await ensureDatabase();
  await ensurePredictionIntegrity();
  await ensurePredictionAnalytics();
  await ensureUserSubscriptionColumns();
  installSubscriptionGateway();
  console.log('[DB] Connected to Neon PostgreSQL and prediction integrity, analytics audit guards, subscription gateway enabled.');
  const { startServer } = await import('./server');
  await startServer();
  await scannerScheduler.start();
}

start().catch((error) => { console.error('[Startup] Critical backend error:', error); process.exitCode = 1; });
