// backend/src/index.ts
import dotenv from 'dotenv';
import { scannerScheduler } from './engine/ScannerScheduler';
import { startServer } from './server';

dotenv.config();

console.log('=========================================');
console.log('🚀 Iniciando SurebetPro Backend Engine');
console.log('=========================================');

startServer().catch(err => {
  console.error('Falha crítica ao iniciar o Servidor API:', err);
});

scannerScheduler.start().catch(err => {
  console.error('Falha crítica ao iniciar o Scanner:', err);
});
