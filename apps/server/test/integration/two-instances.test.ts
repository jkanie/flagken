import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagkenClient } from '@flagken/sdk';
import { Api, consoleSocket, createUser, freshDatabase, openSse, setupProject, startServer, testConfig, updateState } from './harness.js';
import type { Running } from './harness.js';

/**
 * 2 server instances on 1 PostgreSQL and 1 Redis, like 2 replicas behind a load balancer.
 * Clients connect to B, the change goes to A.
 */
let a: Running;
let b: Running;
let apiA: Api;
let apiB: Api;
let keys: Awaited<ReturnType<typeof setupProject>>;
const state = '/api/v1/projects/demo-shop/flags/new-checkout/environments/production';

beforeAll(async () => {
  const databaseUrl = await freshDatabase();
  const prefix = `pair${Date.now()}`;
  a = await startServer(testConfig(databaseUrl, { RATE_LIMIT_PER_MINUTE: '40' }, prefix));
  b = await startServer(testConfig(databaseUrl, { RATE_LIMIT_PER_MINUTE: '40' }, prefix));
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  apiA = new Api(a.url);
  await apiA.login('owner@example.com');
  apiB = new Api(b.url);
  apiB.cookie = apiA.cookie;
  keys = await setupProject(apiA);
});
afterAll(async () => {
  await a.close();
  await b.close();
});

describe('Redis publish and subscribe between instances', () => {
  it('runs 2 instances on different ports', () => {
    expect(a.url).not.toBe(b.url);
  });

  it('delivers a change made on A to an SSE stream on B', async () => {
    const stream = await openSse(b.url, keys.serverKey);
    await stream.waitFor((e) => e.event === 'put');
    const saved = await updateState(apiA, state, { on: true });
    expect(saved.status).toBe(200);
    const patch = await stream.waitFor((e) => e.event === 'patch' && e.data.on === true);
    expect(patch.data.key).toBe('new-checkout');
    stream.close();
  });

  it('delivers the change and its audit entry to a console WebSocket on B', async () => {
    const ws = await consoleSocket(b.url, apiA.cookie, 'demo-shop');
    await updateState(apiA, state, { on: false });
    const changed = await ws.waitFor((m) => m.event === 'flag.changed');
    expect(changed.data).toMatchObject({ flagKey: 'new-checkout', environmentKey: 'production', projectKey: 'demo-shop' });
    const audit = await ws.waitFor((m) => m.event === 'audit.created');
    expect(audit.data).toMatchObject({ action: 'flag.state.updated', actorLabel: 'owner@example.com' });
    ws.socket.close();
  });

  it('keeps an SDK on B in step with changes on A', async () => {
    const sdk = new FlagkenClient({ baseUrl: b.url, apiKey: keys.clientKey, context: { key: 'u_b41e07' } });
    await sdk.start();
    try {
      expect(sdk.variation('new-checkout', true)).toBe(false);
      await updateState(apiA, state, { on: true, fallthrough: { variation: 1 } });
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !sdk.variation('new-checkout', false)) await new Promise((r) => setTimeout(r, 10));
      expect(sdk.variation('new-checkout', false)).toBe(true);
    } finally {
      await sdk.close();
    }
  });

  it('closes a revoked key on B when it is revoked through A', async () => {
    const stream = await openSse(b.url, keys.clientKey, { key: 'u_1' });
    await stream.waitFor((e) => e.event === 'put');
    await apiA.json('DELETE', `/api/v1/projects/demo-shop/environments/production/api-keys/${keys.clientKeyId}`);
    await stream.ended;
  });

  it('counts the rate limit across both instances in Redis', async () => {
    let limitedOn: string | undefined;
    for (let i = 0; i < 40 && !limitedOn; i++) {
      for (const [name, url] of [
        ['A', a.url],
        ['B', b.url],
      ] as const) {
        const response = await fetch(`${url}/api/v1/auth/me`, { headers: { cookie: apiA.cookie, 'x-test': String(i) } });
        if (response.status === 429) {
          limitedOn = name;
          break;
        }
      }
    }
    // The limit is 40 per minute: with a shared counter the requests from this test run out before 40 rounds.
    expect(limitedOn).toBeDefined();
  });
});
