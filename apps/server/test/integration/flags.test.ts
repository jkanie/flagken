import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffJson } from '@flagken/shared';
import { Api, createUser, freshDatabase, startServer, testConfig, updateState } from './harness.js';
import type { Running } from './harness.js';

let server: Running;
let api: Api;
const base = '/api/v1/projects/shop/flags';

beforeAll(async () => {
  const databaseUrl = await freshDatabase();
  server = await startServer(testConfig(databaseUrl));
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  api = new Api(server.url);
  await api.login('owner@example.com');
  await api.json('POST', '/api/v1/projects', { key: 'shop', name: 'Shop' });
});
afterAll(() => server.close());

describe('projects', () => {
  it('creates development, staging and production for a new project', async () => {
    const list = await api.json('GET', '/api/v1/projects');
    expect(list.body[0]).toEqual({
      key: 'shop',
      name: 'Shop',
      environments: [
        { key: 'development', name: 'Development' },
        { key: 'staging', name: 'Staging' },
        { key: 'production', name: 'Production' },
      ],
    });
    expect((await api.json('POST', '/api/v1/projects', { key: 'shop', name: 'Again' })).status).toBe(409);
    expect((await api.json('POST', '/api/v1/projects', { key: 'Bad Key', name: 'x' })).status).toBe(400);
  });
});

describe('flags', () => {
  it('creates a flag off in every environment, with the true variation as fallthrough', async () => {
    const created = await api.json('POST', base, {
      key: 'dark-mode',
      name: 'Dark mode',
      kind: 'boolean',
      variations: [{ value: false }, { value: true }],
      tags: ['ui'],
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"v1"');
    for (const environment of ['development', 'staging', 'production']) {
      const state = await api.json('GET', `${base}/dark-mode/environments/${environment}`);
      expect(state.body).toMatchObject({ on: false, killed: false, offVariation: 0, fallthrough: { variation: 1 }, version: 1 });
    }
    expect(
      (await api.json('POST', base, { key: 'dark-mode', name: 'Again', kind: 'boolean', variations: [{ value: false }, { value: true }] }))
        .status,
    ).toBe(409);
  });

  it('refuses variations that do not fit the kind, with every problem listed', async () => {
    const bad = await api.json('POST', base, { key: 'bad', name: 'Bad', kind: 'boolean', variations: [{ value: 'yes' }, { value: 'no' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toEqual(['variation 0 is string, the flag is boolean', 'variation 1 is string, the flag is boolean']);
    const extra = await api.json('POST', base, {
      key: 'bad2',
      name: 'Bad',
      kind: 'string',
      variations: [{ value: 'a' }, { value: 'b' }],
      secret: 1,
    });
    expect(extra.status).toBe(400);
  });

  it('lists flags per environment with a search over key, name and description', async () => {
    await api.json('POST', base, {
      key: 'search-ranking',
      name: 'Search ranking',
      description: 'semantic search',
      kind: 'string',
      variations: [{ value: 'a' }, { value: 'b' }],
    });
    const all = await api.json('GET', `${base}?environment=production`);
    expect(all.body.map((f: { key: string }) => f.key)).toEqual(['dark-mode', 'search-ranking']);
    const hits = await api.json('GET', `${base}?environment=production&q=SEMANTIC`);
    expect(hits.body.map((f: { key: string }) => f.key)).toEqual(['search-ranking']);
    // % and _ are plain characters in the search, not wildcards.
    expect((await api.json('GET', `${base}?environment=production&q=%25`)).body).toEqual([]);
    expect((await api.json('GET', `${base}?environment=nowhere`)).status).toBe(404);
  });
});

describe('edit conflicts (ETag and If-Match)', () => {
  const path = `${base}/dark-mode/environments/production`;

  it('needs If-Match: 428 without it', async () => {
    const current = await api.json('GET', path);
    const { environment: _e, killed: _k, version: _v, updatedAt: _u, ...body } = current.body;
    expect((await api.json('PUT', path, body)).status).toBe(428);
  });

  it('gives 412 to a save based on an old read', async () => {
    const first = await api.json('GET', path);
    const etag = first.headers.get('etag')!;
    const { environment: _e, killed: _k, version: _v, updatedAt: _u, ...body } = first.body;
    const saved = await api.json('PUT', path, { ...body, on: true }, { 'if-match': etag });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('etag')).toBe(`"v${first.body.version + 1}"`);
    const stale = await api.json('PUT', path, { ...body, on: false }, { 'if-match': etag });
    expect(stale.status).toBe(412);
    expect((await api.json('GET', path)).body.on).toBe(true);
  });

  it('lets exactly 1 of 2 parallel saves with the same ETag through', async () => {
    const current = await api.json('GET', path);
    const etag = current.headers.get('etag')!;
    const { environment: _e, killed: _k, version: _v, updatedAt: _u, ...body } = current.body;
    const results = await Promise.all([
      api.json('PUT', path, { ...body, offVariation: 0 }, { 'if-match': etag }),
      api.json('PUT', path, { ...body, offVariation: 1 }, { 'if-match': etag }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  });

  it('checks the flag metadata version the same way', async () => {
    const flag = await api.json('GET', `${base}/dark-mode`);
    const body = { name: 'Dark mode 2', description: '', variations: flag.body.variations, tags: [] };
    expect((await api.json('PUT', `${base}/dark-mode`, body, { 'if-match': '"v999"' })).status).toBe(412);
    const ok = await api.json('PUT', `${base}/dark-mode`, body, { 'if-match': flag.headers.get('etag')! });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(flag.body.version + 1);
  });
});

describe('targeting', () => {
  const path = `${base}/search-ranking/environments/staging`;

  it('saves rules, targets, a rollout, refuses weights that do not add up', async () => {
    const saved = await updateState(api, path, {
      on: true,
      targets: [{ variation: 1, values: ['u_7f3a9c'] }],
      rules: [{ id: 'ca', clauses: [{ attribute: 'country', op: 'in', values: ['CA'] }], serve: { variation: 1 } }],
      fallthrough: {
        rollout: {
          variations: [
            { variation: 0, weight: 7500 },
            { variation: 1, weight: 2500 },
          ],
        },
      },
    });
    expect(saved.status).toBe(200);
    const bad = await updateState(api, path, {
      fallthrough: {
        rollout: {
          variations: [
            { variation: 0, weight: 50 },
            { variation: 1, weight: 50 },
          ],
        },
      },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.message).toEqual(['fallthrough: weights add up to 100, they must add up to 10000']);
    const shape = await updateState(api, path, {
      rules: [{ id: 'x', clauses: [{ attribute: 'a', op: 'regex', values: ['.*'] }], serve: { variation: 0 } }],
    });
    expect(shape.status).toBe(422);
    expect(shape.body.message[0]).toMatch(/op must be one of/);
  });

  it('refuses a variation change that would leave a rule pointing at a missing variation', async () => {
    const flag = await api.json('GET', `${base}/search-ranking`);
    const result = await api.json(
      'PUT',
      `${base}/search-ranking`,
      { name: 'Search ranking', description: '', variations: [{ value: 'a' }], tags: [] },
      { 'if-match': flag.headers.get('etag')! },
    );
    expect(result.status).toBe(422);
  });
});

describe('kill switch and archive', () => {
  it('kills without If-Match, keeps the rules, restores them on unkill', async () => {
    const path = `${base}/search-ranking/environments/staging`;
    const before = await api.json('GET', path);
    const killed = await api.json('PUT', `${path}/kill`, { killed: true });
    expect(killed.status).toBe(200);
    expect(killed.body).toMatchObject({ killed: true, on: true, rules: before.body.rules });
    const restored = await api.json('PUT', `${path}/kill`, { killed: false });
    expect(restored.body).toMatchObject({ killed: false, on: true, rules: before.body.rules });
  });

  it('archives a flag: it leaves the list and refuses changes', async () => {
    await api.json('POST', base, { key: 'old-flag', name: 'Old', kind: 'boolean', variations: [{ value: false }, { value: true }] });
    expect((await api.json('DELETE', `${base}/old-flag`)).status).toBe(204);
    const list = await api.json('GET', `${base}?environment=production`);
    expect(list.body.map((f: { key: string }) => f.key)).not.toContain('old-flag');
    expect((await api.json('PUT', `${base}/old-flag/environments/production/kill`, { killed: true })).status).toBe(409);
  });
});

describe('audit log (interceptor)', () => {
  it('records who, when, which environment, the state before, the state after', async () => {
    const audit = await api.json('GET', '/api/v1/projects/shop/audit?flag=dark-mode&environment=production&limit=50');
    expect(audit.status).toBe(200);
    const entry = audit.body.find(
      (e: { action: string; before: { on: boolean }; after: { on: boolean } }) =>
        e.action === 'flag.state.updated' && e.before.on === false && e.after.on === true,
    );
    expect(entry).toMatchObject({
      actor: { type: 'user', label: 'owner@example.com' },
      environment: 'production',
      resourceType: 'flag',
      resourceKey: 'dark-mode',
    });
    expect(new Date(entry.at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(diffJson(entry.before, entry.after)).toContainEqual({ path: '/on', kind: 'changed', before: false, after: true });
  });

  it('writes nothing for a refused change', async () => {
    const before = await api.json('GET', '/api/v1/projects/shop/audit?limit=200');
    await api.json('POST', base, { key: 'bad', name: 'Bad', kind: 'boolean', variations: [{ value: 1 }, { value: 2 }] });
    const after = await api.json('GET', '/api/v1/projects/shop/audit?limit=200');
    expect(after.body.length).toBe(before.body.length);
  });

  it('pages with before and checks its query', async () => {
    const page1 = await api.json('GET', '/api/v1/projects/shop/audit?limit=2');
    expect(page1.body).toHaveLength(2);
    const page2 = await api.json('GET', `/api/v1/projects/shop/audit?limit=2&before=${page1.body[1].id}`);
    expect(Number(page2.body[0].id)).toBeLessThan(Number(page1.body[1].id));
    expect((await api.json('GET', '/api/v1/projects/shop/audit?limit=999')).status).toBe(400);
    expect((await api.json('GET', '/api/v1/projects/shop/audit?before=1;drop')).status).toBe(400);
  });
});
