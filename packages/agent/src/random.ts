/**
 * Seeded PRNG (mulberry32).
 *
 * The simulator must be reproducible: a demo that shows different actions on
 * every reload cannot be compared against a receipt, and a test that depends on
 * `Math.random` is not a test. Same seed, same plan, every time.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length) % items.length];
  /* c8 ignore next */
  if (item === undefined) throw new Error('cannot pick from an empty list');
  return item;
}

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
