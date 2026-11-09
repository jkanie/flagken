import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DB } from '../db/database.js';
import type { Database } from '../db/schema.js';
import type { ApiKeyPrincipal } from '../common/request.js';
import { hashApiKey } from './api-keys.js';

@Injectable()
export class ApiKeyService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async authenticate(key: string | undefined): Promise<ApiKeyPrincipal | undefined> {
    if (!key || !/^fk_(srv|cli)_[A-Za-z0-9_-]{43}$/.test(key)) return undefined;
    const row = await this.db
      .selectFrom('apiKeys as k')
      .innerJoin('environments as e', 'e.id', 'k.environmentId')
      .innerJoin('projects as p', 'p.id', 'e.projectId')
      .select(['k.id', 'k.kind', 'k.name', 'e.id as environmentId', 'e.key as environmentKey', 'p.id as projectId', 'p.key as projectKey'])
      .where('k.keyHash', '=', hashApiKey(key))
      .where('k.revokedAt', 'is', null)
      .executeTakeFirst();
    return row;
  }
}
