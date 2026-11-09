import { describe, expect, it } from 'vitest';
import { KEY_PATTERN, diffJson, validateEnvironmentState, validateVariations } from '../src/index.js';
import type { FlagEnvironmentState, JsonValue } from '../src/index.js';

const base: FlagEnvironmentState = {
  on: true,
  killed: false,
  offVariation: 0,
  fallthrough: { variation: 1 },
  targets: [],
  rules: [],
};

describe('validateVariations', () => {
  it('accepts a boolean flag with 2 variations', () => {
    expect(validateVariations('boolean', [{ value: false }, { value: true }])).toEqual([]);
  });
  it('refuses wrong kinds, duplicates and too few variations', () => {
    expect(validateVariations('boolean', [{ value: 'yes' }, { value: true }])).toContain('variation 0 is string, the flag is boolean');
    expect(validateVariations('string', [{ value: 'a' }, { value: 'a' }])).toContain('variation values must be unique');
    expect(validateVariations('number', [{ value: 1 }])).toContain('a flag needs at least 2 variations');
  });
  it('lets json flags hold any JSON', () => {
    expect(validateVariations('json', [{ value: { a: 1 } }, { value: [1, 2] }, { value: 'x' }])).toEqual([]);
  });
});

describe('validateEnvironmentState', () => {
  it('accepts a valid state', () => {
    expect(validateEnvironmentState(base, 2)).toEqual([]);
  });
  it('refuses rollout weights that do not add up to 10,000', () => {
    const errors = validateEnvironmentState(
      {
        ...base,
        fallthrough: {
          rollout: {
            variations: [
              { variation: 0, weight: 5000 },
              { variation: 1, weight: 4000 },
            ],
          },
        },
      },
      2,
    );
    expect(errors).toEqual(['fallthrough: weights add up to 9000, they must add up to 10000']);
  });
  it('refuses unknown variations, empty rules, duplicate rule ids, keys targeted twice', () => {
    const errors = validateEnvironmentState(
      {
        ...base,
        offVariation: 5,
        targets: [
          { variation: 0, values: ['u_1'] },
          { variation: 1, values: ['u_1'] },
        ],
        rules: [
          { id: 'a', clauses: [], serve: { variation: 0 } },
          { id: 'a', clauses: [{ attribute: 'x', op: 'in', values: [] }], serve: { variation: 3 } },
        ],
      },
      2,
    );
    expect(errors).toEqual([
      'off variation: variation 5 does not exist',
      'rule 1: needs at least 1 condition',
      'rule 2: id a is used twice',
      'rule 2, condition 1: needs at least 1 value',
      'rule 2: variation 3 does not exist',
      'context key u_1 is targeted twice',
    ]);
  });
});

describe('KEY_PATTERN', () => {
  it.each(['new-checkout', 'a', 'v2.search_rank'])('accepts %s', (key) => expect(KEY_PATTERN.test(key)).toBe(true));
  it.each(['', 'New', '-x', 'a b', 'x'.repeat(65)])('refuses %j', (key) => expect(KEY_PATTERN.test(key)).toBe(false));
});

describe('diffJson', () => {
  it('lists changed, added and removed leaves with paths', () => {
    const before: JsonValue = { on: false, rules: [{ id: 'r1', serve: { variation: 0 } }], name: 'a/b' };
    const after: JsonValue = { on: true, rules: [{ id: 'r1', serve: { variation: 1 } }, { id: 'r2' }], name: 'a/b' };
    expect(diffJson(before, after)).toEqual([
      { path: '/on', kind: 'changed', before: false, after: true },
      { path: '/rules/0/serve/variation', kind: 'changed', before: 0, after: 1 },
      { path: '/rules/1', kind: 'added', after: { id: 'r2' } },
    ]);
  });
  it('handles a created or deleted resource', () => {
    expect(diffJson(undefined, { a: 1 })).toEqual([{ path: '/', kind: 'added', after: { a: 1 } }]);
    expect(diffJson({ a: 1 }, undefined)).toEqual([{ path: '/', kind: 'removed', before: { a: 1 } }]);
  });
  it('escapes / and ~ in keys', () => {
    expect(diffJson({ 'a/b': 1, 'c~d': 1 }, { 'a/b': 2, 'c~d': 2 }).map((d) => d.path)).toEqual(['/a~1b', '/c~0d']);
  });
  it('returns nothing for equal values', () => {
    expect(diffJson({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toEqual([]);
  });
});
