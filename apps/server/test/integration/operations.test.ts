import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, consoleSocket, createUser, freshDatabase, openSse, openWs, setupProject, startServer, testConfig } from './harness.js';
import type { Running } from './harness.js';

let server: Running;
let api: Api;
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await freshDatabase();
  server = await startServer(
    testConfig(databaseUrl, { CORS_ORIGINS: 'https://console.example.com', METRICS_TOKEN: 'made-up-metrics-token' }),
  );
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  api = new Api(server.url);
  await api.login('owner@example.com');
});
afterAll(() => server.close());

describe('health checks (terminus)', () => {
  it('reports PostgreSQL and Redis on /health/ready', async () => {
    const response = await fetch(`${server.url}/health/ready`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.status).toBe('ok');
    expect(body.info.postgres.status).toBe('up');
    expect(body.info.redis.status).toBe('up');
  });

  it('answers /health/live without touching dependencies', async () => {
    expect((await fetch(`${server.url}/health/live`)).status).toBe(200);
  });
});

describe('metrics', () => {
  it('needs the metrics token when one is set and serves Prometheus text', async () => {
    expect((await fetch(`${server.url}/metrics`)).status).toBe(401);
    expect((await fetch(`${server.url}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    const response = await fetch(`${server.url}/metrics`, { headers: { authorization: 'Bearer made-up-metrics-token' } });
    expect(response.headers.get('content-type')).toMatch(/^text\/plain; version=0\.0\.4/);
    const text = await response.text();
    for (const name of [
      'flagken_flag_evaluations_total',
      'flagken_connected_clients',
      'flagken_webhook_deliveries_total',
      'flagken_process_cpu_seconds_total',
    ]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
  });

  it('counts connected SSE and WebSocket clients', async () => {
    const { serverKey } = await setupProject(api, 'metrics-project');
    const stream = await openSse(server.url, serverKey);
    await stream.waitFor((e) => e.event === 'put');
    const ws = await consoleSocket(server.url, api.cookie, 'metrics-project');
    const text = await (await fetch(`${server.url}/metrics`, { headers: { authorization: 'Bearer made-up-metrics-token' } })).text();
    expect(text).toContain('flagken_connected_clients{transport="sse"} 1');
    expect(text).toContain('flagken_connected_clients{transport="websocket"} 1');
    stream.close();
    ws.socket.close();
  });
});

describe('HTTP safety settings', () => {
  it('sends helmet security headers and a request id', async () => {
    const response = await fetch(`${server.url}/health/live`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows CORS for configured origins only', async () => {
    const allowed = await fetch(`${server.url}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://console.example.com', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://console.example.com');
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
    const other = await fetch(`${server.url}/api/v1/projects`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('accepts JSON bodies only, so a cross-site form cannot post', async () => {
    const response = await fetch(`${server.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=owner%40example.com&password=made-up-test-password',
    });
    expect(response.status).toBe(400);
  });

  it('serves the OpenAPI document', async () => {
    const response = await fetch(`${server.url}/docs/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as any;
    expect(document.info.title).toBe('flagken');
    expect(Object.keys(document.paths)).toContain('/sdk/v1/stream');
  });
});

describe('console WebSocket', () => {
  it('closes a socket without a session with 4401', async () => {
    const ws = await openWs(server.url, '');
    expect((await ws.closed).code).toBe(4401);
  });

  it('closes a socket from a foreign origin with 4403', async () => {
    const ws = await openWs(server.url, api.cookie, 'https://evil.example');
    expect((await ws.closed).code).toBe(4403);
  });

  it('accepts a configured origin and refuses a subscription to a bad key', async () => {
    const ws = await openWs(server.url, api.cookie, 'https://console.example.com');
    await ws.waitFor((m) => m.event === 'ready');
    ws.socket.send(JSON.stringify({ event: 'subscribe', data: { project: '../../etc' } }));
    expect((await ws.waitFor((m) => m.event === 'error')).data.message).toBe('cannot subscribe');
    ws.socket.close();
  });
});

describe('clean shutdown', () => {
  it('ends SSE streams, closes WebSockets with 1001 and stops within 5 seconds', async () => {
    const own = await startServer(testConfig(databaseUrl));
    const owner = new Api(own.url);
    await owner.login('owner@example.com');
    const { serverKey } = await setupProject(owner, 'shutdown-project');
    const stream = await openSse(own.url, serverKey);
    await stream.waitFor((e) => e.event === 'put');
    const ws = await consoleSocket(own.url, owner.cookie, 'shutdown-project');
    const started = Date.now();
    await own.close();
    await stream.ended;
    expect((await ws.closed).code).toBe(1001);
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(fetch(`${own.url}/health/live`)).rejects.toThrow();
  });
});
