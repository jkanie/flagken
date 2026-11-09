import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { verifyWebhookSignature } from '@flagken/sdk';
import { ConfigError, loadConfig } from '../../src/config.js';
import { etagFor, expectedVersion } from '../../src/common/etag.js';
import { KeyPipe } from '../../src/common/keys.js';
import { bearerToken, generateApiKey, hashApiKey } from '../../src/auth/api-keys.js';
import { SessionService, readCookie } from '../../src/auth/session.js';
import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';
import { generateWebhookSecret, signWebhook } from '../../src/webhooks/signature.js';
import { ShapeError, parseRules, parseServe, parseTargets, parseVariations } from '../../src/flags/shape.js';
import { contextFromHeader, toContext } from '../../src/sdk/context.js';
import { originAllowed } from '../../src/live/console.gateway.js';
import { MetricsService } from '../../src/metrics/metrics.service.js';
import { initialState } from '../../src/projects/projects.service.js';
import { SEED_FLAGS } from '../../src/seed.js';
import { validateEnvironmentState, validateVariations } from '@flagken/shared';

const env = { DATABASE_URL: 'postgres://x/y', REDIS_URL: 'redis://x:6379', SESSION_SECRET: 's'.repeat(32) };

describe('loadConfig', () => {
  it('fills defaults', () => {
    const config = loadConfig(env);
    expect(config).toMatchObject({
      port: 3000,
      cookieSecure: true,
      allowPrivateTargets: false,
      workersEnabled: true,
      corsOrigins: [],
      metricsToken: undefined,
    });
  });
  it('reads lists, flags and numbers', () => {
    const config = loadConfig({
      ...env,
      CORS_ORIGINS: 'https://a.example, http://localhost:5173',
      ALLOW_PRIVATE_TARGETS: 'yes',
      PORT: '8080',
    });
    expect(config.corsOrigins).toEqual(['https://a.example', 'http://localhost:5173']);
    expect(config.allowPrivateTargets).toBe(true);
    expect(config.port).toBe(8080);
  });
  it.each([
    [{ DATABASE_URL: '' }, 'DATABASE_URL is required'],
    [{ SESSION_SECRET: 'short' }, 'SESSION_SECRET must be at least 32 characters'],
    [{ PORT: 'eighty' }, 'PORT must be a whole number'],
    [{ COOKIE_SECURE: 'maybe' }, 'COOKIE_SECURE must be true or false'],
    [{ CORS_ORIGINS: 'https://a.example/path' }, 'is not an origin'],
    [{ LOG_LEVEL: 'loud' }, 'LOG_LEVEL must be one of'],
  ])('refuses %j', (override, message) => {
    expect(() => loadConfig({ ...env, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, ...override })).toThrow(message);
  });
});

describe('ETags', () => {
  it('round-trips a version', () => {
    expect(expectedVersion(etagFor(7))).toBe(7);
    expect(expectedVersion('"x", "v3"')).toBe(3);
    expect(expectedVersion('*')).toBeUndefined();
  });
  it('answers 428 without If-Match and 412 for a foreign tag', () => {
    const status = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as HttpException).getStatus();
      }
      return 0;
    };
    expect(status(() => expectedVersion(undefined))).toBe(428);
    expect(status(() => expectedVersion('W/"v1"'))).toBe(412);
  });
});

describe('keys and tokens', () => {
  it('generates API keys with a kind prefix and stores only a SHA-256', () => {
    const server = generateApiKey('server');
    const client = generateApiKey('client');
    expect(server.key).toMatch(/^fk_srv_[A-Za-z0-9_-]{43}$/);
    expect(client.key).toMatch(/^fk_cli_[A-Za-z0-9_-]{43}$/);
    expect(server.hash).toBe(hashApiKey(server.key));
    expect(server.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(server.prefix).toBe(server.key.slice(0, 14));
  });
  it('reads bearer tokens', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
  it('checks path keys', () => {
    expect(new KeyPipe().transform('demo-shop')).toBe('demo-shop');
    expect(() => new KeyPipe().transform('../etc')).toThrow();
  });
});

describe('sessions and passwords', () => {
  const sessions = new SessionService(loadConfig(env));
  it('signs and verifies a session token, and refuses a forged one', async () => {
    const token = await sessions.sign('11111111-1111-1111-1111-111111111111');
    expect(await sessions.verify(token)).toBe('11111111-1111-1111-1111-111111111111');
    const other = new SessionService(loadConfig({ ...env, SESSION_SECRET: 'o'.repeat(32) }));
    expect(await other.verify(token)).toBeUndefined();
    expect(await sessions.verify('not.a.jwt')).toBeUndefined();
  });
  it('reads 1 cookie from a header', () => {
    expect(readCookie('a=1; flagken_session=abc%3D; b=2', 'flagken_session')).toBe('abc=');
    expect(readCookie('a=1', 'flagken_session')).toBeUndefined();
  });
  it('hashes passwords with argon2id', async () => {
    const stored = await hashPassword('made-up-password-1');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(stored, 'made-up-password-1')).toBe(true);
    expect(await verifyPassword(stored, 'wrong')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
});

describe('webhook signatures', () => {
  it('signs in the format the SDK verifier accepts', async () => {
    const secret = generateWebhookSecret();
    const body = '{"id":"evt_9"}';
    const now = Math.floor(Date.now() / 1000);
    const header = signWebhook(secret, body, now);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature({ secret, body, header, now })).toBe(true);
    expect(await verifyWebhookSignature({ secret, body, header, now: now + 3600 })).toBe(false);
  });
});

describe('request shapes', () => {
  it('parses serve, rules, targets, variations', () => {
    expect(parseServe({ variation: 1 }, 'x')).toEqual({ variation: 1 });
    expect(parseServe({ rollout: { variations: [{ variation: 0, weight: 10000 }], bucketBy: 'org' } }, 'x')).toEqual({
      rollout: { variations: [{ variation: 0, weight: 10000 }], bucketBy: 'org' },
    });
    expect(
      parseRules([{ id: 'r', clauses: [{ attribute: 'a', op: 'in', values: ['x', 1, true], negate: true }], serve: { variation: 0 } }]),
    ).toHaveLength(1);
    expect(parseTargets([{ variation: 0, values: ['u_1'] }])).toEqual([{ variation: 0, values: ['u_1'] }]);
    expect(parseVariations([{ value: { a: [1] }, name: 'A' }])).toEqual([{ value: { a: [1] }, name: 'A' }]);
  });
  it.each([
    () => parseServe({}, 'x'),
    () => parseServe({ variation: 1.5 }, 'x'),
    () => parseRules([{ id: 'r', clauses: [{ attribute: 'a', op: 'in', values: [{}] }], serve: { variation: 0 } }]),
    () => parseRules([{ id: '', clauses: [], serve: { variation: 0 } }]),
    () => parseTargets([{ variation: 0, values: [''] }]),
    () => parseVariations([{ value: Number.NaN }]),
    () => parseVariations([{ name: 'no value' }]),
  ])('refuses bad shape %#', (fn) => {
    expect(fn).toThrow(ShapeError);
  });
});

describe('evaluation contexts', () => {
  it('builds a flat context, the key wins over an attribute named key', () => {
    expect(toContext({ key: 'u_1', attributes: { country: 'CA', key: 'other', tags: ['a'] } })).toEqual({
      key: 'u_1',
      country: 'CA',
      tags: ['a'],
    });
  });
  it('reads the base64url header and refuses junk', () => {
    const header = Buffer.from(JSON.stringify({ key: 'u_1' })).toString('base64url');
    expect(contextFromHeader(header)).toEqual({ key: 'u_1' });
    expect(() => contextFromHeader(undefined)).toThrow(/X-Flagken-Context/);
    expect(() => contextFromHeader('!!!')).toThrow();
    expect(() => toContext({ key: '' })).toThrow();
    expect(() => toContext({ key: 'u', attributes: { a: { b: 1 } } })).toThrow();
  });
});

describe('WebSocket origin check', () => {
  it('allows same host, configured origins and non-browser clients', () => {
    expect(originAllowed(undefined, 'flags.example.com', [])).toBe(true);
    expect(originAllowed('https://flags.example.com', 'flags.example.com', [])).toBe(true);
    expect(originAllowed('http://localhost:5173', 'localhost:3000', ['http://localhost:5173'])).toBe(true);
    expect(originAllowed('https://evil.example', 'flags.example.com', [])).toBe(false);
  });
});

describe('metrics registry', () => {
  it('registers the 3 flagken metrics on its own registry', async () => {
    const a = new MetricsService();
    const b = new MetricsService();
    a.webhookDeliveries.inc({ outcome: 'success' });
    expect(await a.registry.getSingleMetricAsString('flagken_webhook_deliveries_total')).toContain('outcome="success"} 1');
    expect(await b.registry.getSingleMetricAsString('flagken_webhook_deliveries_total')).not.toContain('outcome="success"} 1');
  });
});

describe('initial flag state and seed data', () => {
  it('starts boolean flags off with true as the fallthrough', () => {
    expect(initialState('boolean', [{ value: false }, { value: true }])).toMatchObject({
      on: false,
      offVariation: 0,
      fallthrough: '{"variation":1}',
    });
    expect(initialState('boolean', [{ value: true }, { value: false }])).toMatchObject({ offVariation: 1, fallthrough: '{"variation":0}' });
    expect(initialState('string', [{ value: 'a' }, { value: 'b' }])).toMatchObject({ offVariation: 0, fallthrough: '{"variation":0}' });
  });
  it('ships valid sample flags with opaque context keys only', () => {
    for (const flag of SEED_FLAGS) {
      expect(validateVariations(flag.kind, flag.variations)).toEqual([]);
      for (const state of Object.values(flag.states)) {
        const full = { on: false, killed: false, offVariation: 0, fallthrough: { variation: 0 }, targets: [], rules: [], ...state };
        expect(validateEnvironmentState(full, flag.variations.length)).toEqual([]);
        for (const target of full.targets) for (const key of target.values) expect(key).toMatch(/^u_[0-9a-f]{6}$/);
      }
    }
  });
});
