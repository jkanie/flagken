import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const alias = {
  '@flagken/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
  '@flagken/api-client': fileURLToPath(new URL('../../packages/api-client/src/index.ts', import.meta.url)),
  '@flagken/sdk/node': fileURLToPath(new URL('../../packages/sdk/src/node.ts', import.meta.url)),
  '@flagken/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
};

// SWC compiles the tests: NestJS needs decorator metadata, which the default transform does not emit.
const plugins = [
  swc.vite({
    module: { type: 'es6' },
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
  }),
];

export default defineConfig({
  plugins,
  resolve: { alias },
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          // The files share 1 PostgreSQL server and 1 Redis, each file in its own database and key prefix.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
