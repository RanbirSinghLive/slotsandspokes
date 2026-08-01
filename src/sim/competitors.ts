import competitorsData from '../../data/competitors.json';
import { potentialDailyDemand, ALL_MARKET_PAIRS } from './demand';
import { marketKey, recommendedFare } from './schedule';
import { nextRandom } from './rng';
import type { SimState } from './state';

/**
 * One competitor route. `openedAtMinute` (new) is the `simMinute` this
 * entry actually joined the market — real routes from `data/competitors.json`
 * all share the same `PRE_EXISTING_OPENED_AT_MINUTE` sentinel (they were
 * never "opened," they were just always there), while a route the
 * competitor AI adds mid-game (see `sim/step.ts`'s day-rollover handling)
 * gets the real `state.simMinute` it was created at. `render/competition.ts`
 * reads this to decide whether a route is recent enough to flash on the
 * map — a plain read of state, not anything step() itself cares about.
 */
export type CompetitorOffering = {
  airline: string;
  /** Two-letter, all-caps shorthand — see sim/airline.ts's PLAYER_AIRLINE
   * for the player's own equivalent. */
  code: string;
  origin: string;
  dest: string;
  dailyFrequency: number;
  fare: number;
  openedAtMinute: number;
};

/**
 * Deliberately a large, finite negative number rather than `-Infinity`:
 * `JSON.stringify(-Infinity)` produces `null`, which would silently break
 * `SimState`'s "survives JSON.parse(JSON.stringify(state)) unchanged" rule
 * (CLAUDE.md) the moment a save/load round-trip happened. Finite and far
 * enough in the past that `state.simMinute - openedAtMinute` can never
 * fall inside the map's recent-opening flash window, however long a game
 * has been running.
 */
export const PRE_EXISTING_OPENED_AT_MINUTE = -999_999;

/**
 * A fresh, independent copy of the competitor roster — same reasoning as
 * `sim/schedule.ts`'s `loadSchedule()`: each game gets its own mutable
 * array (`state.competitorRoutes`), so one game's competitor AI adding
 * routes can never leak into another's, and nothing mutates this
 * module's own imported data directly. Every seed route starts already
 * "existing," not freshly opened — see `PRE_EXISTING_OPENED_AT_MINUTE`.
 */
export function loadCompetitorRoutes(): CompetitorOffering[] {
  return (competitorsData as Omit<CompetitorOffering, 'openedAtMinute'>[]).map((route) => ({
    ...route,
    openedAtMinute: PRE_EXISTING_OPENED_AT_MINUTE,
  }));
}

// Deliberately crude, same spirit as sim/weather.ts's daily roll: a small
// per-airline, per-day chance of opening exactly one new route, weighted
// toward markets with more demand but not restricted to always the single
// biggest one. This "AI" isn't solving an optimization problem — it's
// producing a plausible, slowly-shifting competitive map for the player
// to notice and react to, the same deliberately-simple spirit as every
// other random model in sim/.
const NEW_ROUTE_PROBABILITY_PER_DAY = 0.03;

/**
 * Weighted pick among `items` — `roll` (already in [0, 1) from
 * nextRandom()) lands in one of `weights`' proportional slices. Falls
 * back to a uniform pick if every weight is zero (shouldn't happen here,
 * since potentialDailyDemand() is never negative and every pair has at least some
 * population product, but a real fallback beats a NaN from a 0/0
 * division if it ever did).
 */
function pickWeighted<T>(items: T[], weights: number[], roll: number): T {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(roll * items.length))];

  const target = roll * total;
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (target < cumulative) return items[i];
  }
  return items[items.length - 1]; // floating-point safety net
}

/**
 * Once per simulated day (called from step.ts's day-rollover, alongside
 * rollDailyWeather()): each competitor airline already in the game — the
 * roster is derived from whichever airlines already have at least one
 * route, so this never invents a brand-new competitor mid-game, only
 * grows the existing three's own networks — gets an independent, small
 * chance to open exactly one new route on a market it doesn't already
 * serve.
 *
 * Candidates are weighted by potentialDailyDemand() (sim/demand.ts) —
 * *potential*, not the stimulated actual demand, on purpose: a
 * competitor sizing up a market should be drawn to how big it could get,
 * the same judgment a player makes, not to how little traffic it happens
 * to carry while nobody serves it. Weighted rather than deterministic so
 * they don't all pile onto the single biggest pair. A freshly-opened route starts small
 * (dailyFrequency 1) at this map's recommendedFare() (sim/schedule.ts) —
 * the same default a player's own new route gets — and is stamped with
 * `dayStartMinute` as its `openedAtMinute`, which is what lets
 * render/competition.ts flash it on the map as news the moment it
 * happens rather than a silent data change.
 */
export function rollCompetitorRouteOpenings(state: SimState, dayStartMinute: number): void {
  const roster = [...new Map(state.competitorRoutes.map((c) => [c.code, { airline: c.airline, code: c.code }])).values()];

  for (const { airline, code } of roster) {
    const [openRoll, seedAfterOpen] = nextRandom(state.rngSeed);
    state.rngSeed = seedAfterOpen;
    if (openRoll >= NEW_ROUTE_PROBABILITY_PER_DAY) continue;

    const servedKeys = new Set(
      state.competitorRoutes.filter((c) => c.code === code).map((c) => marketKey(c.origin, c.dest)),
    );
    const candidates = ALL_MARKET_PAIRS.filter(([a, b]) => !servedKeys.has(marketKey(a, b)));
    if (candidates.length === 0) continue; // this airline already serves every possible market

    const weights = candidates.map(([a, b]) => potentialDailyDemand(a, b));
    const [pickRoll, seedAfterPick] = nextRandom(state.rngSeed);
    state.rngSeed = seedAfterPick;
    const [origin, dest] = pickWeighted(candidates, weights, pickRoll);

    state.competitorRoutes.push({
      airline,
      code,
      origin,
      dest,
      dailyFrequency: 1,
      fare: recommendedFare(origin, dest),
      openedAtMinute: dayStartMinute,
    });
  }
}
