import dotenv from 'dotenv';
import { ensureDatabase } from './lib/db';
import { scannerScheduler } from './engine/ScannerScheduler';
import { startServer } from './server';

dotenv.config();

console.log('=========================================');
console.log('🚀 Starting SurebetPro Backend Engine');
console.log('=========================================');

async function start(): Promise<void> {
  await ensureDatabase();
  console.log('[DB] Connected to Neon PostgreSQL.');
  await startServer();
  await scannerScheduler.start();
}

start().catch((error) => {
  console.error('[Startup] Critical backend error:', error);
  process.exitCode = 1;
});
