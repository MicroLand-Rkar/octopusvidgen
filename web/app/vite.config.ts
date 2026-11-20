import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives under /app; the Rust server serves the landing page at / and the API at /api.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API answers only its own address (see server/src/auth.rs), so the dev proxy speaks as it.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: { origin: 'http://127.0.0.1:8787' } },
      // the landing page's files the app reuses (style stills, the icon)
      '/img': 'http://127.0.0.1:8787',
      '/favicon.svg': 'http://127.0.0.1:8787',
    },
  },
});
