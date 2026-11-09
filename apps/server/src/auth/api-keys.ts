import { createHash, randomBytes } from 'node:crypto';
import type { ApiKeyKind } from '@flagken/shared';

/**
 * Server keys start fk_srv_ and read flag rules. Client keys start fk_cli_ and read evaluated values only.
 * 32 random bytes, base64url. Only the SHA-256 of a key is stored.
 */
export function generateApiKey(kind: ApiKeyKind): { key: string; prefix: string; hash: string } {
  const key = `fk_${kind === 'server' ? 'srv' : 'cli'}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 14), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
