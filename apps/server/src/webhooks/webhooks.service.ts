import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DB, json } from '../db/database.js';
import type { Database, WebhookRow } from '../db/schema.js';
import { AuditContext } from '../audit/audit-context.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { CreatedWebhookDto, WebhookDeliveryDto, WebhookDto } from '../common/dto.js';
import { BlockedTargetError, assertAllowedUrl } from './ssrf.js';
import type { TargetPolicy } from './ssrf.js';
import { generateWebhookSecret } from './signature.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';

export const TARGET_POLICY = Symbol('TARGET_POLICY');

function toDto(row: WebhookRow): WebhookDto {
  return { id: row.id, name: row.name, url: row.url, events: row.events, active: row.active, createdAt: row.createdAt.toISOString() };
}

/** Audit view of a webhook: never the secret. */
function auditView(row: WebhookRow) {
  return { name: row.name, url: row.url, events: row.events, active: row.active };
}

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(TARGET_POLICY) private readonly policy: TargetPolicy,
    private readonly projects: ProjectsService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  private async checkUrl(url: string): Promise<void> {
    try {
      await assertAllowedUrl(url, this.policy);
    } catch (error) {
      if (error instanceof BlockedTargetError) throw new BadRequestException(`webhook URL refused: ${error.message}`);
      throw error;
    }
  }

  private async getRow(projectId: string, id: string): Promise<WebhookRow> {
    const row = await this.db.selectFrom('webhooks').selectAll().where('id', '=', id).where('projectId', '=', projectId).executeTakeFirst();
    if (!row) throw new NotFoundException('no such webhook');
    return row;
  }

  async list(projectKey: string): Promise<WebhookDto[]> {
    const project = await this.projects.getProject(projectKey);
    const rows = await this.db.selectFrom('webhooks').selectAll().where('projectId', '=', project.id).orderBy('createdAt').execute();
    return rows.map(toDto);
  }

  async create(projectKey: string, input: { name: string; url: string; events: string[] }): Promise<CreatedWebhookDto> {
    const project = await this.projects.getProject(projectKey);
    await this.checkUrl(input.url);
    const row = await this.db
      .insertInto('webhooks')
      .values({
        projectId: project.id,
        name: input.name,
        url: input.url,
        events: json(input.events),
        secret: generateWebhookSecret(),
        active: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    AuditContext.record({
      action: 'webhook.created',
      projectId: project.id,
      projectKey,
      environmentKey: null,
      resourceType: 'webhook',
      resourceKey: row.id,
      before: null,
      after: auditView(row),
    });
    return { ...toDto(row), secret: row.secret };
  }

  async update(
    projectKey: string,
    id: string,
    input: { name: string; url: string; events: string[]; active: boolean },
  ): Promise<WebhookDto> {
    const project = await this.projects.getProject(projectKey);
    const before = await this.getRow(project.id, id);
    await this.checkUrl(input.url);
    const after = await this.db
      .updateTable('webhooks')
      .set({ name: input.name, url: input.url, events: json(input.events), active: input.active })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    AuditContext.record({
      action: 'webhook.updated',
      projectId: project.id,
      projectKey,
      environmentKey: null,
      resourceType: 'webhook',
      resourceKey: id,
      before: auditView(before),
      after: auditView(after),
    });
    return toDto(after);
  }

  async remove(projectKey: string, id: string): Promise<void> {
    const project = await this.projects.getProject(projectKey);
    const before = await this.getRow(project.id, id);
    await this.db.deleteFrom('webhooks').where('id', '=', id).execute();
    AuditContext.record({
      action: 'webhook.deleted',
      projectId: project.id,
      projectKey,
      environmentKey: null,
      resourceType: 'webhook',
      resourceKey: id,
      before: auditView(before),
      after: null,
    });
  }

  async deliveries(projectKey: string, id: string): Promise<WebhookDeliveryDto[]> {
    const project = await this.projects.getProject(projectKey);
    await this.getRow(project.id, id);
    const rows = await this.db
      .selectFrom('webhookDeliveries')
      .selectAll()
      .where('webhookId', '=', id)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      attempt: row.attempt,
      ok: row.ok,
      statusCode: row.statusCode,
      error: row.error,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Queues a ping event to 1 webhook, so an owner can check the receiver and its signature check. */
  async test(projectKey: string, id: string, actor: string): Promise<{ eventId: string }> {
    const project = await this.projects.getProject(projectKey);
    const row = await this.getRow(project.id, id);
    const eventId = `evt_test_${randomUUID()}`;
    await this.dispatcher.enqueue(row.id, {
      id: eventId,
      type: 'webhook.test',
      createdAt: new Date().toISOString(),
      project: projectKey,
      environment: null,
      resource: { type: 'webhook', key: row.id },
      actor: { type: 'user', label: actor },
      before: null,
      after: null,
    });
    return { eventId };
  }
}
