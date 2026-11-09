import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { INestApplication, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Kysely } from 'kysely';
import { AppModule } from './app.module.js';
import type { AppOptions } from './app.module.js';
import type { Config } from './config.js';
import { DB } from './db/database.js';
import type { Database } from './db/schema.js';
import { migrateToLatest } from './db/migrations.js';
import { SESSION_COOKIE } from './auth/session.js';

const LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const document = new DocumentBuilder()
    .setTitle('flagken')
    .setDescription('Self-hosted feature flags. Console routes use the session cookie, SDK routes an environment API key.')
    .setVersion('0.1.0')
    .setLicense('MIT', 'https://opensource.org/license/mit')
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE }, 'session')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Environment API key: fk_srv_... or fk_cli_...' }, 'apiKey')
    .addSecurityRequirements('session')
    .build();
  return SwaggerModule.createDocument(app, document, {
    operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, '')}_${method}`,
  });
}

/** Builds the Nest application with every HTTP setting. main.ts, the tests, the OpenAPI script share it. */
export async function createApp(config: Config, options: AppOptions & { preview?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, options), {
    logger: LEVELS.slice(0, LEVELS.indexOf(config.logLevel) + 1),
    bodyParser: false,
    // Ends idle keep-alive sockets on close, so shutdown does not wait for them.
    forceCloseConnections: true,
    abortOnError: false,
    ...(options.preview ? { preview: true } : {}),
  });

  if (!options.preview) {
    await migrate(app, config);
  }

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const incoming = request.header('x-request-id');
    request.requestId = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI at /docs needs inline styles.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // JSON only: no form or text parsers, so a cross-site HTML form cannot post to the API.
  app.useBodyParser('json', { limit: '256kb' });
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    credentials: true,
    exposedHeaders: ['ETag', 'X-Request-Id'],
    allowedHeaders: ['Content-Type', 'If-Match', 'Authorization', 'X-Flagken-Context', 'X-Request-Id'],
  });
  if (config.consoleDir) serveConsole(app, config.consoleDir);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  if (config.docsEnabled && !options.preview) {
    SwaggerModule.setup('docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'docs/openapi.json' });
  }
  return app;
}

const SERVER_PATHS = /^\/(api|sdk|health|metrics|docs|ws)(\/|$)/;

/**
 * Serves the built console from the same origin as the API, so the session cookie stays SameSite=Strict and the
 * WebSocket origin check passes. Unknown paths outside the API return index.html for the Vue router.
 */
function serveConsole(app: NestExpressApplication, dir: string): void {
  const root = resolve(dir);
  app.useStaticAssets(root, { index: false, maxAge: '1h', immutable: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' || SERVER_PATHS.test(request.path) || !request.accepts('html')) return next();
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(join(root, 'index.html'));
  });
}

async function migrate(app: INestApplication, config: Config): Promise<void> {
  if (!config.migrateOnStart) return;
  const applied = await migrateToLatest(app.get<Kysely<Database>>(DB));
  if (applied.length) new Logger('Migrations').log(`applied ${applied.join(', ')}`);
}
