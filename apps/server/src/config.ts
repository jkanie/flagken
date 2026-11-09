/** Server settings, read once from environment variables. README.md lists every one. */
export interface Config {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  /** Prefix for every Redis key, channel, queue, so several installations can share 1 Redis. */
  redisPrefix: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
  allowPrivateTargets: boolean;
  rateLimitPerMinute: number;
  loginRateLimitPerMinute: number;
  workersEnabled: boolean;
  migrateOnStart: boolean;
  webhookTimeoutMs: number;
  webhookMaxAttempts: number;
  webhookBackoffMs: number;
  sseHeartbeatMs: number;
  metricsToken: string | undefined;
  docsEnabled: boolean;
  /** Folder with the built console (apps/console/dist). When set, the server serves it on the same origin. */
  consoleDir: string | undefined;
  logLevel: 'error' | 'warn' | 'log' | 'debug' | 'verbose';
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function text(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`${name} is required`);
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${name} must be true or false`);
}

const LOG_LEVELS = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

export function loadConfig(env: Env = process.env): Config {
  const sessionSecret = text(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) throw new ConfigError('SESSION_SECRET must be at least 32 characters');
  const logLevel = text(env, 'LOG_LEVEL', 'log');
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    const url = URL.parse(origin);
    if (!url || url.origin !== origin)
      throw new ConfigError(`CORS_ORIGINS entry ${origin} is not an origin like https://flags.example.com`);
  }
  return {
    nodeEnv: text(env, 'NODE_ENV', 'production'),
    host: text(env, 'HOST', '0.0.0.0'),
    port: integer(env, 'PORT', 3000, 0, 65535),
    databaseUrl: text(env, 'DATABASE_URL'),
    redisUrl: text(env, 'REDIS_URL'),
    redisPrefix: text(env, 'REDIS_PREFIX', 'flagken'),
    sessionSecret,
    sessionTtlHours: integer(env, 'SESSION_TTL_HOURS', 12, 1, 24 * 30),
    cookieSecure: flag(env, 'COOKIE_SECURE', true),
    corsOrigins,
    trustProxy: flag(env, 'TRUST_PROXY', false),
    allowPrivateTargets: flag(env, 'ALLOW_PRIVATE_TARGETS', false),
    rateLimitPerMinute: integer(env, 'RATE_LIMIT_PER_MINUTE', 600, 1, 1_000_000),
    loginRateLimitPerMinute: integer(env, 'LOGIN_RATE_LIMIT_PER_MINUTE', 10, 1, 10_000),
    workersEnabled: flag(env, 'WORKERS_ENABLED', true),
    migrateOnStart: flag(env, 'MIGRATE_ON_START', true),
    webhookTimeoutMs: integer(env, 'WEBHOOK_TIMEOUT_MS', 5000, 100, 60_000),
    webhookMaxAttempts: integer(env, 'WEBHOOK_MAX_ATTEMPTS', 6, 1, 20),
    webhookBackoffMs: integer(env, 'WEBHOOK_BACKOFF_MS', 2000, 10, 3_600_000),
    sseHeartbeatMs: integer(env, 'SSE_HEARTBEAT_MS', 15_000, 1000, 300_000),
    metricsToken: env.METRICS_TOKEN?.trim() || undefined,
    docsEnabled: flag(env, 'DOCS_ENABLED', true),
    consoleDir: env.CONSOLE_DIR?.trim() || undefined,
    logLevel: logLevel as Config['logLevel'],
  };
}

export const CONFIG = Symbol('CONFIG');
