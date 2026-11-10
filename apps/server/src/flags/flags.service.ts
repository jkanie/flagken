import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { validateEnvironmentState, validateVariations } from '@flagken/shared';
import type { FlagConfig, FlagEnvironmentState, FlagKind, JsonValue } from '@flagken/shared';
import { DB, json } from '../db/database.js';
import type { Database, Environment, FlagRow, FlagStateRow, Project, ScheduledChange } from '../db/schema.js';
import { AuditContext } from '../audit/audit-context.js';
import type { AuditMeta, AuditRecord } from '../audit/audit-context.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../audit/audit.service.js';
import { OutboxRelay } from '../audit/outbox-relay.js';
import type { ChangeMessage } from '../live/change-bus.js';
import { ProjectsService, initialState } from '../projects/projects.service.js';
import type { FlagDto, FlagListItemDto, FlagStateDto } from '../common/dto.js';
import { ShapeError, parseRules, parseServe, parseTargets, parseVariations } from './shape.js';

export function toFlagDto(flag: FlagRow): FlagDto {
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    kind: flag.kind,
    variations: flag.variations,
    tags: flag.tags,
    version: flag.version,
    archived: flag.archivedAt !== null,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
  };
}

export function toStateDto(environmentKey: string, state: FlagStateRow): FlagStateDto {
  return {
    environment: environmentKey,
    on: state.on,
    killed: state.killed,
    offVariation: state.offVariation,
    fallthrough: state.fallthrough,
    targets: state.targets,
    rules: state.rules,
    version: state.version,
    updatedAt: state.updatedAt.toISOString(),
  };
}

/** What an SDK gets. The version adds both counters, so it grows on any change to the flag or its state. */
export function toFlagConfig(flag: FlagRow, state: FlagStateRow): FlagConfig {
  return {
    key: flag.key,
    kind: flag.kind,
    variations: flag.variations,
    version: flag.version + state.version,
    on: state.on,
    killed: state.killed,
    offVariation: state.offVariation,
    fallthrough: state.fallthrough,
    targets: state.targets,
    rules: state.rules,
  };
}

function stateAudit(state: FlagStateRow): JsonValue {
  return {
    on: state.on,
    killed: state.killed,
    offVariation: state.offVariation,
    fallthrough: state.fallthrough as unknown as JsonValue,
    targets: state.targets as unknown as JsonValue,
    rules: state.rules as unknown as JsonValue,
    version: state.version,
  };
}

function flagAudit(flag: FlagRow): JsonValue {
  return {
    name: flag.name,
    description: flag.description,
    kind: flag.kind,
    variations: flag.variations as unknown as JsonValue,
    tags: flag.tags,
    version: flag.version,
    archived: flag.archivedAt !== null,
  };
}

function shape<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ShapeError) throw new UnprocessableEntityException([error.message]);
    throw error;
  }
}

export interface Changer {
  label: string;
}

@Injectable()
export class FlagsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly projects: ProjectsService,
    private readonly auditLog: AuditService,
    private readonly relay: OutboxRelay,
  ) {}

  /**
   * Stores the audit entry and the outbox row of 1 flag change in the change's own transaction. The relay sends
   * the events after the commit, so a change never commits without its entry, and an entry never without its events.
   */
  private record(trx: Transaction<Database>, record: AuditRecord, message: ChangeMessage, meta?: AuditMeta) {
    const anonymous: Actor = { type: 'system', id: null, label: 'anonymous' };
    const who = meta ?? AuditContext.meta() ?? { actor: anonymous, requestId: null };
    return this.auditLog.writeInTransaction(trx, record, who.actor, who.requestId, [message]);
  }

  private async getFlagRow(project: Project, key: string, db: Kysely<Database> | Transaction<Database> = this.db) {
    const flag = await db.selectFrom('flags').selectAll().where('projectId', '=', project.id).where('key', '=', key).executeTakeFirst();
    if (!flag) throw new NotFoundException(`flag ${key} does not exist in ${project.key}`);
    return flag;
  }

  async list(projectKey: string, environmentKey: string, search: string | undefined): Promise<FlagListItemDto[]> {
    const { project, environment } = await this.projects.getEnvironment(projectKey, environmentKey);
    let query = this.db
      .selectFrom('flags as f')
      .innerJoin('flagStates as s', 's.flagId', 'f.id')
      .selectAll('f')
      .select(['s.on', 's.killed', 's.version as stateVersion', 's.rules'])
      .where('f.projectId', '=', project.id)
      .where('s.environmentId', '=', environment.id)
      .where('f.archivedAt', 'is', null);
    const term = search?.trim();
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      query = query.where((eb) => eb.or([eb('f.key', 'ilike', like), eb('f.name', 'ilike', like), eb('f.description', 'ilike', like)]));
    }
    const rows = await query.orderBy('f.key').limit(500).execute();
    return rows.map((row) => ({
      ...toFlagDto(row),
      state: { on: row.on, killed: row.killed, version: row.stateVersion, rules: row.rules.length },
    }));
  }

  async get(projectKey: string, key: string): Promise<FlagDto> {
    const project = await this.projects.getProject(projectKey);
    return toFlagDto(await this.getFlagRow(project, key));
  }

  async create(
    projectKey: string,
    input: { key: string; name: string; description?: string; kind: FlagKind; variations: unknown; tags?: string[] },
  ): Promise<FlagDto> {
    const project = await this.projects.getProject(projectKey);
    const variations = shape(() => parseVariations(input.variations));
    const errors = validateVariations(input.kind, variations);
    if (errors.length) throw new UnprocessableEntityException(errors);
    const flag = await this.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('flags')
        .values({
          projectId: project.id,
          key: input.key,
          name: input.name,
          description: input.description ?? '',
          kind: input.kind,
          variations: json(variations),
          tags: json(input.tags ?? []),
        })
        .onConflict((oc) => oc.columns(['projectId', 'key']).doNothing())
        .returningAll()
        .executeTakeFirst();
      if (!created) throw new ConflictException(`flag ${input.key} already exists`);
      const environments = await trx.selectFrom('environments').select('id').where('projectId', '=', project.id).execute();
      await trx
        .insertInto('flagStates')
        .values(environments.map((e) => ({ flagId: created.id, environmentId: e.id, ...initialState(input.kind, variations) })))
        .execute();
      await this.record(
        trx,
        this.audit('flag.created', project, null, created.key, null, flagAudit(created)),
        this.changed(project, null, created.key, created.version, 'flag created'),
      );
      return created;
    });
    await this.relay.drain();
    return toFlagDto(flag);
  }

  async update(
    projectKey: string,
    key: string,
    expected: number | undefined,
    input: { name: string; description: string; variations: unknown; tags: string[] },
  ): Promise<FlagDto> {
    const project = await this.projects.getProject(projectKey);
    const variations = shape(() => parseVariations(input.variations));
    const after = await this.db.transaction().execute(async (trx) => {
      const before = await this.getFlagRow(project, key, trx);
      if (expected !== undefined && before.version !== expected) {
        throw new PreconditionFailedException(`flag ${key} changed since you read it (now version ${before.version})`);
      }
      const errors = validateVariations(before.kind, variations);
      // Fewer variations must not leave any environment pointing at one that is gone.
      const states = await trx
        .selectFrom('flagStates as s')
        .innerJoin('environments as e', 'e.id', 's.environmentId')
        .selectAll('s')
        .select('e.key as environmentKey')
        .where('s.flagId', '=', before.id)
        .execute();
      for (const state of states) {
        for (const problem of validateEnvironmentState(state, variations.length)) {
          errors.push(`${state.environmentKey}: ${problem}`);
        }
      }
      if (errors.length) throw new UnprocessableEntityException(errors);
      const after = await trx
        .updateTable('flags')
        .set((eb) => ({
          name: input.name,
          description: input.description,
          variations: json(variations),
          tags: json(input.tags),
          version: eb('version', '+', 1),
          updatedAt: new Date(),
        }))
        .where('id', '=', before.id)
        .where('version', '=', before.version)
        .returningAll()
        .executeTakeFirst();
      if (!after) throw new PreconditionFailedException(`flag ${key} changed while saving`);
      await this.record(
        trx,
        this.audit('flag.updated', project, null, key, flagAudit(before), flagAudit(after)),
        this.changed(project, null, key, after.version, 'flag updated'),
      );
      return after;
    });
    await this.relay.drain();
    return toFlagDto(after);
  }

  async archive(projectKey: string, key: string): Promise<void> {
    const project = await this.projects.getProject(projectKey);
    const archived = await this.db.transaction().execute(async (trx) => {
      const before = await this.getFlagRow(project, key, trx);
      if (before.archivedAt) return false;
      const after = await trx
        .updateTable('flags')
        .set((eb) => ({ archivedAt: new Date(), version: eb('version', '+', 1), updatedAt: new Date() }))
        .where('id', '=', before.id)
        .where('archivedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!after) return false;
      await this.record(
        trx,
        this.audit('flag.archived', project, null, key, flagAudit(before), flagAudit(after)),
        this.changed(project, null, key, after.version, 'flag archived'),
      );
      return true;
    });
    if (archived) await this.relay.drain();
  }

  async getState(projectKey: string, key: string, environmentKey: string): Promise<FlagStateDto> {
    const { project, environment } = await this.projects.getEnvironment(projectKey, environmentKey);
    const flag = await this.getFlagRow(project, key);
    const state = await this.db
      .selectFrom('flagStates')
      .selectAll()
      .where('flagId', '=', flag.id)
      .where('environmentId', '=', environment.id)
      .executeTakeFirstOrThrow();
    return toStateDto(environmentKey, state);
  }

  /** Replaces the targeting of a flag in 1 environment. The kill switch has its own call. */
  async updateState(
    projectKey: string,
    key: string,
    environmentKey: string,
    expected: number | undefined,
    input: { on: boolean; offVariation: unknown; fallthrough: unknown; targets: unknown; rules: unknown },
  ): Promise<FlagStateDto> {
    const next = shape(() => ({
      on: input.on,
      offVariation: typeof input.offVariation === 'number' && Number.isInteger(input.offVariation) ? input.offVariation : -1,
      fallthrough: parseServe(input.fallthrough, 'fallthrough'),
      targets: parseTargets(input.targets),
      rules: parseRules(input.rules),
    }));
    return this.changeState(projectKey, key, environmentKey, 'flag.state.updated', expected, (current) => ({ ...current, ...next }), {
      label: 'state updated',
    });
  }

  /** Kill switch: no If-Match, because in an incident the newest state must not block it. */
  async setKilled(projectKey: string, key: string, environmentKey: string, killed: boolean): Promise<FlagStateDto> {
    return this.changeState(
      projectKey,
      key,
      environmentKey,
      killed ? 'flag.killed' : 'flag.unkilled',
      undefined,
      (current) => ({ ...current, killed }),
      { label: killed ? 'kill switch on' : 'kill switch off' },
    );
  }

  /** Runs a scheduled change. Called by the BullMQ worker, outside any HTTP request, so the caller names the actor. */
  async applyScheduledChange(
    projectKey: string,
    key: string,
    environmentKey: string,
    change: ScheduledChange,
    actor: Actor,
  ): Promise<FlagStateDto> {
    return this.changeState(
      projectKey,
      key,
      environmentKey,
      'flag.schedule.executed',
      undefined,
      (current) => ({
        ...current,
        ...(change.on !== undefined ? { on: change.on } : {}),
        ...(change.fallthrough !== undefined ? { fallthrough: change.fallthrough } : {}),
      }),
      { label: 'scheduled change' },
      { actor, requestId: null },
    );
  }

  private async changeState(
    projectKey: string,
    key: string,
    environmentKey: string,
    action: string,
    expected: number | undefined,
    change: (current: FlagEnvironmentState) => FlagEnvironmentState,
    changer: Changer,
    meta?: AuditMeta,
  ): Promise<FlagStateDto> {
    const { project, environment } = await this.projects.getEnvironment(projectKey, environmentKey);
    const flag = await this.getFlagRow(project, key);
    if (flag.archivedAt) throw new ConflictException(`flag ${key} is archived`);
    const after = await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('flagStates')
        .selectAll()
        .where('flagId', '=', flag.id)
        .where('environmentId', '=', environment.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (expected !== undefined && before.version !== expected) {
        throw new PreconditionFailedException(`flag ${key} in ${environmentKey} changed since you read it (now version ${before.version})`);
      }
      const next = change(before);
      const errors = validateEnvironmentState(next, flag.variations.length);
      if (errors.length) throw new UnprocessableEntityException(errors);
      // The version check in the WHERE clause makes the compare and the write 1 step.
      const after = await trx
        .updateTable('flagStates')
        .set((eb) => ({
          on: next.on,
          killed: next.killed,
          offVariation: next.offVariation,
          fallthrough: json(next.fallthrough),
          targets: json(next.targets),
          rules: json(next.rules),
          version: eb('version', '+', 1),
          updatedAt: new Date(),
        }))
        .where('flagId', '=', flag.id)
        .where('environmentId', '=', environment.id)
        .where('version', '=', before.version)
        .returningAll()
        .executeTakeFirst();
      if (!after) throw new PreconditionFailedException(`flag ${key} changed while saving`);
      await this.record(
        trx,
        this.audit(action, project, environment, key, stateAudit(before), stateAudit(after)),
        this.changed(project, environment, key, flag.version + after.version, changer.label),
        meta,
      );
      return after;
    });
    await this.relay.drain();
    return toStateDto(environmentKey, after);
  }

  /** All live flags of an environment, as SDKs see them. */
  async configsFor(environmentId: string, flagKey?: string): Promise<Array<FlagConfig & { archived: boolean }>> {
    let query = this.db
      .selectFrom('flags as f')
      .innerJoin('flagStates as s', 's.flagId', 'f.id')
      .selectAll('f')
      .select([
        's.on',
        's.killed',
        's.offVariation',
        's.fallthrough',
        's.targets',
        's.rules',
        's.version as stateVersion',
        's.environmentId',
        's.flagId',
        's.updatedAt as stateUpdatedAt',
      ])
      .where('s.environmentId', '=', environmentId);
    query = flagKey ? query.where('f.key', '=', flagKey) : query.where('f.archivedAt', 'is', null);
    const rows = await query.orderBy('f.key').execute();
    return rows.map((row) => ({
      ...toFlagConfig(row, {
        flagId: row.flagId,
        environmentId: row.environmentId,
        on: row.on,
        killed: row.killed,
        offVariation: row.offVariation,
        fallthrough: row.fallthrough,
        targets: row.targets,
        rules: row.rules,
        version: row.stateVersion,
        updatedAt: row.stateUpdatedAt,
      }),
      archived: row.archivedAt !== null,
    }));
  }

  private audit(
    action: string,
    project: Project,
    environment: Environment | null,
    key: string,
    before: JsonValue | null,
    after: JsonValue | null,
  ): AuditRecord {
    return {
      action,
      projectId: project.id,
      projectKey: project.key,
      environmentKey: environment?.key ?? null,
      resourceType: 'flag',
      resourceKey: key,
      before,
      after,
    };
  }

  private changed(project: Project, environment: Environment | null, flagKey: string, version: number, summary: string): ChangeMessage {
    return {
      type: 'flag.changed',
      projectId: project.id,
      projectKey: project.key,
      environmentId: environment?.id ?? null,
      environmentKey: environment?.key ?? null,
      flagKey,
      version,
      summary,
    };
  }
}
