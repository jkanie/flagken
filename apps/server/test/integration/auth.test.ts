import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, PASSWORD, createUser, freshDatabase, setupProject, startServer, testConfig } from './harness.js';
import type { Running } from './harness.js';

let server: Running;
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await freshDatabase();
  server = await startServer(testConfig(databaseUrl));
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  await createUser(databaseUrl, 'editor@example.com', 'editor');
  await createUser(databaseUrl, 'viewer@example.com', 'viewer');
});
afterAll(() => server.close());

describe('sign-in', () => {
  it('sets an HttpOnly, SameSite=Strict session cookie and answers /me', async () => {
    const api = new Api(server.url);
    const response = await api.login('owner@example.com');
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^flagken_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const me = await api.json('GET', '/api/v1/auth/me');
    expect(me.body).toMatchObject({ email: 'owner@example.com', role: 'owner' });
  });

  it('refuses a wrong password and an unknown e-mail with the same message', async () => {
    const a = await new Api(server.url).json('POST', '/api/v1/auth/login', { email: 'editor@example.com', password: 'wrong-password-123' });
    const b = await new Api(server.url).json('POST', '/api/v1/auth/login', { email: 'nobody@example.com', password: 'wrong-password-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('refuses requests without a session and with a forged token', async () => {
    expect((await new Api(server.url).json('GET', '/api/v1/projects')).status).toBe(401);
    const forged = new Api(server.url);
    forged.cookie = 'flagken_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad';
    expect((await forged.json('GET', '/api/v1/projects')).status).toBe(401);
  });

  it('ends the session on logout', async () => {
    const api = new Api(server.url);
    await api.login('viewer@example.com');
    const out = await api.request('POST', '/api/v1/auth/logout');
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/flagken_session=;/);
  });

  it('has no public sign-up route', async () => {
    expect((await new Api(server.url).json('POST', '/api/v1/auth/register', { email: 'a@b.c', password: 'x'.repeat(20) })).status).toBe(
      404,
    );
    expect(
      (await new Api(server.url).json('POST', '/api/v1/users', { email: 'a@b.c', password: 'x'.repeat(20), role: 'owner' })).status,
    ).toBe(401);
  });

  it('limits login attempts per minute, and only on the login route', async () => {
    const limited = await startServer(testConfig(databaseUrl, { LOGIN_RATE_LIMIT_PER_MINUTE: '5' }));
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push(
          (await new Api(limited.url).json('POST', '/api/v1/auth/login', { email: 'limit@example.com', password: 'wrong-password-123' }))
            .status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
      const limitedResponse = await new Api(limited.url).request('POST', '/api/v1/auth/login', {
        email: 'x@example.com',
        password: 'y'.repeat(12),
      });
      // Named throttlers add their name to the header.
      expect(Number(limitedResponse.headers.get('retry-after-login'))).toBeGreaterThan(0);
      // Other routes keep the general limit.
      expect((await fetch(`${limited.url}/health/live`)).status).toBe(200);
      expect((await new Api(limited.url).json('GET', '/api/v1/projects')).status).toBe(401);
    } finally {
      await limited.close();
    }
  });
});

describe('roles', () => {
  it('lets each role do what it should, and no more', async () => {
    const owner = new Api(server.url);
    await owner.login('owner@example.com');
    await setupProject(owner, 'roles-project');
    const editor = new Api(server.url);
    await editor.login('editor@example.com');
    const viewer = new Api(server.url);
    await viewer.login('viewer@example.com');

    const flag = { key: 'f1', name: 'F1', kind: 'boolean', variations: [{ value: false }, { value: true }] };
    expect((await viewer.json('GET', '/api/v1/projects/roles-project/flags?environment=production')).status).toBe(200);
    expect((await viewer.json('POST', '/api/v1/projects/roles-project/flags', flag)).status).toBe(403);
    expect((await editor.json('POST', '/api/v1/projects/roles-project/flags', flag)).status).toBe(201);
    expect((await editor.json('GET', '/api/v1/projects/roles-project/environments/production/api-keys')).status).toBe(403);
    expect((await editor.json('GET', '/api/v1/projects/roles-project/webhooks')).status).toBe(403);
    expect((await editor.json('GET', '/api/v1/users')).status).toBe(403);
    expect((await owner.json('GET', '/api/v1/users')).status).toBe(200);
  });

  it('applies a demotion at once and keeps 1 owner', async () => {
    const owner = new Api(server.url);
    await owner.login('owner@example.com');
    const created = await owner.json('POST', '/api/v1/users', { email: 'temp@example.com', password: PASSWORD, role: 'editor' });
    expect(created.status).toBe(201);
    const temp = new Api(server.url);
    await temp.login('temp@example.com');
    expect(
      (
        await temp.json('POST', '/api/v1/projects/roles-project/flags', {
          key: 'f2',
          name: 'F2',
          kind: 'boolean',
          variations: [{ value: false }, { value: true }],
        })
      ).status,
    ).toBe(201);
    await owner.json('PATCH', `/api/v1/users/${created.body.id}`, { role: 'viewer' });
    expect(
      (
        await temp.json('POST', '/api/v1/projects/roles-project/flags', {
          key: 'f3',
          name: 'F3',
          kind: 'boolean',
          variations: [{ value: false }, { value: true }],
        })
      ).status,
    ).toBe(403);
    await owner.json('PATCH', `/api/v1/users/${created.body.id}`, { disabled: true });
    expect((await temp.json('GET', '/api/v1/auth/me')).status).toBe(401);
    const me = await owner.json('GET', '/api/v1/auth/me');
    expect((await owner.json('PATCH', `/api/v1/users/${me.body.id}`, { role: 'viewer' })).status).toBe(400);
  });

  it('refuses short passwords and duplicate e-mail addresses', async () => {
    const owner = new Api(server.url);
    await owner.login('owner@example.com');
    expect((await owner.json('POST', '/api/v1/users', { email: 'short@example.com', password: 'short', role: 'viewer' })).status).toBe(400);
    expect((await owner.json('POST', '/api/v1/users', { email: 'EDITOR@example.com', password: PASSWORD, role: 'viewer' })).status).toBe(
      409,
    );
  });
});

describe('API keys', () => {
  it('shows a key once, stores only its hash, keeps it out of the audit log, stops it on revoke', async () => {
    const owner = new Api(server.url);
    await owner.login('owner@example.com');
    const { serverKey, serverKeyId } = await setupProject(owner, 'keys-project');
    expect(serverKey).toMatch(/^fk_srv_[A-Za-z0-9_-]{43}$/);
    const listed = await owner.json('GET', '/api/v1/projects/keys-project/environments/production/api-keys');
    expect(JSON.stringify(listed.body)).not.toContain(serverKey);
    const audit = await owner.json('GET', '/api/v1/projects/keys-project/audit');
    expect(JSON.stringify(audit.body)).not.toContain(serverKey);
    expect(audit.body.some((e: { action: string }) => e.action === 'api-key.created')).toBe(true);

    const sdk = (key: string) => fetch(`${server.url}/sdk/v1/flags`, { headers: { authorization: `Bearer ${key}` } });
    expect((await sdk(serverKey)).status).toBe(200);
    await owner.json('DELETE', `/api/v1/projects/keys-project/environments/production/api-keys/${serverKeyId}`);
    expect((await sdk(serverKey)).status).toBe(401);
  });
});

describe('create-admin command', () => {
  it('creates an owner from ADMIN_EMAIL and ADMIN_PASSWORD', async () => {
    const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [cli, 'create-admin'], {
      env: { ...process.env, DATABASE_URL: databaseUrl, ADMIN_EMAIL: 'Admin@Example.com', ADMIN_PASSWORD: 'made-up-admin-password' },
    });
    expect(stdout.trim()).toBe('created owner admin@example.com');
    const api = new Api(server.url);
    expect((await api.login('admin@example.com', 'made-up-admin-password')).status).toBe(200);
    expect((await api.json('GET', '/api/v1/auth/me')).body.role).toBe('owner');
  });

  it('refuses a short password', async () => {
    const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
    await expect(
      promisify(execFile)(process.execPath, [cli, 'create-admin'], {
        env: { ...process.env, DATABASE_URL: databaseUrl, ADMIN_EMAIL: 'x@example.com', ADMIN_PASSWORD: 'short' },
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('ADMIN_PASSWORD needs at least 12 characters') });
  });
});
