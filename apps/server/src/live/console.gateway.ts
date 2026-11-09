import type { IncomingMessage } from 'node:http';
import { Inject, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { KEY_PATTERN } from '@flagken/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { SESSION_COOKIE, readCookie } from '../auth/session.js';
import { CONFIG } from '../config.js';
import type { Config } from '../config.js';
import { LiveService } from './live.service.js';

/** Origin check for the handshake: a page on another site must not open a socket with the user's cookie. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  const url = URL.parse(origin);
  return Boolean(url && host && url.host === host);
}

/**
 * WebSocket for the console at /ws. Sign-in comes from the session cookie of the handshake.
 * Messages are JSON { event, data }. The server sends ready, flag.changed, audit.created, webhook.delivery.
 * The console sends subscribe { project } after ready.
 */
@WebSocketGateway({ path: '/ws' })
export class ConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ConsoleGateway.name);

  constructor(
    private readonly live: LiveService,
    private readonly auth: AuthGuard,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    if (this.live.isClosing) {
      socket.close(1001, 'server shutting down');
      return;
    }
    if (!originAllowed(request.headers.origin, request.headers.host, this.config.corsOrigins)) {
      socket.close(4403, 'origin not allowed');
      return;
    }
    this.live.addConsole(socket);
    const user = await this.auth.userFromSession(readCookie(request.headers.cookie, SESSION_COOKIE)).catch(() => undefined);
    if (!user) {
      socket.close(4401, 'sign in first');
      return;
    }
    this.live.authoriseConsole(socket, user);
  }

  handleDisconnect(socket: WebSocket): void {
    this.live.removeConsole(socket);
  }

  @SubscribeMessage('subscribe')
  subscribe(@ConnectedSocket() socket: WebSocket, @MessageBody() data: { project?: unknown }) {
    const project = typeof data?.project === 'string' ? data.project : '';
    if (!KEY_PATTERN.test(project) || !this.live.subscribeConsole(socket, project)) {
      this.logger.debug('refused a console subscription');
      return { event: 'error', data: { message: 'cannot subscribe' } };
    }
    return { event: 'subscribed', data: { project } };
  }
}
