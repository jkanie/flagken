import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export const DB = Symbol('DB');

export function createDatabase(url: string, max = 10): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'flagken' });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });
}

/** JSON text for a JSONB column. node-postgres would turn a JS array into a PostgreSQL array otherwise. */
export function json(value: unknown): string {
  return JSON.stringify(value);
}
