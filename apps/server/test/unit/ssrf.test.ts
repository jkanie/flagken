import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedTargetError, assertAllowedUrl, isPublicAddress, parseIPv6 } from '../../src/webhooks/ssrf.js';
import { safeRequest } from '../../src/webhooks/safe-request.js';

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fe80::1%eth0',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '2001:db8::1',
    '3fff::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b::169.254.169.254',
    '2002:c0a8:0101::1',
    '2001::1',
    'not-an-ip',
  ])('refuses %s', (address) => expect(isPublicAddress(address)).toBe(false));

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:0808:0808::1',
  ])('allows %s', (address) => expect(isPublicAddress(address)).toBe(true));
});

describe('parseIPv6', () => {
  it('expands :: and embedded IPv4 tails', () => {
    expect(parseIPv6('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6('::ffff:1.2.3.4')!.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toHaveLength(16);
  });
  it('refuses malformed input', () => {
    for (const bad of ['1::2::3', '1:2:3', '12345::', 'g::1', '::1.2.3']) expect(parseIPv6(bad)).toBeUndefined();
  });
});

describe('assertAllowedUrl', () => {
  const resolve = (map: Record<string, string[]>) => async (host: string) =>
    (map[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('allows a name that resolves to public addresses only', async () => {
    const url = await assertAllowedUrl('https://hooks.example.com/x', {
      allowPrivate: false,
      resolve: resolve({ 'hooks.example.com': ['93.184.215.14'] }),
    });
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('refuses a name with any private address among its answers', async () => {
    await expect(
      assertAllowedUrl('https://mixed.example.com', {
        allowPrivate: false,
        resolve: resolve({ 'mixed.example.com': ['93.184.215.14', '10.0.0.5'] }),
      }),
    ).rejects.toThrow(/10\.0\.0\.5/);
  });

  it('refuses names that do not resolve, other schemes and credentials', async () => {
    await expect(assertAllowedUrl('https://nowhere.example', { allowPrivate: false, resolve: resolve({}) })).rejects.toBeInstanceOf(
      BlockedTargetError,
    );
    await expect(assertAllowedUrl('file:///etc/passwd', { allowPrivate: false })).rejects.toThrow(/http/);
    await expect(assertAllowedUrl('https://a:b@example.com', { allowPrivate: true })).rejects.toThrow(/user name/);
  });

  it('allows everything over http(s) with allowPrivate', async () => {
    await expect(assertAllowedUrl('http://127.0.0.1:8080/x', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});

describe('safeRequest', () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/redirect-private') {
        response.writeHead(307, { location: `http://127.0.0.2:${port}/landed` });
        return response.end();
      }
      if (request.url === '/redirect-ok') {
        response.writeHead(308, { location: '/landed' });
        return response.end();
      }
      if (request.url === '/loop') {
        response.writeHead(302, { location: '/loop' });
        return response.end();
      }
      if (request.url === '/slow') return setTimeout(() => response.end('late'), 500);
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // Only 127.0.0.1 counts as allowed here, so the guard runs against a local server.
  const policy = {
    allowPrivate: false,
    isAllowed: (address: string) => address === '127.0.0.1',
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  };
  const options = { method: 'POST' as const, headers: {}, body: '{}', timeoutMs: 2000, maxRedirects: 3, policy };

  it('posts to an allowed address', async () => {
    expect(await safeRequest(`http://127.0.0.1:${port}/`, options)).toEqual({ status: 200, urls: [`http://127.0.0.1:${port}/`] });
  });

  it('follows a redirect after checking its target again', async () => {
    const result = await safeRequest(`http://hooks.test:${port}/redirect-ok`, options);
    expect(result.status).toBe(200);
    expect(result.urls).toEqual([`http://hooks.test:${port}/redirect-ok`, `http://hooks.test:${port}/landed`]);
  });

  it('refuses a redirect to a blocked address', async () => {
    await expect(safeRequest(`http://127.0.0.1:${port}/redirect-private`, options)).rejects.toThrow(/127\.0\.0\.2 is a private/);
  });

  it('refuses at connect time when DNS changes between the check and the connection (rebinding)', async () => {
    let calls = 0;
    const answers = ['127.0.0.1', '169.254.169.254'];
    const rebinding = { ...policy, resolve: async () => [{ address: answers[Math.min(calls++, 1)]!, family: 4 }] };
    await expect(safeRequest(`http://metadata.test:${port}/`, { ...options, policy: rebinding })).rejects.toThrow(/169\.254\.169\.254/);
    // 1 answer for the URL check, 1 for the socket: the second one is the one refused.
    expect(calls).toBe(2);
  });

  it('stops after the redirect limit and on timeout', async () => {
    await expect(safeRequest(`http://127.0.0.1:${port}/loop`, options)).rejects.toThrow(/more than 3 redirects/);
    await expect(safeRequest(`http://127.0.0.1:${port}/slow`, { ...options, timeoutMs: 100 })).rejects.toThrow(/no answer within 100 ms/);
  });
});
