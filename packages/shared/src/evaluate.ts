import { bucketFor } from './bucket.js';
import type { AttributeValue, Clause, ClauseValue, EvalContext, EvalResult, FlagConfig, JsonValue, Rollout, Serve } from './types.js';

/** Picks a variation from a rollout. Returns the variation index and the bucket used. */
export function pickFromRollout(flagKey: string, rollout: Rollout, context: EvalContext): { variation: number; bucket: number } {
  const attribute = rollout.bucketBy ?? 'key';
  const raw = context[attribute];
  // A missing or unusable bucketBy value goes to bucket 0, so the result is still stable.
  const bucket = typeof raw === 'string' || typeof raw === 'number' ? bucketFor(flagKey, String(raw)) : 0;
  let upper = 0;
  for (const entry of rollout.variations) {
    upper += entry.weight;
    if (bucket < upper) return { variation: entry.variation, bucket };
  }
  // Weights that add up to less than 10,000 fail validation, this only guards stored bad data.
  const last = rollout.variations[rollout.variations.length - 1];
  return { variation: last ? last.variation : 0, bucket };
}

function toTime(value: AttributeValue | ClauseValue): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : time;
  }
  return undefined;
}

function matchOne(op: Clause['op'], actual: string | number | boolean, expected: ClauseValue): boolean {
  switch (op) {
    case 'in':
      return actual === expected;
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'before': {
      const a = toTime(actual);
      const b = toTime(expected);
      return a !== undefined && b !== undefined && a < b;
    }
    case 'after': {
      const a = toTime(actual);
      const b = toTime(expected);
      return a !== undefined && b !== undefined && a > b;
    }
  }
}

/** True when the clause matches the context. A missing attribute never matches, negated or not. */
export function clauseMatches(clause: Clause, context: EvalContext): boolean {
  const raw = context[clause.attribute];
  if (raw === undefined || raw === null) return false;
  const actuals = Array.isArray(raw) ? raw : [raw];
  const hit = actuals.some((actual) => clause.values.some((expected) => matchOne(clause.op, actual, expected)));
  return clause.negate ? !hit : hit;
}

function variationValue(flag: FlagConfig, index: number): JsonValue | undefined {
  return flag.variations[index]?.value;
}

function serveResult(flag: FlagConfig, serve: Serve, context: EvalContext): { variation: number; bucket?: number } {
  if ('variation' in serve) return { variation: serve.variation };
  return pickFromRollout(flag.key, serve.rollout, context);
}

/**
 * Evaluates a flag for a context. Order: kill switch, on/off, individual targets, rules top to bottom, fallthrough.
 * The server and the SDK both call this function, so they give the same answer for the same input.
 */
export function evaluateFlag<T extends JsonValue = JsonValue>(
  flag: FlagConfig | undefined,
  context: EvalContext,
  fallback: T,
): EvalResult<T | JsonValue> {
  if (!flag) return { value: fallback, variation: null, reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' } };

  const finish = (variation: number, reason: EvalResult['reason']): EvalResult<T | JsonValue> => {
    const value = variationValue(flag, variation);
    if (value === undefined) {
      return { value: fallback, variation: null, reason: { kind: 'ERROR', errorKind: 'MALFORMED_FLAG' } };
    }
    return { value, variation, reason };
  };

  if (flag.killed) return finish(flag.offVariation, { kind: 'KILLED' });
  if (!flag.on) return finish(flag.offVariation, { kind: 'OFF' });

  for (const target of flag.targets) {
    if (target.values.includes(context.key)) return finish(target.variation, { kind: 'TARGET_MATCH' });
  }

  for (let i = 0; i < flag.rules.length; i++) {
    const rule = flag.rules[i]!;
    if (rule.clauses.length > 0 && rule.clauses.every((clause) => clauseMatches(clause, context))) {
      const picked = serveResult(flag, rule.serve, context);
      return finish(picked.variation, {
        kind: 'RULE_MATCH',
        ruleId: rule.id,
        ruleIndex: i,
        ...(picked.bucket !== undefined ? { bucket: picked.bucket } : {}),
      });
    }
  }

  const picked = serveResult(flag, flag.fallthrough, context);
  return finish(picked.variation, {
    kind: 'FALLTHROUGH',
    ...(picked.bucket !== undefined ? { bucket: picked.bucket } : {}),
  });
}
