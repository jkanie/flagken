import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { JsonValue } from '@flagken/shared';
import { DB, json } from '../db/database.js';
import type { AuditRow, Database } from '../db/schema.js';
import { ChangeBus } from '../live/change-bus.js';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.js';
import type { WebhookEvent } from '../jobs/queues.js';
import type { AuditRecord } from './audit-context.js';

export interface Actor {
  type: 'user' | 'api_key' | 'system';
  id: string | null;
  label: string;
}

export function toWebhookEvent(row: AuditRow, projectKey: string | null): WebhookEvent {
  return {
    id: `evt_${row.id}`,
    type: row.action,
    createdAt: row.at.toISOString(),
    project: projectKey,
    environment: row.environmentKey,
    resource: { type: row.resourceType, key: row.resourceKey },
    actor: { type: row.actorType, label: row.actorLabel },
    before: row.before,
    after: row.after,
  };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly bus: ChangeBus,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  /** Stores audit entries, tells consoles about them, then queues webhooks for flag events. */
  async write(records: AuditRecord[], actor: Actor, requestId: string | null): Promise<AuditRow[]> {
    if (records.length === 0) return [];
    const rows = await this.db
      .insertInto('auditLog')
      .values(
        records.map((record) => ({
          actorType: actor.type,
          actorId: actor.id,
          actorLabel: actor.label,
          action: record.action,
          projectId: record.projectId,
          environmentKey: record.environmentKey,
          resourceType: record.resourceType,
          resourceKey: record.resourceKey,
          before: json(record.before),
          after: json(record.after),
          requestId,
        })),
      )
      .returningAll()
      .execute();

    for (const [i, row] of rows.entries()) {
      const record = records[i]!;
      if (!row.projectId || !record.projectKey) continue;
      await this.bus.publish({
        type: 'audit.created',
        projectId: row.projectId,
        projectKey: record.projectKey,
        entry: {
          id: row.id,
          action: row.action,
          environmentKey: row.environmentKey,
          resourceKey: row.resourceKey,
          actorLabel: row.actorLabel,
          at: row.at.toISOString(),
        },
      });
      if (row.action.startsWith('flag.')) {
        try {
          await this.webhooks.dispatch(row.projectId, toWebhookEvent(row, record.projectKey));
        } catch (error) {
          // The change and its audit entry are stored. A queue failure must not turn the request into an error.
          this.logger.error(`could not queue webhooks for audit entry ${row.id}: ${String(error)}`);
        }
      }
    }
    return rows;
  }

  async list(projectId: string, filter: { environment?: string; flag?: string; limit: number; before?: string }): Promise<AuditRow[]> {
    let query = this.db.selectFrom('auditLog').selectAll().where('projectId', '=', projectId);
    if (filter.environment) query = query.where('environmentKey', '=', filter.environment);
    if (filter.flag) query = query.where('resourceType', '=', 'flag').where('resourceKey', '=', filter.flag);
    if (filter.before) query = query.where('id', '<', filter.before);
    return query.orderBy('id', 'desc').limit(filter.limit).execute();
  }
}

export function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
