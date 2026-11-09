import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from './db/database.js';
import { migrateToLatest } from './db/migrations.js';
import { UsersService } from './auth/users.service.js';
import { MIN_PASSWORD_LENGTH } from './auth/passwords.js';
import { seed } from './seed.js';

const USAGE = `Usage: node dist/cli.js <command>

Commands:
  migrate         Apply database migrations (needs DATABASE_URL).
  create-admin    Create an owner from ADMIN_EMAIL and ADMIN_PASSWORD, or reset that owner's password.
  seed            Add the made-up demo-shop project with sample flags (refused when NODE_ENV=production).
  openapi [file]  Print the OpenAPI document, or write it to a file. Needs no database.
`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function withDatabase<T>(fn: (db: ReturnType<typeof createDatabase>) => Promise<T>): Promise<T> {
  const db = createDatabase(required('DATABASE_URL'), 2);
  try {
    await migrateToLatest(db);
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'migrate': {
      const db = createDatabase(required('DATABASE_URL'), 2);
      try {
        const applied = await migrateToLatest(db);
        console.log(applied.length ? `applied ${applied.join(', ')}` : 'database is up to date');
      } finally {
        await db.destroy();
      }
      return 0;
    }
    case 'create-admin': {
      const email = required('ADMIN_EMAIL');
      const password = required('ADMIN_PASSWORD');
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('ADMIN_EMAIL is not an e-mail address');
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD needs at least ${MIN_PASSWORD_LENGTH} characters`);
      const result = await withDatabase((db) => new UsersService(db).upsertOwner(email, password));
      console.log(`${result} owner ${email.toLowerCase()}`);
      return 0;
    }
    case 'seed': {
      if (process.env.NODE_ENV === 'production') throw new Error('seed refuses to run with NODE_ENV=production');
      const result = await withDatabase(seed);
      if (!result.created) {
        console.log('demo-shop exists, nothing added');
        return 0;
      }
      console.log('added project demo-shop with 5 flags in development, staging and production');
      console.log('development API keys (shown once, store them now):');
      for (const k of result.keys) console.log(`  ${k.kind.padEnd(6)} ${k.key}`);
      return 0;
    }
    case 'openapi': {
      const { openApiJson } = await import('./openapi.js');
      const text = await openApiJson();
      if (rest[0]) await writeFile(rest[0], text);
      else process.stdout.write(text);
      return 0;
    }
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
