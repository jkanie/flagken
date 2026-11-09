import type { Kysely } from 'kysely';
import { validateEnvironmentState, validateVariations } from '@flagken/shared';
import type { FlagEnvironmentState, FlagKind, Variation } from '@flagken/shared';
import { json } from './db/database.js';
import type { Database } from './db/schema.js';
import { generateApiKey } from './auth/api-keys.js';
import { DEFAULT_ENVIRONMENTS } from './projects/projects.service.js';

interface SeedFlag {
  key: string;
  name: string;
  description: string;
  kind: FlagKind;
  variations: Variation[];
  tags: string[];
  states: Partial<Record<string, Partial<FlagEnvironmentState>>>;
}

/** Made-up sample data. Context keys are opaque ids, no real people, no personal data. */
export const SEED_PROJECT = { key: 'demo-shop', name: 'Demo Shop' };

export const SEED_FLAGS: SeedFlag[] = [
  {
    key: 'new-checkout',
    name: 'New checkout',
    description: 'The 1-page checkout. Rolling out by percentage.',
    kind: 'boolean',
    variations: [
      { value: false, name: 'Old checkout' },
      { value: true, name: 'New checkout' },
    ],
    tags: ['checkout', 'rollout'],
    states: {
      development: { on: true, fallthrough: { variation: 1 } },
      staging: {
        on: true,
        targets: [{ variation: 1, values: ['u_7f3a9c'] }],
        fallthrough: {
          rollout: {
            variations: [
              { variation: 0, weight: 7500 },
              { variation: 1, weight: 2500 },
            ],
          },
        },
      },
    },
  },
  {
    key: 'search-ranking',
    name: 'Search ranking',
    description: 'Which ranking the product search uses.',
    kind: 'string',
    variations: [
      { value: 'classic', name: 'Classic' },
      { value: 'semantic', name: 'Semantic' },
    ],
    tags: ['search'],
    states: {
      development: {
        on: true,
        rules: [
          {
            id: 'ca-nz',
            description: 'Canada and New Zealand first',
            clauses: [{ attribute: 'country', op: 'in', values: ['CA', 'NZ'] }],
            serve: { variation: 1 },
          },
        ],
        fallthrough: { variation: 0 },
      },
      staging: {
        on: true,
        rules: [{ id: 'beta-plan', clauses: [{ attribute: 'plan', op: 'in', values: ['beta'] }], serve: { variation: 1 } }],
        fallthrough: { variation: 0 },
      },
    },
  },
  {
    key: 'max-cart-items',
    name: 'Max cart items',
    description: 'Upper limit of items in 1 cart.',
    kind: 'number',
    variations: [{ value: 50 }, { value: 100 }, { value: 250 }],
    tags: ['limits'],
    states: { development: { on: true, fallthrough: { variation: 2 } } },
  },
  {
    key: 'holiday-banner',
    name: 'Holiday banner',
    description: 'Banner text and colour for the home page.',
    kind: 'json',
    variations: [
      { value: { show: false }, name: 'Hidden' },
      { value: { show: true, text: 'Free delivery this week', colour: 'teal' }, name: 'Delivery offer' },
    ],
    tags: ['marketing'],
    states: {},
  },
  {
    key: 'payments-provider-b',
    name: 'Payments provider B',
    description: 'Sends payments to the second provider. Has a kill switch for incidents.',
    kind: 'boolean',
    variations: [{ value: false }, { value: true }],
    tags: ['payments', 'ops'],
    states: { development: { on: true, killed: true, fallthrough: { variation: 1 } } },
  },
];

export async function seed(
  db: Kysely<Database>,
): Promise<{ created: boolean; keys: Array<{ environment: string; kind: string; key: string }> }> {
  const existing = await db.selectFrom('projects').select('id').where('key', '=', SEED_PROJECT.key).executeTakeFirst();
  if (existing) return { created: false, keys: [] };
  return db.transaction().execute(async (trx) => {
    const project = await trx.insertInto('projects').values(SEED_PROJECT).returningAll().executeTakeFirstOrThrow();
    const environments = await trx
      .insertInto('environments')
      .values(DEFAULT_ENVIRONMENTS.map((e, i) => ({ projectId: project.id, key: e.key, name: e.name, sortOrder: i })))
      .returningAll()
      .execute();
    for (const flag of SEED_FLAGS) {
      const errors = validateVariations(flag.kind, flag.variations);
      if (errors.length) throw new Error(`seed flag ${flag.key}: ${errors.join(', ')}`);
      const row = await trx
        .insertInto('flags')
        .values({
          projectId: project.id,
          key: flag.key,
          name: flag.name,
          description: flag.description,
          kind: flag.kind,
          variations: json(flag.variations),
          tags: json(flag.tags),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      for (const environment of environments) {
        const state: FlagEnvironmentState = {
          on: false,
          killed: false,
          offVariation: 0,
          fallthrough: { variation: 0 },
          targets: [],
          rules: [],
          ...flag.states[environment.key],
        };
        const stateErrors = validateEnvironmentState(state, flag.variations.length);
        if (stateErrors.length) throw new Error(`seed flag ${flag.key} in ${environment.key}: ${stateErrors.join(', ')}`);
        await trx
          .insertInto('flagStates')
          .values({
            flagId: row.id,
            environmentId: environment.id,
            on: state.on,
            killed: state.killed,
            offVariation: state.offVariation,
            fallthrough: json(state.fallthrough),
            targets: json(state.targets),
            rules: json(state.rules),
          })
          .execute();
      }
    }
    const development = environments.find((e) => e.key === 'development')!;
    const keys: Array<{ environment: string; kind: string; key: string }> = [];
    for (const kind of ['server', 'client'] as const) {
      const generated = generateApiKey(kind);
      await trx
        .insertInto('apiKeys')
        .values({ environmentId: development.id, kind, name: `dev seed ${kind}`, prefix: generated.prefix, keyHash: generated.hash })
        .execute();
      keys.push({ environment: 'development', kind, key: generated.key });
    }
    return { created: true, keys };
  });
}
