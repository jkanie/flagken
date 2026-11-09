import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import { validateEnvironmentState } from '@flagken/shared';
import { DB, json } from '../db/database.js';
import type { Database, ScheduledChange } from '../db/schema.js';
import { AuditContext } from '../audit/audit-context.js';
import { AuditService } from '../audit/audit.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { ShapeError, parseServe } from '../flags/shape.js';
import { ProjectsService } from '../projects/projects.service.js';
import type { ScheduledChangeDto } from '../common/dto.js';
import { SCHEDULE_QUEUE } from './queues.js';
import type { ScheduleJob } from './queues.js';

const YEAR_MS = 366 * 24 * 3600 * 1000;

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @InjectQueue(SCHEDULE_QUEUE) private readonly queue: Queue<ScheduleJob>,
    private readonly projects: ProjectsService,
    private readonly flags: FlagsService,
    private readonly audit: AuditService,
  ) {}

  private async locate(projectKey: string, flagKey: string, environmentKey: string) {
    const { project, environment } = await this.projects.getEnvironment(projectKey, environmentKey);
    const flag = await this.db
      .selectFrom('flags')
      .selectAll()
      .where('projectId', '=', project.id)
      .where('key', '=', flagKey)
      .executeTakeFirst();
    if (!flag) throw new NotFoundException(`flag ${flagKey} does not exist`);
    return { project, environment, flag };
  }

  async list(projectKey: string, flagKey: string, environmentKey: string): Promise<ScheduledChangeDto[]> {
    const { flag, environment } = await this.locate(projectKey, flagKey, environmentKey);
    const rows = await this.db
      .selectFrom('scheduledChanges')
      .selectAll()
      .where('flagId', '=', flag.id)
      .where('environmentId', '=', environment.id)
      .orderBy('runAt', 'desc')
      .limit(100)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      environment: environmentKey,
      runAt: row.runAt.toISOString(),
      change: row.change,
      status: row.status,
      executedAt: row.executedAt?.toISOString() ?? null,
      error: row.error,
    }));
  }

  async create(
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    runAtText: string,
    input: { on?: unknown; fallthrough?: unknown },
    userId: string | null,
  ): Promise<ScheduledChangeDto> {
    const { project, environment, flag } = await this.locate(projectKey, flagKey, environmentKey);
    const runAt = new Date(runAtText);
    const delay = runAt.getTime() - Date.now();
    if (Number.isNaN(delay) || delay < 0 || delay > YEAR_MS) {
      throw new BadRequestException('runAt must be a time from now to 1 year ahead');
    }
    const change: ScheduledChange = {};
    try {
      if (input.on !== undefined) {
        if (typeof input.on !== 'boolean') throw new ShapeError('change.on must be true or false');
        change.on = input.on;
      }
      if (input.fallthrough !== undefined) change.fallthrough = parseServe(input.fallthrough, 'change.fallthrough');
    } catch (error) {
      if (error instanceof ShapeError) throw new UnprocessableEntityException([error.message]);
      throw error;
    }
    if (change.on === undefined && change.fallthrough === undefined) {
      throw new UnprocessableEntityException(['change needs on, fallthrough or both']);
    }
    if (change.fallthrough) {
      const errors = validateEnvironmentState(
        { on: true, killed: false, offVariation: 0, fallthrough: change.fallthrough, targets: [], rules: [] },
        flag.variations.length,
      );
      if (errors.length) throw new UnprocessableEntityException(errors);
    }
    const row = await this.db
      .insertInto('scheduledChanges')
      .values({ flagId: flag.id, environmentId: environment.id, runAt, change: json(change), status: 'pending', createdBy: userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.queue.add(
      'run',
      { scheduleId: row.id },
      { jobId: row.id, delay, attempts: 3, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true, removeOnFail: 1000 },
    );
    AuditContext.record({
      action: 'flag.schedule.created',
      projectId: project.id,
      projectKey,
      environmentKey,
      resourceType: 'flag',
      resourceKey: flagKey,
      before: null,
      after: { schedule: row.id, runAt: runAt.toISOString(), change: change as never },
    });
    return {
      id: row.id,
      environment: environmentKey,
      runAt: runAt.toISOString(),
      change,
      status: 'pending',
      executedAt: null,
      error: null,
    };
  }

  async cancel(projectKey: string, flagKey: string, environmentKey: string, id: string): Promise<void> {
    const { project, environment, flag } = await this.locate(projectKey, flagKey, environmentKey);
    const row = await this.db
      .updateTable('scheduledChanges')
      .set({ status: 'cancelled' })
      .where('id', '=', id)
      .where('flagId', '=', flag.id)
      .where('environmentId', '=', environment.id)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundException('no pending scheduled change with that id');
    await this.queue.remove(id).catch(() => 0);
    AuditContext.record({
      action: 'flag.schedule.cancelled',
      projectId: project.id,
      projectKey,
      environmentKey,
      resourceType: 'flag',
      resourceKey: flagKey,
      before: { schedule: id, runAt: row.runAt.toISOString(), change: row.change as never },
      after: null,
    });
  }

  /** Runs 1 scheduled change. The worker calls this when the delay ends. */
  async run(scheduleId: string): Promise<'done' | 'skipped' | 'failed'> {
    const row = await this.db
      .selectFrom('scheduledChanges as c')
      .innerJoin('flags as f', 'f.id', 'c.flagId')
      .innerJoin('environments as e', 'e.id', 'c.environmentId')
      .innerJoin('projects as p', 'p.id', 'f.projectId')
      .leftJoin('users as u', 'u.id', 'c.createdBy')
      .selectAll('c')
      .select(['f.key as flagKey', 'e.key as environmentKey', 'p.key as projectKey', 'u.email as createdByEmail'])
      .where('c.id', '=', scheduleId)
      .executeTakeFirst();
    if (!row || row.status !== 'pending') return 'skipped';
    try {
      const { audit } = await this.flags.applyScheduledChange(row.projectKey, row.flagKey, row.environmentKey, row.change);
      await this.audit.write(
        [audit],
        {
          type: 'system',
          id: null,
          label: `scheduled change ${row.id}${row.createdByEmail ? ` set by ${row.createdByEmail}` : ''}`,
        },
        null,
      );
      await this.db.updateTable('scheduledChanges').set({ status: 'done', executedAt: new Date() }).where('id', '=', row.id).execute();
      return 'done';
    } catch (error) {
      // A change that no longer fits the flag (a 4xx) will not fit on a retry either.
      if (error instanceof HttpException && error.getStatus() < 500) {
        await this.db
          .updateTable('scheduledChanges')
          .set({ status: 'failed', executedAt: new Date(), error: error.message })
          .where('id', '=', row.id)
          .execute();
        this.logger.warn(`scheduled change ${row.id} failed: ${error.message}`);
        return 'failed';
      }
      throw error;
    }
  }
}
