import { CLAUSE_OPS } from '@flagken/shared';
import type { Clause, JsonValue, Rule, Serve, Target, Variation } from '@flagken/shared';

/**
 * Structural checks for the nested JSON in flag requests. class-validator checks the top level,
 * these check the inside, then @flagken/shared checks the meaning (indexes, weights).
 */
export class ShapeError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function int(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ShapeError(`${where} must be a whole number`);
  return value;
}

function str(value: unknown, where: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new ShapeError(`${where} must be a string of 1 to ${max} characters`);
  }
  return value;
}

function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJson(v, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => isJson(v, depth + 1));
  return false;
}

export function parseVariations(input: unknown): Variation[] {
  if (!Array.isArray(input)) throw new ShapeError('variations must be a list');
  return input.map((raw, i) => {
    if (!isRecord(raw) || !('value' in raw) || !isJson(raw.value)) {
      throw new ShapeError(`variations[${i}] needs a JSON value`);
    }
    const variation: Variation = { value: raw.value };
    if (raw.name !== undefined) variation.name = str(raw.name, `variations[${i}].name`, 100);
    if (raw.description !== undefined) variation.description = str(raw.description, `variations[${i}].description`, 1000);
    if (JSON.stringify(raw.value).length > 32_768) throw new ShapeError(`variations[${i}] is larger than 32 KiB`);
    return variation;
  });
}

export function parseServe(input: unknown, where: string): Serve {
  if (!isRecord(input)) throw new ShapeError(`${where} must be an object`);
  if ('variation' in input) return { variation: int(input.variation, `${where}.variation`) };
  if (isRecord(input.rollout)) {
    const rollout = input.rollout;
    if (!Array.isArray(rollout.variations)) throw new ShapeError(`${where}.rollout.variations must be a list`);
    return {
      rollout: {
        variations: rollout.variations.map((entry, i) => {
          if (!isRecord(entry)) throw new ShapeError(`${where}.rollout.variations[${i}] must be an object`);
          return {
            variation: int(entry.variation, `${where}.rollout.variations[${i}].variation`),
            weight: int(entry.weight, `${where}.rollout.variations[${i}].weight`),
          };
        }),
        ...(rollout.bucketBy !== undefined ? { bucketBy: str(rollout.bucketBy, `${where}.rollout.bucketBy`, 100) } : {}),
      },
    };
  }
  throw new ShapeError(`${where} needs either variation or rollout`);
}

function parseClause(input: unknown, where: string): Clause {
  if (!isRecord(input)) throw new ShapeError(`${where} must be an object`);
  const op = input.op;
  if (typeof op !== 'string' || !(CLAUSE_OPS as readonly string[]).includes(op)) {
    throw new ShapeError(`${where}.op must be one of ${CLAUSE_OPS.join(', ')}`);
  }
  if (!Array.isArray(input.values)) throw new ShapeError(`${where}.values must be a list`);
  const values = input.values.map((value, i) => {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      return value;
    }
    throw new ShapeError(`${where}.values[${i}] must be a string, number or boolean`);
  });
  const clause: Clause = { attribute: str(input.attribute, `${where}.attribute`, 100), op: op as Clause['op'], values };
  if (input.negate !== undefined) {
    if (typeof input.negate !== 'boolean') throw new ShapeError(`${where}.negate must be true or false`);
    clause.negate = input.negate;
  }
  return clause;
}

export function parseRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) throw new ShapeError('rules must be a list');
  return input.map((raw, i) => {
    const where = `rules[${i}]`;
    if (!isRecord(raw)) throw new ShapeError(`${where} must be an object`);
    if (!Array.isArray(raw.clauses)) throw new ShapeError(`${where}.clauses must be a list`);
    const rule: Rule = {
      id: str(raw.id, `${where}.id`, 64),
      clauses: raw.clauses.map((c, j) => parseClause(c, `${where}.clauses[${j}]`)),
      serve: parseServe(raw.serve, `${where}.serve`),
    };
    if (raw.description !== undefined) rule.description = str(raw.description, `${where}.description`, 500);
    return rule;
  });
}

export function parseTargets(input: unknown): Target[] {
  if (!Array.isArray(input)) throw new ShapeError('targets must be a list');
  return input.map((raw, i) => {
    if (!isRecord(raw) || !Array.isArray(raw.values)) throw new ShapeError(`targets[${i}] needs variation and values`);
    return {
      variation: int(raw.variation, `targets[${i}].variation`),
      values: raw.values.map((v, j) => str(v, `targets[${i}].values[${j}]`)),
    };
  });
}
