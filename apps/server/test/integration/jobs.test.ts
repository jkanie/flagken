import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '@flagken/sdk';
import { Api, createUser, freshDatabase, openSse, setupProject, startServer, testConfig, updateState } from './harness.js';
import type { Running } from './harness.js';

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A local webhook receiver. `plan` lists the status codes to answer, in order, then 200. */
async function receiver(plan: number[] = []) {
  const received: Received[] = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.statusCode = plan.shift() ?? 200;
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { received, url: `http://hooks.test:${port}/flagken`, close: () => new Promise((r) => server.close(r)) };
}

// Webhook targets must be public addresses. The tests point a made-up name at 127.0.0.1 and allow only that address,
// so the guard still runs on every request.
let resolveTo = '127.0.0.1';
const policy = {
  allowPrivate: false,
  resolve: async () => [{ address: resolveTo, family: 4 }],
  isAllowed: (address: string) => address === '127.0.0.1',
};

let server: Running;
let api: Api;
let databaseUrl: string;
const state = '/api/v1/projects/demo-shop/flags/new-checkout/environments/production';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  databaseUrl = await freshDatabase();
  server = await startServer(testConfig(databaseUrl), { targetPolicy: policy });
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  api = new Api(server.url);
  await api.login('owner@example.com');
  await setupProject(api);
});
afterAll(() => server.close());

describe('scheduled changes (BullMQ delayed jobs)', () => {
  it('turns a flag on at the set time, writes the audit entry and pushes the change', async () => {
    const { serverKey } = await setupProject(api, 'sched-project');
    const stream = await openSse(server.url, serverKey);
    await stream.waitFor((e) => e.event === 'put');
    const path = '/api/v1/projects/sched-project/flags/new-checkout/environments/production';
    const runAt = new Date(Date.now() + 1500).toISOString();
    const created = await api.json('POST', `${path}/schedules`, { runAt, change: { on: true } });
    expect(created.status).toBe(201);
    expect((await api.json('GET', path)).body.on).toBe(false);
    await stream.waitFor((e) => e.event === 'patch' && e.data.on === true, 15_000);
    const done = await until(
      () => api.json('GET', `${path}/schedules`),
      (r) => r.body[0].status === 'done',
    );
    expect(done.body[0]).toMatchObject({ status: 'done', change: { on: true } });
    expect(new Date(done.body[0].executedAt).getTime()).toBeGreaterThanOrEqual(new Date(runAt).getTime());
    const audit = await api.json('GET', '/api/v1/projects/sched-project/audit?flag=new-checkout');
    const executed = audit.body.find((e: { action: string }) => e.action === 'flag.schedule.executed');
    expect(executed.actor).toMatchObject({ type: 'system', label: expect.stringContaining('set by owner@example.com') });
    stream.close();
  });

  it('can set a rollout and can be cancelled before it runs', async () => {
    const path = `${state}/schedules`;
    const later = await api.json('POST', path, {
      runAt: new Date(Date.now() + 60_000).toISOString(),
      change: {
        fallthrough: {
          rollout: {
            variations: [
              { variation: 0, weight: 5000 },
              { variation: 1, weight: 5000 },
            ],
          },
        },
      },
    });
    expect(later.status).toBe(201);
    expect((await api.json('DELETE', `${path}/${later.body.id}`)).status).toBe(204);
    expect((await api.json('GET', path)).body.find((s: { id: string }) => s.id === later.body.id).status).toBe('cancelled');
    expect((await api.json('DELETE', `${path}/${later.body.id}`)).status).toBe(404);
  });

  it('refuses a time in the past and a change that does not fit the flag', async () => {
    const path = `${state}/schedules`;
    expect((await api.json('POST', path, { runAt: '2020-01-01T00:00:00Z', change: { on: true } })).status).toBe(400);
    const bad = await api.json('POST', path, {
      runAt: new Date(Date.now() + 60_000).toISOString(),
      change: { fallthrough: { variation: 9 } },
    });
    expect(bad.status).toBe(422);
    expect((await api.json('POST', path, { runAt: new Date(Date.now() + 60_000).toISOString(), change: {} })).status).toBe(422);
  });
});

describe('signed webhooks', () => {
  it('delivers a signed event that the SDK verifier accepts', async () => {
    const target = await receiver();
    try {
      const hook = await api.json('POST', '/api/v1/projects/demo-shop/webhooks', {
        name: 'ci',
        url: target.url,
        events: ['flag.state.updated'],
      });
      expect(hook.status).toBe(201);
      expect(hook.body.secret).toMatch(/^whsec_/);
      await updateState(api, state, { on: true });
      await until(
        async () => target.received.length,
        (n) => n >= 1,
      );
      const [delivery] = target.received;
      expect(delivery!.headers['content-type']).toBe('application/json');
      expect(delivery!.headers['flagken-event-type']).toBe('flag.state.updated');
      expect(delivery!.headers['flagken-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      const ok = await verifyWebhookSignature({
        secret: hook.body.secret,
        body: delivery!.body,
        header: delivery!.headers['flagken-signature'] as string,
      });
      expect(ok).toBe(true);
      const event = JSON.parse(delivery!.body);
      expect(event).toMatchObject({
        type: 'flag.state.updated',
        project: 'demo-shop',
        environment: 'production',
        resource: { type: 'flag', key: 'new-checkout' },
      });
      expect(event.before.on).toBe(false);
      expect(event.after.on).toBe(true);
      // A tampered body fails the same check.
      expect(
        await verifyWebhookSignature({
          secret: hook.body.secret,
          body: delivery!.body.replace('true', 'false'),
          header: delivery!.headers['flagken-signature'] as string,
        }),
      ).toBe(false);
      const log = await until(
        () => api.json('GET', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}/deliveries`),
        (r) => r.body.length >= 1,
      );
      expect(log.body[0]).toMatchObject({ ok: true, statusCode: 200, attempt: 1, eventType: 'flag.state.updated' });
      await api.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}`);
    } finally {
      await target.close();
    }
  });

  it('retries a failing receiver with back-off and logs every attempt', async () => {
    const target = await receiver([500, 503]);
    try {
      const hook = await api.json('POST', '/api/v1/projects/demo-shop/webhooks', { name: 'flaky', url: target.url, events: ['*'] });
      const started = Date.now();
      await api.json('PUT', `${state}/kill`, { killed: true });
      const log = await until(
        () => api.json('GET', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}/deliveries`),
        (r) => r.body.some((d: { ok: boolean }) => d.ok),
      );
      const attempts = [...log.body].reverse();
      expect(attempts.map((d: { attempt: number; statusCode: number; ok: boolean }) => [d.attempt, d.statusCode, d.ok])).toEqual([
        [1, 500, false],
        [2, 503, false],
        [3, 200, true],
      ]);
      // Back-off of 50 ms, then 100 ms (with up to 20% jitter) between attempts.
      expect(Date.now() - started).toBeGreaterThanOrEqual(120);
      const ids = new Set(target.received.map((r) => r.headers['flagken-event-id']));
      expect(ids.size).toBe(1);
      expect(target.received.map((r) => r.headers['flagken-delivery-attempt'])).toEqual(['1', '2', '3']);
      await api.json('PUT', `${state}/kill`, { killed: false });
      await api.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}`);
    } finally {
      await target.close();
    }
  });

  it('sends a test ping on request', async () => {
    const target = await receiver();
    try {
      const hook = await api.json('POST', '/api/v1/projects/demo-shop/webhooks', {
        name: 'ping',
        url: target.url,
        events: ['flag.created'],
      });
      const ping = await api.json('POST', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}/test`);
      expect(ping.status).toBe(202);
      await until(
        async () => target.received.length,
        (n) => n >= 1,
      );
      expect(target.received[0]!.headers['flagken-event-id']).toBe(ping.body.eventId);
      await api.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}`);
    } finally {
      await target.close();
    }
  });

  it('never stores or logs the webhook secret in the audit log', async () => {
    const hook = await api.json('POST', '/api/v1/projects/demo-shop/webhooks', {
      name: 'audit-check',
      url: 'http://hooks.test:9/x',
      events: ['*'],
    });
    const audit = await api.json('GET', '/api/v1/projects/demo-shop/audit?limit=200');
    expect(JSON.stringify(audit.body)).not.toContain(hook.body.secret);
    const list = await api.json('GET', '/api/v1/projects/demo-shop/webhooks');
    expect(JSON.stringify(list.body)).not.toContain(hook.body.secret);
    await api.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}`);
  });
});

describe('SSRF guard', () => {
  it('refuses private, loopback, link-local targets when the webhook is saved', async () => {
    const strict = await startServer(testConfig(databaseUrl));
    try {
      const owner = new Api(strict.url);
      await owner.login('owner@example.com');
      for (const url of [
        'http://127.0.0.1/x',
        'http://10.0.0.8/x',
        'http://169.254.169.254/latest/meta-data',
        'http://[::1]/x',
        'http://localhost/x',
        'http://[::ffff:192.168.0.1]/x',
        'ftp://example.com/x',
        'http://user:pw@example.com/x',
      ]) {
        const result = await owner.json('POST', '/api/v1/projects/demo-shop/webhooks', { name: 'x', url, events: ['*'] });
        expect(result.status, url).toBe(400);
      }
    } finally {
      await strict.close();
    }
  });

  it('accepts private targets when ALLOW_PRIVATE_TARGETS is on', async () => {
    const open = await startServer(testConfig(databaseUrl, { ALLOW_PRIVATE_TARGETS: 'true' }));
    try {
      const owner = new Api(open.url);
      await owner.login('owner@example.com');
      const result = await owner.json('POST', '/api/v1/projects/demo-shop/webhooks', {
        name: 'local',
        url: 'http://127.0.0.1:9/x',
        events: ['flag.killed'],
      });
      expect(result.status).toBe(201);
      await owner.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${result.body.id}`);
    } finally {
      await open.close();
    }
  });

  it('blocks at send time when DNS changes to a private address after the save, without retries', async () => {
    const target = await receiver();
    try {
      const hook = await api.json('POST', '/api/v1/projects/demo-shop/webhooks', {
        name: 'rebind',
        url: target.url,
        events: ['flag.killed'],
      });
      expect(hook.status).toBe(201);
      resolveTo = '10.1.2.3';
      await api.json('PUT', `${state}/kill`, { killed: true });
      const log = await until(
        () => api.json('GET', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}/deliveries`),
        (r) => r.body.length >= 1,
      );
      expect(log.body[0]).toMatchObject({ ok: false, statusCode: null, attempt: 1 });
      expect(log.body[0].error).toMatch(/10\.1\.2\.3.*private, local or reserved/);
      await new Promise((r) => setTimeout(r, 400));
      expect((await api.json('GET', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}/deliveries`)).body).toHaveLength(1);
      expect(target.received).toHaveLength(0);
      await api.json('PUT', `${state}/kill`, { killed: false });
      await api.json('DELETE', `/api/v1/projects/demo-shop/webhooks/${hook.body.id}`);
    } finally {
      resolveTo = '127.0.0.1';
      await target.close();
    }
  });
});
