import { BUCKET_COUNT } from './bucket.js';
import { CLAUSE_OPS, FLAG_KINDS } from './types.js';
import type { FlagEnvironmentState, FlagKind, JsonValue, Serve, Variation } from './types.js';

/** Keys for flags, projects, environments: lower case, digits, dot, dash, underscore. */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const LIMITS = {
  variations: 20,
  rules: 100,
  clausesPerRule: 20,
  valuesPerClause: 500,
  targetsPerVariation: 1000,
} as const;

function kindOf(value: JsonValue): FlagKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return 'json';
}

/** Returns a list of problems, empty when the variations fit the flag kind. */
export function validateVariations(kind: FlagKind, variations: Variation[]): string[] {
  const errors: string[] = [];
  if (!FLAG_KINDS.includes(kind)) errors.push(`kind must be one of ${FLAG_KINDS.join(', ')}`);
  if (variations.length < 2) errors.push('a flag needs at least 2 variations');
  if (variations.length > LIMITS.variations) errors.push(`a flag takes at most ${LIMITS.variations} variations`);
  variations.forEach((variation, index) => {
    if (variation.value === undefined) {
      errors.push(`variation ${index} has no value`);
      return;
    }
    const actual = kindOf(variation.value);
    if (kind !== 'json' && actual !== kind) errors.push(`variation ${index} is ${actual}, the flag is ${kind}`);
    if (typeof variation.value === 'number' && !Number.isFinite(variation.value)) {
      errors.push(`variation ${index} is not a finite number`);
    }
  });
  if (kind === 'boolean' && variations.length !== 2) errors.push('a boolean flag has exactly 2 variations');
  const seen = new Set(variations.map((v) => JSON.stringify(v.value)));
  if (seen.size !== variations.length) errors.push('variation values must be unique');
  return errors;
}

function checkVariation(index: number, count: number, where: string, errors: string[]): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    errors.push(`${where}: variation ${index} does not exist`);
  }
}

function checkServe(serve: Serve, count: number, where: string, errors: string[]): void {
  if ('variation' in serve) {
    checkVariation(serve.variation, count, where, errors);
    return;
  }
  const entries = serve.rollout.variations;
  if (entries.length === 0) errors.push(`${where}: a rollout needs at least 1 variation`);
  let total = 0;
  for (const entry of entries) {
    checkVariation(entry.variation, count, where, errors);
    if (!Number.isInteger(entry.weight) || entry.weight < 0) errors.push(`${where}: weights are whole numbers from 0`);
    total += entry.weight;
  }
  if (total !== BUCKET_COUNT) errors.push(`${where}: weights add up to ${total}, they must add up to ${BUCKET_COUNT}`);
}

/** Returns a list of problems, empty when the environment state is valid for a flag with `count` variations. */
export function validateEnvironmentState(state: FlagEnvironmentState, count: number): string[] {
  const errors: string[] = [];
  checkVariation(state.offVariation, count, 'off variation', errors);
  checkServe(state.fallthrough, count, 'fallthrough', errors);
  if (state.rules.length > LIMITS.rules) errors.push(`at most ${LIMITS.rules} rules`);
  const ids = new Set<string>();
  state.rules.forEach((rule, index) => {
    const where = `rule ${index + 1}`;
    if (!rule.id) errors.push(`${where}: id is required`);
    if (ids.has(rule.id)) errors.push(`${where}: id ${rule.id} is used twice`);
    ids.add(rule.id);
    if (rule.clauses.length === 0) errors.push(`${where}: needs at least 1 condition`);
    if (rule.clauses.length > LIMITS.clausesPerRule) errors.push(`${where}: at most ${LIMITS.clausesPerRule} conditions`);
    rule.clauses.forEach((clause, c) => {
      if (!clause.attribute) errors.push(`${where}, condition ${c + 1}: attribute is required`);
      if (!CLAUSE_OPS.includes(clause.op)) errors.push(`${where}, condition ${c + 1}: unknown operator ${clause.op}`);
      if (clause.values.length === 0) errors.push(`${where}, condition ${c + 1}: needs at least 1 value`);
      if (clause.values.length > LIMITS.valuesPerClause) {
        errors.push(`${where}, condition ${c + 1}: at most ${LIMITS.valuesPerClause} values`);
      }
    });
    checkServe(rule.serve, count, where, errors);
  });
  const targeted = new Set<string>();
  state.targets.forEach((target, index) => {
    checkVariation(target.variation, count, `target ${index + 1}`, errors);
    if (target.values.length > LIMITS.targetsPerVariation) {
      errors.push(`target ${index + 1}: at most ${LIMITS.targetsPerVariation} keys`);
    }
    for (const key of target.values) {
      if (targeted.has(key)) errors.push(`context key ${key} is targeted twice`);
      targeted.add(key);
    }
  });
  return errors;
}
