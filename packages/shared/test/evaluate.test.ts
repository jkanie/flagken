import { describe, expect, it } from 'vitest';
import { bucketFor, clauseMatches, evaluateFlag, pickFromRollout } from '../src/index.js';
import type { FlagConfig } from '../src/index.js';

function flag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key: 'new-checkout',
    kind: 'boolean',
    variations: [{ value: false }, { value: true }],
    version: 1,
    on: true,
    killed: false,
    offVariation: 0,
    fallthrough: { variation: 0 },
    targets: [],
    rules: [],
    ...overrides,
  };
}

describe('evaluateFlag order', () => {
  it('returns the fallback when the flag is missing', () => {
    const result = evaluateFlag(undefined, { key: 'u_1' }, 'fallback');
    expect(result).toEqual({ value: 'fallback', variation: null, reason: { kind: 'ERROR', errorKind: 'FLAG_NOT_FOUND' } });
  });

  it('serves the off variation when the flag is off', () => {
    const result = evaluateFlag(flag({ on: false, fallthrough: { variation: 1 } }), { key: 'u_1' }, true);
    expect(result).toMatchObject({ value: false, variation: 0, reason: { kind: 'OFF' } });
  });

  it('lets the kill switch win over on, targets and rules', () => {
    const result = evaluateFlag(
      flag({ killed: true, targets: [{ variation: 1, values: ['u_1'] }], fallthrough: { variation: 1 } }),
      { key: 'u_1' },
      true,
    );
    expect(result).toMatchObject({ value: false, reason: { kind: 'KILLED' } });
  });

  it('checks individual targets before rules', () => {
    const result = evaluateFlag(
      flag({
        targets: [{ variation: 1, values: ['u_vip'] }],
        rules: [{ id: 'r1', clauses: [{ attribute: 'key', op: 'in', values: ['u_vip'] }], serve: { variation: 0 } }],
      }),
      { key: 'u_vip' },
      false,
    );
    expect(result).toMatchObject({ value: true, reason: { kind: 'TARGET_MATCH' } });
  });

  it('takes the first rule whose conditions all match', () => {
    const f = flag({
      kind: 'string',
      variations: [{ value: 'classic' }, { value: 'semantic' }, { value: 'hybrid' }],
      rules: [
        {
          id: 'ca-beta',
          clauses: [
            { attribute: 'country', op: 'in', values: ['CA'] },
            { attribute: 'plan', op: 'in', values: ['beta'] },
          ],
          serve: { variation: 2 },
        },
        { id: 'ca', clauses: [{ attribute: 'country', op: 'in', values: ['CA', 'NZ'] }], serve: { variation: 1 } },
      ],
    });
    expect(evaluateFlag(f, { key: 'u_1', country: 'CA', plan: 'beta' }, 'x')).toMatchObject({
      value: 'hybrid',
      reason: { kind: 'RULE_MATCH', ruleId: 'ca-beta', ruleIndex: 0 },
    });
    expect(evaluateFlag(f, { key: 'u_1', country: 'NZ' }, 'x')).toMatchObject({
      value: 'semantic',
      reason: { kind: 'RULE_MATCH', ruleId: 'ca', ruleIndex: 1 },
    });
    expect(evaluateFlag(f, { key: 'u_1', country: 'FR' }, 'x')).toMatchObject({
      value: 'classic',
      reason: { kind: 'FALLTHROUGH' },
    });
  });

  it('ignores a rule without conditions', () => {
    const f = flag({ rules: [{ id: 'empty', clauses: [], serve: { variation: 1 } }] });
    expect(evaluateFlag(f, { key: 'u_1' }, true).reason.kind).toBe('FALLTHROUGH');
  });

  it('reports a malformed flag when a variation index is out of range', () => {
    const result = evaluateFlag(flag({ fallthrough: { variation: 7 } }), { key: 'u_1' }, true);
    expect(result).toEqual({ value: true, variation: null, reason: { kind: 'ERROR', errorKind: 'MALFORMED_FLAG' } });
  });
});

describe('rollouts', () => {
  const rollout = {
    variations: [
      { variation: 0, weight: 7500 },
      { variation: 1, weight: 2500 },
    ],
  };

  it('serves the variation whose bucket range holds the user', () => {
    // u_7f3a9c is in bucket 6505 of new-checkout, below 7,500, so it gets variation 0.
    expect(bucketFor('new-checkout', 'u_7f3a9c')).toBe(6505);
    expect(pickFromRollout('new-checkout', rollout, { key: 'u_7f3a9c' })).toEqual({ variation: 0, bucket: 6505 });
    const result = evaluateFlag(flag({ fallthrough: { rollout } }), { key: 'u_7f3a9c' }, true);
    expect(result).toMatchObject({ value: false, reason: { kind: 'FALLTHROUGH', bucket: 6505 } });
  });

  it('puts close to 25% of 20,000 users in a 25% rollout', () => {
    let on = 0;
    for (let i = 0; i < 20_000; i++) {
      if (evaluateFlag(flag({ fallthrough: { rollout } }), { key: `u_${i}` }, false).value === true) on++;
    }
    expect(on / 20_000).toBeGreaterThan(0.24);
    expect(on / 20_000).toBeLessThan(0.26);
  });

  it('keeps users who were in a rollout when the rollout grows', () => {
    const at = (weight: number) => ({
      variations: [
        { variation: 1, weight },
        { variation: 0, weight: 10_000 - weight },
      ],
    });
    for (let i = 0; i < 2000; i++) {
      const context = { key: `u_${i}` };
      if (pickFromRollout('grow', at(1000), context).variation === 1) {
        expect(pickFromRollout('grow', at(5000), context).variation).toBe(1);
      }
    }
  });

  it('buckets by another attribute when asked', () => {
    const byOrg = { ...rollout, bucketBy: 'org' };
    const a = pickFromRollout('new-checkout', byOrg, { key: 'u_1', org: 'org_42' });
    const b = pickFromRollout('new-checkout', byOrg, { key: 'u_2', org: 'org_42' });
    expect(a).toEqual(b);
    expect(a.bucket).toBe(bucketFor('new-checkout', 'org_42'));
  });

  it('uses bucket 0 when the bucketBy attribute is missing', () => {
    expect(pickFromRollout('new-checkout', { ...rollout, bucketBy: 'org' }, { key: 'u_1' })).toEqual({
      variation: 0,
      bucket: 0,
    });
  });

  it('serves 100% and 0% exactly', () => {
    const all = {
      variations: [
        { variation: 1, weight: 10_000 },
        { variation: 0, weight: 0 },
      ],
    };
    for (let i = 0; i < 500; i++) expect(pickFromRollout('x', all, { key: `u_${i}` }).variation).toBe(1);
  });
});

describe('clauseMatches', () => {
  const context = { key: 'u_1', country: 'CA', age: 34, tags: ['beta', 'staff'], joined: '2026-03-01T00:00:00Z', email: null };

  it.each([
    [{ attribute: 'country', op: 'in', values: ['CA', 'NZ'] }, true],
    [{ attribute: 'country', op: 'in', values: ['FR'] }, false],
    [{ attribute: 'country', op: 'in', values: ['CA'], negate: true }, false],
    [{ attribute: 'country', op: 'in', values: ['FR'], negate: true }, true],
    [{ attribute: 'tags', op: 'in', values: ['beta'] }, true],
    [{ attribute: 'country', op: 'contains', values: ['A'] }, true],
    [{ attribute: 'country', op: 'startsWith', values: ['C'] }, true],
    [{ attribute: 'country', op: 'endsWith', values: ['Z'] }, false],
    [{ attribute: 'age', op: 'lt', values: [35] }, true],
    [{ attribute: 'age', op: 'lte', values: [34] }, true],
    [{ attribute: 'age', op: 'gt', values: [34] }, false],
    [{ attribute: 'age', op: 'gte', values: [34] }, true],
    [{ attribute: 'age', op: 'gt', values: ['30'] }, false],
    [{ attribute: 'joined', op: 'before', values: ['2026-06-01T00:00:00Z'] }, true],
    [{ attribute: 'joined', op: 'after', values: ['2026-06-01T00:00:00Z'] }, false],
    [{ attribute: 'joined', op: 'after', values: ['not a date'] }, false],
    [{ attribute: 'missing', op: 'in', values: ['x'] }, false],
    [{ attribute: 'missing', op: 'in', values: ['x'], negate: true }, false],
    [{ attribute: 'email', op: 'in', values: ['x'], negate: true }, false],
  ] as const)('%j gives %s', (clause, expected) => {
    expect(clauseMatches({ ...clause, values: [...clause.values] }, context)).toBe(expected);
  });
});
