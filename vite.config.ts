import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    // Generate a legacy bundle and polyfills for older Android 8-era
    // Chrome/WebView engines. This is more robust than syntax transpilation alone.
    legacy({
      targets: ['Chrome >= 61'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
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
