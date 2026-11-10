import { BullModule } from '@nestjs/bullmq';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown, Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { CONFIG } from './config.js';
import type { Config } from './config.js';
import { DB, createDatabase } from './db/database.js';
import type { Database } from './db/schema.js';
import { REDIS, createRedis } from './redis/redis.js';
import { AuthGuard } from './auth/auth.guard.js';
import { ApiKeyService } from './auth/api-key.service.js';
import { AuthController, UsersController } from './auth/auth.controller.js';
import { LOGIN_THROTTLE } from './auth/decorators.js';
import { SessionService } from './auth/session.js';
import { RedisThrottlerStorage } from './auth/throttler-storage.js';
import { UsersService } from './auth/users.service.js';
import { AuditController } from './audit/audit.controller.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuditService } from './audit/audit.service.js';
import { OutboxRelay } from './audit/outbox-relay.js';
import { FlagsController } from './flags/flags.controller.js';
import { FlagsService } from './flags/flags.service.js';
import { HealthController } from './health/health.controller.js';
import { ScheduleProcessor, WebhookProcessor } from './jobs/processors.js';
import { SCHEDULE_QUEUE, WEBHOOK_QUEUE } from './jobs/queues.js';
import { SchedulesController } from './jobs/schedules.controller.js';
import { SchedulesService } from './jobs/schedules.service.js';
import { ChangeBus } from './live/change-bus.js';
import { ConsoleGateway } from './live/console.gateway.js';
import { LiveService } from './live/live.service.js';
import { MetricsController } from './metrics/metrics.controller.js';
import { MetricsService } from './metrics/metrics.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { SdkController } from './sdk/sdk.controller.js';
import { WebhookDispatcher } from './webhooks/webhook-dispatcher.js';
import { TARGET_POLICY, WebhooksService } from './webhooks/webhooks.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import type { TargetPolicy } from './webhooks/ssrf.js';

export interface AppOptions {
  /** Replaces the webhook address policy (tests use this to point webhooks at a local receiver). */
  targetPolicy?: TargetPolicy;
}

/** Closes the PostgreSQL pool and the Redis client last, after every other module has stopped. */
@Injectable()
class ConnectionCloser implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
    await this.db.destroy();
  }
}

/** Settings and connections every module uses. */
@Global()
@Module({})
class CoreModule {
  static forRoot(config: Config, options: AppOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      { provide: DB, useFactory: () => createDatabase(config.databaseUrl) },
      { provide: REDIS, useFactory: () => createRedis(config.redisUrl, 'flagken') },
      { provide: TARGET_POLICY, useValue: options.targetPolicy ?? { allowPrivate: config.allowPrivateTargets } },
      ConnectionCloser,
    ];
    return { module: CoreModule, providers, exports: [CONFIG, DB, REDIS, TARGET_POLICY] };
  }
}

@Module({})
export class AppModule {
  static forRoot(config: Config, options: AppOptions = {}): DynamicModule {
    const prefix = `${config.redisPrefix}:bull`;
    const workers: Provider[] = config.workersEnabled ? [ScheduleProcessor, WebhookProcessor] : [];
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config, options),
        TerminusModule.forRoot({ logger: false }),
        BullModule.forRoot({ connection: { url: config.redisUrl, maxRetriesPerRequest: null }, prefix }),
        BullModule.registerQueue({ name: WEBHOOK_QUEUE }, { name: SCHEDULE_QUEUE }),
        ThrottlerModule.forRootAsync({
          inject: [REDIS],
          useFactory: (redis: Redis) => ({
            storage: new RedisThrottlerStorage(redis, config.redisPrefix),
            throttlers: [
              { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
              {
                name: 'login',
                ttl: 60_000,
                limit: config.loginRateLimitPerMinute,
                blockDuration: 60_000,
                skipIf: (context: ExecutionContext) => !new Reflector().get<boolean>(LOGIN_THROTTLE, context.getHandler()),
              },
            ],
          }),
        }),
      ],
      controllers: [
        AuthController,
        UsersController,
        ProjectsController,
        FlagsController,
        SchedulesController,
        WebhooksController,
        AuditController,
        SdkController,
        HealthController,
        MetricsController,
      ],
      providers: [
        // Guards run in this order: rate limit first, then sign-in and role.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        AuthGuard,
        SessionService,
        ApiKeyService,
        UsersService,
        ProjectsService,
        FlagsService,
        SchedulesService,
        AuditService,
        OutboxRelay,
        WebhookDispatcher,
        WebhooksService,
        ChangeBus,
        LiveService,
        ConsoleGateway,
        MetricsService,
        ...workers,
      ],
    };
  }
}
