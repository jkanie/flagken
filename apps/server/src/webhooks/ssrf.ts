import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Raised when a webhook target resolves to an address that must not be reached from the server. */
export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

type Range = { bytes: number[]; bits: number };

function v4(text: string): number[] | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : undefined;
}

/** Parses an IPv6 address (with ::, an embedded IPv4 tail, a zone id) into 16 bytes. */
export function parseIPv6(text: string): number[] | undefined {
  let address = text.toLowerCase();
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);
  let tail: number[] = [];
  const lastColon = address.lastIndexOf(':');
  if (address.slice(lastColon + 1).includes('.')) {
    const embedded = v4(address.slice(lastColon + 1));
    if (!embedded) return undefined;
    tail = embedded;
    address = `${address.slice(0, lastColon + 1)}0:0`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const parse = (s: string) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

function range(cidr: string): Range {
  const [address, bits] = cidr.split('/') as [string, string];
  const bytes = address.includes(':') ? parseIPv6(address) : v4(address);
  if (!bytes) throw new Error(`bad range ${cidr}`);
  return { bytes, bits: Number(bits) };
}

function inRange(bytes: number[], r: Range): boolean {
  if (bytes.length !== r.bytes.length) return false;
  let bits = r.bits;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i]! & mask) !== (r.bytes[i]! & mask)) return false;
  }
  return true;
}

// IANA special-purpose registries: private, local, shared, reserved, documentation addresses.
const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(range);

const BLOCKED_V6 = [
  '::/128',
  '::1/128',
  '::/96', // IPv4-compatible, deprecated
  '64:ff9b:1::/48', // local-use NAT64
  '100::/64', // discard-only
  '2001::/23', // IETF protocol assignments, Teredo included
  '2001:db8::/32', // documentation
  '3fff::/20', // documentation
  '5f00::/16', // SRv6 SIDs
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'fec0::/10', // site-local, deprecated
  'ff00::/8', // multicast
].map(range);

const MAPPED = range('::ffff:0:0/96');
const NAT64 = range('64:ff9b::/96');
const SIX_TO_FOUR = range('2002::/16');

/** True when an IP address is a public unicast address the server may connect to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address.split('%')[0]!);
  if (family === 4) {
    const bytes = v4(address)!;
    return !BLOCKED_V4.some((r) => inRange(bytes, r));
  }
  if (family !== 6) return false;
  const bytes = parseIPv6(address);
  if (!bytes) return false;
  // Forms that carry an IPv4 address are judged by that IPv4 address.
  if (inRange(bytes, MAPPED) || inRange(bytes, NAT64)) return isPublicAddress(bytes.slice(12).join('.'));
  if (inRange(bytes, SIX_TO_FOUR)) return isPublicAddress(bytes.slice(2, 6).join('.'));
  return !BLOCKED_V6.some((r) => inRange(bytes, r));
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export interface TargetPolicy {
  /** ALLOW_PRIVATE_TARGETS: skip the address checks. */
  allowPrivate: boolean;
  resolve?: Resolver;
  /** Decides which addresses are allowed. Defaults to isPublicAddress. Tests replace it. */
  isAllowed?: (address: string) => boolean;
}

export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Checks a webhook URL: http or https, no user name or password, every resolved address allowed. */
export async function assertAllowedUrl(raw: string, policy: TargetPolicy): Promise<URL> {
  const url = URL.parse(raw);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new BlockedTargetError('the URL must start with http:// or https://');
  }
  if (url.username || url.password) throw new BlockedTargetError('the URL must not hold a user name or password');
  if (policy.allowPrivate) return url;
  const allowed = policy.isAllowed ?? isPublicAddress;
  const host = hostOf(url);
  if (isIP(host)) {
    if (!allowed(host)) throw new BlockedTargetError(`${host} is a private, local or reserved address`);
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await (policy.resolve ?? systemResolver)(host);
  } catch {
    throw new BlockedTargetError(`${host} does not resolve`);
  }
  if (addresses.length === 0) throw new BlockedTargetError(`${host} does not resolve`);
  const bad = addresses.find((a) => !allowed(a.address));
  if (bad) throw new BlockedTargetError(`${host} resolves to ${bad.address}, a private, local or reserved address`);
  return url;
}
