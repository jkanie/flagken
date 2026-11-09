import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@flagken/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@flagken/api-client': fileURLToPath(new URL('../../packages/api-client/src/index.ts', import.meta.url)),
    },
  },
  test: { environment: 'happy-dom', include: ['test/**/*.test.ts'] },
});
