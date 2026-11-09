import { describe, expect, it } from 'vitest';
import { BUCKET_COUNT, bucketFor, murmur3String, murmur3_32, percentToWeight, weightToPercent } from '../src/index.js';

describe('murmur3_32', () => {
  // Reference values: MurmurHash3 x86 32-bit, seed 0, the same values the Python mmh3 package returns.
  it.each([
    ['', 0x00000000],
    ['hello', 0x248bfa47],
    ['The quick brown fox jumps over the lazy dog', 0x2e4ff723],
  ])('hashes %j to the reference value', (input, expected) => {
    expect(murmur3String(input)).toBe(expected);
  });

  it('uses the seed', () => {
    expect(murmur3_32(new Uint8Array(), 1)).not.toBe(murmur3_32(new Uint8Array(), 0));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 1000; i++) {
      const h = murmur3String(`k${i}`);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('bucketFor', () => {
  // Pinned: if any of these change, every rollout in every installation moves users between variations.
  it.each([
    ['new-checkout', 'u_7f3a9c', 6505],
    ['new-checkout', 'u_000001', 2244],
    ['search-ranking', 'u_b41e07', 9067],
    ['flag', 'ü-ключ-鍵', 6640],
  ])('puts %s / %s in bucket %i', (flag, user, bucket) => {
    expect(bucketFor(flag, user)).toBe(bucket);
  });

  it('gives the same user different buckets in different flags', () => {
    expect(bucketFor('flag-a', 'u_1')).not.toBe(bucketFor('flag-b', 'u_1'));
  });

  it('spreads 100,000 keys evenly over 10 deciles (chi-square, 9 degrees of freedom)', () => {
    const n = 100_000;
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < n; i++) {
      const bucket = bucketFor('distribution-check', `u_${i.toString(36)}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKET_COUNT);
      counts[Math.floor(bucket / 1000)]!++;
    }
    const expected = n / 10;
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 27.88 is the critical value at p = 0.001 for 9 degrees of freedom.
    expect(chi).toBeLessThan(27.88);
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.03);
  });

  it('spreads keys evenly over 100 buckets of 1% each (chi-square, 99 degrees of freedom)', () => {
    const n = 200_000;
    const counts = new Array<number>(100).fill(0);
    for (let i = 0; i < n; i++) counts[Math.floor(bucketFor('percent-check', `ctx-${i}`) / 100)]!++;
    const expected = n / 100;
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // 148.23 is the critical value at p = 0.001 for 99 degrees of freedom.
    expect(chi).toBeLessThan(148.23);
  });
});

describe('weights and percentages', () => {
  it('converts both ways at 0.01% precision', () => {
    expect(percentToWeight(25)).toBe(2500);
    expect(percentToWeight(12.34)).toBe(1234);
    expect(weightToPercent(1)).toBe(0.01);
    expect(weightToPercent(10_000)).toBe(100);
  });
});
