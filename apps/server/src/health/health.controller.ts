import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { Public } from '../auth/decorators.js';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import { REDIS } from '../redis/redis.js';
import { LiveService } from '../live/live.service.js';

@ApiTags('health')
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly live: LiveService,
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process answers. No dependency checks, so a database outage does not restart every instance. */
  @Get('live')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /** Readiness: PostgreSQL and Redis answer within 2 seconds, and the server is not shutting down. */
  @Get('ready')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.indicators
          .check('postgres')
          .attempt(async () => {
            await sql`select 1`.execute(this.db);
          })
          .withTimeout(2000),
      () =>
        this.indicators
          .check('redis')
          .attempt(async () => {
            const reply = await this.redis.ping();
            if (reply !== 'PONG') throw new Error(`unexpected reply ${reply}`);
          })
          .withTimeout(2000),
      () => {
        const session = this.indicators.check('shutdown');
        return this.live.isClosing ? session.down('shutting down') : session.up(this.live.counts);
      },
    ]);
  }
}
