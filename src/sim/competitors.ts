import { onSale, SALE_RIVAL_READ } from './seatSale';
import { dayIndex } from './clock';
import competitorsData from '../../data/competitors.json';
import rivalPoolData from '../../data/rival-airlines.json';
import { potentialDailyDemand, ALL_MARKET_PAIRS, marketDistanceNm, pairsTouching } from './demand';
import { marketKey, recommendedFare } from './schedule';
import { nextRandom } from './rng';
import { networkAirports } from './reach';
import {
  FREQUENCY_GROWTH_PROBABILITY_PER_DAY,
  MAX_RIVAL_ENTRIES,
  MAX_RIVAL_ENTRY_CHANCE_PER_DAY,
  pressureFactor,
  RIVAL_ENTRY_CHANCE_PER_DOLLAR,
  RIVAL_OPENING_MONEY_SCALE,
  RIVAL_TARGETS_PLAYER,
  RIVAL_FIRST_ENTRY_DAY,
  RIVAL_FREQUENCY_CAP,
  inRespite,
  recentlyClosedByRival,
  rivalNetworkRoom,
} from './pressure';
import { moneyOnTable } from './attractiveness';
import { rivalSecuresCapacity } from './market';
import { rivalSlotQuote } from './slots';
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
  /** What it charges today; moves in response to the player's fare (rollDailyRivalFares()). */
  fare: number;
  /** The fare it opened at, and drifts back to when the player isn't competing with it. */
  baseFare: number;
  openedAtMinute: number;
  /**
   * Slot fees this route pays a day, locked when each flight's slots were
   * taken (sim/slots.ts's rivalSlotQuote()). Optional: seed routes and
   * routes from older saves hold theirs from before and pay nothing.
   */
  slotFeesPerDay?: number;
  /**
   * Consecutive days this route has lost money (sim/rivalEconomics.ts);
   * reset by any profitable day. Optional so saves from before rivals
   * could close routes still load: absent means 0.
   */
  losingDays?: number;
  /** Consecutive profitable days, and yesterday's passengers over seats (sim/rivalEconomics.ts), for the rival's ladder (sim/rivalLadder.ts). Absent in an older save. */
  profitableDays?: number;
  loadFactor?: number;
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
 * A fresh, independent copy of the competitor roster: each game gets its own mutable
 * array (`state.competitorRoutes`), so one game's competitor AI adding
 * routes can never leak into another's, and nothing mutates this
 * module's own imported data directly. Every seed route starts already
 * "existing," not freshly opened — see `PRE_EXISTING_OPENED_AT_MINUTE`.
 */
export function loadCompetitorRoutes(): CompetitorOffering[] {
  return (competitorsData as Omit<CompetitorOffering, 'openedAtMinute' | 'fare'>[]).map((route) => ({
    ...route,
    fare: incumbentFare(route.origin, route.dest),
    baseFare: incumbentFare(route.origin, route.dest),
    openedAtMinute: PRE_EXISTING_OPENED_AT_MINUTE,
  }));
}

/**
 * The fare an incumbent charges: a little under the going rate for the
 * market. Computed from the going rate rather than typed into the data,
 * so it can't drift when fares are recalibrated.
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

/**
 * The money on the table (sim/attractiveness.ts) on every market the
 * player flies that has any, by market key: worked out once a day and
 * shared by the entry and opening rolls.
 */
function moneyByPlayerMarket(state: SimState): Map<string, number> {
  const money = new Map<string, number>();
  for (const key of new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))) {
    const [a, b] = key.split('-');
    const perDay = moneyOnTable(state, a, b).perDay;
    if (perDay > 0) money.set(key, perDay);
  }
  return money;
}

/** Competitors are peer startups on regional equipment, so their new routes stay within this. */
const COMPETITOR_MAX_ROUTE_NM = 850;

/**
 * Once per simulated day (called from step.ts's day-rollover, alongside
 * rollDailyWeather()): each competitor airline already in the game (new
 * airlines arrive separately, via rollRivalEntry()) gets an independent,
 * small chance to open exactly one new route on a market it doesn't
 * already serve. The chance rises with pressureFactor() and shrinks as
 * the airline's network fills (sim/pressure.ts's rivalNetworkRoom()), so
 * openings slow down and stop at RIVAL_MAX_ROUTES_PER_AIRLINE.
 *
 * The player's markets in its reach that leave money on the table
 * (sim/attractiveness.ts) raise that chance (RIVAL_OPENING_MONEY_SCALE),
 * and with chance RIVAL_TARGETS_PLAYER it opens on one of them, weighted
 * by the money there. Otherwise it picks any market in reach weighted by
 * potentialDailyDemand() (sim/demand.ts): *potential*, not the stimulated
 * actual demand, on purpose, since a competitor sizing up a market should
 * be drawn to how big it could get. A freshly-opened route starts small
 * (dailyFrequency 1) at this map's recommendedFare() (sim/schedule.ts) —
 * the same default a player's own new route gets — and is stamped with
 * `dayStartMinute` as its `openedAtMinute`, which is what lets
 * render/competition.ts flash it on the map as news the moment it
 * happens rather than a silent data change.
 */
export function rollCompetitorRouteOpenings(state: SimState, dayStartMinute: number): void {
  const roster = [...new Map(state.competitorRoutes.map((c) => [c.code, { airline: c.airline, code: c.code }])).values()];
  const money = moneyByPlayerMarket(state);

  for (const { airline, code } of roster) {
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
    // The player's markets within this airline's reach that leave money on
    // the table: they make it keener to open a route, and are where it
    // mostly goes when it does.
    const inReach = [...money.entries()].filter(([key]) => {
      const [a, b] = key.split('-');
      return (
        !servedKeys.has(key) &&
        !recentlyClosedByRival(state, code, a, b) &&
        !inRespite(state, a, b) &&
        (airlineAirports.has(a) || airlineAirports.has(b)) &&
        marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM
      );
    });
    const moneyInReach = inReach.reduce((sum, [, perDay]) => sum + perDay, 0);

    const [openRoll, seedAfterOpen] = nextRandom(state.rngSeed);
    state.rngSeed = seedAfterOpen;
    const openChance =
      NEW_ROUTE_PROBABILITY_PER_DAY * pressureFactor(state) * rivalNetworkRoom(state, code) * (1 + moneyInReach / RIVAL_OPENING_MONEY_SCALE);
    if (openRoll >= openChance) continue;

    // Only pairs touching its network, found by airport rather than by walking every pair.
    const candidates = pairsTouching(airlineAirports).filter(
      ([a, b]) =>
        marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM &&
        !servedKeys.has(marketKey(a, b)) &&
        !recentlyClosedByRival(state, code, a, b) &&
        !inRespite(state, a, b),
    );
    if (candidates.length === 0) continue; // nothing left within reach of its network

    const [targetRoll, seedAfterTarget] = nextRandom(state.rngSeed);
    const [pickRoll, seedAfterPick] = nextRandom(seedAfterTarget);
    state.rngSeed = seedAfterPick;
    // Most of the time, the player market with the most on the table;
    // otherwise any market in reach, by potential.
    const targetsPlayer = inReach.length > 0 && targetRoll < RIVAL_TARGETS_PLAYER;
    const [origin, dest] = targetsPlayer
      ? (pickWeighted(inReach.map(([key]) => key), inReach.map(([, perDay]) => perDay), pickRoll).split('-') as [string, string])
      : pickWeighted(candidates, candidates.map(([a, b]) => potentialDailyDemand(a, b)), pickRoll);
    // A new route needs slots at both ends (checked first, so no plane is
    // leased for a route that can't fly) and a plane, leased from the same
    // market the player uses (sim/market.ts). No slot or no plane, no route today.
    const slotFees = rivalSlotQuote(state, origin, dest);
    if (slotFees === null) continue;
    if (!rivalSecuresCapacity(state, code, 1)) continue;

    state.competitorRoutes.push({
      airline,
      code,
      origin,
      dest,
      dailyFrequency: 1,
      fare: recommendedFare(origin, dest),
      baseFare: recommendedFare(origin, dest),
      openedAtMinute: dayStartMinute,
      slotFeesPerDay: slotFees,
    });
  }
}

const SEED_CODES = new Set((competitorsData as { code: string }[]).map((route) => route.code));

/**
 * A new rival airline arrives. From RIVAL_FIRST_ENTRY_DAY, each day has a
 * chance of one, which grows with the money the player's network leaves
 * on the table (sim/pressure.ts, sim/attractiveness.ts), up to
 * MAX_RIVAL_ENTRIES in a game. It opens a single daily flight on a market
 * next to the player's network. With chance RIVAL_TARGETS_PLAYER it goes
 * after one of the player's own markets, weighted by the money on the
 * table there; otherwise, or if no player market has any, it takes a
 * market next to the network weighted by potential demand. Markets must be
 * between airports the player knows and within regional range, like every
 * competitor route.
 *
 * "How many have arrived" is read off the routes (airlines that are not in
 * the seed data), so there is no counter to keep in `SimState`. Uses the
 * seeded random stream; call it from the day rollover.
 */
export function rollRivalEntry(state: SimState, dayStartMinute: number): void {
  const day = dayIndex(state, dayStartMinute);
  const codesInUse = new Set(state.competitorRoutes.map((route) => route.code));
  const entered = [...codesInUse].filter((code) => !SEED_CODES.has(code)).length;
  if (entered >= MAX_RIVAL_ENTRIES) return;
  if (day < RIVAL_FIRST_ENTRY_DAY) return;

  // Whether one comes today at all: the more the network leaves on the
  // table, the likelier.
  const money = moneyByPlayerMarket(state);
  const networkMoney = [...money.values()].reduce((sum, perDay) => sum + perDay, 0);
  const [arrivalRoll, seedAfterArrival] = nextRandom(state.rngSeed);
  state.rngSeed = seedAfterArrival;
  if (arrivalRoll >= Math.min(MAX_RIVAL_ENTRY_CHANCE_PER_DAY, networkMoney * RIVAL_ENTRY_CHANCE_PER_DOLLAR)) return;

  const known = new Set(state.knownAirports);
  const network = networkAirports(state);
  const candidates = ALL_MARKET_PAIRS.filter(
    ([a, b]) =>
      known.has(a) &&
      known.has(b) &&
      (network.has(a) || network.has(b)) &&
      marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM &&
      potentialDailyDemand(a, b) > 0 &&
      !inRespite(state, a, b),
  );
  if (candidates.length === 0) return;

  const pool = (rivalPoolData as { airline: string; code: string }[]).filter((rival) => !codesInUse.has(rival.code));
  if (pool.length === 0) return;

  const [targetRoll, seedAfterTarget] = nextRandom(state.rngSeed);
  const [marketRoll, seedAfterMarket] = nextRandom(seedAfterTarget);
  const [nameRoll, seedAfterName] = nextRandom(seedAfterMarket);
  state.rngSeed = seedAfterName;

  // Most of the time the newcomer goes after something the player built,
  // weighted by the money it leaves on the table (sim/attractiveness.ts):
  // passengers turned away and a fat margin. A player market with nothing
  // on the table isn't a target at all, so a lean airline is left alone
  // and the newcomer takes the best market next to the network instead.
  const playerCandidates = candidates.filter(([a, b]) => money.has(marketKey(a, b)));
  const targetsPlayer = playerCandidates.length > 0 && targetRoll < RIVAL_TARGETS_PLAYER;
  const marketPool = targetsPlayer ? playerCandidates : candidates;
  const weights = marketPool.map(([a, b]) => (targetsPlayer ? money.get(marketKey(a, b))! : potentialDailyDemand(a, b)));

  const [origin, dest] = pickWeighted(marketPool, weights, marketRoll);
  const rival = pool[Math.min(pool.length - 1, Math.floor(nameRoll * pool.length))];
  // A new airline needs slots at both ends and its first plane from the
  // market, like anyone.
  const slotFees = rivalSlotQuote(state, origin, dest);
  if (slotFees === null) return;
  if (!rivalSecuresCapacity(state, rival.code, 1)) return;
  state.competitorRoutes.push({
    airline: rival.airline,
    code: rival.code,
    origin,
    dest,
    dailyFrequency: 1,
    fare: recommendedFare(origin, dest),
    baseFare: recommendedFare(origin, dest),
    openedAtMinute: dayStartMinute,
    slotFeesPerDay: slotFees,
  });
}

/** How many of home's biggest markets the home rival picks among. */
const HOME_RIVAL_CHOICES = 5;

/**
 * A rival already flying from the player's home on day one: a local
 * start-up from the rival pool, on one daily route to somewhere the player
 * can see. Picked by the seeded stream from home's HOME_RIVAL_CHOICES
 * biggest markets that no rival flies yet, weighted by potential demand,
 * so every start differs, even from the same home, and the single best
 * market isn't always the contested one. It is an incumbent, like the
 * seed routes: priced a little under the going rate, holding its slots
 * and its plane from before the game. It counts as one of the game's
 * MAX_RIVAL_ENTRIES newcomers. Called once, when the home is chosen.
 */
export function placeHomeRival(state: SimState): void {
  const home = state.homeAirport;
  const served = new Set(state.competitorRoutes.map((route) => marketKey(route.origin, route.dest)));
  const known = new Set(state.knownAirports);
  const markets = ALL_MARKET_PAIRS.filter(
    ([a, b]) =>
      (a === home || b === home) &&
      known.has(a) &&
      known.has(b) &&
      !served.has(marketKey(a, b)) &&
      marketDistanceNm(a, b) <= COMPETITOR_MAX_ROUTE_NM &&
      potentialDailyDemand(a, b) > 0,
  )
    .sort((x, y) => potentialDailyDemand(y[0], y[1]) - potentialDailyDemand(x[0], x[1]))
    .slice(0, HOME_RIVAL_CHOICES);
  const codesInUse = new Set(state.competitorRoutes.map((route) => route.code));
  const pool = (rivalPoolData as { airline: string; code: string }[]).filter((rival) => !codesInUse.has(rival.code));
  if (markets.length === 0 || pool.length === 0) return;

  const [marketRoll, seedAfterMarket] = nextRandom(state.rngSeed);
  const [nameRoll, seedAfterName] = nextRandom(seedAfterMarket);
  state.rngSeed = seedAfterName;
  const [a, b] = pickWeighted(markets, markets.map(([x, y]) => potentialDailyDemand(x, y)), marketRoll);
  const rival = pool[Math.min(pool.length - 1, Math.floor(nameRoll * pool.length))];
  const origin = a === home ? a : b;
  const dest = a === home ? b : a;
  state.competitorRoutes.push({
    airline: rival.airline,
    code: rival.code,
    origin,
    dest,
    dailyFrequency: 1,
    fare: incumbentFare(origin, dest),
    baseFare: incumbentFare(origin, dest),
    openedAtMinute: PRE_EXISTING_OPENED_AT_MINUTE,
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
    if (roll < chance && route.dailyFrequency < RIVAL_FREQUENCY_CAP) addRivalFlight(state, route);
  }
}

/**
 * One more daily flight on a rival route, if it can get the slots at both
 * ends (checked first) and a plane. Its slot fees are added at today's
 * price. Whether it happened.
 */
export function addRivalFlight(state: SimState, route: CompetitorOffering): boolean {
  const slotFees = rivalSlotQuote(state, route.origin, route.dest);
  if (slotFees === null || !rivalSecuresCapacity(state, route.code, 1)) return false;
  route.dailyFrequency += 1;
  route.slotFeesPerDay = (route.slotFeesPerDay ?? 0) + slotFees;
  return true;
}

// --- Fare response ------------------------------------------------------------

/**
 * Rivals respond to the player's fares, once a day, on every market both
 * fly, so competition is on price as well as frequency.
 *
 * The behaviour is a simple, readable one:
 *   - The player is cheaper: the rival cuts toward the player's fare —
 *     matching, not undercutting, so a price war only escalates if the
 *     player keeps cutting — down to a floor it won't go below, standing
 *     in for its costs.
 *   - The player is dearer: the rival raises toward the player's fare but
 *     stays RIVAL_FOLLOW_UP_DISCOUNT under it, to keep taking share, up to
 *     a ceiling.
 *   - The player doesn't fly the market: the rival drifts back to the fare
 *     it opened at.
 * Each move covers RIVAL_FARE_ADJUST_SHARE of the gap a day, so a fare
 * change plays out over days rather than snapping. Deterministic — no
 * random draws.
 */
const RIVAL_FARE_FLOOR_SHARE = 0.65;
const RIVAL_FARE_CEILING_SHARE = 1.4;
const RIVAL_FOLLOW_UP_DISCOUNT = 0.08;
export const RIVAL_FARE_ADJUST_SHARE = 0.25;
const RIVAL_FARE_DRIFT_SHARE = 0.1;

/** Where this rival's fare is heading today, given the player's fare on the market (null if the player doesn't fly it). */
export function rivalFareTarget(route: CompetitorOffering, playerFare: number | null): number {
  const goingRate = recommendedFare(route.origin, route.dest);
  const floor = goingRate * RIVAL_FARE_FLOOR_SHARE;
  const ceiling = goingRate * RIVAL_FARE_CEILING_SHARE;
  if (playerFare === null) return route.baseFare;
  if (playerFare < route.fare) return Math.max(floor, playerFare);
  return Math.min(ceiling, Math.max(route.fare, playerFare * (1 - RIVAL_FOLLOW_UP_DISCOUNT)));
}

export function rollDailyRivalFares(state: SimState): void {
  const playerFlies = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const route of state.competitorRoutes) {
    const key = marketKey(route.origin, route.dest);
    const listed = playerFlies.has(key) ? (state.routeSettings[key]?.fare ?? null) : null;
    // A seat sale reads to a rival as a cut, so it can answer one (sim/seatSale.ts).
    const playerFare = listed !== null && onSale(state, key) ? listed * (1 - SALE_RIVAL_READ) : listed;
    const target = rivalFareTarget(route, playerFare);
    const share = playerFare === null ? RIVAL_FARE_DRIFT_SHARE : RIVAL_FARE_ADJUST_SHARE;
    route.fare = Math.round(route.fare + (target - route.fare) * share);
  }
}
