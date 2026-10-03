import { currentPotentialDemand } from '../sim/marketDemand';
import { marketLoadFactor } from '../sim/loadFactor';
import { saleBlockedReason, saleMarginChangePerDay } from '../sim/seatSale';
import { crewsForRisk } from '../sim/crews';
import { dayOfYear, marketSeasonOn } from '../sim/seasons';
import { SEASONAL_PREMIUM } from '../sim/seasonalLease';
import { contractOn, contractsOf, performanceFactor } from '../sim/contracts';
import airportsData from '../../data/airports.json';
import { inboundAt } from '../sim/fleetTiming';
import { styleAdvice } from '../sim/hubPlanner';
import { DEFAULT_FARE_CLASSES } from '../sim/fareClasses';
import { airportHours, averageHourLoad } from '../sim/hours';
import { lastWeekMargin } from '../sim/pnlHistory';
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
import { setFareClasses, setFareStance } from '../sim/pricing';
import { applyRotation, planRotation, type RotationPlan, type RotationStop } from '../sim/rotations';
import { isAircraftTypeAllowedAt, legsServingMarket, marketKey, recommendedFare } from '../sim/schedule';
import type { FareStance, SimState } from '../sim/state';
import { TURN_BUFFER_CHOICES } from '../sim/turnBuffer';
import { networkAirports } from '../sim/reach';
import { spillingMarkets } from '../sim/unmetDemand';
import { aircraftUtilisation, rotationsForTail, USABLE_DAY_END_MINUTE, utilisationPools } from '../sim/utilisation';
import { nightStopCostPerNight, nightStopStation } from '../sim/nightStops';
import { summarizeMarket } from '../sim/marketSummary';
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
 * Crews (sim/crews.ts) a plane on its way is expected to need: one full
 * day at ideal shifts. Hired the day it's leased, so they join about when
 * it's delivered (sim/fleetTiming.ts).
 */
export const CREWS_PER_NEW_PLANE = 2;
/** Days a base's crews must sit above need before the extra are let go. */
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
      // Whatever crews each class of its planes needs, those on their way
      // included, every day (sim/crews.ts, sim/fleetTiming.ts).
      for (const iata of Object.keys(state.crewBases ?? {})) {
        for (const crew of actions.crewReadout(state, iata)?.classes ?? []) {
          const short = crew.ideal + CREWS_PER_NEW_PLANE * inboundAt(state, iata, crew.classCode).length - crew.crews - crew.arriving;
          if (short <= 0) continue;
          const hired = actions.hireCrewsAt(state, iata, crew.classCode, short);
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
  /** Days in a row each base has carried more crews of a class than it needs, by "IATA:CLASS". */
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

/**
 * Whether congestion at this airport already delays enough flights that
 * adding more would make it worse. Judged at its average hour, not its
 * peak: the route planner puts a new flight in an hour with room
 * (sim/hours.ts), so a full morning peak alone doesn't make it too busy.
 */
function tooBusy(state: SimState, iata: string): boolean {
  return congestionParameters(averageHourLoad(airportHours(state, iata))).delayChance >= BUSY_DELAY_CHANCE;
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
      // Contracts first, before the day is filled with anything else.
      takeContracts(state, memory);
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
        ...fillDelivered(state, memory),
        ...takeContracts(state, memory),
        ...keepContractsOnTime(state, memory),
        ...(harvesting ? [] : [...feedSpill(state, memory), ...openMarkets(state, memory), ...leaseWhenFull(state, memory, kind === 'bold')]),
        ...shedWhenOverheadBites(state, memory),
        ...returnIdle(state, memory),
        ...keepCrews(state, memory),
        ...pickStances(state, memory),
        ...runHomeHub(state),
        ...tuneFareClasses(state),
        ...refitCabins(state),
        ...takeNightStops(state),
        ...runSeatSales(state),
        ...adoptInnovations(state),
        ...(kind === 'steady' ? hedgeWhenCheap(state) : []),
        ...(kind === 'steady' ? hireExecutives(state) : []),
      ];
    },
  };
}

// --- Night stops --------------------------------------------------------

/** How often the player looks for a night stop, in days, and on which day of the cycle. */
const NIGHT_STOP_REVIEW_DAYS = 7;
const NIGHT_STOP_REVIEW_DAY = 4;
/** A night stop has to beat its nightly cost and its risk by this much a day. */
const NIGHT_STOP_WORTH_PER_DAY = 500;
/** The player's guess at how often a night stop's flight out breaks (cancelled, or held by the curfew). */
const NIGHT_STOP_BREAK_CHANCE = 0.05;

/** Every flown market's margin a day, summed (sim/marketSummary.ts): a morning flight into base feeds connections on other routes. */
function networkMargin(state: SimState): number {
  let total = 0;
  for (const key of new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))) {
    const settings = state.routeSettings[key];
    if (!settings) continue;
    const [a, b] = key.split('-');
    total += summarizeMarket(a, b, state, settings).margin;
  }
  return total;
}

/**
 * Once a week, the one night stop worth the most: an out-and-back from
 * base dragged past the end of the day (sim/nightStops.ts, through the
 * same retime the Gantt uses), taken when the network's margin with it,
 * less the night's hotel and check and the chance of it breaking (a lost
 * morning flight), beats today's by NIGHT_STOP_WORTH_PER_DAY. Never one
 * that would leave the base short of crews. The forecast is the player's,
 * not the page's.
 */
function takeNightStops(state: SimState): string[] {
  if (dayIndex(state) % NIGHT_STOP_REVIEW_DAYS !== NIGHT_STOP_REVIEW_DAY) return [];
  const now = networkMargin(state);
  let best: { tail: string; legIds: string[]; worth: number } | null = null;
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport || nightStopStation(state, aircraft.tail) || aircraft.returningOnDay !== undefined || aircraft.rebase) continue;
    for (const rotation of rotationsForTail(state, aircraft.tail)) {
      if (rotation.legs.length !== 2 || !rotation.closed || rotation.legs[0].origin !== aircraft.baseAirport) continue;
      const legIds = rotation.legs.map((leg) => leg.legId);
      const plan = actions.planRetimeRotation(state, legIds, aircraft.tail, USABLE_DAY_END_MINUTE);
      if (!plan.ok || plan.kind !== 'wrap' || !plan.station || plan.crewWarning) continue;
      const byId = new Map(plan.legs.map((leg) => [leg.legId, leg]));
      const after = { ...state, schedule: state.schedule.map((leg) => byId.get(leg.legId) ?? leg) };
      const [a, b] = [rotation.legs[0].origin, rotation.legs[0].dest];
      const settings = state.routeSettings[marketKey(a, b)];
      if (!settings) continue;
      const market = summarizeMarket(a, b, state, settings);
      const risk = NIGHT_STOP_BREAK_CHANCE * (market.freq > 0 ? market.revenue / market.freq : 0);
      const worth = networkMargin(after) - now - nightStopCostPerNight(state, aircraft, plan.station) - risk;
      if (worth >= NIGHT_STOP_WORTH_PER_DAY && (!best || worth > best.worth)) best = { tail: aircraft.tail, legIds, worth };
    }
  }
  if (!best) return [];
  const result = actions.retimeRotation(state, best.legIds, best.tail, USABLE_DAY_END_MINUTE);
  return result.ok ? [result.message] : [];
}

// --- Fare classes --------------------------------------------------------

/** How often the player looks at each route's seat split, in days. */
const FARE_CLASS_REVIEW_DAYS = 7;
/** How far one look moves Saver's share. */
const FARE_CLASS_STEP = 0.05;
const MIN_SAVER_SHARE = 0.1;
const MAX_SAVER_SHARE = 0.5;

/**
 * Once a week, each route's Saver seats (sim/fareClasses.ts) from what
 * sold yesterday: fewer where Saver sold out on most flights and business
 * travellers were turned away (they'd have paid more), more where planes
 * flew with seats to spare and Saver never sold out (cheap seats fill
 * them). A player who reads the seat bar's yesterday line; balance numbers
 * describe one who uses it.
 */
function tuneFareClasses(state: SimState): string[] {
  if (dayIndex(state) % FARE_CLASS_REVIEW_DAYS !== 3) return [];
  const log: string[] = [];
  for (const [key, tally] of Object.entries(state.yesterdayFareClasses ?? {})) {
    const settings = state.routeSettings[key];
    if (!settings || tally.flights === 0) continue;
    const { saverShare, flexShare } = settings.fareClasses ?? DEFAULT_FARE_CLASSES;
    const soldOutMostly = tally.saverSoldOut / tally.flights >= 0.5;
    let next = saverShare;
    if (soldOutMostly && tally.businessTurnedAway >= 1) next = Math.max(MIN_SAVER_SHARE, saverShare - FARE_CLASS_STEP);
    else if (tally.saverSoldOut === 0 && tally.businessTurnedAway < 1) next = Math.min(MAX_SAVER_SHARE, saverShare + FARE_CLASS_STEP);
    if (Math.abs(next - saverShare) < 1e-9) continue;
    const [a, b] = key.split('-');
    setFareClasses(state, a, b, next, flexShare + (saverShare - next));
    log.push(`${key} Saver ${Math.round(saverShare * 100)}% → ${Math.round(next * 100)}%.`);
  }
  return log;
}

// --- Seat sales --------------------------------------------------------

/** How often the player looks for a route to put on sale, in days. */
const SALE_REVIEW_DAYS = 7;
/** A route flying emptier than this over a week is one a sale might fill. */
const SALE_LOAD_BELOW = 0.55;

/**
 * Once a week, a seven-day seat sale (sim/seatSale.ts) on the emptiest
 * route flying under SALE_LOAD_BELOW full, if it can have one: the move a
 * player makes to fill planes and build a thin market.
 */
function runSeatSales(state: SimState): string[] {
  if (dayIndex(state) % SALE_REVIEW_DAYS !== 2) return [];
  let emptiest: { a: string; b: string; load: number } | null = null;
  for (const key of new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))) {
    const [a, b] = key.split('-');
    const load = marketLoadFactor(state, a, b).factor;
    if (load === null || load >= SALE_LOAD_BELOW || saleBlockedReason(state, a, b)) continue;
    // Only a sale that doesn't lose money while it runs: its growth is the gain.
    if (saleMarginChangePerDay(state, a, b) < 0) continue;
    if (!emptiest || load < emptiest.load) emptiest = { a, b, load };
  }
  if (!emptiest) return [];
  const result = actions.startSeatSale(state, emptiest.a, emptiest.b);
  return result.ok ? [result.message] : [];
}

// --- Cabins ------------------------------------------------------------

/** How often the player looks at its planes' cabins, in days. */
const CABIN_REVIEW_DAYS = 7;
/** A refit has to pay for itself, and the days out of service, within this many days of its forecast gain. */
const CABIN_PAYBACK_DAYS = 45;
/** Out of service costs about this many times the refit's price again. */
const CABIN_DOWNTIME_FACTOR = 0.5;

/**
 * Once a week, refit the one plane whose cabin change (sim/cabins.ts)
 * pays back fastest, when it pays back within CABIN_PAYBACK_DAYS and the
 * airline has three refits' cash on hand: one at a time, so the fleet is
 * never short more than a plane.
 */
function refitCabins(state: SimState): string[] {
  if (dayIndex(state) % CABIN_REVIEW_DAYS !== 5) return [];
  if (state.aogs.some((event) => event.refitTo) || state.aircraft.some((a) => a.refitPending)) return [];
  let best: { tail: string; to: 'economy' | 'business'; worth: number } | null = null;
  for (const aircraft of state.aircraft) {
    const option = actions.refitOptionFor(state, aircraft.tail);
    if (!option || option.blocked || state.cash < 3 * option.cost) continue;
    const worth = option.gainPerDay * CABIN_PAYBACK_DAYS - option.cost * (1 + CABIN_DOWNTIME_FACTOR);
    if (worth > 0 && (!best || worth > best.worth)) best = { tail: aircraft.tail, to: option.to, worth };
  }
  if (!best) return [];
  const result = actions.orderRefit(state, best.tail, best.to);
  return result.ok ? [result.message] : [];
}

// --- The home hub ------------------------------------------------------

/** How often the player looks at how its home hub is run, in days. */
const HUB_REVIEW_DAYS = 7;
/** A style change has to be worth this much a day before it's made. */
const HUB_STYLE_WORTH_PER_DAY = 500;

/**
 * Once a week, run the home hub the way the Plan hub window
 * (sim/hubPlanner.ts) says pays best, when its advice is worth
 * HUB_STYLE_WORTH_PER_DAY or more. Connections come from real times
 * (sim/hubs.ts), and a hub's style is how its rotations are timed, so a
 * player who never touched it would connect only by chance: the balance
 * numbers would describe a player who never opens the window.
 */
function runHomeHub(state: SimState): string[] {
  if (dayIndex(state) % HUB_REVIEW_DAYS !== 0) return [];
  const home = state.homeAirport;
  const move = styleAdvice(state, home).best;
  if (!move || move.kind !== 'style' || move.gainPerDay < HUB_STYLE_WORTH_PER_DAY) return [];
  const result = actions.setHubStyle(state, home, move.style);
  return result.ok ? [result.message] : [];
}

// --- Contracts -------------------------------------------------------

/**
 * Take every offered contract (sim/contracts.ts) worth at
 * least CONTRACT_WORTH_PER_DAY that a plane can fit: one out-and-back a day from whichever end has a plane based with
 * room for it, landing by LATEST_LANDING_MINUTE. That's all a contract
 * asks, and it starts the next day. Priced on the Match stance like any
 * market this player opens.
 */
function takeContracts(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const contract of contractsOf(state)) {
    if (contract.status !== 'offered' || legsServingMarket(contract.a, contract.b, state.schedule) > 0) continue;
    // A small one isn't worth a slot in the plane's day that a real market could fill.
    if (contract.paymentPerDay < CONTRACT_WORTH_PER_DAY) continue;
    for (const [base, far] of [
      [contract.a, contract.b],
      [contract.b, contract.a],
    ]) {
      const from = airportByIata.get(base)!;
      const to = airportByIata.get(far)!;
      const fits = (tail: string) => {
        const plan = planRotation([from], to, tail, state);
        return plan.error === null && plan.arriveBackMinute <= LATEST_LANDING_MINUTE;
      };
      const plane = state.aircraft.find((aircraft) => aircraft.baseAirport === base && aircraft.returningOnDay === undefined && fits(aircraft.tail));
      if (!plane) continue;
      applyRotation(state, plane.tail, planRotation([from], to, plane.tail, state));
      setFareStance(state, base, far, 'match');
      memory.openedOn.set(marketKey(base, far), dayIndex(state));
      log.push(`contract ${base}–${far}`);
      break;
    }
  }
  return log;
}

/** The smallest contract this player takes, in dollars a day at full pay. */
const CONTRACT_WORTH_PER_DAY = 3000;
/** A contract earning less than this share of its pay gets its plane's turns padded. */
const CONTRACT_PAY_TO_BUFFER = 0.5;

/**
 * A running contract judged late (sim/contracts.ts's performanceFactor())
 * loses its pay, and its lateness is mostly knock-on from earlier in its
 * plane's day. So, once the market has settled, pad every turn that plane
 * flies by one more step of turn buffer, as a player reading the
 * contract's terms would.
 */
function keepContractsOnTime(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const contract of contractsOf(state)) {
    const key = marketKey(contract.a, contract.b);
    if (contract.status !== 'active' || !settled(state, memory, key)) continue;
    if (performanceFactor(state, contract) >= CONTRACT_PAY_TO_BUFFER) continue;
    const tails = new Set(state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key).map((leg) => leg.tail));
    const markets = new Map(state.schedule.filter((leg) => tails.has(leg.tail)).map((leg) => [marketKey(leg.origin, leg.dest), leg]));
    let padded = 0;
    for (const leg of markets.values()) {
      const next = TURN_BUFFER_CHOICES.find((minutes) => minutes > actions.currentTurnBuffer(state, leg.origin, leg.dest));
      if (next !== undefined && actions.setTurnBuffer(state, leg.origin, leg.dest, next).ok) padded++;
    }
    memory.lastTouched.set(key, dayIndex(state));
    if (padded > 0) log.push(`contract ${contract.a}–${contract.b} running late: padded ${padded} market${padded === 1 ? '' : 's'} its plane flies.`);
  }
  return log;
}

// --- Reading a market -----------------------------------------------------------

/**
 * How this player ranks a market: its potential demand, roughly riders a
 * day, which a player reads off the Demand lens's circles and a hovered
 * airport's market lines. Read in words alone, "Huge" spans 3,000 to
 * 14,000 riders, and in a dense region nearly every market is "Huge,
 * starved": the steady player then picked blind, and its median year fell
 * two- to four-fold. Ranking up starved ends or down rivals' markets both
 * cut a careful year from Montréal by more than two-thirds, so neither
 * counts here.
 */
function marketScore(state: SimState, from: string, to: string): number {
  return currentPotentialDemand(state, from, to);
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
  // A running contract (sim/contracts.ts) needs a flight each
  // way every day: its last round trip stays until the term is over.
  if (contractOn(state, a, b)?.status === 'active' && legsServingMarket(a, b, state.schedule) <= 2) {
    return { ok: false, reason: `${a}–${b} is under contract` };
  }
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
 * A plane with nothing to fly (just delivered, sim/fleetTiming.ts, or
 * emptied by cuts) gets a whole day at once, from the best markets from
 * its base, since an idle plane is only cost. Not one going back to the
 * lessor. Runs for the sitter too, so a plane it has leases isn't wasted.
 */
function fillDelivered(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const aircraft of state.aircraft) {
    if (aircraft.returningOnDay !== undefined || state.schedule.some((leg) => leg.tail === aircraft.tail)) continue;
    const opened = fillPlane(state, aircraft.tail, {
      latestLanding: LATEST_LANDING_MINUTE,
      avoid: (key) => coolingDown(state, memory, key),
      checkSlotFees: true,
      onOpen: (key) => memory.openedOn.set(key, dayIndex(state)),
    });
    if (opened.length > 0) log.push(`${aircraft.tail} flies ${opened.join(', ')}.`);
  }
  return log;
}

/**
 * Habit 5, lease when full. Once a class's pool at home is
 * LEASE_WHEN_POOL_SHARE booked, lease one more: the largest class on
 * offer whose best market has the riders to fill a round trip, whose
 * lease last week's average daily margin could pay on its own, with cash
 * to cover the lessor's reserve plus LEASE_SAFETY_DAYS more, and with no
 * plane of that class already on its way (the pools don't count a plane
 * until it's delivered). Not while home is too busy. Its crews are hired
 * the same day (keepCrews()), so they join about when it's delivered;
 * once it's delivered, openMarkets() gives it a day. One lease a day.
 */
/** When the network's demand is this far over an ordinary day's, a lease for growth is a seasonal one. */
const SEASONAL_LEASE_IN_PEAK = 1.08;

/** The flown markets' seasonal level today, averaged (sim/seasons.ts). */
function networkSeasonToday(state: SimState): number {
  const keys = [...new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))];
  if (keys.length === 0) return 1;
  const day = dayOfYear(state);
  return keys.reduce((sum, key) => {
    const [a, b] = key.split('-');
    return sum + marketSeasonOn(a, b, day);
  }, 0) / keys.length;
}

function leaseWhenFull(state: SimState, memory: Memory, bold: boolean): string[] {
  const home = state.homeAirport;
  if (tooBusy(state, home)) return [];
  const pools = utilisationPools(state, home).filter((pool) => pool.planes > 0);
  if (!pools.some((pool) => pool.share >= (bold ? BOLD_LEASE_WHEN_POOL_SHARE : LEASE_WHEN_POOL_SHARE))) return [];
  const lastWeek = state.marginHistory.slice(-7);
  if (lastWeek.length < 7) return [];
  const averageMargin = lastWeek.reduce((sum, margin) => sum + margin, 0) / 7;

  const options = actions.planeOptions(state, home);
  // In a peak (sim/seasons.ts), the extra plane is leased for the season and goes back by itself.
  const seasonal = networkSeasonToday(state) >= SEASONAL_LEASE_IN_PEAK;
  for (const cls of [...AIRCRAFT_CLASSES].reverse()) {
    const option = options.find((o) => o.code === cls.code);
    if (!option?.listing || option.disabledReason) continue;
    const price = Math.round(option.listing.leasePricePerDay * (seasonal ? SEASONAL_PREMIUM : 1));
    // What the airline already makes a day has to carry the new lease, and
    // the network overhead it adds (sim/overhead.ts), on its own.
    // The bold player only waits for the airline to make money at all.
    if (averageMargin < (bold ? 0 : price + overheadAddedByNextPlane(state))) continue;
    if (state.cash < cashNeededToLease(price) + (bold ? BOLD_SAFETY_DAYS : LEASE_SAFETY_DAYS) * price) continue;
    const market = bestMarketFor(state, home, cls.code, memory);
    if (!market || market.score < worthFlying(cls.code)) continue;
    // One of this class on its way already: wait for it to show up.
    if (inboundAt(state, home, cls.code).length > 0) return [];

    const leased = actions.leasePlane(state, home, cls.code, seasonal);
    if (!leased.ok) continue;
    return [leased.message, ...keepCrews(state, memory)];
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
  const leaseBill = state.aircraft.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0);
  // Crew academy: crews in half the time matter once the airline grows or
  // changes type often, so valued as a twentieth of the lease bill.
  if (id === 'crew-academy') return leaseBill * 0.05;
  // Younger airframes: worth it once the airline leases often, so valued
  // as a tenth of the fleet's daily lease bill.
  return leaseBill * 0.1;
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
 * Keep each crew base's crews of each class at what that class's planes
 * need at ideal shifts, with enough reserve for sickness to keep a week's
 * grounding risk under CREW_GROUNDING_RISK, plus CREWS_PER_NEW_PLANE for each plane of the
 * class on its way, counting crews already joining. A shortfall is met by
 * retraining spare crews of another class first (cheaper), then hiring;
 * crews above target are let go once they've sat spare for
 * CREW_RELEASE_AFTER_DAYS.
 */
/** The weekly chance of a crew grounding the player staffs for. */
const CREW_GROUNDING_RISK = 0.05;

function keepCrews(state: SimState, memory: Memory): string[] {
  const log: string[] = [];
  for (const iata of Object.keys(state.crewBases ?? {})) {
    const classes = actions.crewReadout(state, iata)?.classes ?? [];
    // Each class's target: its planes' need at ideal shifts, plus a full
    // day's crews for each plane of the class on its way.
    // ...and enough reserve to keep a week's crew-grounding risk under CREW_GROUNDING_RISK (sim/crews.ts's sickness).
    const targets = classes.map((crew) => ({
      crew,
      target: crewsForRisk(state, iata, crew.classCode, CREW_GROUNDING_RISK, crew.ideal) + CREWS_PER_NEW_PLANE * inboundAt(state, iata, crew.classCode).length,
    }));
    for (const { crew, target } of targets) {
      const key = `${iata}:${crew.classCode}`;
      let short = target - crew.crews - crew.arriving;
      if (short > 0) {
        memory.spareCrewDays.delete(key);
        // Spare crews of another class retrain for less than a hire costs.
        for (const other of targets) {
          if (short <= 0 || other.crew.classCode === crew.classCode) continue;
          const otherSpare = other.crew.crews - other.target;
          if (otherSpare <= 0) continue;
          const moved = Math.min(short, otherSpare);
          const retrained = actions.retrainCrewsAt(state, iata, other.crew.classCode, crew.classCode, moved);
          if (!retrained.ok) continue;
          log.push(retrained.message);
          other.crew.crews -= moved;
          short -= moved;
        }
        if (short > 0) {
          const hired = actions.hireCrewsAt(state, iata, crew.classCode, short);
          if (hired.ok) log.push(hired.message);
        }
        continue;
      }
      const spare = crew.crews - target;
      if (spare <= 0 || crew.arriving > 0) {
        memory.spareCrewDays.delete(key);
        continue;
      }
      const days = (memory.spareCrewDays.get(key) ?? 0) + 1;
      memory.spareCrewDays.set(key, days);
      if (days < CREW_RELEASE_AFTER_DAYS) continue;
      memory.spareCrewDays.delete(key);
      const released = actions.releaseCrewsAt(state, iata, crew.classCode, spare);
      if (released.ok) log.push(released.message);
    }
  }
  return log;
}
