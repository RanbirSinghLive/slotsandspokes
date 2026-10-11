import type { SimState } from './state';

/**
 * Standing: how much a client trusts the airline, built slowly by
 * finishing what it asked for and fading when the airline stops. One
 * number per client, 0 to 100, kept under a string key so any kind of
 * client can use it: an event's client is `event:<story>` (sim/mandates.ts);
 * a tender's buyer can be `buyer:<id>` the same way.
 *
 * It is the game's "repeat business" moat. It cannot be bought, only
 * earned a flight at a time (a clean term is worth about a dozen
 * points) and it fades about 0.4% of itself a day, so a loyal client is
 * months of reliable flying and a rival that has not done that work
 * cannot copy it.
 */
export const STANDING_MAX = 100;
const FADE_PER_DAY = 0.004;
/** Points a standing below this is worth nothing: it rounds away rather than lingering. */
const STANDING_FLOOR = 0.5;

export function standingOf(state: SimState, key: string): number {
  return state.standing?.[key] ?? 0;
}

export function earnStanding(state: SimState, key: string, points: number): void {
  const standing = (state.standing ??= {});
  standing[key] = Math.min(STANDING_MAX, Math.round(((standing[key] ?? 0) + points) * 10) / 10);
}

export function loseStanding(state: SimState, key: string, points: number): void {
  const standing = (state.standing ??= {});
  const next = Math.round(((standing[key] ?? 0) - points) * 10) / 10;
  if (next < STANDING_FLOOR) delete standing[key];
  else standing[key] = next;
}

/** 1 at no standing, up to 2 at full standing: what a client pays over its base rate. */
export function standingPayMultiplier(state: SimState, key: string): number {
  return 1 + standingOf(state, key) / STANDING_MAX;
}

/** Once a day at rollover: every standing fades a little. */
export function fadeStandings(state: SimState): void {
  const standing = state.standing;
  if (!standing) return;
  for (const key of Object.keys(standing)) {
    const next = Math.round(standing[key] * (1 - FADE_PER_DAY) * 10) / 10;
    if (next < STANDING_FLOOR) delete standing[key];
    else standing[key] = next;
  }
}

/** Five pips for the card: one per 20 points. */
export function standingPips(points: number): string {
  const lit = Math.min(5, Math.floor(points / 20));
  return '●'.repeat(lit) + '○'.repeat(5 - lit);
}
