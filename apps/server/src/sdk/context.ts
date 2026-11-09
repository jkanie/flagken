import { BadRequestException } from '@nestjs/common';
import type { AttributeValue, EvalContext } from '@flagken/shared';

const MAX_ATTRIBUTES = 50;

function isAttribute(value: unknown): value is AttributeValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value !== 'string' || value.length <= 1024;
  }
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((v) => (typeof v === 'string' && v.length <= 1024) || (typeof v === 'number' && Number.isFinite(v)))
  );
}

/** Builds an evaluation context from { key, attributes }. The key always wins over an attribute named key. */
export function toContext(input: unknown): EvalContext {
  if (typeof input !== 'object' || input === null) throw new BadRequestException('context must be an object');
  const { key, attributes } = input as { key?: unknown; attributes?: unknown };
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
    throw new BadRequestException('context.key must be a string of 1 to 256 characters');
  }
  const context: EvalContext = { key };
  if (attributes === undefined) return context;
  if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
    throw new BadRequestException('context.attributes must be an object');
  }
  const entries = Object.entries(attributes);
  if (entries.length > MAX_ATTRIBUTES) throw new BadRequestException(`at most ${MAX_ATTRIBUTES} attributes`);
  for (const [name, value] of entries) {
    if (name === 'key' || name === '__proto__') continue;
    if (!isAttribute(value)) throw new BadRequestException(`attribute ${name.slice(0, 50)} has an unsupported value`);
    context[name] = value;
  }
  return context;
}

/** Reads the X-Flagken-Context header: base64url JSON of { key, attributes }. A header keeps it out of URLs and logs. */
export function contextFromHeader(header: string | undefined): EvalContext {
  if (!header) throw new BadRequestException('a client key stream needs the X-Flagken-Context header');
  if (header.length > 16_384) throw new BadRequestException('X-Flagken-Context is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('X-Flagken-Context must be base64url JSON');
  }
  return toContext(parsed);
}
