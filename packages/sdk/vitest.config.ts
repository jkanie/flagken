import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@flagken/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@flagken/api-client': fileURLToPath(new URL('../api-client/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});
