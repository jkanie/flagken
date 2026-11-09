import { createHmac, randomBytes } from 'node:crypto';

export const SIGNATURE_HEADER = 'Flagken-Signature';

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/**
 * Header value "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
 * The timestamp is part of the signed text, so a receiver can refuse an old delivery sent again (a replay).
 */
export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}
