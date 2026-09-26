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
import { spillingMarkets } from '../sim/unmetDemand';
import { utilisationPools } from '../sim/utilisation';
import { airportLoad } from '../sim/airports';
import { congestionParameters } from '../sim/delays';

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
/** Days after dropping a flight from a market before the player adds one back, so cutting and adding don't take turns. */
export const REOPEN_COOLDOWN_DAYS = 30;
/** Days a plane flies nothing before it goes back to the lessor. */
export const IDLE_DAYS_TO_RETURN = 7;
/**
 * The share of flights congestion delays (sim/delays.ts, the airport
 * view's load line) at which an airport is too busy to add flights to.
 * Past it, every new flight makes every other one there later.
 */
export const BUSY_DELAY_CHANCE = 0.1;

const airports = airportsData as RotationStop[];
const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// --- The two players -----------------------------------------------------

function starterPlayer(): Player {
  return {
    kind: 'starter',
    open: (state) => {
      for (const aircraft of state.aircraft) fillPlane(state, aircraft.tail, { latestLanding: Infinity });
      return [];
    },
    playDay: () => [],
  };
}

/**
 * What the steady player remembers between days. A person would too: which
 * markets they just changed, which they just gave up on, and which planes
 * have been sitting idle. Kept by the player, not in `SimState`, since the
 * game itself doesn't know about any of it.
 */
export type Memory = {
  /** Day the player last changed each market, by market key: judged again only once the change has had time to show. */
  lastTouched: Map<string, number>;
  /** Day the player last dropped a flight from each market: it adds none back until the cooldown is over. */
  lastDropped: Map<string, number>;
  /** Days in a row each plane has had nothing to fly, by tail. */
  idleDays: Map<string, number>;
  /**
   * Day each market was last opened, by market key. It is judged only on
   * the days since: a market reopened after a cut starts with a clean
   * slate, not the last stint's cancellations and losses.
   */
  openedOn: Map<string, number>;
  /** Day until which each plane gets no new flights, by tail: its day just proved too tight to fly. */
  tightUntil: Map<string, number>;
};

/** Days since this market was last opened: its record before that belongs to an earlier stint. */
function daysFlown(state: SimState, memory: Memory, key: string): number {
  return dayIndex(state) - (memory.openedOn.get(key) ?? 0);
}

/** The airport at the other end of a market from `iata`. */
function otherEnd(key: string, iata: string): string {
  const [a, b] = key.split('-');
  return a === iata ? b : a;
}

/** Whether congestion at this airport already delays enough flights that adding more would make it worse. */
function tooBusy(state: SimState, iata: string): boolean {
  return congestionParameters(airportLoad(state, iata)).delayChance >= BUSY_DELAY_CHANCE;
}

function settled(state: SimState, memory: Memory, key: string): boolean {
  return dayIndex(state) - (memory.lastTouched.get(key) ?? -Infinity) >= SETTLE_DAYS;
}

function coolingDown(state: SimState, memory: Memory, key: string): boolean {
  return dayIndex(state) - (memory.lastDropped.get(key) ?? -Infinity) < REOPEN_COOLDOWN_DAYS;
}

function steadyPlayer(): Player {
  const memory: Memory = { lastTouched: new Map(), lastDropped: new Map(), idleDays: new Map(), openedOn: new Map(), tightUntil: new Map() };
  return {
    kind: 'steady',
    open: (state) => {
      for (const aircraft of state.aircraft) {
        fillPlane(state, aircraft.tail, { latestLanding: LATEST_LANDING_MINUTE, onOpen: (key) => memory.openedOn.set(key, dayIndex(state)) });
      }
      return [];
    },
    playDay: (state) => [
      ...leaveSlack(state, memory),
      ...cutLosers(state, memory),
      ...feedSpill(state, memory),
      ...openMarkets(state, memory),
      ...leaseWhenFull(state, memory),
      ...returnIdle(state, memory),
    ],
  };
}

// --- Filling a plane's day ------------------------------------------------

type FillOptions = {
  /** No rotation landing back at base after this (home-local minutes). */
  latestLanding: number;
  /** Only markets nobody on the player's schedule flies yet. */
  unservedOnly?: boolean;
  /** Markets it must leave alone, by market key. */
  avoid?: (key: string) => boolean;
  /** Ignore markets scoring below this: too few riders to be worth a plane's time. */
  minScore?: number;
  /** Told about each market a rotation is added to, by market key. */
  onOpen?: (key: string) => void;
};

/**
 * Keep adding out-and-back rotations from the plane's base until its day
 * is full, each time choosing the known airport with the most potential
 * demand per flight already on that market. Dividing by existing flights
 * spreads planes over several markets instead of stacking every rotation
 * on the single biggest one. Every market opened is priced on the Match
 * stance (sim/pricing.ts), the neutral choice.
 *
 * Candidates are tried best first, so the planner only runs until one
 * fits. Ties keep the data file's order, so the pick never depends on
 * anything but the state.
 */
function fillPlane(state: SimState, tail: string, options: FillOptions): string[] {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const home = airportByIata.get(aircraft.baseAirport ?? state.homeAirport)!;
  const opened: string[] = [];
  // A safety cap: every rotation uses up part of the day, so the loop ends on its own long before this.
  const MAX_ROTATIONS_PER_PLANE = 20;

  for (let added = 0; added < MAX_ROTATIONS_PER_PLANE; added++) {
    const candidates: { dest: RotationStop; score: number }[] = [];
    for (const dest of airports) {
      if (dest.iata === home.iata || !state.knownAirports.includes(dest.iata)) continue;
      const demand = potentialDailyDemand(home.iata, dest.iata);
      if (demand <= 0) continue;
      if (options.avoid?.(marketKey(home.iata, dest.iata))) continue;
      const flights = legsServingMarket(home.iata, dest.iata, state.schedule);
      if (options.unservedOnly && flights > 0) continue;
      const score = demand / (1 + flights);
      if (score < (options.minScore ?? 0)) continue;
      candidates.push({ dest, score });
    }
    candidates.sort((x, y) => y.score - x.score);

    const pick = candidates.find(({ dest }) => {
      const plan = planRotation([home], dest, tail, state);
      return plan.error === null && plan.arriveBackMinute <= options.latestLanding;
    });
    if (!pick) break; // this plane's day is full, or nothing is in reach
    applyRotation(state, tail, planRotation([home], pick.dest, tail, state));
    setFareStance(state, home.iata, pick.dest.iata, 'match');
    options.onOpen?.(marketKey(home.iata, pick.dest.iata));
    opened.push(`${home.iata}–${pick.dest.iata}`);
  }
  return opened;
}

/** Riders a day a market needs, per flight already on it, to be worth a plane of this class: a full plane each way. */
function worthFlying(typeCode: string): number {
  return 2 * (classByCode(typeCode)?.seats ?? 0);
}

// --- Habits ----------------------------------------------------------------

/** Every market on the schedule, as [a, b] with a < b. */
function scheduledMarkets(state: SimState): [string, string][] {
  const keys = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  return [...keys].sort().map((key) => key.split('-') as [string, string]);
}

/**
 * Take one flight off a market, or the whole route if it's the last one,
 * and remember when. With `tight`, the planes that flew it get no new
 * flights for a while: their day couldn't fit what it had.
 */
function dropOneFlight(state: SimState, memory: Memory, a: string, b: string, tight = false): actions.Outcome<{ message: string }> {
  const one = actions.previewRemoveFlight(state, a, b);
  const tails = one.ok ? [one.rotation.tail] : actions.rotationsServing(state, a, b).map((rotation) => rotation.tail);
  const outcome = one.ok ? actions.removeFlight(state, a, b) : actions.removeRoute(state, a, b);
  if (outcome.ok) {
    memory.lastTouched.set(marketKey(a, b), dayIndex(state));
    memory.lastDropped.set(marketKey(a, b), dayIndex(state));
    if (tight) for (const tail of tails) memory.tightUntil.set(tail, dayIndex(state) + REOPEN_COOLDOWN_DAYS);
  }
  return outcome;
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
function leaveSlack(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!settled(state, memory, key)) continue;
    const window = Math.min(7, daysFlown(state, memory, key));
    const cancelled = window > 0 ? (state.onTimeHistoryByMarket[key]?.cancelled.slice(-window) ?? []) : [];
    const cancellingDays = cancelled.filter((count) => count > 0).length;
    if (cancellingDays < CANCELLING_DAYS_TO_BUFFER) continue;

    if (cancellingDays < CANCELLING_DAYS_TO_DROP) {
      const next = TURN_BUFFER_CHOICES.find((minutes) => minutes > actions.currentTurnBuffer(state, a, b));
      const buffer = next === undefined ? null : actions.setTurnBuffer(state, a, b, next);
      if (buffer?.ok) {
        memory.lastTouched.set(key, dayIndex(state));
        log.push(`${a}–${b} had cancellations on ${cancellingDays} of the last 7 days: turn buffer to +${next} min.`);
        continue;
      }
    }
    const dropped = dropOneFlight(state, memory, a, b, true);
    if (dropped.ok) {
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
function cutLosers(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!settled(state, memory, key)) continue;
    const revenue = state.revenueHistoryByMarket[key] ?? [];
    const cost = state.costHistoryByMarket[key] ?? [];
    if (daysFlown(state, memory, key) < RAMP_UP_DAYS || revenue.length < LOSING_DAYS_TO_CUT) continue;
    const recent = revenue.slice(-LOSING_DAYS_TO_CUT).map((r, i) => r - cost[cost.length - LOSING_DAYS_TO_CUT + i]);
    if (recent.some((margin) => margin > 0)) continue;
    const dropped = dropOneFlight(state, memory, a, b);
    if (dropped.ok) {
      log.push(`${a}–${b} made no money for ${LOSING_DAYS_TO_CUT} days: ${dropped.message}`);
    }
  }
  return log;
}

/**
 * Habit 3, feed spill. A market that turns passengers away (the map's
 * "turned away": today's demand is more than the seats on it) and made
 * money over the last week gets one more flight, on a plane of the same
 * class based there, if one has room before the 21:00 cutoff. Not on a
 * market it dropped a flight from recently.
 */
function feedSpill(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  const spilling = spillingMarkets(state);
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!spilling.has(key) || !settled(state, memory, key) || coolingDown(state, memory, key)) continue;
    if (daysFlown(state, memory, key) < 7 || tooBusy(state, a) || tooBusy(state, b)) continue;
    const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-7);
    const cost = (state.costHistoryByMarket[key] ?? []).slice(-7);
    if (revenue.length < 7 || revenue.reduce((sum, r, i) => sum + r - cost[i], 0) <= 0) continue;
    const preview = actions.previewAddFlight(state, a, b);
    if (!preview.ok || preview.plan.arriveBackMinute > LATEST_LANDING_MINUTE) continue;
    const added = actions.addFlight(state, a, b);
    if (added.ok) {
      memory.lastTouched.set(key, dayIndex(state));
      log.push(`${a}–${b} is turning passengers away: ${added.message}`);
    }
  }
  return log;
}

/**
 * Habit 4, open markets. Every plane with time left in its day flies the
 * best market from its base that nobody on the schedule flies yet, if it
 * has riders enough for the plane (a full plane each way) and isn't one
 * the player gave up on recently. Not from or to an airport that's
 * already too busy, and not on a plane whose day just proved too tight.
 */
function openMarkets(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport || tooBusy(state, aircraft.baseAirport)) continue;
    // A tight plane is left alone, unless it has nothing left to fly: then its day has room again.
    const tight = (memory.tightUntil.get(aircraft.tail) ?? -Infinity) > dayIndex(state);
    if (tight && state.schedule.some((leg) => leg.tail === aircraft.tail)) continue;
    const opened = fillPlane(state, aircraft.tail, {
      latestLanding: LATEST_LANDING_MINUTE,
      unservedOnly: true,
      avoid: (key) => coolingDown(state, memory, key) || tooBusy(state, otherEnd(key, aircraft.baseAirport!)),
      minScore: worthFlying(aircraft.typeCode),
      onOpen: (key) => memory.openedOn.set(key, dayIndex(state)),
    });
    if (opened.length > 0) log.push(`${aircraft.tail} had time to spare: opened ${opened.join(', ')}.`);
  }
  return log;
}

/**
 * Habit 6, return idle planes. A plane that has had nothing to fly for
 * IDLE_DAYS_TO_RETURN days in a row goes back to the lessor, if the fee
 * can be paid: an idle plane is only its lease.
 */
function returnIdle(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const aircraft of [...state.aircraft]) {
    const flies = state.schedule.some((leg) => leg.tail === aircraft.tail);
    const idle = flies ? 0 : (memory.idleDays.get(aircraft.tail) ?? 0) + 1;
    memory.idleDays.set(aircraft.tail, idle);
    if (idle < IDLE_DAYS_TO_RETURN) continue;
    const returned = actions.returnPlane(state, aircraft.tail);
    if (returned.ok) {
      memory.idleDays.delete(aircraft.tail);
      log.push(`${aircraft.tail} flew nothing for ${idle} days: ${returned.message}`);
    }
  }
  return log;
}

/**
 * The best market from `home` for a plane of this class: in its range,
 * at an airport that takes it, not cooling down after a cut, scored the
 * way fillPlane() scores. Null when there's nothing.
 */
function bestMarketFor(state: SimState, home: string, typeCode: string, memory: Memory): { dest: string; score: number } | null {
  const spec = classByCode(typeCode)!;
  const from = airportByIata.get(home)!;
  let best: { dest: string; score: number } | null = null;
  for (const dest of airports) {
    if (dest.iata === home || !state.knownAirports.includes(dest.iata)) continue;
    if (!isAircraftTypeAllowedAt(dest.iata, typeCode)) continue;
    if (greatCircleDistanceNm(from, dest) > spec.rangeNm) continue;
    if (coolingDown(state, memory, marketKey(home, dest.iata))) continue;
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
function leaseWhenFull(state: SimState, memory: Memory): string[] {
  const home = state.homeAirport;
  if (tooBusy(state, home)) return [];
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
    const market = bestMarketFor(state, home, cls.code, memory);
    if (!market || market.score < worthFlying(cls.code)) continue;

    const leased = actions.leasePlane(state, home, cls.code);
    if (!leased.ok) continue;
    const tail = state.aircraft[state.aircraft.length - 1].tail;
    const opened = fillPlane(state, tail, {
      latestLanding: LATEST_LANDING_MINUTE,
      avoid: (key) => coolingDown(state, memory, key),
      onOpen: (key) => memory.openedOn.set(key, dayIndex(state)),
    });
    return [`${leased.message} Flying ${opened.length > 0 ? opened.join(', ') : 'nothing yet'}.`];
  }
  return [];
}
