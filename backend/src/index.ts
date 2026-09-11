// backend/src/index.ts
import dotenv from 'dotenv';
import { scannerScheduler } from './engine/ScannerScheduler';
import { startServer } from './server';

dotenv.config();

console.log('=========================================');
console.log('🚀 Starting SurebetPro Backend Engine');
console.log('=========================================');

startServer().catch(err => {
  console.error('Critical error while starting the API server:', err);
});

scannerScheduler.start().catch(err => {
  console.error('Critical error while starting the scanner:', err);
});
