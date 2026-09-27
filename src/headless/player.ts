import airportsData from '../../data/airports.json';
import { lastWeekMargin } from '../sim/pnlHistory';
import { marketAppeal } from '../sim/whereToFly';
import { AIRCRAFT_CLASSES, classByCode } from '../sim/aircraftClasses';
import { dayIndex } from '../sim/clock';
import { RECAPTURE_RATE } from '../sim/economy';
import { connectingPassengersThrough } from '../sim/hubs';
import {
  CODESHARE_FEED_FACTOR,
  DIRECT_BOOKING_YIELD,
  LOYALTY_RECAPTURE_RATE,
  runningCostOf,
  WINGLET_FUEL_FACTOR,
  type InnovationId,
} from '../sim/innovations';
import { greatCircleDistanceNm } from '../sim/geo';
import { cashNeededToLease } from '../sim/leasing';
import { overheadAddedByNextPlane, overheadSavedByOneFewer } from '../sim/overhead';
import * as actions from '../sim/playerActions';
import { forecastStance } from '../sim/fareForecast';
import { setFareStance } from '../sim/pricing';
import { applyRotation, planRotation, type RotationPlan, type RotationStop } from '../sim/rotations';
import { isAircraftTypeAllowedAt, legsServingMarket, marketKey, recommendedFare } from '../sim/schedule';
import type { FareStance, SimState } from '../sim/state';
import { TURN_BUFFER_CHOICES } from '../sim/turnBuffer';
import { networkAirports } from '../sim/reach';
import { spillingMarkets } from '../sim/unmetDemand';
import { aircraftUtilisation, utilisationPools } from '../sim/utilisation';
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
 * - **sitter** plays steady until it has SITTER_FLEET_SIZE planes, then
 *   only harvests: it keeps its schedule running (slack, cutting losers,
 *   stances, returning idle planes) but never leases, opens or adds a
 *   flight again. It is the player the game should punish slowly
 *   (WEEK-NINE.md, thread 1).
 * - **bold** plays steady's habits but grows fast: it leases once a
 *   class's pool is BOLD_LEASE_WHEN_POOL_SHARE booked, as soon as the
 *   airline makes money at all rather than once its margin covers the
 *   new lease, and keeps only BOLD_SAFETY_DAYS of
 *   cash on top of the lessor's reserve. It still cuts losers and sheds
 *   planes, so it measures how an ambitious but sane airline weathers a
 *   shock.
 * - **reckless** grows at any cost: it leases the biggest plane the lessor
 *   allows every day it can, fills every plane's day to the curfew
 *   wherever the riders are, and never cuts, buffers or looks at
 *   congestion, slot fees or rivals. The game should punish it quickly.
 */

export type PlayerKind = 'starter' | 'steady' | 'sitter' | 'bold' | 'reckless';
export const PLAYER_KINDS: PlayerKind[] = ['starter', 'steady', 'sitter', 'bold', 'reckless'];

export type Player = {
  kind: PlayerKind;
  /** The first morning, before any time passes: routes for the starting plane. */
  open(state: SimState): string[];
  /** Once a day, at rollover, after the day's numbers are final. Returns what it did, in words. */
  playDay(state: SimState): string[];
};

export function createPlayer(kind: PlayerKind): Player {
  if (kind === 'starter') return starterPlayer();
  if (kind === 'reckless') return recklessPlayer();
  return steadyPlayer(kind);
}

/**
 * The command line's `--player starter|steady|sitter|bold|reckless` (steady when left out),
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
 * Days in a row a plane's flying must earn less than it costs to keep
 * (its lease and the network overhead it adds, sim/overhead.ts) before it
 * is cleared and returned. Two weeks, so one bad week doesn't cost a plane.
 */
export const SHED_AFTER_DAYS = 14;
/**
 * Crews (sim/crews.ts) kept beyond what today's planes need at ideal
 * shifts, hired or on their way: one plane's full day, so a newly leased
 * plane flies at once rather than waiting out the hiring lead time.
 */
export const CREW_BUFFER = 2;
/** Days a base's crews must sit above need plus the buffer before the extra are let go. */
export const CREW_RELEASE_AFTER_DAYS = 30;

/** The bold player leases once a class's pool is this booked... */
export const BOLD_LEASE_WHEN_POOL_SHARE = 0.6;
/** ...keeping only this many days of the new lease in cash on top of the lessor's reserve. */
export const BOLD_SAFETY_DAYS = 7;
/**
 * The share of flights congestion delays (sim/delays.ts, the airport
 * view's load line) at which an airport is too busy to add flights to.
 * Past it, every new flight makes every other one there later.
 */
export const BUSY_DELAY_CHANCE = 0.1;
/**
 * The most a rotation's new slot fees (the route form's "New slots" line)
 * may be, as a share of what a full plane would take in fares on it. Past
 * this, a slot-controlled airport's fees eat what the flight could earn.
 */
export const SLOT_FEE_LIMIT_SHARE = 0.25;
/**
 * Days of cash left, at last week's average loss, below which the player
 * stops waiting for LOSING_DAYS_TO_CUT and cuts the worst market every
 * day: the game's own "Cash is running out" warning.
 */
export const EMERGENCY_RUNWAY_DAYS = 60;
/** Days between the player's looks at each contested market's fare stance. */
export const STANCE_REVIEW_DAYS = 7;
/** Stances in the order they win ties: Match first, since it's the neutral choice. */
const STANCE_PREFERENCE: FareStance[] = ['match', 'undercut', 'premium'];

/**
 * An innovation (sim/innovations.ts) is adopted when its one-off price
 * pays back from its estimated gain within this many days, or, for a
 * running cost, when the gain beats the cost by INNOVATION_RUNNING_MARGIN.
 */
export const INNOVATION_PAYBACK_DAYS = 90;
export const INNOVATION_RUNNING_MARGIN = 1.5;
/** Cash an adoption must leave behind, as days of the airline's leases, so it never starves the fleet. */
const INNOVATION_RESERVE_DAYS = 60;

/**
 * The steady player hedges fuel (sim/fuelPrice.ts) for the longest term
 * when the price is at least this far below usual, betting on the walk's
 * drift back up; never when it's above. The sitter never hedges.
 */
export const HEDGE_BELOW_PRICE = 0.95;

/**
 * The steady player hires an executive (sim/executives.ts) when last
 * week's average margin is at least this many times their salary, and the
 * signing fee leaves the same cash reserve as an innovation. It fills an
 * empty chair, or replaces the holder with a candidate who needs a higher
 * NPS, since those are the stronger hires.
 */
export const EXECUTIVE_MARGIN_TIMES_SALARY = 10;

/** Planes the sitter grows to before it stops growing. */
export const SITTER_FLEET_SIZE = 5;
/** How much of its day a plane can already fly before the reckless player stops looking for more to give it. */
const RECKLESS_FULL_SHARE = 0.9;

const airports = airportsData as RotationStop[];
const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// --- The players -----------------------------------------------------------

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

function recklessPlayer(): Player {
  return {
    kind: 'reckless',
    open: (state) => {
      for (const aircraft of state.aircraft) fillPlane(state, aircraft.tail, { latestLanding: Infinity });
      return [];
    },
    playDay: (state) => {
      const log: string[] = [];
      // The biggest plane the lessor will let it have, every day it can.
      for (const option of [...actions.planeOptions(state, state.homeAirport)].reverse()) {
        if (!option.listing || option.disabledReason) continue;
        const leased = actions.leasePlane(state, state.homeAirport, option.code);
        if (leased.ok) {
          log.push(leased.message);
          break;
        }
      }
      // Whatever crews its planes need, every day (sim/crews.ts).
      for (const iata of Object.keys(state.crewBases ?? {})) {
        const crew = actions.crewReadout(state, iata);
        const short = crew ? crew.ideal - crew.crews - crew.arriving : 0;
        if (short > 0) {
          const hired = actions.hireCrewsAt(state, iata, short);
          if (hired.ok) log.push(hired.message);
        }
      }
      // Every plane's day filled to the curfew, wherever the riders are.
      for (const aircraft of state.aircraft) {
        if (aircraftUtilisation(state, aircraft.tail).share >= RECKLESS_FULL_SHARE) continue;
        const opened = fillPlane(state, aircraft.tail, { latestLanding: Infinity });
        if (opened.length > 0) log.push(`${aircraft.tail} now flies ${opened.join(', ')}.`);
      }
      return log;
    },
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
  /** Day the player last weighed each contested market's fare stance, by market key. */
  stanceReviewed: Map<string, number>;
  /** Days in a row each plane's flying hasn't paid for keeping it, by tail. */
  shortDays: Map<string, number>;
  /** Days in a row each crew base has carried more crews than it needs, by IATA. */
  spareCrewDays: Map<string, number>;
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

function steadyPlayer(kind: 'steady' | 'sitter' | 'bold'): Player {
  // Set once the sitter reaches its size, and never cleared: from then on it only harvests.
  let harvesting = false;
  const memory: Memory = { lastTouched: new Map(), lastDropped: new Map(), idleDays: new Map(), openedOn: new Map(), tightUntil: new Map(), stanceReviewed: new Map(), shortDays: new Map(), spareCrewDays: new Map() };
  return {
    kind,
    open: (state) => {
      for (const aircraft of state.aircraft) {
        fillPlane(state, aircraft.tail, {
          latestLanding: LATEST_LANDING_MINUTE,
          checkSlotFees: true,
          onOpen: (key) => memory.openedOn.set(key, dayIndex(state)),
        });
      }
      return [];
    },
    playDay: (state) => {
      if (kind === 'sitter' && state.aircraft.length >= SITTER_FLEET_SIZE) harvesting = true;
      return [
        ...leaveSlack(state, memory),
        ...cutLosers(state, memory),
        ...(harvesting ? [] : [...feedSpill(state, memory), ...openMarkets(state, memory), ...leaseWhenFull(state, memory, kind === 'bold')]),
        ...shedWhenOverheadBites(state, memory),
        ...returnIdle(state, memory),
        ...keepCrews(state, memory),
        ...pickStances(state, memory),
        ...adoptInnovations(state),
        ...(kind === 'steady' ? hedgeWhenCheap(state) : []),
        ...(kind === 'steady' ? hireExecutives(state) : []),
      ];
    },
  };
}

// --- Reading a market -----------------------------------------------------------

/**
 * A market as the screen ranks it: the airport view's "Where to fly next"
 * order (sim/whereToFly.ts's marketAppeal()). Read in words alone, "Huge"
 * spans 3,000 to 14,000 riders, and in a dense region nearly every market
 * is "Huge, starved": the steady player then picked blind, and its median
 * year fell two- to four-fold. Roughly riders a day, so the thresholds
 * below keep their units.
 */
function marketScore(state: SimState, from: string, to: string): number {
  return marketAppeal(state, from, to);
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
  /** Skip rotations whose new slot fees aren't worth paying (slotsWorthPaying()). */
  checkSlotFees?: boolean;
};

/**
 * Keep adding out-and-back rotations from the plane's base until its day
 * is full, each time choosing the known airport whose market ranks best
 * (marketScore()) per flight already on it. Dividing by existing flights
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
      const demand = marketScore(state, home.iata, dest.iata);
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
      if (plan.error !== null || plan.arriveBackMinute > options.latestLanding) return false;
      return !options.checkSlotFees || slotsWorthPaying(plan, aircraft.typeCode);
    });
    if (!pick) break; // this plane's day is full, or nothing is in reach
    applyRotation(state, tail, planRotation([home], pick.dest, tail, state));
    setFareStance(state, home.iata, pick.dest.iata, 'match');
    options.onOpen?.(marketKey(home.iata, pick.dest.iata));
    opened.push(`${home.iata}–${pick.dest.iata}`);
  }
  return opened;
}

/**
 * Whether a planned rotation's new slot fees are worth paying: under
 * SLOT_FEE_LIMIT_SHARE of the fares a full plane would take on it, at the
 * recommended fare for each leg.
 */
function slotsWorthPaying(plan: RotationPlan, typeCode: string): boolean {
  const fees = plan.slotQuotes.reduce((sum, quote) => sum + quote.fees.reduce((total, fee) => total + fee, 0), 0);
  if (fees === 0) return true;
  const seats = classByCode(typeCode)?.seats ?? 0;
  const fullPlaneFares = plan.legs.reduce((sum, leg) => sum + seats * recommendedFare(leg.origin, leg.dest), 0);
  return fees <= SLOT_FEE_LIMIT_SHARE * fullPlaneFares;
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
 *
 * When the airline as a whole is losing fast enough to run out of cash
 * within EMERGENCY_RUNWAY_DAYS, it doesn't wait: every day it also drops
 * a flight from whichever market lost the most last week, the way the
 * game's "Cash is running out" warning tells a player to. Markets still in
 * their RAMP_UP_DAYS are spared while the cash would last that long:
 * they're expected to lose money at first.
 */
function cutLosers(state: SimState, memory: Memory): string[] {
  const log: string[] = [...cutInEmergency(state, memory)];
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

function cutInEmergency(state: SimState, memory: Memory): string[] {
  const lastWeek = state.marginHistory.slice(-7);
  if (lastWeek.length < 7) return [];
  const averageMargin = lastWeek.reduce((sum, margin) => sum + margin, 0) / 7;
  if (averageMargin >= 0 || state.cash / -averageMargin >= EMERGENCY_RUNWAY_DAYS) return [];

  // A new route loses money while its market builds (the route view says
  // so); a careful player rides that out while the cash lasts that long,
  // and cuts anything once it doesn't.
  const runway = state.cash / -averageMargin;
  let worst: { a: string; b: string; margin: number } | null = null;
  for (const [a, b] of scheduledMarkets(state)) {
    if (runway >= RAMP_UP_DAYS && daysFlown(state, memory, marketKey(a, b)) < RAMP_UP_DAYS) continue;
    const margin = lastWeekMargin(state, marketKey(a, b));
    if (margin !== null && margin < 0 && (!worst || margin < worst.margin)) worst = { a, b, margin };
  }
  if (!worst) return [];
  const dropped = dropOneFlight(state, memory, worst.a, worst.b);
  if (!dropped.ok) return [];
  return [`Cash runs out in about ${Math.round(runway)} days; ${worst.a}–${worst.b} lost $${Math.round(-worst.margin).toLocaleString()}/day last week: ${dropped.message}`];
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
    const margin = lastWeekMargin(state, key);
    if (margin === null || margin <= 0) continue;
    const preview = actions.previewAddFlight(state, a, b);
    if (!preview.ok || preview.plan.arriveBackMinute > LATEST_LANDING_MINUTE) continue;
    if (!slotsWorthPaying(preview.plan, state.aircraft.find((a) => a.tail === preview.tail)!.typeCode)) continue;
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
      checkSlotFees: true,
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
/**
 * Shed a plane when overhead bites. Network overhead grows with the square
 * of the fleet (sim/overhead.ts), so a plane that paid its way at five
 * planes may not at fifteen. Each plane's flying is valued as its share
 * of last week's margin on every market it flies (a market's margin per
 * flight, times its flights there); a plane whose share has been below
 * its lease plus the overhead one fewer plane would save for
 * SHED_AFTER_DAYS days in a row has its flights removed and goes back to
 * the lessor. Newest first, one a day, never the last plane, and only
 * once its markets have been flown past RAMP_UP_DAYS.
 */
function shedWhenOverheadBites(state: SimState, memory: Memory): string[] {
  if (state.aircraft.length <= 1) return [];
  const saved = overheadSavedByOneFewer(state);
  const legsByMarket = new Map<string, number>();
  for (const leg of state.schedule) legsByMarket.set(marketKey(leg.origin, leg.dest), (legsByMarket.get(marketKey(leg.origin, leg.dest)) ?? 0) + 1);
  let toShed: string | null = null;
  for (const aircraft of [...state.aircraft].reverse()) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    const keys = [...new Set(legs.map((leg) => marketKey(leg.origin, leg.dest)))];
    const ready = legs.length > 0 && keys.every((key) => daysFlown(state, memory, key) >= RAMP_UP_DAYS && lastWeekMargin(state, key) !== null);
    if (!ready) {
      memory.shortDays.delete(aircraft.tail);
      continue;
    }
    const earns = legs.reduce((sum, leg) => {
      const key = marketKey(leg.origin, leg.dest);
      return sum + (lastWeekMargin(state, key) ?? 0) / (legsByMarket.get(key) ?? 1);
    }, 0);
    const short = earns < aircraft.leaseCostPerDay + saved ? (memory.shortDays.get(aircraft.tail) ?? 0) + 1 : 0;
    memory.shortDays.set(aircraft.tail, short);
    if (short >= SHED_AFTER_DAYS && toShed === null) toShed = aircraft.tail;
  }
  if (toShed === null) return [];
  const shedTail = toShed;
  const itsMarkets = new Set(state.schedule.filter((leg) => leg.tail === shedTail).map((leg) => marketKey(leg.origin, leg.dest)));
  const cleared = actions.clearPlane(state, toShed);
  if (!cleared.ok) return [];
  // Its markets changed today; let the change show before judging them again.
  for (const key of itsMarkets) memory.lastTouched.set(key, dayIndex(state));
  memory.shortDays.delete(toShed);
  const returned = actions.returnPlane(state, toShed);
  return [`${toShed} hasn't paid its lease and overhead for ${SHED_AFTER_DAYS} days: ${cleared.message}${returned.ok ? ` ${returned.message}` : ''}`];
}

function returnIdle(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const aircraft of [...state.aircraft]) {
    // Never the last plane: an airline with none can't start again.
    if (state.aircraft.length <= 1) break;
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
 * Habit 8, pick a stance. Every STANCE_REVIEW_DAYS, on each market a rival
 * also flies, it reads the route view's forecast (sim/fareForecast.ts)
 * for all three stances and takes the one that makes the most a day once
 * fares and the rivals' capacity have settled. Ties go to Match. It
 * doesn't try to win a price war for its own sake: a rival leaving shows
 * up only as what the market makes.
 */
function pickStances(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  const contested = new Set(state.competitorRoutes.map((route) => marketKey(route.origin, route.dest)));
  for (const [a, b] of scheduledMarkets(state)) {
    const key = marketKey(a, b);
    if (!contested.has(key) || !state.routeSettings[key]) continue;
    if (dayIndex(state) - (memory.stanceReviewed.get(key) ?? -Infinity) < STANCE_REVIEW_DAYS) continue;
    memory.stanceReviewed.set(key, dayIndex(state));

    const forecasts = STANCE_PREFERENCE.map((stance) => forecastStance(state, a, b, stance));
    const best = forecasts.reduce((top, forecast) => (forecast.margin > top.margin ? forecast : top));
    const current = state.routeSettings[key].fareStance ?? null;
    if (best.stance === current) continue;
    setFareStance(state, a, b, best.stance);
    log.push(`${a}–${b} is contested: ${best.stance} (forecast $${Math.round(best.margin).toLocaleString()}/day at $${best.fare}).`);
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
    const score = marketScore(state, home, dest.iata) / (1 + legsServingMarket(home, dest.iata, state.schedule));
    if (!best || score > best.score) best = { dest: dest.iata, score };
  }
  return best;
}

/**
 * Habit 5, lease when full. Once a class's pool at home is
 * LEASE_WHEN_POOL_SHARE booked, and home has CREW_BUFFER spare crews to
 * fly another plane, lease one more: the largest class
 * on offer whose best market has the riders to fill a round trip, whose
 * lease last week's average daily margin could pay on its own, with cash
 * to cover the lessor's reserve plus LEASE_SAFETY_DAYS more. Not while
 * home is too busy. Then give it a day at once, since an idle
 * plane is only cost. One lease a day at most.
 */
function leaseWhenFull(state: SimState, memory: Memory, bold: boolean): string[] {
  const home = state.homeAirport;
  if (tooBusy(state, home)) return [];
  const pools = utilisationPools(state, home).filter((pool) => pool.planes > 0);
  if (!pools.some((pool) => pool.share >= (bold ? BOLD_LEASE_WHEN_POOL_SHARE : LEASE_WHEN_POOL_SHARE))) return [];
  const lastWeek = state.marginHistory.slice(-7);
  if (lastWeek.length < 7) return [];
  const averageMargin = lastWeek.reduce((sum, margin) => sum + margin, 0) / 7;
  // Only with crews to fly it (sim/crews.ts): a plane leased without them
  // sits grounded until hires arrive, and every flight it misses cancels.
  const crew = actions.crewReadout(state, home);
  if (!crew || crew.crews - crew.ideal < CREW_BUFFER) return [];

  const options = actions.planeOptions(state, home);
  for (const cls of [...AIRCRAFT_CLASSES].reverse()) {
    const option = options.find((o) => o.code === cls.code);
    if (!option?.listing || option.disabledReason) continue;
    const price = option.listing.leasePricePerDay;
    // What the airline already makes a day has to carry the new lease, and
    // the network overhead it adds (sim/overhead.ts), on its own.
    // The bold player only waits for the airline to make money at all.
    if (averageMargin < (bold ? 0 : price + overheadAddedByNextPlane(state))) continue;
    if (state.cash < cashNeededToLease(price) + (bold ? BOLD_SAFETY_DAYS : LEASE_SAFETY_DAYS) * price) continue;
    const market = bestMarketFor(state, home, cls.code, memory);
    if (!market || market.score < worthFlying(cls.code)) continue;

    const leased = actions.leasePlane(state, home, cls.code);
    if (!leased.ok) continue;
    const tail = state.aircraft[state.aircraft.length - 1].tail;
    const opened = fillPlane(state, tail, {
      latestLanding: LATEST_LANDING_MINUTE,
      avoid: (key) => coolingDown(state, memory, key),
      checkSlotFees: true,
      onOpen: (key) => memory.openedOn.set(key, dayIndex(state)),
    });
    return [`${leased.message} Flying ${opened.length > 0 ? opened.join(', ') : 'nothing yet'}.`];
  }
  return [];
}

// --- Innovations ---------------------------------------------------------------

/**
 * What an innovation would gain the airline a day, roughly, from the day
 * just flown: the share of revenue, fuel or connecting fares it changes.
 * A player's rule of thumb, not the sim's own sum, and deliberately
 * cautious: younger airframes and the loyalty scheme's rival deterrence
 * gain in ways a day's books don't show, so they're valued by what is
 * countable only.
 */
function innovationGainPerDay(state: SimState, id: InnovationId): number {
  const lastWeek = state.revenueHistory.slice(-7);
  const revenue = lastWeek.length > 0 ? lastWeek.reduce((sum, r) => sum + r, 0) / lastWeek.length : 0;
  if (id === 'online-booking') return revenue * (DIRECT_BOOKING_YIELD - 1);
  if (id === 'winglets') return state.todayCostByCategory.fuel * (1 - WINGLET_FUEL_FACTOR);
  // Recapture only helps flights that turn people away: a tenth of revenue is a fair guess at how much that is.
  if (id === 'loyalty-scheme') return revenue * 0.1 * (LOYALTY_RECAPTURE_RATE - RECAPTURE_RATE);
  if (id === 'codeshare-feed') {
    let connecting = 0;
    for (const hub of networkAirports(state)) connecting = Math.max(connecting, connectingPassengersThrough(state, hub));
    // Each connecting passenger rides two legs, at about the going fare on each.
    const markets = scheduledMarkets(state);
    const averageFare = markets.length > 0 ? markets.reduce((sum, [a, b]) => sum + recommendedFare(a, b), 0) / markets.length : 0;
    return connecting * (CODESHARE_FEED_FACTOR - 1) * 2 * averageFare;
  }
  // Younger airframes: worth it once the airline leases often, so valued
  // as a tenth of the fleet's daily lease bill.
  return state.aircraft.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0) * 0.1;
}

/** Adopt whichever open innovations pay for themselves soon enough and leave cash to spare. */
function adoptInnovations(state: SimState): string[] {
  const done: string[] = [];
  const leases = state.aircraft.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0);
  for (const option of actions.innovationOptions(state)) {
    if (option.adopted || option.blocked) continue;
    if (state.cash < option.oneOffPrice + INNOVATION_RESERVE_DAYS * leases) continue;
    const gain = innovationGainPerDay(state, option.id);
    const runningCost = runningCostOf(option.id, state.revenueHistory.slice(-1)[0] ?? 0);
    if (runningCost > 0 ? gain < runningCost * INNOVATION_RUNNING_MARGIN : option.oneOffPrice > gain * INNOVATION_PAYBACK_DAYS) continue;
    const adopted = actions.adoptInnovation(state, option.id);
    if (adopted.ok) done.push(adopted.message);
  }
  return done;
}

// --- Fuel ----------------------------------------------------------------------------

/** Buy the longest hedge when fuel is cheap and no hedge runs, leaving the same cash reserve as innovations. */
function hedgeWhenCheap(state: SimState): string[] {
  if (state.fuelPriceIndex > HEDGE_BELOW_PRICE) return [];
  const quote = actions.hedgeOptions(state).at(-1);
  if (!quote || quote.blocked) return [];
  const leases = state.aircraft.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0);
  if (state.cash < quote.premium + INNOVATION_RESERVE_DAYS * leases) return [];
  const hedged = actions.hedgeFuel(state, quote.days);
  return hedged.ok ? [hedged.message] : [];
}

// --- Executives --------------------------------------------------------------------

/** Fill or upgrade each chair with the strongest candidate the airline can get and afford. */
function hireExecutives(state: SimState): string[] {
  const lastWeek = state.marginHistory.slice(-7);
  if (lastWeek.length < 7) return [];
  const averageMargin = lastWeek.reduce((sum, margin) => sum + margin, 0) / 7;
  const leases = state.aircraft.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0);
  const done: string[] = [];
  for (const chair of actions.executiveOptions(state)) {
    const holderRank = chair.holder ? (chair.holder.npsNeeded ?? 0) : -1;
    const best = chair.candidates
      .filter((candidate) => !candidate.blocked && (candidate.npsNeeded ?? 0) > holderRank)
      .filter((candidate) => averageMargin >= EXECUTIVE_MARGIN_TIMES_SALARY * candidate.salaryPerDay)
      .filter((candidate) => state.cash >= candidate.signingFee + INNOVATION_RESERVE_DAYS * leases)
      .sort((a, b) => (b.npsNeeded ?? 0) - (a.npsNeeded ?? 0))[0];
    if (!best) continue;
    const hired = actions.appointExecutiveById(state, best.id);
    if (hired.ok) done.push(hired.message);
  }
  return done;
}

// --- Crews ----------------------------------------------------------------------------

/**
 * Keep each crew base's crews at what its planes need at ideal shifts
 * plus CREW_BUFFER (twice that when a plane pool there is nearly full at
 * a profitable airline, since the next lease is near), counting crews
 * already on their way: hire the difference, and let go of crews above
 * that once they've sat spare for CREW_RELEASE_AFTER_DAYS days.
 */
function keepCrews(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  const lastWeek = state.marginHistory.slice(-7);
  const profitable = lastWeek.length === 7 && lastWeek.reduce((sum, margin) => sum + margin, 0) > 0;
  for (const iata of Object.keys(state.crewBases ?? {})) {
    const crew = actions.crewReadout(state, iata);
    if (!crew) continue;
    // Growth coming: a pool nearly full at a profitable airline means the
    // next lease is near, so a second plane's crews are hired ahead.
    const growing = profitable && utilisationPools(state, iata).some((pool) => pool.planes > 0 && pool.share >= LEASE_WHEN_POOL_SHARE);
    const target = crew.ideal + CREW_BUFFER * (growing ? 2 : 1);
    const have = crew.crews + crew.arriving;
    if (have < target) {
      memory.spareCrewDays.delete(iata);
      const hired = actions.hireCrewsAt(state, iata, target - have);
      if (hired.ok) log.push(hired.message);
      continue;
    }
    const spare = crew.crews - target;
    // Never while growing: those crews are about to be needed.
    if (spare <= 0 || crew.arriving > 0 || growing) {
      memory.spareCrewDays.delete(iata);
      continue;
    }
    const days = (memory.spareCrewDays.get(iata) ?? 0) + 1;
    memory.spareCrewDays.set(iata, days);
    if (days < CREW_RELEASE_AFTER_DAYS) continue;
    memory.spareCrewDays.delete(iata);
    const released = actions.releaseCrewsAt(state, iata, spare);
    if (released.ok) log.push(released.message);
  }
  return log;
}
