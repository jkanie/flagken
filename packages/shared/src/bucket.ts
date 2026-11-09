import { murmur3String } from './murmur3.js';

/** Every rollout splits users over this many buckets, so a weight of 1 is 0.01%. */
export const BUCKET_COUNT = 10_000;

/**
 * The bucket (0 to 9,999) for a user in a flag.
 * Input: the UTF-8 bytes of `${flagKey}:${bucketValue}`, hashed with MurmurHash3 x86 32-bit, seed 0.
 * Output: the unsigned hash modulo 10,000.
 * The flag key is part of the input, so 1 user lands in unrelated buckets for different flags.
 */
export function bucketFor(flagKey: string, bucketValue: string): number {
  return murmur3String(`${flagKey}:${bucketValue}`) % BUCKET_COUNT;
}

/** Converts a weight in buckets to a percentage with up to 2 decimals (2,500 becomes 25). */
export function weightToPercent(weight: number): number {
  return Math.round(weight) / 100;
}

/** Converts a percentage to a weight in buckets (12.34 becomes 1,234). */
export function percentToWeight(percent: number): number {
  return Math.round(percent * 100);
}
