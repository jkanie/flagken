import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';

/** Migrations live in code, so the built server and the tests carry them without extra files. */
const migrations: Record<string, Migration> = {
  '0001_initial': {
    async up(db: Kysely<unknown>): Promise<void> {
      await sql`
        create table users (
          id uuid primary key default gen_random_uuid(),
          email text not null unique check (email = lower(email)),
          password_hash text not null,
          role text not null check (role in ('owner', 'editor', 'viewer')),
          created_at timestamptz not null default now(),
          disabled_at timestamptz
        );
        create table projects (
          id uuid primary key default gen_random_uuid(),
          key text not null unique,
          name text not null,
          created_at timestamptz not null default now()
        );
        create table environments (
          id uuid primary key default gen_random_uuid(),
          project_id uuid not null references projects(id) on delete cascade,
          key text not null,
          name text not null,
          sort_order integer not null default 0,
          created_at timestamptz not null default now(),
          unique (project_id, key)
        );
        create table api_keys (
          id uuid primary key default gen_random_uuid(),
          environment_id uuid not null references environments(id) on delete cascade,
          kind text not null check (kind in ('server', 'client')),
          name text not null,
          prefix text not null,
          key_hash text not null unique,
          created_by uuid references users(id) on delete set null,
          created_at timestamptz not null default now(),
          revoked_at timestamptz
        );
        create table flags (
          id uuid primary key default gen_random_uuid(),
          project_id uuid not null references projects(id) on delete cascade,
          key text not null,
          name text not null,
          description text not null default '',
          kind text not null check (kind in ('boolean', 'string', 'number', 'json')),
          variations jsonb not null,
          tags jsonb not null default '[]',
          version integer not null default 1,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          archived_at timestamptz,
          unique (project_id, key)
        );
        create table flag_states (
          flag_id uuid not null references flags(id) on delete cascade,
          environment_id uuid not null references environments(id) on delete cascade,
          "on" boolean not null default false,
          killed boolean not null default false,
          off_variation integer not null,
          fallthrough jsonb not null,
          targets jsonb not null default '[]',
          rules jsonb not null default '[]',
          version integer not null default 1,
          updated_at timestamptz not null default now(),
          primary key (flag_id, environment_id)
        );
        create table audit_log (
          id bigint generated always as identity primary key,
          at timestamptz not null default now(),
          actor_type text not null check (actor_type in ('user', 'api_key', 'system')),
          actor_id text,
          actor_label text not null,
          action text not null,
          project_id uuid references projects(id) on delete cascade,
          environment_key text,
          resource_type text not null,
          resource_key text not null,
          before jsonb,
          after jsonb,
          request_id text
        );
        create index audit_log_project_at on audit_log (project_id, id desc);
        create table webhooks (
          id uuid primary key default gen_random_uuid(),
          project_id uuid not null references projects(id) on delete cascade,
          name text not null,
          url text not null,
          secret text not null,
          events jsonb not null,
          active boolean not null default true,
          created_at timestamptz not null default now()
        );
        create table webhook_deliveries (
          id uuid primary key default gen_random_uuid(),
          webhook_id uuid not null references webhooks(id) on delete cascade,
          event_id text not null,
          event_type text not null,
          attempt integer not null,
          ok boolean not null,
          status_code integer,
          error text,
          duration_ms integer not null,
          created_at timestamptz not null default now()
        );
        create index webhook_deliveries_webhook_created on webhook_deliveries (webhook_id, created_at desc);
        create table scheduled_changes (
          id uuid primary key default gen_random_uuid(),
          flag_id uuid not null references flags(id) on delete cascade,
          environment_id uuid not null references environments(id) on delete cascade,
          run_at timestamptz not null,
          change jsonb not null,
          status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'cancelled')),
          created_by uuid references users(id) on delete set null,
          created_at timestamptz not null default now(),
          executed_at timestamptz,
          error text
        );
      `.execute(db);
    },
    async down(db: Kysely<unknown>): Promise<void> {
      await sql`
        drop table scheduled_changes, webhook_deliveries, webhooks, audit_log, flag_states, flags,
          api_keys, environments, projects, users;
      `.execute(db);
    },
  },
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the migrator works on any schema.
export async function migrateToLatest(db: Kysely<any>): Promise<string[]> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
