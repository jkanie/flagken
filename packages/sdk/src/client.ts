import { createApiClient } from '@flagken/api-client';
import type { ApiClient } from '@flagken/api-client';
import { evaluateFlag, murmur3String } from '@flagken/shared';
import type { EvalContext, EvalResult, EvaluatedFlag, FlagConfig, JsonValue } from '@flagken/shared';
import { backoffDelay } from './backoff.js';
import type { BackoffOptions } from './backoff.js';
import { SseParser } from './sse.js';
import { memoryStore } from './storage.js';
import type { Snapshot, SnapshotStore } from './storage.js';

export type ClientStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'closed';

export interface FlagkenOptions {
  /** Server origin, for example https://flags.example.com. */
  baseUrl: string;
  /** fk_srv_... (server SDK: rules, local evaluation) or fk_cli_... (browser: values for 1 context). */
  apiKey: string;
  /** Client keys: who to evaluate for. Change it later with identify(). */
  context?: EvalContext;
  /** Where the last known flags are kept for offline starts. Default: memory. */
  store?: SnapshotStore;
  /** false: poll with pollIntervalMs instead of a live stream. */
  streaming?: boolean;
  pollIntervalMs?: number;
  backoff?: BackoffOptions;
  /** start() resolves after this long even without the server (with the snapshot or fallbacks). Default 5,000 ms. */
  startTimeoutMs?: number;
  /** Reconnect when the stream is silent this long. The server pings every 15 s. Default 45,000 ms. */
  idleTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface ChangeEvent {
  key: string;
  /** Server mode: the new rules. Client mode: the new evaluated value. Undefined when the flag was removed. */
  flag: FlagConfig | EvaluatedFlag | undefined;
}

type Events = {
  change: ChangeEvent;
  status: ClientStatus;
  error: Error;
};

type Flag = FlagConfig | EvaluatedFlag;

/** variation('x', false) returns boolean, not the literal type false. */
export type Widen<T> = T extends boolean ? boolean : T extends string ? string : T extends number ? number : T;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The server takes { key, attributes }. The SDK takes a flat context. */
function wireContext(context: EvalContext): { key: string; attributes: Record<string, unknown> } {
  const { key, ...attributes } = context;
  return { key, attributes };
}

function contextHash(context: EvalContext | undefined): string | undefined {
  return context ? murmur3String(JSON.stringify(wireContext(context))).toString(16) : undefined;
}

function sameKind(value: JsonValue, fallback: JsonValue): boolean {
  if (fallback === null) return true;
  if (Array.isArray(fallback)) return Array.isArray(value);
  return typeof value === typeof fallback;
}

/**
 * flagken SDK for Node.js and browsers.
 * It keeps every flag of 1 environment in memory, takes changes from a Server-Sent Events stream, evaluates with
 * the same rules engine as the server. When the server is away it serves the last snapshot and reconnects with
 * exponential back-off.
 */
export class FlagkenClient {
  readonly mode: 'server' | 'client';
  private readonly options: Required<Pick<FlagkenOptions, 'streaming' | 'pollIntervalMs' | 'startTimeoutMs' | 'idleTimeoutMs'>> &
    FlagkenOptions;
  private readonly api: ApiClient;
  private readonly store: SnapshotStore;
  private readonly flags = new Map<string, Flag>();
  private readonly listeners: { [K in keyof Events]: Set<(value: Events[K]) => void> } = {
    change: new Set(),
    status: new Set(),
    error: new Set(),
  };
  private context: EvalContext | undefined;
  private environment = '';
  private currentStatus: ClientStatus = 'idle';
  private abort: AbortController | undefined;
  private loop: Promise<void> | undefined;
  private closed = false;
  private restart = false;
  private wake: (() => void) | undefined;
  private firstData: Promise<void>;
  private gotFirstData!: () => void;

  constructor(options: FlagkenOptions) {
    if (options.apiKey.startsWith('fk_srv_')) this.mode = 'server';
    else if (options.apiKey.startsWith('fk_cli_')) this.mode = 'client';
    else throw new Error('apiKey must be a flagken server key (fk_srv_) or client key (fk_cli_)');
    if (this.mode === 'client' && !options.context) throw new Error('a client key needs a context with a key');
    this.options = { streaming: true, pollIntervalMs: 30_000, startTimeoutMs: 5000, idleTimeoutMs: 45_000, ...options };
    this.context = options.context;
    this.store = options.store ?? memoryStore();
    this.api = createApiClient({
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      headers: { authorization: `Bearer ${options.apiKey}` },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.firstData = new Promise((resolve) => (this.gotFirstData = resolve));
  }

  get status(): ClientStatus {
    return this.currentStatus;
  }

  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  /** Loads the snapshot, then connects. Resolves on the first data from the server or after startTimeoutMs. */
  async start(): Promise<void> {
    if (this.loop) return this.ready();
    const snapshot = await this.store.load().catch(() => undefined);
    if (snapshot && snapshot.mode === this.mode && snapshot.contextHash === contextHash(this.context)) {
      this.replace(snapshot.environment, snapshot.flags, false);
    }
    this.loop = this.run();
    return this.ready();
  }

  private ready(): Promise<void> {
    return Promise.race([this.firstData, new Promise<void>((resolve) => setTimeout(resolve, this.options.startTimeoutMs).unref?.())]);
  }

  /** Server mode: evaluate a flag for a context. Client mode: the value for the identified context. */
  variation<T extends JsonValue>(key: string, fallback: T, context?: EvalContext): Widen<T> {
    return this.variationDetail(key, fallback, context).value as Widen<T>;
  }

  variationDetail<T extends JsonValue>(key: string, fallback: T, context?: EvalContext): EvalResult<T | JsonValue> {
    const flag = this.flags.get(key);
    let result: EvalResult<T | JsonValue>;
    if (this.mode === 'server') {
      const target = context ?? this.context;
      if (!target) throw new Error('server mode needs a context for each evaluation');
      result = evaluateFlag(flag as FlagConfig | undefined, target, fallback);
    } else {
      const evaluated = flag as EvaluatedFlag | undefined;
      result = evaluated
        ? { value: evaluated.value, variation: evaluated.variation, reason: evaluated.reason }
        : { value: fallback, variation: null, reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' } };
    }
    if (!sameKind(result.value, fallback))
      return { value: fallback, variation: null, reason: { kind: 'ERROR', errorKind: 'MALFORMED_FLAG' } };
    return result;
  }

  /** Every flag as the SDK holds it now. */
  allFlags(): Flag[] {
    return [...this.flags.values()];
  }

  get environmentKey(): string {
    return this.environment;
  }

  /** Client mode: switch to another context. Reconnects so the server evaluates for it. */
  async identify(context: EvalContext): Promise<void> {
    if (this.mode !== 'client') throw new Error('identify() is for client keys');
    this.context = context;
    this.firstData = new Promise((resolve) => (this.gotFirstData = resolve));
    this.restart = true;
    this.abort?.abort('restart');
    this.wake?.();
    await this.ready();
  }

  /** 1 request through the generated API client: all flags for a server key, or values for a client key. */
  async refresh(): Promise<void> {
    if (this.mode === 'server') {
      const { data, error } = await this.api.GET('/sdk/v1/flags');
      if (error || !data) throw new Error('could not read flags');
      this.replace(data.environment, data.flags as FlagConfig[], true);
    } else {
      const { data, error } = await this.api.POST('/sdk/v1/evaluate', { body: wireContext(this.context!) });
      if (error || !data) throw new Error('could not evaluate flags');
      this.replace(data.environment, data.flags as EvaluatedFlag[], true);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.abort?.abort('closed');
    this.wake?.();
    await this.loop;
    this.setStatus('closed');
  }

  /* ---------- connection ---------- */

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.closed) {
      this.setStatus('connecting');
      let gotData = false;
      try {
        gotData = this.options.streaming ? await this.streamOnce() : (await this.refresh(), true);
        if (!this.options.streaming) this.setStatus('live');
      } catch (error) {
        if (!this.closed) this.emit('error', error instanceof Error ? error : new Error(String(error)));
        if (!this.options.streaming) this.setStatus('offline');
      }
      if (this.closed) break;
      if (this.restart) {
        this.restart = false;
        attempt = 0;
        continue;
      }
      if (this.options.streaming) {
        attempt = gotData ? 0 : attempt + 1;
        this.setStatus('offline');
        await this.sleep(backoffDelay(attempt, this.options.backoff));
      } else {
        await this.sleep(this.options.pollIntervalMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** 1 stream connection. Returns whether any data arrived, so the back-off can start over. */
  private async streamOnce(): Promise<boolean> {
    const abort = new AbortController();
    this.abort = abort;
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.apiKey}`, accept: 'text/event-stream' };
    if (this.mode === 'client') headers['x-flagken-context'] = toBase64Url(JSON.stringify(wireContext(this.context!)));
    const fetcher = this.options.fetch ?? globalThis.fetch;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(new Error('stream went quiet')), this.options.idleTimeoutMs);
    };
    let gotData = false;
    try {
      touch();
      const response = await fetcher(`${this.options.baseUrl.replace(/\/+$/, '')}/sdk/v1/stream`, { headers, signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`stream refused: HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      // Some fetch implementations do not end a body that is being read when the signal aborts, so cancel it here.
      abort.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
      const parser = new SseParser();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        for (const message of parser.push(value)) {
          if (this.handle(message.event, message.data)) gotData = true;
        }
      }
    } catch (error) {
      // close() and identify() abort on purpose. Anything else (a network error, a silent stream) is a failure.
      if (this.closed || abort.signal.reason === 'restart' || abort.signal.reason === 'closed') return gotData;
      throw error;
    } finally {
      clearTimeout(idle);
    }
    return gotData;
  }

  private handle(event: string, data: string): boolean {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return false;
    }
    if (event === 'put') {
      const put = payload as { environment: string; flags: Flag[] };
      this.replace(put.environment, put.flags, true);
      this.setStatus('live');
      return true;
    }
    if (event === 'patch') {
      const flag = payload as Flag;
      const current = this.flags.get(flag.key);
      if (current && current.version >= flag.version) return true;
      this.flags.set(flag.key, flag);
      this.emit('change', { key: flag.key, flag });
      this.persist();
      return true;
    }
    if (event === 'delete') {
      const { key, version } = payload as { key: string; version: number };
      const current = this.flags.get(key);
      if (!current || current.version > version) return true;
      this.flags.delete(key);
      this.emit('change', { key, flag: undefined });
      this.persist();
      return true;
    }
    return false;
  }

  private replace(environment: string, flags: Flag[], fresh: boolean): void {
    this.environment = environment;
    const before = new Map(this.flags);
    this.flags.clear();
    for (const flag of flags) this.flags.set(flag.key, flag);
    for (const [key, flag] of this.flags) {
      const old = before.get(key);
      if (!old || old.version !== flag.version || JSON.stringify(old) !== JSON.stringify(flag)) this.emit('change', { key, flag });
    }
    for (const key of before.keys()) if (!this.flags.has(key)) this.emit('change', { key, flag: undefined });
    if (fresh) {
      this.gotFirstData();
      this.persist();
    }
  }

  private persist(): void {
    const snapshot: Snapshot = {
      version: 1,
      mode: this.mode,
      environment: this.environment,
      savedAt: new Date().toISOString(),
      flags: [...this.flags.values()] as Snapshot['flags'],
      ...(this.mode === 'client' ? { contextHash: contextHash(this.context)! } : {}),
    };
    this.store.save(snapshot).catch((error: unknown) => this.emit('error', error instanceof Error ? error : new Error(String(error))));
  }

  private setStatus(status: ClientStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emit('status', status);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const listener of this.listeners[event]) {
      try {
        listener(value);
      } catch {
        // A failing listener must not stop the SDK.
      }
    }
  }
}

export function createFlagkenClient(options: FlagkenOptions): FlagkenClient {
  return new FlagkenClient(options);
}
