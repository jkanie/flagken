import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type { Kysely } from 'kysely';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import { ChangeBus } from '../live/change-bus.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { safeRequest } from '../webhooks/safe-request.js';
import { BlockedTargetError } from '../webhooks/ssrf.js';
import type { TargetPolicy } from '../webhooks/ssrf.js';
import { SIGNATURE_HEADER, signWebhook } from '../webhooks/signature.js';
import { TARGET_POLICY } from '../webhooks/webhooks.service.js';
import { SchedulesService } from './schedules.service.js';
import { SCHEDULE_QUEUE, WEBHOOK_QUEUE } from './queues.js';
import type { ScheduleJob, WebhookJob } from './queues.js';

@Processor(SCHEDULE_QUEUE)
export class ScheduleProcessor extends WorkerHost {
  constructor(private readonly schedules: SchedulesService) {
    super();
  }

  process(job: Job<ScheduleJob>): Promise<string> {
    return this.schedules.run(job.data.scheduleId);
  }
}

@Processor(WEBHOOK_QUEUE, { concurrency: 8 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TARGET_POLICY) private readonly policy: TargetPolicy,
    private readonly metrics: MetricsService,
    private readonly bus: ChangeBus,
  ) {
    super();
  }

  /** 1 delivery attempt. Throwing hands the job back to BullMQ, which retries with exponential back-off. */
  async process(job: Job<WebhookJob>): Promise<string> {
    const webhook = await this.db
      .selectFrom('webhooks as w')
      .innerJoin('projects as p', 'p.id', 'w.projectId')
      .select(['w.id', 'w.url', 'w.secret', 'w.active', 'w.projectId', 'p.key as projectKey'])
      .where('w.id', '=', job.data.webhookId)
      .executeTakeFirst();
    if (!webhook || !webhook.active) return 'skipped';

    const attempt = job.attemptsMade + 1;
    const body = JSON.stringify(job.data.event);
    // Signed again on every attempt, so the timestamp is fresh and a receiver's replay window stays short.
    const signature = signWebhook(webhook.secret, body, Math.floor(Date.now() / 1000));
    const started = performance.now();
    let status: number | null = null;
    let error: string | null = null;
    let blocked = false;
    try {
      const response = await safeRequest(webhook.url, {
        method: 'POST',
        body,
        timeoutMs: this.config.webhookTimeoutMs,
        maxRedirects: 3,
        policy: this.policy,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'flagken-webhooks/0.1',
          'flagken-event-id': job.data.event.id,
          'flagken-event-type': job.data.event.type,
          'flagken-delivery-attempt': String(attempt),
          [SIGNATURE_HEADER.toLowerCase()]: signature,
        },
      });
      status = response.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (caught) {
      blocked = caught instanceof BlockedTargetError;
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const ok = error === null;
    await this.db
      .insertInto('webhookDeliveries')
      .values({
        webhookId: webhook.id,
        eventId: job.data.event.id,
        eventType: job.data.event.type,
        attempt,
        ok,
        statusCode: status,
        error: error?.slice(0, 500) ?? null,
        durationMs: Math.round(performance.now() - started),
      })
      .execute();
    this.metrics.webhookDeliveries.inc({ outcome: ok ? 'success' : blocked ? 'blocked' : 'failure' });
    await this.bus.publish({
      type: 'webhook.delivery',
      projectId: webhook.projectId,
      projectKey: webhook.projectKey,
      webhookId: webhook.id,
      ok,
    });
    if (ok) return `HTTP ${status}`;
    this.logger.warn(`webhook ${webhook.id} attempt ${attempt} failed: ${error}`);
    // A blocked address will stay blocked, so retrying would only repeat the refusal.
    if (blocked) throw new UnrecoverableError(error!);
    throw new Error(error!);
  }
}
