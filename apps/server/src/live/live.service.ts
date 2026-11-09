import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { evaluateFlag } from '@flagken/shared';
import type { EvalContext, EvaluatedFlag, FlagConfig } from '@flagken/shared';
import type { ApiKeyPrincipal, SessionUser } from '../common/request.js';
import { FlagsService } from '../flags/flags.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { ChangeBus } from './change-bus.js';
import type { ChangeMessage } from './change-bus.js';

export interface SseEvent {
  type: 'put' | 'patch' | 'delete' | 'ping';
  data: unknown;
}

export interface SseConnection {
  id: string;
  key: ApiKeyPrincipal;
  /** Set for client keys: the server evaluates for this context. */
  context?: EvalContext;
  /** False until the first put is out. Patches wait in `pending` until then. */
  ready: boolean;
  pending: SseEvent[];
  emit(event: SseEvent): void;
  close(): void;
}

interface ConsoleClient {
  socket: WebSocket;
  user?: SessionUser;
  projects: Set<string>;
  alive: boolean;
}

/**
 * Keeps this instance's live connections: SSE streams of SDKs and WebSocket sockets of consoles.
 * It reacts to ChangeBus messages, which come from any instance through Redis.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(LiveService.name);
  private readonly streams = new Set<SseConnection>();
  private readonly consoles = new Map<WebSocket, ConsoleClient>();
  private unsubscribe?: () => void;
  private pinger?: NodeJS.Timeout;
  private closing = false;

  constructor(
    private readonly bus: ChangeBus,
    private readonly flags: FlagsService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((message) => {
      this.handle(message).catch((error: unknown) => this.logger.error(`live update failed: ${String(error)}`));
    });
    // Drops console sockets that stop answering pings (a laptop that went to sleep).
    this.pinger = setInterval(() => {
      for (const client of this.consoles.values()) {
        if (!client.alive) {
          client.socket.terminate();
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }, 30_000);
    this.pinger.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    clearInterval(this.pinger);
  }

  /** Clean shutdown: ends every SSE stream and closes every console socket with 1001 (going away). */
  beforeApplicationShutdown(): void {
    this.closing = true;
    for (const stream of [...this.streams]) stream.close();
    for (const client of [...this.consoles.values()]) client.socket.close(1001, 'server shutting down');
  }

  get isClosing(): boolean {
    return this.closing;
  }

  get counts(): { sse: number; websocket: number } {
    return { sse: this.streams.size, websocket: this.consoles.size };
  }

  /* ---------- SSE ---------- */

  openStream(key: ApiKeyPrincipal, context: EvalContext | undefined, emit: (event: SseEvent) => void, close: () => void): SseConnection {
    const connection: SseConnection = { id: randomUUID(), key, ready: false, pending: [], emit, close, ...(context ? { context } : {}) };
    this.streams.add(connection);
    this.metrics.connectedClients.inc({ transport: 'sse' });
    return connection;
  }

  closeStream(connection: SseConnection): void {
    if (this.streams.delete(connection)) this.metrics.connectedClients.dec({ transport: 'sse' });
  }

  /** The first event of a stream: every flag of the environment. */
  async initialPut(connection: SseConnection): Promise<void> {
    const configs = (await this.flags.configsFor(connection.key.environmentId)).map(stripArchived);
    connection.emit({ type: 'put', data: this.putPayload(connection, configs) });
    connection.ready = true;
    for (const event of connection.pending.splice(0)) connection.emit(event);
  }

  putPayload(connection: { key: ApiKeyPrincipal; context?: EvalContext }, configs: FlagConfig[]) {
    if (connection.key.kind === 'server') return { environment: connection.key.environmentKey, flags: configs };
    return { environment: connection.key.environmentKey, flags: configs.map((c) => this.evaluate(connection.key, c, connection.context!)) };
  }

  evaluate(key: ApiKeyPrincipal, config: FlagConfig, context: EvalContext): EvaluatedFlag {
    const result = evaluateFlag(config, context, null);
    this.metrics.evaluations.inc({ environment: key.environmentKey, flag: config.key, reason: result.reason.kind });
    return { key: config.key, value: result.value, variation: result.variation, version: config.version, reason: result.reason };
  }

  private send(connection: SseConnection, event: SseEvent): void {
    if (connection.ready) connection.emit(event);
    else connection.pending.push(event);
  }

  /* ---------- console WebSocket ---------- */

  addConsole(socket: WebSocket): void {
    const client: ConsoleClient = { socket, projects: new Set(), alive: true };
    socket.on('pong', () => (client.alive = true));
    this.consoles.set(socket, client);
    this.metrics.connectedClients.inc({ transport: 'websocket' });
  }

  authoriseConsole(socket: WebSocket, user: SessionUser): void {
    const client = this.consoles.get(socket);
    if (!client) return;
    client.user = user;
    sendJson(socket, { event: 'ready', data: { user: { email: user.email, role: user.role } } });
  }

  subscribeConsole(socket: WebSocket, project: string): boolean {
    const client = this.consoles.get(socket);
    if (!client?.user) return false;
    client.projects.add(project);
    return true;
  }

  removeConsole(socket: WebSocket): void {
    if (this.consoles.delete(socket)) this.metrics.connectedClients.dec({ transport: 'websocket' });
  }

  private toConsoles(projectKey: string, payload: { event: string; data: unknown }): void {
    for (const client of this.consoles.values()) {
      if (client.user && client.projects.has(projectKey)) sendJson(client.socket, payload);
    }
  }

  /* ---------- messages from Redis ---------- */

  async handle(message: ChangeMessage): Promise<void> {
    switch (message.type) {
      case 'flag.changed': {
        this.toConsoles(message.projectKey, { event: 'flag.changed', data: message });
        const listeners = [...this.streams].filter(
          (s) => s.key.projectId === message.projectId && (message.environmentId === null || s.key.environmentId === message.environmentId),
        );
        const byEnvironment = new Map<string, SseConnection[]>();
        for (const stream of listeners) {
          const list = byEnvironment.get(stream.key.environmentId) ?? [];
          list.push(stream);
          byEnvironment.set(stream.key.environmentId, list);
        }
        for (const [environmentId, streams] of byEnvironment) {
          const [config] = await this.flags.configsFor(environmentId, message.flagKey);
          if (!config) continue;
          for (const stream of streams) {
            if (config.archived) {
              this.send(stream, { type: 'delete', data: { key: config.key, version: config.version } });
            } else if (stream.key.kind === 'server') {
              this.send(stream, { type: 'patch', data: stripArchived(config) });
            } else {
              this.send(stream, { type: 'patch', data: this.evaluate(stream.key, stripArchived(config), stream.context!) });
            }
          }
        }
        return;
      }
      case 'audit.created':
        this.toConsoles(message.projectKey, { event: 'audit.created', data: message.entry });
        return;
      case 'webhook.delivery':
        this.toConsoles(message.projectKey, { event: 'webhook.delivery', data: { webhookId: message.webhookId, ok: message.ok } });
        return;
      case 'api-key.revoked':
        for (const stream of [...this.streams]) if (stream.key.id === message.keyId) stream.close();
        return;
    }
  }
}

function stripArchived(config: FlagConfig & { archived?: boolean }): FlagConfig {
  const { archived: _archived, ...rest } = config;
  return rest;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
