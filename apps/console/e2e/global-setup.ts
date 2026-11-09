import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { OWNER } from './users';

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/**
 * Starts PostgreSQL and Redis (Testcontainers, or the URLs CI passes), migrates, creates the owner, adds the
 * made-up demo data, then starts the built server, which also serves the built console.
 */
export default async function globalSetup() {
  let postgres: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let adminUrl = process.env.FLAGKEN_TEST_DATABASE_URL;
  let redisUrl = process.env.FLAGKEN_TEST_REDIS_URL;
  if (!adminUrl) {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    adminUrl = postgres.getConnectionUri();
  }
  if (!redisUrl) {
    redis = await new RedisContainer('redis:8-alpine').start();
    redisUrl = redis.getConnectionUrl();
  }
  const name = `flagken_e2e_${randomBytes(5).toString('hex')}`;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`create database ${name}`);
  await client.end();
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;

  const port = process.env.FLAGKEN_E2E_PORT ?? '3999';
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: port,
    HOST: '127.0.0.1',
    DATABASE_URL: databaseUrl.toString(),
    REDIS_URL: redisUrl,
    REDIS_PREFIX: `e2e${randomBytes(3).toString('hex')}`,
    SESSION_SECRET: 'made-up-e2e-session-secret-0123456789',
    COOKIE_SECURE: 'false',
    CONSOLE_DIR: root('apps/console/dist'),
    // The webhook test posts to a receiver on 127.0.0.1.
    ALLOW_PRIVATE_TARGETS: 'true',
    WEBHOOK_BACKOFF_MS: '100',
    // Each test signs in again, more often than the production default of 10 per minute allows.
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    LOG_LEVEL: 'error',
    ADMIN_EMAIL: OWNER.email,
    ADMIN_PASSWORD: OWNER.password,
  };
  const cli = root('apps/server/dist/cli.js');
  execFileSync(process.execPath, [cli, 'create-admin'], { env, stdio: 'inherit' });
  execFileSync(process.execPath, [cli, 'seed'], { env, stdio: 'ignore' });

  const server: ChildProcess = spawn(process.execPath, [root('apps/server/dist/main.js')], { env, stdio: 'inherit' });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('the server did not become ready in 30 seconds');
    await new Promise((r) => setTimeout(r, 250));
  }

  return async () => {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
    await redis?.stop();
    await postgres?.stop();
  };
}
