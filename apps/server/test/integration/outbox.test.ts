import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/audit/outbox-relay.js';
import { ChangeBus } from '../../src/live/change-bus.js';
import type { ChangeMessage } from '../../src/live/change-bus.js';
import { Api, createUser, freshDatabase, startServer, testConfig } from './harness.js';
import type { Running } from './harness.js';

let server: Running;
let api: Api;
let db: pg.Client;
let bus: ChangeBus;
let relay: OutboxRelay;
const seen: ChangeMessage[] = [];
const flags = '/api/v1/projects/shop/flags';
const kill = `${flags}/dark-mode/environments/production/kill`;

/** Waits until the bus has delivered n messages to this instance. */
async function seenAtLeast(n: number): Promise<void> {
  const until = Date.now() + 5_000;
  while (seen.length < n) {
    if (Date.now() > until) throw new Error(`saw ${seen.length} messages, waited for ${n}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function outbox() {
  const { rows } = await db.query<{
    id: string;
    attempts: number;
    last_error: string | null;
    sent_at: Date | null;
    messages: ChangeMessage[];
  }>('select id, attempts, last_error, sent_at, messages from outbox order by id');
  return rows;
}

async function auditCount(): Promise<number> {
  const { rows } = await db.query<{ n: string }>("select count(*) as n from audit_log where action like 'flag.%'");
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  const databaseUrl = await freshDatabase();
  server = await startServer(testConfig(databaseUrl));
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  bus = server.app.get(ChangeBus);
  relay = server.app.get(OutboxRelay);
  bus.subscribe((message) => {
    // Only the events of flag changes: the project made in the set-up has an audit entry of its own.
    if (message.type === 'flag.changed' || (message.type === 'audit.created' && message.entry.action.startsWith('flag.')))
      seen.push(message);
  });
  await createUser(databaseUrl, 'owner@example.com', 'owner');
  api = new Api(server.url);
  await api.login('owner@example.com');
  await api.json('POST', '/api/v1/projects', { key: 'shop', name: 'Shop' });
  const created = await api.json('POST', flags, {
    key: 'dark-mode',
    name: 'Dark mode',
    kind: 'boolean',
    variations: [{ value: false }, { value: true }],
  });
  expect(created.status).toBe(201);
});
afterAll(async () => {
  await db.end();
  await server.close();
});

describe('audit outbox', () => {
  it('writes the flag change, its audit entry and its outbox row in 1 transaction, then sends the row', async () => {
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sent_at).not.toBeNull();
    expect(rows[0]!.messages.map((m) => m.type)).toEqual(['flag.changed', 'audit.created']);
    await seenAtLeast(2);
    expect(seen.slice(0, 2).map((m) => m.type)).toEqual(['flag.changed', 'audit.created']);
    expect(await auditCount()).toBe(1);
  });

  it('keeps the change and its entry when the publish fails, and sends the events on the next relay run', async () => {
    const realPublish = bus.publish.bind(bus);
    bus.publish = () => Promise.reject(new Error('Redis is down on purpose'));
    const before = seen.length;
    let rows;
    try {
      // The request still succeeds: the change and its audit entry are committed.
      expect((await api.json('PUT', kill, { killed: true })).status).toBe(200);
      // A 2nd change waits behind the 1st, so the 2 can never go out in the wrong order.
      expect((await api.json('PUT', kill, { killed: false })).status).toBe(200);

      expect(await auditCount()).toBe(3);
      const audit = await api.json('GET', '/api/v1/projects/shop/audit?flag=dark-mode');
      expect(audit.body.map((e: { action: string }) => e.action)).toEqual(['flag.unkilled', 'flag.killed', 'flag.created']);

      rows = await outbox();
      expect(rows.slice(1).map((r) => r.sent_at)).toEqual([null, null]);
      expect(rows[1]!.attempts).toBeGreaterThanOrEqual(1);
      expect(rows[1]!.last_error).toContain('Redis is down on purpose');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen.length).toBe(before);
    } finally {
      bus.publish = realPublish;
    }

    // The next run (here called at once, otherwise the 5-second timer) sends both rows, in order.
    await relay.drain();
    rows = await outbox();
    expect(rows.every((r) => r.sent_at !== null)).toBe(true);
    await seenAtLeast(before + 4);
    expect(seen.slice(before).map((m) => (m.type === 'flag.changed' ? `${m.type} ${m.summary}` : m.type))).toEqual([
      'flag.changed kill switch on',
      'audit.created',
      'flag.changed kill switch off',
      'audit.created',
    ]);
    // A run with nothing left to send sends nothing.
    expect(await relay.drain()).toBe(0);
  });

  it('writes no entry and no outbox row for a change that is refused', async () => {
    const entries = await auditCount();
    const rows = (await outbox()).length;
    const stale = await api.json(
      'PUT',
      `${flags}/dark-mode`,
      { name: 'x', description: '', variations: [{ value: false }, { value: true }], tags: [] },
      { 'if-match': '"v99"' },
    );
    expect(stale.status).toBe(412);
    expect(await auditCount()).toBe(entries);
    expect((await outbox()).length).toBe(rows);
  });
});
