import competitorsData from '../../data/competitors.json';
import rivalPoolData from '../../data/rival-airlines.json';
import { potentialDailyDemand, ALL_MARKET_PAIRS, marketDistanceNm } from './demand';
import { marketKey, recommendedFare } from './schedule';
import { nextRandom } from './rng';
import { networkAirports } from './reach';
import {
  FREQUENCY_GROWTH_PROBABILITY_PER_DAY,
  MAX_RIVAL_ENTRIES,
  PLAYER_MARKET_WEIGHT,
  pressureFactor,
  RIVAL_TARGETS_PLAYER,
  RIVAL_ENTRY_INTERVAL_DAYS,
  RIVAL_FIRST_ENTRY_DAY,
  RIVAL_FREQUENCY_CAP,
} from './pressure';
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
  return (competitorsData as Omit<CompetitorOffering, 'openedAtMinute' | 'fare'>[]).map((route) => ({
    ...route,
    fare: incumbentFare(route.origin, route.dest),
    openedAtMinute: PRE_EXISTING_OPENED_AT_MINUTE,
  }));
}

/**
 * The fare an incumbent charges: a little under the going rate for the
 * market. These used to be typed into data/competitors.json ($170 to $210)
 * and were left behind when fares were recalibrated upward, so by the time
 * the player arrived every incumbent undercut the going rate by 23% to 51%,
 * and a player charged that rate lost most bookings on those four markets
 * for no reason anyone chose. Computed now, so it cannot drift again.
 */
const INCUMBENT_FARE_FACTOR = 0.9;

function incumbentFare(origin: string, dest: string): number {
  return Math.round(recommendedFare(origin, dest) * INCUMBENT_FARE_FACTOR);
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

/** Competitors are peer startups on regional equipment, so their new routes stay within this. */
const COMPETITOR_MAX_ROUTE_NM = 850;

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
    if (openRoll >= NEW_ROUTE_PROBABILITY_PER_DAY * pressureFactor(state)) continue;

    const servedKeys = new Set(
      state.competitorRoutes.filter((c) => c.code === code).map((c) => marketKey(c.origin, c.dest)),
    );
    // A competitor grows outward from where it already flies, and only in
    // regional hops. Without both limits the AI would open Toronto to
    // Singapore now that the map is global, and would spend all its
    // openings on the biggest markets in Europe.
    const airlineAirports = new Set(
      state.competitorRoutes.filter((c) => c.code === code).flatMap((c) => [c.origin, c.dest]),
    );
    const candidates = ALL_MARKET_PAIRS.filter(
      ([a, b]) =>
        !servedKeys.has(marketKey(a, b)) &&
        (airlineAirports.has(a) || airlineAirports.has(b)) &&
        marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM,
    );
    if (candidates.length === 0) continue; // nothing left within reach of its network

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

const SEED_CODES = new Set((competitorsData as { code: string }[]).map((route) => route.code));

/**
 * A new rival airline arrives, once the calendar says one is due (see
 * sim/pressure.ts): the k-th arrives on day FIRST + k * INTERVAL. It
 * opens a single daily flight on a market next to the player's network,
 * weighted by potential demand and by PLAYER_MARKET_WEIGHT for markets the
 * player already flies, so the newcomer tends to land on something the
 * player built. Markets must be between airports the player knows and
 * within regional range, like every competitor route.
 *
 * "How many have arrived" is read off the routes (airlines that are not in
 * the seed data), so there is no counter to keep in `SimState`. If the
 * player has no network yet, or nothing qualifies, it simply tries again
 * tomorrow. Uses the seeded random stream; call it from the day rollover.
 */
export function rollRivalEntry(state: SimState, dayStartMinute: number): void {
  const day = Math.floor(dayStartMinute / 1440);
  const codesInUse = new Set(state.competitorRoutes.map((route) => route.code));
  const entered = [...codesInUse].filter((code) => !SEED_CODES.has(code)).length;
  if (entered >= MAX_RIVAL_ENTRIES) return;
  if (day < RIVAL_FIRST_ENTRY_DAY + entered * RIVAL_ENTRY_INTERVAL_DAYS) return;

  const known = new Set(state.knownAirports);
  const network = networkAirports(state);
  const playerMarkets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const candidates = ALL_MARKET_PAIRS.filter(
    ([a, b]) =>
      known.has(a) &&
      known.has(b) &&
      (network.has(a) || network.has(b)) &&
      marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM &&
      potentialDailyDemand(a, b) > 0,
  );
  if (candidates.length === 0) return;

  const pool = (rivalPoolData as { airline: string; code: string }[]).filter((rival) => !codesInUse.has(rival.code));
  if (pool.length === 0) return;

  const [targetRoll, seedAfterTarget] = nextRandom(state.rngSeed);
  const [marketRoll, seedAfterMarket] = nextRandom(seedAfterTarget);
  const [nameRoll, seedAfterName] = nextRandom(seedAfterMarket);
  state.rngSeed = seedAfterName;

  // Most of the time the newcomer goes straight for something the player
  // built; otherwise it takes the best market next to the network.
  const playerCandidates = candidates.filter(([a, b]) => playerMarkets.has(marketKey(a, b)));
  const marketPool = playerCandidates.length > 0 && targetRoll < RIVAL_TARGETS_PLAYER ? playerCandidates : candidates;
  const weights = marketPool.map(
    ([a, b]) => potentialDailyDemand(a, b) * (playerMarkets.has(marketKey(a, b)) ? PLAYER_MARKET_WEIGHT : 1),
  );

  const [origin, dest] = pickWeighted(marketPool, weights, marketRoll);
  const rival = pool[Math.min(pool.length - 1, Math.floor(nameRoll * pool.length))];
  state.competitorRoutes.push({
    airline: rival.airline,
    code: rival.code,
    origin,
    dest,
    dailyFrequency: 1,
    fare: recommendedFare(origin, dest),
    openedAtMinute: dayStartMinute,
  });
}

/**
 * Competitors add flights to routes they already fly, up to
 * RIVAL_FREQUENCY_CAP, with a small daily chance per route that grows with
 * pressureFactor(). This is what turns a rival on your route from a
 * nuisance into a threat: booking share follows frequency
 * (sim/choiceModel.ts). One random draw per route per day, in route order.
 */
export function rollCompetitorFrequencyGrowth(state: SimState): void {
  const chance = FREQUENCY_GROWTH_PROBABILITY_PER_DAY * pressureFactor(state);
  for (const route of state.competitorRoutes) {
    const [roll, nextSeed] = nextRandom(state.rngSeed);
    state.rngSeed = nextSeed;
    if (roll < chance && route.dailyFrequency < RIVAL_FREQUENCY_CAP) route.dailyFrequency += 1;
  }
}
