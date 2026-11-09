import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Role } from '@flagken/shared';
import { DB } from '../db/database.js';
import type { Database, User } from '../db/schema.js';
import { AuditContext } from '../audit/audit-context.js';
import type { UserDto } from '../common/dto.js';
import { hashPassword } from './passwords.js';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    disabled: user.disabledAt !== null,
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async list(): Promise<UserDto[]> {
    const users = await this.db.selectFrom('users').selectAll().orderBy('email').execute();
    return users.map(toUserDto);
  }

  async create(email: string, password: string, role: Role): Promise<UserDto> {
    const normalised = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const user = await this.db
      .insertInto('users')
      .values({ email: normalised, passwordHash, role })
      .onConflict((oc) => oc.column('email').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!user) throw new ConflictException(`a user with e-mail ${normalised} exists`);
    AuditContext.record({
      action: 'user.created',
      projectId: null,
      projectKey: null,
      environmentKey: null,
      resourceType: 'user',
      resourceKey: user.id,
      before: null,
      after: { email: user.email, role },
    });
    return toUserDto(user);
  }

  async update(actingUserId: string, id: string, change: { role?: Role; disabled?: boolean }): Promise<UserDto> {
    if (id === actingUserId && (change.role !== undefined || change.disabled !== undefined)) {
      throw new BadRequestException('you cannot change your own role or disable yourself');
    }
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('users').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new NotFoundException('no such user');
      const after = await trx
        .updateTable('users')
        .set({
          ...(change.role ? { role: change.role } : {}),
          ...(change.disabled !== undefined ? { disabledAt: change.disabled ? (before.disabledAt ?? new Date()) : null } : {}),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const owners = await trx
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('role', '=', 'owner')
        .where('disabledAt', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(owners.n) === 0) throw new BadRequestException('at least 1 active owner must remain');
      AuditContext.record({
        action: 'user.updated',
        projectId: null,
        projectKey: null,
        environmentKey: null,
        resourceType: 'user',
        resourceKey: id,
        before: { email: before.email, role: before.role, disabled: before.disabledAt !== null },
        after: { email: after.email, role: after.role, disabled: after.disabledAt !== null },
      });
      return toUserDto(after);
    });
  }

  /** Used by the create-admin command: creates the owner, or resets the password and role of that e-mail. */
  async upsertOwner(email: string, password: string): Promise<'created' | 'updated'> {
    const normalised = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const existing = await this.db.selectFrom('users').select('id').where('email', '=', normalised).executeTakeFirst();
    if (existing) {
      await this.db.updateTable('users').set({ passwordHash, role: 'owner', disabledAt: null }).where('id', '=', existing.id).execute();
      return 'updated';
    }
    await this.db.insertInto('users').values({ email: normalised, passwordHash, role: 'owner' }).execute();
    return 'created';
  }
}
