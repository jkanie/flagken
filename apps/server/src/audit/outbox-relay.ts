import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import { ChangeBus } from '../live/change-bus.js';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.js';
import { toWebhookEvent } from './audit.service.js';

/** How often each instance looks for rows that an earlier run could not send. */
export const OUTBOX_INTERVAL_MS = 5_000;
const BATCH = 100;

/**
 * Sends what a committed flag change left in the outbox: its change messages on the Redis channel, then its
 * webhooks. Rows go out in id order. A row whose sending fails stays, with the error, and the rows after it
 * wait, so events never pass each other. Each instance runs the relay after its own changes and every
 * [OUTBOX_INTERVAL_MS]. FOR UPDATE SKIP LOCKED lets instances share the work without sending a row twice.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;
  private again = false;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly bus: ChangeBus,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), OUTBOX_INTERVAL_MS);
    this.timer.unref();
    void this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /**
   * Sends every unsent row and returns how many went out. It never throws: a failure is logged and stored on the
   * row, and the next run tries again. Calls that overlap share 1 run, plus 1 more for rows added meanwhile.
   */
  async drain(): Promise<number> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let sent = 0;
      do {
        this.again = false;
        sent += await this.sendBatches();
      } while (this.again);
      return sent;
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async sendBatches(): Promise<number> {
    let sent = 0;
    for (;;) {
      let batch: { sent: number; full: boolean; failed: boolean };
      try {
        batch = await this.sendBatch();
      } catch (error) {
        this.logger.error(`outbox relay stopped: ${String(error)}`);
        return sent;
      }
      sent += batch.sent;
      if (!batch.full || batch.failed) return sent;
    }
  }

  private async sendBatch(): Promise<{ sent: number; full: boolean; failed: boolean }> {
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outbox')
        .selectAll()
        .where('sentAt', 'is', null)
        .orderBy('id')
        .limit(BATCH)
        .forUpdate()
        .skipLocked()
        .execute();
      let sent = 0;
      for (const row of rows) {
        try {
          for (const message of row.messages) await this.bus.publish(message);
          if (row.webhookAuditId) {
            const entry = await trx
              .selectFrom('auditLog as a')
              .leftJoin('projects as p', 'p.id', 'a.projectId')
              .selectAll('a')
              .select('p.key as projectKey')
              .where('a.id', '=', row.webhookAuditId)
              .executeTakeFirst();
            if (entry?.projectId) await this.webhooks.dispatch(entry.projectId, toWebhookEvent(entry, entry.projectKey));
          }
          await trx.updateTable('outbox').set({ sentAt: new Date() }).where('id', '=', row.id).execute();
          sent++;
        } catch (error) {
          // Later rows wait for this 1, so the order of events holds.
          await trx
            .updateTable('outbox')
            .set((eb) => ({ attempts: eb('attempts', '+', 1), lastError: String(error).slice(0, 1000) }))
            .where('id', '=', row.id)
            .execute();
          this.logger.warn(`outbox row ${row.id} not sent yet: ${String(error)}`);
          return { sent, full: rows.length === BATCH, failed: true };
        }
      }
      return { sent, full: rows.length === BATCH, failed: false };
    });
  }
}
