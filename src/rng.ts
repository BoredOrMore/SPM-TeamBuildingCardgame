// Seeded mulberry32 so every game can be replayed from its seed.

/** Next float in [0, 1) from the seeded generator; advances `holder.rng`. */
export function nextRandom(holder: { rng: number }): number {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random integer in [0, maxExclusive). */
export function randomInt(holder: { rng: number }, maxExclusive: number): number {
  return Math.floor(nextRandom(holder) * maxExclusive);
}

/** Shuffled copy of `items` (Fisher-Yates). */
export function shuffle<T>(holder: { rng: number }, items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(holder, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** One random element of a non-empty list. */
export function pickRandom<T>(holder: { rng: number }, items: T[]): T {
  if (items.length === 0) throw new Error('pickRandom on empty list');
  return items[randomInt(holder, items.length)]!;
}
