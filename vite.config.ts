import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep the production bundle friendly to older Android WebViews/Chrome,
  // including devices commonly running Android 8.0/8.1.
  build: {
    target: 'es2017',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
