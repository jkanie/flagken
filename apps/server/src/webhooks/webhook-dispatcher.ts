import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import { WEBHOOK_QUEUE } from '../jobs/queues.js';
import type { WebhookEvent, WebhookJob } from '../jobs/queues.js';

/** Puts 1 delivery job per matching webhook on the BullMQ queue. Retries and back-off belong to the queue. */
@Injectable()
export class WebhookDispatcher {
  constructor(
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookJob>,
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async dispatch(projectId: string, event: WebhookEvent): Promise<number> {
    const hooks = await this.db
      .selectFrom('webhooks')
      .select(['id', 'events'])
      .where('projectId', '=', projectId)
      .where('active', '=', true)
      .execute();
    const matching = hooks.filter((hook) => hook.events.includes('*') || hook.events.includes(event.type));
    await Promise.all(matching.map((hook) => this.enqueue(hook.id, event)));
    return matching.length;
  }

  enqueue(webhookId: string, event: WebhookEvent): Promise<unknown> {
    return this.queue.add(
      'deliver',
      { webhookId, event },
      {
        // 1 job per webhook and event: a second dispatch of the same event is ignored.
        jobId: `${webhookId}-${event.id}`,
        attempts: this.config.webhookMaxAttempts,
        backoff: { type: 'exponential', delay: this.config.webhookBackoffMs, jitter: 0.2 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
  }
}
