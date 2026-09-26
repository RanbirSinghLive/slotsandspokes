import airportsData from '../../data/airports.json';
import { AIRCRAFT_CLASSES, classByCode } from '../sim/aircraftClasses';
import { dayIndex } from '../sim/clock';
import { potentialDailyDemand } from '../sim/demand';
import { greatCircleDistanceNm } from '../sim/geo';
import { cashNeededToLease } from '../sim/leasing';
import * as actions from '../sim/playerActions';
import { setFareStance } from '../sim/pricing';
import { applyRotation, planRotation, type RotationStop } from '../sim/rotations';
import { isAircraftTypeAllowedAt, legsServingMarket, marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { TURN_BUFFER_CHOICES } from '../sim/turnBuffer';
import { utilisationPools } from '../sim/utilisation';

/**
 * The headless "players" that balance runs are played by (WEEK-EIGHT.md,
 * "a headless player that plays"). Each acts only through what a player
 * can do on screen: the rotation planner the route builder uses, and the
 * ring's actions in sim/playerActions.ts. It reads only what the screen
 * shows: cash, each market's daily P&L and cancellations, how full each
 * plane's day is, and the lessor's listings.
 *
 * - **starter** fills its first plane's day on the first morning and then
 *   does nothing. It is the floor: how the game goes if you never touch it.
 * - **steady** plays like a careful player checking in once a day. Each
 *   habit is a small function with one threshold, run in a fixed order,
 *   so when a balance number moves the reason can be read here. There is
 *   no lookahead and no randomness: two runs from one seed still match.
 */

export type PlayerKind = 'starter' | 'steady';
export const PLAYER_KINDS: PlayerKind[] = ['starter', 'steady'];

export type Player = {
  kind: PlayerKind;
  /** The first morning, before any time passes: routes for the starting plane. */
  open(state: SimState): string[];
  /** Once a day, at rollover, after the day's numbers are final. Returns what it did, in words. */
  playDay(state: SimState): string[];
};

export function createPlayer(kind: PlayerKind): Player {
  return kind === 'starter' ? starterPlayer() : steadyPlayer();
}

/**
 * The command line's `--player starter|steady` (steady when left out),
 * and the other arguments in order without it, so each runner keeps its
 * own positional arguments.
 */
export function playerFromArgs(argv: string[]): { kind: PlayerKind; rest: string[] } {
  const rest = [...argv];
  const at = rest.indexOf('--player');
  if (at === -1) return { kind: 'steady', rest };
  const [, kind] = rest.splice(at, 2);
  if (!PLAYER_KINDS.includes(kind as PlayerKind)) {
    throw new Error(`Unknown player "${kind}". Choose one of: ${PLAYER_KINDS.join(', ')}.`);
  }
  return { kind: kind as PlayerKind, rest };
}

// --- Thresholds ---------------------------------------------------------

/** The latest a rotation may land back at base: an hour before the 22:00 curfew, so one late leg doesn't cost the next. */
export const LATEST_LANDING_MINUTE = 21 * 60;
/** A market is cut once it has lost money this many days in a row... */
export const LOSING_DAYS_TO_CUT = 14;
/** ...but only once it has flown this long, since demand grows into new service. */
export const RAMP_UP_DAYS = 21;
/** Days a market is left alone after the player changes it, so the change can show up in the numbers. */
export const SETTLE_DAYS = 7;
/** Days in the last week with a cancellation before a market's timing gets a buffer. One bad day is weather, not a schedule problem. */
export const CANCELLING_DAYS_TO_BUFFER = 2;
/** Days in the last week with a cancellation that mean the market is overbooked, not unlucky: drop a flight. */
export const CANCELLING_DAYS_TO_DROP = 4;
/** How full a class's pool at base has to be before another plane is worth leasing. */
export const LEASE_WHEN_POOL_SHARE = 0.85;
/** Cash to keep on top of the lessor's own reserve, in days of the new plane's lease. */
export const LEASE_SAFETY_DAYS = 30;

const airports = airportsData as RotationStop[];
const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// --- The two players -----------------------------------------------------

function starterPlayer(): Player {
  return {
    kind: 'starter',
    open: (state) => {
      for (const aircraft of state.aircraft) fillPlane(state, aircraft.tail, Infinity);
      return [];
    },
    playDay: () => [],
  };
}

function steadyPlayer(): Player {
  // When the player last changed each market, by market key: a market is
  // judged again only once that change has had time to show.
  const lastTouched = new Map<string, number>();
  const settled = (state: SimState, key: string) => dayIndex(state) - (lastTouched.get(key) ?? -Infinity) >= SETTLE_DAYS;
  const touch = (state: SimState, key: string) => lastTouched.set(key, dayIndex(state));

  return {
    kind: 'steady',
    open: (state) => {
      for (const aircraft of state.aircraft) fillPlane(state, aircraft.tail, LATEST_LANDING_MINUTE);
      return [];
    },
    playDay: (state) => [
      ...leaveSlack(state, settled, touch),
      ...cutLosers(state, settled, touch),
      ...leaseWhenFull(state),
    ],
  };
}

// --- Filling a plane's day ------------------------------------------------

/**
 * Keep adding out-and-back rotations from the plane's base until its day
 * is full, each time choosing the known airport with the most potential
 * demand per flight already on that market. Dividing by existing flights
 * spreads planes over several markets instead of stacking every rotation
 * on the single biggest one. A rotation landing after `latestLanding`
 * (home-local minutes) is not taken. Every market opened is priced on the
 * Match stance (sim/pricing.ts), the neutral choice.
 */
function fillPlane(state: SimState, tail: string, latestLanding: number): string[] {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const home = airportByIata.get(aircraft.baseAirport ?? state.homeAirport)!;
  const opened: string[] = [];
  // A safety cap: every rotation uses up part of the day, so the loop ends on its own long before this.
  const MAX_ROTATIONS_PER_PLANE = 20;

  for (let added = 0; added < MAX_ROTATIONS_PER_PLANE; added++) {
    let best: { dest: RotationStop; score: number } | null = null;
    for (const dest of airports) {
      if (dest.iata === home.iata || !state.knownAirports.includes(dest.iata)) continue;
      const demand = potentialDailyDemand(home.iata, dest.iata);
      if (demand <= 0) continue;
      const score = demand / (1 + legsServingMarket(home.iata, dest.iata, state.schedule));
      // Ties go to the earlier airport in the data file, so the pick never
      // depends on anything but the state.
      if (best && score <= best.score) continue;
      const plan = planRotation([home], dest, tail, state);
      if (plan.error !== null || plan.arriveBackMinute > latestLanding) continue;
      best = { dest, score };
    }
    if (!best) break; // this plane's day is full, or nothing is in reach
    applyRotation(state, tail, planRotation([home], best.dest, tail, state));
    setFareStance(state, home.iata, best.dest.iata, 'match');
    opened.push(`${home.iata}–${best.dest.iata}`);
  }
  return opened;
}

// --- Habits ----------------------------------------------------------------

type Settled = (state: SimState, key: string) => boolean;
type Touch = (state: SimState, key: string) => void;

/** Every market on the schedule, as [a, b] with a < b. */
function scheduledMarkets(state: SimState): [string, string][] {
  const keys = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  return [...keys].sort().map((key) => key.split('-') as [string, string]);
}

/** Take one flight off a market, or the whole route if it's the last one. */
function dropOneFlight(state: SimState, a: string, b: string): actions.Outcome<{ message: string }> {
  const flight = actions.removeFlight(state, a, b);
  return flight.ok ? flight : actions.removeRoute(state, a, b);
}

/**
 * Habit 1, leave slack. A market that had a cancellation most days last
 * week is overbooked: its plane can't get round in time, and a buffer
 * would only make that worse, so drop a flight. One with cancellations
 * on a couple of days gets 15 more minutes of turn buffer, if the plane's
 * day has room; if it hasn't, it drops a flight instead. A single bad
 * day is left alone: a storm at home cancels a flight on every market,
 * and no schedule change fixes weather.
 */
function leaveSlack(state: SimState, settled: Settled, touch: Touch): string[] {
  const log: string[] = [];
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!settled(state, key)) continue;
    const cancelled = state.onTimeHistoryByMarket[key]?.cancelled.slice(-7) ?? [];
    const cancellingDays = cancelled.filter((count) => count > 0).length;
    if (cancellingDays < CANCELLING_DAYS_TO_BUFFER) continue;

    if (cancellingDays < CANCELLING_DAYS_TO_DROP) {
      const next = TURN_BUFFER_CHOICES.find((minutes) => minutes > actions.currentTurnBuffer(state, a, b));
      const buffer = next === undefined ? null : actions.setTurnBuffer(state, a, b, next);
      if (buffer?.ok) {
        touch(state, key);
        log.push(`${a}–${b} had cancellations on ${cancellingDays} of the last 7 days: turn buffer to +${next} min.`);
        continue;
      }
    }
    const dropped = dropOneFlight(state, a, b);
    if (dropped.ok) {
      touch(state, key);
      log.push(`${a}–${b} had cancellations on ${cancellingDays} of the last 7 days: ${dropped.message}`);
    }
  }
  return log;
}

/**
 * Habit 2, cut losers. A market that has made no money for
 * LOSING_DAYS_TO_CUT days in a row loses a flight, once it has had
 * RAMP_UP_DAYS to grow into its service. A day with every flight
 * cancelled counts as losing: it earned nothing and still took the
 * plane's time.
 */
function cutLosers(state: SimState, settled: Settled, touch: Touch): string[] {
  const log: string[] = [];
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!settled(state, key)) continue;
    const revenue = state.revenueHistoryByMarket[key] ?? [];
    const cost = state.costHistoryByMarket[key] ?? [];
    if (revenue.length < RAMP_UP_DAYS) continue;
    const recent = revenue.slice(-LOSING_DAYS_TO_CUT).map((r, i) => r - cost[cost.length - LOSING_DAYS_TO_CUT + i]);
    if (recent.some((margin) => margin > 0)) continue;
    const dropped = dropOneFlight(state, a, b);
    if (dropped.ok) {
      touch(state, key);
      log.push(`${a}–${b} made no money for ${LOSING_DAYS_TO_CUT} days: ${dropped.message}`);
    }
  }
  return log;
}

/**
 * The best market from `home` for a plane of this class: in its range,
 * at an airport that takes it, scored the way fillPlane() scores. Null
 * when there's nothing.
 */
function bestMarketFor(state: SimState, home: string, typeCode: string): { dest: string; score: number } | null {
  const spec = classByCode(typeCode)!;
  const from = airportByIata.get(home)!;
  let best: { dest: string; score: number } | null = null;
  for (const dest of airports) {
    if (dest.iata === home || !state.knownAirports.includes(dest.iata)) continue;
    if (!isAircraftTypeAllowedAt(dest.iata, typeCode)) continue;
    if (greatCircleDistanceNm(from, dest) > spec.rangeNm) continue;
    const score = potentialDailyDemand(home, dest.iata) / (1 + legsServingMarket(home, dest.iata, state.schedule));
    if (!best || score > best.score) best = { dest: dest.iata, score };
  }
  return best;
}

/**
 * Habit 5, lease when full. Once a class's pool at home is
 * LEASE_WHEN_POOL_SHARE booked and last week made money overall, lease
 * one more plane: the largest class on offer whose best market has the
 * riders to fill a round trip, with cash to cover the lessor's reserve
 * plus LEASE_SAFETY_DAYS more. Then give it a day at once, since an idle
 * plane is only cost. One lease a day at most.
 */
function leaseWhenFull(state: SimState): string[] {
  const home = state.homeAirport;
  const pools = utilisationPools(state, home).filter((pool) => pool.planes > 0);
  if (!pools.some((pool) => pool.share >= LEASE_WHEN_POOL_SHARE)) return [];
  const lastWeek = state.marginHistory.slice(-7);
  if (lastWeek.length < 7 || lastWeek.reduce((sum, margin) => sum + margin, 0) <= 0) return [];

  const options = actions.planeOptions(state, home);
  for (const cls of [...AIRCRAFT_CLASSES].reverse()) {
    const option = options.find((o) => o.code === cls.code);
    if (!option?.listing || option.disabledReason) continue;
    const price = option.listing.leasePricePerDay;
    if (state.cash < cashNeededToLease(price) + LEASE_SAFETY_DAYS * price) continue;
    const market = bestMarketFor(state, home, cls.code);
    // One round trip's worth of riders: a full plane each way.
    if (!market || market.score < 2 * cls.seats) continue;

    const leased = actions.leasePlane(state, home, cls.code);
    if (!leased.ok) continue;
    const tail = state.aircraft[state.aircraft.length - 1].tail;
    const opened = fillPlane(state, tail, LATEST_LANDING_MINUTE);
    return [`${leased.message} Flying ${opened.length > 0 ? opened.join(', ') : 'nothing yet'}.`];
  }
  return [];
}
