import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { inject } from 'vitest';
import WebSocket from 'ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SseParser } from '@flagken/sdk';
import { createApp } from '../../src/app.factory.js';
import type { AppOptions } from '../../src/app.module.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import { createDatabase } from '../../src/db/database.js';
import { UsersService } from '../../src/auth/users.service.js';
import type { Role } from '@flagken/shared';

export const PASSWORD = 'made-up-test-password';

/** A new, empty database on the test server, so each test file starts clean. */
export async function freshDatabase(): Promise<string> {
  const admin = inject('databaseUrl');
  const name = `flagken_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`create database ${name}`);
  await client.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return url.toString();
}

export function testConfig(
  databaseUrl: string,
  overrides: Record<string, string> = {},
  prefix = `t${randomBytes(4).toString('hex')}`,
): Config {
  return loadConfig({
    DATABASE_URL: databaseUrl,
    REDIS_URL: inject('redisUrl'),
    REDIS_PREFIX: prefix,
    SESSION_SECRET: 'made-up-test-session-secret-0123456789',
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'error',
    RATE_LIMIT_PER_MINUTE: '100000',
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    WEBHOOK_BACKOFF_MS: '50',
    WEBHOOK_TIMEOUT_MS: '2000',
    SSE_HEARTBEAT_MS: '1000',
    ...overrides,
  });
}

export interface Running {
  app: NestExpressApplication;
  url: string;
  config: Config;
  close(): Promise<void>;
}

export async function startServer(config: Config, options: AppOptions = {}): Promise<Running> {
  const app = await createApp(config, options);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  let closed = false;
  return {
    app,
    url: `http://127.0.0.1:${port}`,
    config,
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
    },
  };
}

export async function createUser(databaseUrl: string, email: string, role: Role): Promise<void> {
  const db = createDatabase(databaseUrl, 1);
  try {
    if (role === 'owner') {
      await new UsersService(db).upsertOwner(email, PASSWORD);
    } else {
      await new UsersService(db).upsertOwner(email, PASSWORD);
      await db.updateTable('users').set({ role }).where('email', '=', email).execute();
    }
  } finally {
    await db.destroy();
  }
}

/** A tiny HTTP client that keeps the session cookie. */
export class Api {
  cookie = '';
  constructor(readonly base: string) {}

  async login(email: string, password = PASSWORD): Promise<Response> {
    const response = await this.request('POST', '/api/v1/auth/login', { email, password });
    const set = response.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return response;
  }

  request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(this.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async json<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const response = await this.request(method, path, body, headers);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T, headers: response.headers };
  }
}

/** Creates a project, a flag, 2 API keys: the common start of many tests. */
export async function setupProject(api: Api, project = 'demo-shop') {
  await api.json('POST', '/api/v1/projects', { key: project, name: 'Demo Shop' });
  const flag = await api.json('POST', `/api/v1/projects/${project}/flags`, {
    key: 'new-checkout',
    name: 'New checkout',
    kind: 'boolean',
    variations: [{ value: false }, { value: true }],
  });
  if (flag.status !== 201) throw new Error(`flag create failed: ${JSON.stringify(flag.body)}`);
  const server = await api.json('POST', `/api/v1/projects/${project}/environments/production/api-keys`, {
    name: 'backend',
    kind: 'server',
  });
  const client = await api.json('POST', `/api/v1/projects/${project}/environments/production/api-keys`, { name: 'web', kind: 'client' });
  return {
    serverKey: server.body.key as string,
    clientKey: client.body.key as string,
    clientKeyId: client.body.id as string,
    serverKeyId: server.body.id as string,
  };
}

/** Reads the flag state and saves a change with its ETag. */
export async function updateState(api: Api, path: string, change: Record<string, unknown>) {
  const current = await api.json('GET', path);
  const { environment: _e, killed: _k, version: _v, updatedAt: _u, ...body } = current.body;
  return api.json('PUT', path, { ...body, ...change }, { 'if-match': current.headers.get('etag')! });
}

export interface SseClient {
  events: Array<{ event: string; data: any }>;
  ended: Promise<void>;
  waitFor(check: (event: { event: string; data: any }) => boolean, timeoutMs?: number): Promise<{ event: string; data: any }>;
  close(): void;
}

export async function openSse(base: string, key: string, context?: unknown): Promise<SseClient> {
  const abort = new AbortController();
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'text/event-stream' };
  if (context) headers['x-flagken-context'] = Buffer.from(JSON.stringify(context)).toString('base64url');
  const response = await fetch(`${base}/sdk/v1/stream`, { headers, signal: abort.signal });
  if (response.status !== 200) throw new Error(`stream answered ${response.status}: ${await response.text()}`);
  const events: SseClient['events'] = [];
  const waiters = new Set<() => void>();
  const parser = new SseParser();
  const ended = (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const m of parser.push(value)) {
          events.push({ event: m.event, data: JSON.parse(m.data) });
          for (const w of waiters) w();
        }
      }
    } catch {
      // aborted
    }
  })();
  return {
    events,
    ended,
    close: () => abort.abort(),
    waitFor: (check, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const found = () => events.find(check);
        const hit = found();
        if (hit) return resolve(hit);
        const timer = setTimeout(() => {
          waiters.delete(tryIt);
          reject(new Error(`no matching SSE event in ${timeoutMs} ms, got ${JSON.stringify(events.map((e) => e.event))}`));
        }, timeoutMs);
        function tryIt() {
          const match = found();
          if (match) {
            clearTimeout(timer);
            waiters.delete(tryIt);
            resolve(match);
          }
        }
        waiters.add(tryIt);
      }),
  };
}

export interface WsClient {
  socket: WebSocket;
  messages: Array<{ event: string; data: any }>;
  closed: Promise<{ code: number; reason: string }>;
  waitFor(check: (m: { event: string; data: any }) => boolean, timeoutMs?: number): Promise<{ event: string; data: any }>;
}

export function openWs(base: string, cookie: string, origin?: string): Promise<WsClient> {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie, ...(origin ? { origin } : {}) } });
  const messages: WsClient['messages'] = [];
  const waiters = new Set<() => void>();
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    for (const w of waiters) w();
  });
  const client: WsClient = {
    socket,
    messages,
    closed,
    waitFor: (check, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const hit = messages.find(check);
        if (hit) return resolve(hit);
        const timer = setTimeout(
          () => reject(new Error(`no matching WebSocket message, got ${JSON.stringify(messages.map((m) => m.event))}`)),
          timeoutMs,
        );
        const tryIt = () => {
          const match = messages.find(check);
          if (match) {
            clearTimeout(timer);
            waiters.delete(tryIt);
            resolve(match);
          }
        };
        waiters.add(tryIt);
      }),
  };
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(client));
    socket.once('error', reject);
  });
}

/** Opens a console socket, waits for ready, subscribes to a project. */
export async function consoleSocket(base: string, cookie: string, project: string): Promise<WsClient> {
  const ws = await openWs(base, cookie);
  await ws.waitFor((m) => m.event === 'ready');
  ws.socket.send(JSON.stringify({ event: 'subscribe', data: { project } }));
  await ws.waitFor((m) => m.event === 'subscribed');
  return ws;
}
