/**
 * MurmurHash3, x86 32-bit variant (Austin Appleby's reference algorithm).
 * Pure integer maths, so the server, the Node SDK, the browser SDK return the same value.
 */
export function murmur3_32(data: Uint8Array, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const length = data.length;
  const blocks = length >>> 2;
  let h = seed >>> 0;

  for (let i = 0; i < blocks; i++) {
    const o = i * 4;
    let k = data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  const tail = blocks * 4;
  const rest = length & 3;
  let k = 0;
  if (rest === 3) k ^= data[tail + 2]! << 16;
  if (rest >= 2) k ^= data[tail + 1]! << 8;
  if (rest >= 1) {
    k ^= data[tail]!;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
  }

  h ^= length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const encoder = new TextEncoder();

/** MurmurHash3 x86 32-bit of the UTF-8 bytes of a string. */
export function murmur3String(text: string, seed = 0): number {
  return murmur3_32(encoder.encode(text), seed);
}
