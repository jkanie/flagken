import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { REDIS, createRedis } from '../redis/redis.js';

/** Messages that cross server instances through Redis. */
export type ChangeMessage =
  | {
      type: 'flag.changed';
      projectId: string;
      projectKey: string;
      /** Null when the change touches every environment (variations, archive). */
      environmentId: string | null;
      environmentKey: string | null;
      flagKey: string;
      version: number;
      summary: string;
    }
  | {
      type: 'audit.created';
      projectId: string;
      projectKey: string;
      entry: { id: string; action: string; environmentKey: string | null; resourceKey: string; actorLabel: string; at: string };
    }
  | { type: 'api-key.revoked'; keyId: string }
  | { type: 'webhook.delivery'; projectId: string; projectKey: string; webhookId: string; ok: boolean };

type Envelope = { from: string; message: ChangeMessage };
type Listener = (message: ChangeMessage, fromThisInstance: boolean) => void;

/**
 * Redis publish and subscribe between server instances.
 * Every instance, the sender included, gets each message from Redis, then passes it to its own SSE and WebSocket clients.
 * That gives 1 delivery path, so a client on instance B sees the same thing as a client on instance A.
 */
@Injectable()
export class ChangeBus implements OnModuleInit, OnModuleDestroy {
  readonly instanceId = randomUUID();
  private readonly logger = new Logger(ChangeBus.name);
  private readonly listeners = new Set<Listener>();
  private subscriber: Redis | undefined;
  private readonly channel: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    this.channel = `${config.redisPrefix}:changes`;
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = createRedis(this.config.redisUrl, 'flagken-subscriber');
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== this.channel) return;
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        this.logger.warn('ignored a change message that is not JSON');
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(envelope.message, envelope.from === this.instanceId);
        } catch (error) {
          this.logger.error(`change listener failed: ${String(error)}`);
        }
      }
    });
    await this.subscriber.subscribe(this.channel);
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(message: ChangeMessage): Promise<void> {
    const envelope: Envelope = { from: this.instanceId, message };
    await this.redis.publish(this.channel, JSON.stringify(envelope));
  }
}
