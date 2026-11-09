import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Starts PostgreSQL 17 and Redis 8 with Testcontainers, once for the whole run.
 * CI passes FLAGKEN_TEST_DATABASE_URL and FLAGKEN_TEST_REDIS_URL for its service containers instead.
 */
export default async function setup(project: TestProject) {
  let postgres: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;
  let databaseUrl = process.env.FLAGKEN_TEST_DATABASE_URL;
  let redisUrl = process.env.FLAGKEN_TEST_REDIS_URL;
  if (!databaseUrl) {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    databaseUrl = postgres.getConnectionUri();
  }
  if (!redisUrl) {
    redis = await new RedisContainer('redis:8-alpine').start();
    redisUrl = redis.getConnectionUrl();
  }
  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', redisUrl);
  return async () => {
    await redis?.stop();
    await postgres?.stop();
  };
}
