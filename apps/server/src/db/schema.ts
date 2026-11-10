import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { FlagKind, Role, ApiKeyKind, Rule, Serve, Target, Variation, JsonValue } from '@flagken/shared';
import type { ChangeMessage } from '../live/change-bus.js';

/** JSONB columns: read as objects, written as JSON text. */
type Json<T> = ColumnType<T, string, string>;
type CreatedAt = ColumnType<Date, never, never>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Generated<Date>;
  disabledAt: Date | null;
}

export interface ProjectsTable {
  id: Generated<string>;
  key: string;
  name: string;
  createdAt: Generated<Date>;
}

export interface EnvironmentsTable {
  id: Generated<string>;
  projectId: string;
  key: string;
  name: string;
  sortOrder: number;
  createdAt: Generated<Date>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  environmentId: string;
  kind: ApiKeyKind;
  name: string;
  /** First characters of the key, safe to show. */
  prefix: string;
  /** SHA-256 of the whole key. The key itself is shown once and never stored. */
  keyHash: string;
  createdBy: string | null;
  createdAt: Generated<Date>;
  revokedAt: Date | null;
}

export interface FlagsTable {
  id: Generated<string>;
  projectId: string;
  key: string;
  name: string;
  description: string;
  kind: FlagKind;
  variations: Json<Variation[]>;
  tags: Json<string[]>;
  version: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  archivedAt: Date | null;
}

export interface FlagStatesTable {
  flagId: string;
  environmentId: string;
  on: boolean;
  killed: boolean;
  offVariation: number;
  fallthrough: Json<Serve>;
  targets: Json<Target[]>;
  rules: Json<Rule[]>;
  version: Generated<number>;
  updatedAt: Generated<Date>;
}

export interface AuditLogTable {
  id: Generated<string>;
  at: Generated<Date>;
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
  action: string;
  projectId: string | null;
  environmentKey: string | null;
  resourceType: string;
  resourceKey: string;
  before: Json<JsonValue | null>;
  after: Json<JsonValue | null>;
  requestId: string | null;
}

export interface WebhooksTable {
  id: Generated<string>;
  projectId: string;
  name: string;
  url: string;
  secret: string;
  events: Json<string[]>;
  active: boolean;
  createdAt: Generated<Date>;
}

export interface WebhookDeliveriesTable {
  id: Generated<string>;
  webhookId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  createdAt: CreatedAt;
}

export interface ScheduledChangesTable {
  id: Generated<string>;
  flagId: string;
  environmentId: string;
  runAt: Date;
  change: Json<ScheduledChange>;
  status: 'pending' | 'done' | 'failed' | 'cancelled';
  createdBy: string | null;
  createdAt: Generated<Date>;
  executedAt: Date | null;
  error: string | null;
}

/** What a scheduled change does when it runs. Fields left out stay as they are. */
export interface ScheduledChange {
  on?: boolean;
  fallthrough?: Serve;
}

/** Events of a committed flag change, written in the same transaction, sent by the outbox relay. */
export interface OutboxTable {
  id: Generated<string>;
  createdAt: Generated<Date>;
  /** Change messages to publish on the Redis channel, in order. */
  messages: Json<ChangeMessage[]>;
  /** The audit entry whose webhooks the relay queues, for flag events. */
  webhookAuditId: string | null;
  attempts: Generated<number>;
  lastError: string | null;
  sentAt: Date | null;
}

export interface Database {
  users: UsersTable;
  projects: ProjectsTable;
  environments: EnvironmentsTable;
  apiKeys: ApiKeysTable;
  flags: FlagsTable;
  flagStates: FlagStatesTable;
  auditLog: AuditLogTable;
  outbox: OutboxTable;
  webhooks: WebhooksTable;
  webhookDeliveries: WebhookDeliveriesTable;
  scheduledChanges: ScheduledChangesTable;
}

export type User = Selectable<UsersTable>;
export type Project = Selectable<ProjectsTable>;
export type Environment = Selectable<EnvironmentsTable>;
export type ApiKeyRow = Selectable<ApiKeysTable>;
export type FlagRow = Selectable<FlagsTable>;
export type FlagStateRow = Selectable<FlagStatesTable>;
export type AuditRow = Selectable<AuditLogTable>;
export type OutboxRow = Selectable<OutboxTable>;
export type WebhookRow = Selectable<WebhooksTable>;
export type NewAuditRow = Insertable<AuditLogTable>;
