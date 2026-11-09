import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Kysely } from 'kysely';
import type { ApiKeyKind, Role } from '@flagken/shared';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import type { FlagkenRequest, SessionUser } from '../common/request.js';
import { MIN_ROLE, PUBLIC, ROLE_RANK, SDK_KEY } from './decorators.js';
import { ApiKeyService } from './api-key.service.js';
import { bearerToken } from './api-keys.js';
import { SESSION_COOKIE, SessionService } from './session.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs on every HTTP route. Routes are closed by default: a route needs 1 of @Public(), an SDK key (@SdkKey), a console session.
 * The role comes from the database on each request, so a demotion takes effect at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyService,
    @Inject(DB) private readonly db: Kysely<Database>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const request = context.switchToHttp().getRequest<FlagkenRequest>();

    const kinds = this.reflector.getAllAndOverride<ApiKeyKind[] | undefined>(SDK_KEY, targets);
    if (kinds) {
      const principal = await this.apiKeys.authenticate(bearerToken(request.headers.authorization));
      if (!principal) throw new UnauthorizedException('a valid API key is required');
      if (!kinds.includes(principal.kind)) throw new ForbiddenException(`this endpoint takes a ${kinds.join(' or ')} key`);
      request.apiKey = principal;
      return true;
    }

    const user = await this.userFromSession(request.cookies?.[SESSION_COOKIE] as string | undefined);
    if (!user) throw new UnauthorizedException('sign in first');
    request.user = user;
    const min = this.reflector.getAllAndOverride<Role | undefined>(MIN_ROLE, targets);
    if (min && ROLE_RANK[user.role] < ROLE_RANK[min]) {
      throw new ForbiddenException(`this needs the ${min} role or higher`);
    }
    return true;
  }

  async userFromSession(token: string | undefined): Promise<SessionUser | undefined> {
    const userId = await this.sessions.verify(token);
    if (!userId || !UUID.test(userId)) return undefined;
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('id', '=', userId)
      .where('disabledAt', 'is', null)
      .executeTakeFirst();
    return user;
  }
}
