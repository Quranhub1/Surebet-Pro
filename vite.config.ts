import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Android 8 commonly uses older Chrome/WebView engines. Keep the bundle
  // conservative so startup does not depend on newer JavaScript syntax.
  build: {
    target: 'es2015',
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
