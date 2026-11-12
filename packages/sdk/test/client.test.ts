import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FlagkenClient, localStorageStore, memoryStore } from '../src/index.js';
import { fileStore } from '../src/node.js';
import type { Snapshot } from '../src/index.js';
import { CLIENT_KEY, FakeStream, SERVER_KEY, fakeFetch, flag, waitFor } from './helpers.js';

const clients: FlagkenClient[] = [];
function track(client: FlagkenClient): FlagkenClient {
  clients.push(client);
  return client;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const fast = { backoff: { initialMs: 10, maxMs: 40 }, startTimeoutMs: 300 };

describe('server mode', () => {
  it('evaluates locally from put, then follows patch and delete', async () => {
    const stream = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => new Response(stream.body, { headers: { 'content-type': 'text/event-stream' } })]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test/', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const changes: string[] = [];
    client.on('change', (c) => changes.push(c.key));
    const started = client.start();
    stream.send('put', { environment: 'production', flags: [flag('new-checkout', { on: false })] });
    await started;

    expect(calls[0]!.url).toBe('http://flags.test/sdk/v1/stream');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SERVER_KEY}`);
    expect(client.status).toBe('live');
    expect(client.environmentKey).toBe('production');
    expect(client.variation('new-checkout', true, { key: 'u_1' })).toBe(false);

    stream.send('patch', flag('new-checkout', { version: 2, on: true }));
    await waitFor(() => client.variation('new-checkout', false, { key: 'u_1' }) === true);

    // An older patch that arrives late is ignored.
    stream.send('patch', flag('new-checkout', { version: 1, on: false }));
    stream.send('delete', { key: 'new-checkout', version: 3 });
    await waitFor(() => client.allFlags().length === 0);
    expect(changes).toEqual(['new-checkout', 'new-checkout', 'new-checkout']);
    expect(client.variationDetail('new-checkout', false, { key: 'u_1' }).reason).toEqual({ kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' });
  });

  it('returns the fallback when the value has another type', async () => {
    const stream = new FakeStream();
    const { fetcher } = fakeFetch([() => new Response(stream.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const started = client.start();
    stream.send('put', { environment: 'dev', flags: [flag('x')] });
    await started;
    expect(client.variation('x', 'text', { key: 'u_1' })).toBe('text');
  });

  it('watch calls back only when the value for the context changes', async () => {
    const stream = new FakeStream();
    const { fetcher } = fakeFetch([() => new Response(stream.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const started = client.start();
    stream.send('put', { environment: 'production', flags: [flag('new-checkout'), flag('other')] });
    await started;

    const seen: boolean[] = [];
    const stop = client.watch('new-checkout', false, (value) => seen.push(value), { key: 'u_1', country: 'CA' });
    // A rule for another country leaves u_1 on the fall-through (true): no call.
    stream.send(
      'patch',
      flag('new-checkout', {
        version: 2,
        rules: [{ id: 'us', clauses: [{ attribute: 'country', op: 'in', values: ['US'] }], serve: { variation: 0 } }],
      }),
    );
    // Another flag changes: no call.
    stream.send('patch', flag('other', { version: 2, on: false }));
    // A target for u_1 serves false: 1 call.
    stream.send('patch', flag('new-checkout', { version: 3, targets: [{ variation: 0, values: ['u_1'] }] }));
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([false]);

    // The flag is removed: the fall-back (false) is what u_1 already had, so no call.
    stream.send('delete', { key: 'new-checkout', version: 4 });
    await waitFor(() => client.allFlags().length === 1);
    stream.send('patch', flag('new-checkout', { version: 5 }));
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual([false, true]);

    stop();
    stream.send('patch', flag('new-checkout', { version: 6, on: false }));
    await waitFor(() => client.variation('new-checkout', true, { key: 'u_1' }) === false);
    expect(seen).toEqual([false, true]);
  });

  it('allValues evaluates every flag for 1 context, in key order', async () => {
    const stream = new FakeStream();
    const { fetcher } = fakeFetch([() => new Response(stream.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const started = client.start();
    stream.send('put', {
      environment: 'production',
      flags: [
        flag('new-checkout', { targets: [{ variation: 0, values: ['u_1'] }] }),
        flag('a-off', { on: false }),
        flag('broken', { fallthrough: { variation: 7 } }),
      ],
    });
    await started;
    expect(Object.keys(client.allValues({ key: 'u_1' }))).toEqual(['a-off', 'new-checkout']);
    expect(client.allValues({ key: 'u_1' })).toEqual({ 'a-off': false, 'new-checkout': false });
    expect(client.allValues({ key: 'u_2' })).toEqual({ 'a-off': false, 'new-checkout': true });
    expect(() => client.allValues()).toThrow('server mode needs a context for allValues');
  });

  it('watchAll calls back once per change of the values for the context', async () => {
    const stream = new FakeStream();
    const { fetcher } = fakeFetch([() => new Response(stream.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const started = client.start();
    stream.send('put', { environment: 'production', flags: [flag('new-checkout'), flag('other')] });
    await started;

    const seen: Record<string, unknown>[] = [];
    const stop = client.watchAll((values) => seen.push(values), { key: 'u_1', country: 'CA' });
    // A rule for another country leaves both values as they were: no call.
    stream.send(
      'patch',
      flag('other', {
        version: 2,
        rules: [{ id: 'us', clauses: [{ attribute: 'country', op: 'in', values: ['US'] }], serve: { variation: 0 } }],
      }),
    );
    stream.send('patch', flag('other', { version: 3, on: false }));
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ 'new-checkout': true, other: false }]);

    // A new snap-shot that changes both flags and adds 1 makes 1 call.
    stream.send('put', {
      environment: 'production',
      flags: [flag('new-checkout', { version: 9, on: false }), flag('other', { version: 9 }), flag('added')],
    });
    await waitFor(() => seen.length === 2);
    expect(seen[1]).toEqual({ added: true, 'new-checkout': false, other: true });

    // A removed flag drops out of the values.
    stream.send('delete', { key: 'added', version: 10 });
    await waitFor(() => seen.length === 3);
    expect(seen[2]).toEqual({ 'new-checkout': false, other: true });

    stop();
    stream.send('patch', flag('other', { version: 11, on: false }));
    await waitFor(() => client.variation('other', true, { key: 'u_1' }) === false);
    expect(seen).toHaveLength(3);
    expect(() => client.watchAll(() => {})).toThrow('server mode needs a context to watch flags');
  });

  it('waitForStatus resolves on the status, or false after the time-out', async () => {
    const stream = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => Promise.reject(new TypeError('connect ECONNREFUSED')), () => new Response(stream.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    client.on('error', () => {});
    expect(client.status).toBe('idle');
    await expect(client.waitForStatus('idle', 0)).resolves.toBe(true);
    await expect(client.waitForStatus('live', 20)).resolves.toBe(false);
    expect(() => client.waitForStatus('live', -1)).toThrow(RangeError);
    expect(() => client.waitForStatus('live', Number.NaN)).toThrow(RangeError);

    const live = client.waitForStatus('live', 5000);
    // A status on the way, such as offline after the 1st failed connect, does not end the wait.
    const offline = client.waitForStatus('offline', 5000);
    await client.start();
    await expect(offline).resolves.toBe(true);
    await waitFor(() => calls.length === 2);
    stream.send('put', { environment: 'production', flags: [flag('new-checkout')] });
    await expect(live).resolves.toBe(true);
    await expect(client.waitForStatus('live', 0)).resolves.toBe(true);
  });

  it('watch in server mode needs a context', () => {
    const client = new FlagkenClient({ baseUrl: 'http://x', apiKey: SERVER_KEY });
    expect(() => client.watch('new-checkout', false, () => {})).toThrow('server mode needs a context to watch a flag');
  });

  it('refuses keys that are not flagken keys', () => {
    expect(() => new FlagkenClient({ baseUrl: 'http://x', apiKey: 'secret' })).toThrow(/fk_srv_/);
  });
});

describe('client mode', () => {
  it('sends the context in a header, never in the URL, then serves evaluated values', async () => {
    const stream = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => new Response(stream.body)]);
    const client = track(
      new FlagkenClient({
        baseUrl: 'http://flags.test',
        apiKey: CLIENT_KEY,
        context: { key: 'u_7f3a9c', country: 'CA' },
        fetch: fetcher,
        ...fast,
      }),
    );
    const started = client.start();
    stream.send('put', {
      environment: 'production',
      flags: [{ key: 'search-ranking', value: 'semantic', variation: 1, version: 3, reason: { kind: 'RULE_MATCH', ruleId: 'ca' } }],
    });
    await started;
    expect(calls[0]!.url).toBe('http://flags.test/sdk/v1/stream');
    const header = calls[0]!.headers['x-flagken-context']!;
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ key: 'u_7f3a9c', attributes: { country: 'CA' } });
    expect(client.variation('search-ranking', 'classic')).toBe('semantic');
    expect(client.variationDetail('search-ranking', 'classic').reason.kind).toBe('RULE_MATCH');
  });

  it('needs a context', () => {
    expect(() => new FlagkenClient({ baseUrl: 'http://x', apiKey: CLIENT_KEY })).toThrow(/context/);
  });

  it('reconnects with the new context after identify()', async () => {
    const first = new FakeStream();
    const second = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => new Response(first.body), () => new Response(second.body)]);
    const client = track(
      new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: CLIENT_KEY, context: { key: 'u_1' }, fetch: fetcher, ...fast }),
    );
    const started = client.start();
    first.send('put', { environment: 'dev', flags: [{ key: 'f', value: 1, variation: 0, version: 1, reason: { kind: 'FALLTHROUGH' } }] });
    await started;
    const identified = client.identify({ key: 'u_2' });
    await waitFor(() => calls.length === 2);
    second.send('put', { environment: 'dev', flags: [{ key: 'f', value: 2, variation: 1, version: 1, reason: { kind: 'FALLTHROUGH' } }] });
    await identified;
    expect(JSON.parse(Buffer.from(calls[1]!.headers['x-flagken-context']!, 'base64url').toString()).key).toBe('u_2');
    expect(client.variation('f', 0)).toBe(2);
  });
});

describe('client mode watch', () => {
  it('follows the value the server sends for the identified context', async () => {
    const stream = new FakeStream();
    const { fetcher } = fakeFetch([() => new Response(stream.body)]);
    const client = track(
      new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: CLIENT_KEY, context: { key: 'u_7f3a9c' }, fetch: fetcher, ...fast }),
    );
    const seen: string[] = [];
    client.watch('search-ranking', 'keyword', (value) => seen.push(value));
    const started = client.start();
    const evaluated = (value: string, version: number) => ({
      key: 'search-ranking',
      value,
      variation: value === 'semantic' ? 1 : 0,
      version,
      reason: { kind: 'FALLTHROUGH' },
    });
    // The 1st data replaces the fall-back.
    stream.send('put', { environment: 'production', flags: [evaluated('semantic', 1)] });
    await started;
    expect(client.allValues()).toEqual({ 'search-ranking': 'semantic' });
    // A new version with the same value makes no call.
    stream.send('patch', evaluated('semantic', 2));
    stream.send('patch', evaluated('keyword', 3));
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual(['semantic', 'keyword']);
  });
});

describe('offline and reconnect', () => {
  it('starts from the stored snapshot while the server is down, then goes live when it returns', async () => {
    const store = memoryStore();
    await store.save({
      version: 1,
      mode: 'server',
      environment: 'production',
      savedAt: '2026-11-01T00:00:00Z',
      flags: [flag('new-checkout')],
    });
    const stream = new FakeStream();
    const statuses: string[] = [];
    const { fetcher, calls } = fakeFetch([
      () => Promise.reject(new TypeError('connect ECONNREFUSED')),
      () => Promise.reject(new TypeError('connect ECONNREFUSED')),
      () => new Response(stream.body),
    ]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, store, ...fast }));
    client.on('status', (s) => statuses.push(s));
    const errors: Error[] = [];
    client.on('error', (e) => errors.push(e));
    await client.start();
    // Served from the snapshot even though no connection worked yet.
    expect(client.variation('new-checkout', false, { key: 'u_1' })).toBe(true);
    await waitFor(() => calls.length === 3);
    stream.send('put', { environment: 'production', flags: [flag('new-checkout', { version: 5, on: false })] });
    await waitFor(() => client.status === 'live');
    expect(client.variation('new-checkout', true, { key: 'u_1' })).toBe(false);
    expect(errors.length).toBe(2);
    expect(statuses).toEqual(['connecting', 'offline', 'connecting', 'offline', 'connecting', 'live']);
    const saved = (await store.load()) as Snapshot;
    expect(saved.flags[0]!.version).toBe(5);
  });

  it('reconnects when the server ends the stream', async () => {
    const first = new FakeStream();
    const second = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => new Response(first.body), () => new Response(second.body)]);
    const client = track(new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast }));
    const started = client.start();
    first.send('put', { environment: 'dev', flags: [flag('a')] });
    await started;
    first.end();
    await waitFor(() => calls.length === 2);
    second.send('patch', flag('a', { version: 2, on: false }));
    await waitFor(() => client.variation('a', true, { key: 'k' }) === false);
  });

  it('reconnects when the stream goes quiet', async () => {
    const quiet = new FakeStream();
    const next = new FakeStream();
    const { fetcher, calls } = fakeFetch([() => new Response(quiet.body), () => new Response(next.body)]);
    const client = track(
      new FlagkenClient({ baseUrl: 'http://flags.test', apiKey: SERVER_KEY, fetch: fetcher, ...fast, idleTimeoutMs: 50 }),
    );
    void client.start();
    await waitFor(() => calls.length === 2, 3000);
  });

  it('ignores a snapshot made for another context', async () => {
    const store = memoryStore();
    await store.save({
      version: 1,
      mode: 'client',
      environment: 'dev',
      savedAt: '',
      contextHash: 'other',
      flags: [{ key: 'f', value: true, variation: 1, version: 1, reason: { kind: 'FALLTHROUGH' } }],
    });
    const { fetcher } = fakeFetch([]);
    const client = track(
      new FlagkenClient({
        baseUrl: 'http://x.test',
        apiKey: CLIENT_KEY,
        context: { key: 'u_1' },
        store,
        fetch: fetcher,
        startTimeoutMs: 20,
        backoff: { initialMs: 1000 },
      }),
    );
    await client.start();
    expect(client.variation('f', false)).toBe(false);
  });
});

describe('polling mode', () => {
  it('reads flags through the generated API client', async () => {
    const { fetcher, calls } = fakeFetch([() => Response.json({ environment: 'staging', flags: [flag('p', { on: false })] })]);
    const client = track(
      new FlagkenClient({
        baseUrl: 'http://flags.test',
        apiKey: SERVER_KEY,
        fetch: fetcher,
        streaming: false,
        pollIntervalMs: 60_000,
        startTimeoutMs: 500,
      }),
    );
    await client.start();
    expect(calls[0]!.url).toBe('http://flags.test/sdk/v1/flags');
    expect(client.variation('p', true, { key: 'u' })).toBe(false);
    expect(client.status).toBe('live');
  });
});

describe('snapshot stores', () => {
  const snapshot: Snapshot = { version: 1, mode: 'server', environment: 'dev', savedAt: '2026-11-01T00:00:00Z', flags: [flag('a')] };

  it('fileStore writes through a temporary file and reads it back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flagken-sdk-'));
    const store = fileStore(join(dir, 'nested', 'flags.json'));
    expect(await store.load()).toBeUndefined();
    await store.save(snapshot);
    expect(await store.load()).toEqual(snapshot);
    expect(await readdir(join(dir, 'nested'))).toEqual(['flags.json']);
    expect(JSON.parse(await readFile(join(dir, 'nested', 'flags.json'), 'utf8')).environment).toBe('dev');
  });

  it('fileStore treats a broken file as no snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flagken-sdk-'));
    await writeFile(join(dir, 'flags.json'), '{not json');
    expect(await fileStore(join(dir, 'flags.json')).load()).toBeUndefined();
  });

  it('localStorageStore round-trips and survives a storage that throws', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const store = localStorageStore('flags', storage);
    await store.save(snapshot);
    expect(await store.load()).toEqual(snapshot);
    const broken = localStorageStore('flags', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    await expect(broken.save(snapshot)).resolves.toBeUndefined();
    await expect(broken.load()).resolves.toBeUndefined();
  });
});
