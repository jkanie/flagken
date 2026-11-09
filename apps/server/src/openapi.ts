import { createApp, buildOpenApi } from './app.factory.js';
import { loadConfig } from './config.js';

/**
 * The OpenAPI document as stable JSON. Preview mode builds the routes without connecting to PostgreSQL or Redis,
 * so CI can check the generated client without services.
 */
export async function openApiJson(): Promise<string> {
  const config = loadConfig({
    DATABASE_URL: 'postgres://unused/unused',
    REDIS_URL: 'redis://unused:6379',
    SESSION_SECRET: 'x'.repeat(32),
    LOG_LEVEL: 'error',
    WORKERS_ENABLED: 'false',
  });
  const app = await createApp(config, { preview: true });
  const document = buildOpenApi(app);
  await app.close();
  return `${JSON.stringify(document, null, 2)}\n`;
}
