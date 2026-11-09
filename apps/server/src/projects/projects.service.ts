import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ApiKeyKind } from '@flagken/shared';
import { DB } from '../db/database.js';
import type { ApiKeyRow, Database, Environment, Project } from '../db/schema.js';
import { AuditContext } from '../audit/audit-context.js';
import { ChangeBus } from '../live/change-bus.js';
import { generateApiKey } from '../auth/api-keys.js';
import type { ApiKeyDto, CreatedApiKeyDto, ProjectDto } from '../common/dto.js';

export const DEFAULT_ENVIRONMENTS = [
  { key: 'development', name: 'Development' },
  { key: 'staging', name: 'Staging' },
  { key: 'production', name: 'Production' },
];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function toApiKeyDto(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly bus: ChangeBus,
  ) {}

  async getProject(key: string): Promise<Project> {
    const project = await this.db.selectFrom('projects').selectAll().where('key', '=', key).executeTakeFirst();
    if (!project) throw new NotFoundException(`project ${key} does not exist`);
    return project;
  }

  async getEnvironment(projectKey: string, environmentKey: string): Promise<{ project: Project; environment: Environment }> {
    const project = await this.getProject(projectKey);
    const environment = await this.db
      .selectFrom('environments')
      .selectAll()
      .where('projectId', '=', project.id)
      .where('key', '=', environmentKey)
      .executeTakeFirst();
    if (!environment) throw new NotFoundException(`environment ${environmentKey} does not exist in ${projectKey}`);
    return { project, environment };
  }

  async list(): Promise<ProjectDto[]> {
    const projects = await this.db.selectFrom('projects').selectAll().orderBy('key').execute();
    const environments = await this.db.selectFrom('environments').selectAll().orderBy('sortOrder').orderBy('key').execute();
    return projects.map((p) => ({
      key: p.key,
      name: p.name,
      environments: environments.filter((e) => e.projectId === p.id).map((e) => ({ key: e.key, name: e.name })),
    }));
  }

  async create(key: string, name: string): Promise<ProjectDto> {
    try {
      const project = await this.db.transaction().execute(async (trx) => {
        const created = await trx.insertInto('projects').values({ key, name }).returningAll().executeTakeFirstOrThrow();
        await trx
          .insertInto('environments')
          .values(DEFAULT_ENVIRONMENTS.map((e, i) => ({ projectId: created.id, key: e.key, name: e.name, sortOrder: i })))
          .execute();
        return created;
      });
      AuditContext.record({
        action: 'project.created',
        projectId: project.id,
        projectKey: key,
        environmentKey: null,
        resourceType: 'project',
        resourceKey: key,
        before: null,
        after: { key, name, environments: DEFAULT_ENVIRONMENTS.map((e) => e.key) },
      });
      return { key, name, environments: DEFAULT_ENVIRONMENTS };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`project ${key} already exists`);
      throw error;
    }
  }

  async createEnvironment(projectKey: string, key: string, name: string): Promise<{ key: string; name: string }> {
    const project = await this.getProject(projectKey);
    try {
      await this.db.transaction().execute(async (trx) => {
        const count = await trx
          .selectFrom('environments')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('projectId', '=', project.id)
          .executeTakeFirstOrThrow();
        const environment = await trx
          .insertInto('environments')
          .values({ projectId: project.id, key, name, sortOrder: Number(count.n) })
          .returningAll()
          .executeTakeFirstOrThrow();
        // Every flag gets an off state in the new environment.
        const flags = await trx.selectFrom('flags').select(['id', 'kind', 'variations']).where('projectId', '=', project.id).execute();
        if (flags.length > 0) {
          await trx
            .insertInto('flagStates')
            .values(flags.map((f) => ({ flagId: f.id, environmentId: environment.id, ...initialState(f.kind, f.variations) })))
            .execute();
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(`environment ${key} already exists`);
      throw error;
    }
    AuditContext.record({
      action: 'environment.created',
      projectId: project.id,
      projectKey,
      environmentKey: key,
      resourceType: 'environment',
      resourceKey: key,
      before: null,
      after: { key, name },
    });
    return { key, name };
  }

  async listApiKeys(projectKey: string, environmentKey: string): Promise<ApiKeyDto[]> {
    const { environment } = await this.getEnvironment(projectKey, environmentKey);
    const rows = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('environmentId', '=', environment.id)
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map(toApiKeyDto);
  }

  async createApiKey(
    projectKey: string,
    environmentKey: string,
    name: string,
    kind: ApiKeyKind,
    userId: string | null,
  ): Promise<CreatedApiKeyDto> {
    const { project, environment } = await this.getEnvironment(projectKey, environmentKey);
    const generated = generateApiKey(kind);
    const row = await this.db
      .insertInto('apiKeys')
      .values({ environmentId: environment.id, kind, name, prefix: generated.prefix, keyHash: generated.hash, createdBy: userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    // The audit entry names the key by prefix only. The key itself never reaches the log.
    AuditContext.record({
      action: 'api-key.created',
      projectId: project.id,
      projectKey,
      environmentKey,
      resourceType: 'api-key',
      resourceKey: row.id,
      before: null,
      after: { name, kind, prefix: row.prefix },
    });
    return { ...toApiKeyDto(row), key: generated.key };
  }

  async revokeApiKey(projectKey: string, environmentKey: string, id: string): Promise<void> {
    const { project, environment } = await this.getEnvironment(projectKey, environmentKey);
    const row = await this.db
      .updateTable('apiKeys')
      .set({ revokedAt: new Date() })
      .where('id', '=', id)
      .where('environmentId', '=', environment.id)
      .where('revokedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('no active API key with that id in this environment');
    AuditContext.record({
      action: 'api-key.revoked',
      projectId: project.id,
      projectKey,
      environmentKey,
      resourceType: 'api-key',
      resourceKey: row.id,
      before: { name: row.name, kind: row.kind, prefix: row.prefix, revoked: false },
      after: { name: row.name, kind: row.kind, prefix: row.prefix, revoked: true },
    });
    // Live streams opened with the key close on every instance.
    await this.bus.publish({ type: 'api-key.revoked', keyId: row.id });
  }
}

/** The state a flag starts with in an environment: off, then the first variation when turned on (true for a boolean). */
export function initialState(kind: string, variations: Array<{ value: unknown }>) {
  const trueIndex = variations.findIndex((v) => v.value === true);
  const falseIndex = variations.findIndex((v) => v.value === false);
  const isBoolean = kind === 'boolean' && trueIndex >= 0 && falseIndex >= 0;
  return {
    on: false,
    killed: false,
    offVariation: isBoolean ? falseIndex : 0,
    fallthrough: JSON.stringify({ variation: isBoolean ? trueIndex : 0 }),
    targets: '[]',
    rules: '[]',
  };
}
