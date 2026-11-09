/**
 * Checks a flagken webhook on the receiving side. Uses Web Crypto, which Node.js and browsers both provide.
 * Header format: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
 */
export async function verifyWebhookSignature(options: {
  secret: string;
  /** The raw request body, exactly as received. */
  body: string;
  header: string | null | undefined;
  /** Oldest accepted delivery, in seconds. Default 300. Stops replays of old deliveries. */
  toleranceSeconds?: number;
  now?: number;
}): Promise<boolean> {
  const { secret, body, header } = options;
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const index = piece.indexOf('=');
    if (index < 0) continue;
    const name = piece.slice(0, index).trim();
    parts.set(name, [...(parts.get(name) ?? []), piece.slice(index + 1).trim()]);
  }
  const timestamp = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((given) => constantTimeEqual(given, expected));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
