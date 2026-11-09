import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { BlockedTargetError, assertAllowedUrl, isPublicAddress, systemResolver } from './ssrf.js';
import type { TargetPolicy } from './ssrf.js';

export interface SafeRequestOptions {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxRedirects: number;
  policy: TargetPolicy;
}

export interface SafeResponse {
  status: number;
  /** Every URL the request went to, redirects included. */
  urls: string[];
}

/**
 * Builds a DNS lookup for http.request that refuses blocked addresses.
 * The check runs on the address the socket connects to, so a DNS answer that changes after the save-time check
 * (DNS rebinding) is caught here.
 */
function guardedLookup(policy: TargetPolicy): LookupFunction {
  const resolve = policy.resolve ?? systemResolver;
  const allowed = policy.allowPrivate ? () => true : (policy.isAllowed ?? isPublicAddress);
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = addresses.find((a) => !allowed(a.address));
        if (bad) {
          callback(new BlockedTargetError(`${hostname} resolves to ${bad.address}, a private, local or reserved address`));
        } else if (addresses.length === 0) {
          callback(new BlockedTargetError(`${hostname} does not resolve`));
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family);
        }
      },
      (error: unknown) => callback(error),
    );
  }) as unknown as LookupFunction;
}

function once(url: URL, options: SafeRequestOptions): Promise<{ status: number; location?: string }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: options.method,
        headers: { ...options.headers, 'content-length': Buffer.byteLength(options.body).toString() },
        lookup: guardedLookup(options.policy),
        timeout: options.timeoutMs,
        // A fresh connection per delivery: a pooled socket could skip the address check.
        agent: false,
      },
      (response) => {
        let read = 0;
        response.on('data', (chunk: Buffer) => {
          read += chunk.length;
          // The receiver's reply is not stored, read at most 64 KiB of it.
          if (read > 65_536) response.destroy();
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, location: response.headers.location }));
        response.on('close', () => resolve({ status: response.statusCode ?? 0, location: response.headers.location }));
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error(`no answer within ${options.timeoutMs} ms`)));
    request.on('error', reject);
    request.end(options.body);
  });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Sends a webhook. Checks the target before the first request and again before every redirect. */
export async function safeRequest(rawUrl: string, options: SafeRequestOptions): Promise<SafeResponse> {
  const urls: string[] = [];
  let url = await assertAllowedUrl(rawUrl, options.policy);
  for (let hop = 0; ; hop++) {
    urls.push(url.toString());
    const result = await once(url, options);
    if (!REDIRECTS.has(result.status) || !result.location) return { status: result.status, urls };
    if (hop >= options.maxRedirects) throw new Error(`more than ${options.maxRedirects} redirects`);
    url = await assertAllowedUrl(new URL(result.location, url).toString(), options.policy);
  }
}
