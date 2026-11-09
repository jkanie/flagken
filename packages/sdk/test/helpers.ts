import type { FlagConfig } from '@flagken/shared';

/** A fake server stream: tests push SSE text into it. */
export class FakeStream {
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly body = new ReadableStream<Uint8Array>({ start: (c) => (this.controller = c) });
  send(event: string, data: unknown): void {
    this.controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }
  raw(text: string): void {
    this.controller.enqueue(new TextEncoder().encode(text));
  }
  end(): void {
    this.controller.close();
  }
}

export interface Call {
  url: string;
  headers: Record<string, string>;
}

/** fetch that hands out the given responses in order and records each call. */
export function fakeFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? request.headers).forEach((value, key) => (headers[key] = value));
    calls.push({ url: request.url, headers });
    const next = responses.shift();
    if (!next) throw new TypeError('fetch failed: no more fake responses');
    const response = await next();
    return response;
  }) as typeof fetch;
  return { fetcher, calls };
}

export function flag(key: string, overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key,
    kind: 'boolean',
    variations: [{ value: false }, { value: true }],
    version: 1,
    on: true,
    killed: false,
    offVariation: 0,
    fallthrough: { variation: 1 },
    targets: [],
    rules: [],
    ...overrides,
  };
}

export const SERVER_KEY = `fk_srv_${'a'.repeat(43)}`;
export const CLIENT_KEY = `fk_cli_${'b'.repeat(43)}`;

export function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 5);
    };
    tick();
  });
}
