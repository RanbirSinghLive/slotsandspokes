/**
 * A small, fast, seeded pseudo-random number generator (the "mulberry32"
 * algorithm). "Seeded" means the entire internal state of the generator is
 * just this one number — given the same seed, calling this produces the
 * exact same output every time, and the exact same sequence of outputs
 * across repeated calls where each call's `nextSeed` feeds the next call.
 *
 * This exists instead of Math.random() because Math.random() has hidden
 * internal state that isn't part of `state` and can't be inspected, saved,
 * or reproduced — a function that calls it can't be deterministic, which
 * breaks the one rule step() has to follow (see CLAUDE.md, "Time"). Turn
 * the seed into an ordinary field on SimState instead, and "same state in,
 * same state out" holds even for a step() that needs some randomness, e.g.
 * how late a flight lands.
 *
 * Returns a value in [0, 1), same range as Math.random(), plus the seed to
 * use for the next call. Typical use inside step():
 *
 *   const [delayRoll, nextSeed] = nextRandom(state.rngSeed);
 *   state.rngSeed = nextSeed;
 */
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  const nextSeed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(nextSeed ^ (nextSeed >>> 15), nextSeed | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, nextSeed];
}
