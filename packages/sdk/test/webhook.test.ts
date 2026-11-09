import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src/index.js';

const secret = 'whsec_made-up-test-secret';
const body = '{"id":"evt_1","type":"flag.state.updated"}';
const now = 1_790_000_000;
const sign = (t: number, text = body, key = secret) => `t=${t},v1=${createHmac('sha256', key).update(`${t}.${text}`).digest('hex')}`;

describe('verifyWebhookSignature', () => {
  it('accepts a fresh, correct signature', async () => {
    expect(await verifyWebhookSignature({ secret, body, header: sign(now), now })).toBe(true);
  });
  it('refuses a changed body, another secret, a missing header, junk', async () => {
    expect(await verifyWebhookSignature({ secret, body: body.replace('1', '2'), header: sign(now), now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, body, header: sign(now, body, 'whsec_other'), now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, body, header: undefined, now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, body, header: 'v1=abc', now })).toBe(false);
  });
  it('refuses a replay older than the tolerance, and one from the future', async () => {
    expect(await verifyWebhookSignature({ secret, body, header: sign(now - 301), now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, body, header: sign(now + 301), now })).toBe(false);
    expect(await verifyWebhookSignature({ secret, body, header: sign(now - 299), now })).toBe(true);
  });
  it('accepts any of several v1 signatures (secret rotation)', async () => {
    const header = `${sign(now, body, 'whsec_old')},v1=${sign(now).split('v1=')[1]}`;
    expect(await verifyWebhookSignature({ secret, body, header, now })).toBe(true);
  });
});
