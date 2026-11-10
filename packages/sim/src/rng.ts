/**
 * mulberry32: a tiny, fast 32-bit PRNG. It uses only integer ops
 * (`Math.imul`, shifts, xor), which are exact in every engine, so a seed
 * always produces the same stream. Not cryptographic, and it doesn't need to be.
 *
 * The state is a plain number so it can live inside SimState and be hashed
 * and copied along with everything else.
 */
export function nextRandom(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform float in [lo, hi). */
export function range(state: { rng: number }, lo: number, hi: number): number {
  return lo + (hi - lo) * nextRandom(state);
}

/** FNV-1a over a string: turns a date like "2026-11-09" into a 32-bit seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
