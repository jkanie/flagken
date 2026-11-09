import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagkenClient } from '@flagken/sdk';
import { Api, createUser, freshDatabase, openSse, setupProject, startServer, testConfig, updateState } from './harness.js';
import type { Running } from './harness.js';

let server: Running;
let api: Api;
let keys: Awaited<ReturnType<typeof setupProject>>;
const state = '/api/v1/projects/demo-shop/flags/new-checkout/environments/production';

beforeAll(async () => {
  const databaseUrl = await freshDatabase();
  server = await startServer(testConfig(databaseUrl));
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  api = new Api(server.url);
  await api.login('owner@example.com');
  keys = await setupProject(api);
});
afterAll(() => server.close());

const sdkGet = (path: string, key: string) => fetch(`${server.url}${path}`, { headers: { authorization: `Bearer ${key}` } });

describe('SDK endpoints', () => {
  it('gives server keys the rules and refuses client keys', async () => {
    const response = await sdkGet('/sdk/v1/flags', keys.serverKey);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.environment).toBe('production');
    expect(body.flags[0]).toMatchObject({ key: 'new-checkout', on: false, rules: [], version: 2 });
    expect((await sdkGet('/sdk/v1/flags', keys.clientKey)).status).toBe(403);
    expect((await sdkGet('/sdk/v1/flags', 'fk_srv_wrong')).status).toBe(401);
    expect((await fetch(`${server.url}/sdk/v1/flags`)).status).toBe(401);
  });

  it('gives client keys evaluated values only', async () => {
    const response = await fetch(`${server.url}/sdk/v1/evaluate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keys.clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'u_7f3a9c', attributes: { country: 'CA' } }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.flags).toEqual([{ key: 'new-checkout', value: false, variation: 0, version: 2, reason: { kind: 'OFF' } }]);
    expect(JSON.stringify(body)).not.toContain('rules');
  });

  it('refuses a malformed context', async () => {
    const response = await fetch(`${server.url}/sdk/v1/evaluate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keys.clientKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'u_1', attributes: { nested: { deep: true } } }),
    });
    expect(response.status).toBe(400);
  });
});

describe('Server-Sent Events', () => {
  it('sends put first, then a patch when the flag changes', async () => {
    const stream = await openSse(server.url, keys.serverKey);
    const put = await stream.waitFor((e) => e.event === 'put');
    expect(put.data.flags.map((f: { key: string }) => f.key)).toEqual(['new-checkout']);
    await updateState(api, state, { on: true });
    const patch = await stream.waitFor((e) => e.event === 'patch' && e.data.on === true);
    expect(patch.data).toMatchObject({ key: 'new-checkout', on: true });
    expect(patch.data.version).toBeGreaterThan(put.data.flags[0].version);
    await stream.waitFor((e) => e.event === 'ping', 3000);
    stream.close();
  });

  it('evaluates for the context of a client key stream', async () => {
    const stream = await openSse(server.url, keys.clientKey, { key: 'u_vip', attributes: { plan: 'beta' } });
    await stream.waitFor((e) => e.event === 'put');
    await updateState(api, state, { on: true, fallthrough: { variation: 0 }, targets: [{ variation: 1, values: ['u_vip'] }] });
    const patch = await stream.waitFor((e) => e.event === 'patch' && e.data.reason.kind === 'TARGET_MATCH');
    expect(patch.data).toMatchObject({ key: 'new-checkout', value: true, variation: 1 });
    stream.close();
  });

  it('needs the context header for a client key', async () => {
    const response = await fetch(`${server.url}/sdk/v1/stream`, { headers: { authorization: `Bearer ${keys.clientKey}` } });
    expect(response.status).toBe(400);
  });

  it('sends delete when a flag is archived', async () => {
    await api.json('POST', '/api/v1/projects/demo-shop/flags', {
      key: 'temp',
      name: 'Temp',
      kind: 'boolean',
      variations: [{ value: false }, { value: true }],
    });
    const stream = await openSse(server.url, keys.serverKey);
    await stream.waitFor((e) => e.event === 'put');
    await api.json('DELETE', '/api/v1/projects/demo-shop/flags/temp');
    const removed = await stream.waitFor((e) => e.event === 'delete');
    expect(removed.data.key).toBe('temp');
    stream.close();
  });

  it('closes the streams of a revoked key', async () => {
    const created = await api.json('POST', '/api/v1/projects/demo-shop/environments/production/api-keys', {
      name: 'short-lived',
      kind: 'server',
    });
    const stream = await openSse(server.url, created.body.key);
    await stream.waitFor((e) => e.event === 'put');
    await api.json('DELETE', `/api/v1/projects/demo-shop/environments/production/api-keys/${created.body.id}`);
    await stream.ended;
  });
});

describe('the SDK against the server', () => {
  it('gives the same value as the server for 500 contexts (rules, targets, rollout)', async () => {
    await updateState(api, state, {
      on: true,
      targets: [{ variation: 1, values: ['u_3', 'u_44'] }],
      rules: [{ id: 'nz', clauses: [{ attribute: 'country', op: 'in', values: ['NZ'] }], serve: { variation: 0 } }],
      fallthrough: {
        rollout: {
          variations: [
            { variation: 0, weight: 6000 },
            { variation: 1, weight: 4000 },
          ],
        },
      },
    });
    const sdk = new FlagkenClient({ baseUrl: server.url, apiKey: keys.serverKey });
    await sdk.start();
    try {
      let on = 0;
      for (let i = 0; i < 500; i++) {
        const context = { key: `u_${i}`, attributes: { country: i % 7 === 0 ? 'NZ' : 'CA' } };
        const response = await fetch(`${server.url}/sdk/v1/evaluate`, {
          method: 'POST',
          headers: { authorization: `Bearer ${keys.clientKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(context),
        });
        const [fromServer] = ((await response.json()) as any).flags;
        const local = sdk.variationDetail('new-checkout', false, { key: context.key, ...context.attributes });
        expect(local.value).toBe(fromServer.value);
        expect(local.reason).toEqual(fromServer.reason);
        if (local.value === true) on++;
      }
      // About 40% of the users outside the NZ rule, plus the 2 targets.
      expect(on).toBeGreaterThan(120);
      expect(on).toBeLessThan(220);
    } finally {
      await sdk.close();
    }
  });

  it('sees a flip within a second, in server and client mode', async () => {
    const serverSdk = new FlagkenClient({ baseUrl: server.url, apiKey: keys.serverKey });
    const clientSdk = new FlagkenClient({ baseUrl: server.url, apiKey: keys.clientKey, context: { key: 'u_flip' } });
    await Promise.all([serverSdk.start(), clientSdk.start()]);
    try {
      await updateState(api, state, { on: false, targets: [], rules: [] });
      const deadline = Date.now() + 1000;
      while (
        Date.now() < deadline &&
        (serverSdk.variation('new-checkout', true, { key: 'u_flip' }) || clientSdk.variation('new-checkout', true))
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(serverSdk.variation('new-checkout', true, { key: 'u_flip' })).toBe(false);
      expect(clientSdk.variation('new-checkout', true)).toBe(false);
      expect(serverSdk.status).toBe('live');
    } finally {
      await Promise.all([serverSdk.close(), clientSdk.close()]);
    }
  });

  it('counts server-side evaluations in Prometheus metrics', async () => {
    const metrics = await (await fetch(`${server.url}/metrics`)).text();
    expect(metrics).toMatch(/flagken_flag_evaluations_total\{environment="production",flag="new-checkout",reason="[A-Z_]+"\} \d+/);
  });
});
