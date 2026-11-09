import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// In development the console runs on Vite and forwards API, SDK, WebSocket calls to the server on port 3000,
// so the browser sees 1 origin, as it does in production where the server serves the built console.
const target = process.env.FLAGKEN_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/sdk': target,
      '/health': target,
      '/docs': target,
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
