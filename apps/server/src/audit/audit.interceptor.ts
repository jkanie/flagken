import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import type { FlagkenRequest } from '../common/request.js';
import { AuditContext } from './audit-context.js';
import { AuditService } from './audit.service.js';
import type { Actor } from './audit.service.js';

export function actorOf(request: FlagkenRequest): Actor {
  if (request.user) return { type: 'user', id: request.user.id, label: request.user.email };
  if (request.apiKey) return { type: 'api_key', id: request.apiKey.id, label: `API key ${request.apiKey.name}` };
  return { type: 'system', id: null, label: 'anonymous' };
}

/**
 * Writes the audit log for every write request.
 * Services record what changed (before and after) during the request. This interceptor stores it with who,
 * when, the request id once the handler has succeeded. The response waits for the write.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<FlagkenRequest>();
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return next.handle();
    return new Observable((subscriber) =>
      AuditContext.run(() => {
        const records = AuditContext.current();
        return next
          .handle()
          .pipe(
            mergeMap(async (body: unknown) => {
              await this.audit.write(records, actorOf(request), request.requestId ?? null);
              return body;
            }),
          )
          .subscribe(subscriber);
      }),
    );
  }
}
