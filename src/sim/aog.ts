import { nextRandom } from './rng';
import { dayIndex, dayStartMinute } from './clock';
import { executiveMaintenanceMultiplier } from './executives';
import { airportLoadAt } from './airports';
import { hourOf } from './hours';
import { summarizeMarket } from './marketSummary';
import { marketKey } from './schedule';
import { aircraftUtilisation, rotationsForTail, type Rotation } from './utilisation';
import { coverRotations, handBackCover } from './turnBuffer';
import { applyRefit, refitDays, refitWorkMinutes, type RefitTarget } from './cabins';
import { type BayClaims, bookedDChecks, chargeMaintenance, freeHeavyBays, bookedHeavyChecks, finishDCheck, finishHeavyCheck, forcedHeavyChecks, wornAge } from './mxChecks';
import { nightStopStation } from './nightStops';
import { rollFleetCabins } from './fleetCabins';
import { engineFault, rollEngineDay } from './enginePool';
import { contractCost, heavyRated } from './bases';
import type { Aircraft, SimState } from './state';

/**
 * How old an airframe behaves, for breakdowns and age delays, per year of
 * its real age: a well-maintained fleet behaves younger than its years.
 * A maintenance COO (sim/executives.ts) lowers it further.
 */
export const MAINTENANCE_AGE_FACTOR = 0.6;

/**
 * AOG — "aircraft on ground": an unscheduled maintenance event that takes
 * a plane out of service for days, not hours, until it's fixed. This
 * replaced a one-day grounding that simply cancelled the plane's flights
 * and was forgotten by the next morning.
 *
 * Rolled for every plane each morning. The chance rises with:
 *   - effective age (age × maintenance staffing, as the delay model uses),
 *   - congestion at the busiest airport the plane flies to — more goes
 *     wrong in a crowded, rushed operation,
 *   - how hard the plane is worked: above UTILISATION_STRAIN_ONSET of its
 *     day, there's less slack for line maintenance to catch things early.
 * That last one is deliberate pressure against booking a fleet to 100%.
 *
 * What an AOG does to the schedule is the one rule for any pool over
 * capacity: the grounded plane's rotations move to other planes of the
 * same class at the same base that have a gap for them (the pool's slack
 * is the buffer this eats), most profitable first, without re-timing
 * anyone's timetable (sim/turnBuffer.ts coverRotations()), and go back at
 * their own times when it's repaired. Whatever doesn't fit
 * stays on the grounded plane and is cancelled every morning until it's
 * back — so the least profitable flying goes first. The player can free
 * time (cut a flight, trim a turn buffer or hub wait) and the next
 * morning's pass picks up whatever now fits; or pay to expedite the repair.
 */

const AOG_CHANCE_PER_EFFECTIVE_YEAR = 0.00125; // 20 years, fully maintained (effective 12) → 1.5% a day
const AOG_CHANCE_MAX = 0.08;
/** Congestion only adds risk once an airport is busy enough to queue (sim/delays.ts's onset). */
const CONGESTION_RISK_ONSET_LOAD = 0.5;
const CONGESTION_RISK_PER_LOAD = 2;
/** Worked harder than this share of its day, a plane starts to break more often... */
const UTILISATION_STRAIN_ONSET = 0.85;
/** ...by this much per unit of share over it: 100% booked → ×1.6. */
const UTILISATION_STRAIN_PER_SHARE = 4;
/** An AOG lasts 1 to 1 + this many days, most of them short; older airframes stretch longer (effective age 12 → 1–5 days). */
const DURATION_BASE_EXTRA_DAYS = 1;
const DURATION_EXTRA_DAYS_PER_EFFECTIVE_YEAR = 0.25;
/** Expediting a repair costs this many days of the plane's lease per day saved. */
const EXPEDITE_LEASE_DAYS_PER_DAY = 5;

const MINUTES_PER_DAY = 1440;
const FAULTS = ['hydraulics', 'landing gear', 'engine', 'avionics', 'bird strike', 'pressurisation', 'fuel system', 'flight controls'];
/** The share of breakdowns that are an engine, for readouts that estimate how often one comes. */
export const ENGINE_FAULT_SHARE = 1 / FAULTS.length;

export type AogEvent = {
  tail: string;
  base: string;
  fault: string;
  /** The day-start simMinute it's back in service. */
  returnsAtMinute: number;
  /** Routes whose rotations couldn't be covered and are cancelled until it's back ("YUL–BOS"). */
  uncoveredRoutes: string[];
  /** Rotations moved onto other planes when it went down. */
  coveredRotations: number;
  /** The ids of those moved legs, so the flying can be handed back when it's repaired. */
  movedLegIds: string[];
  /** When each moved leg was scheduled before it moved (home-local minute of day, by leg id), so it goes back at exactly that time. */
  scheduledAt?: Record<string, number>;
  /** A planned refit (sim/cabins.ts) rather than a breakdown: the cabin it has when it's back. It can't be expedited. */
  refitTo?: RefitTarget;
  /** A refit done in a hangar bay at its base, which is held until it's back; absent, contracted out. */
  inBay?: boolean;
  /** A heavy check (sim/mxChecks.ts) rather than a breakdown. It can't be expedited. */
  check?: boolean;
  /** Which check it is, when `check` is set: absent is the C check. */
  checkKind?: 'D';
};

/** An engine's shop visit, paid when the spare is swapped in. */
function chargeEngineShop(state: SimState, cost: number): void {
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.maintenance += cost;
  state.todayMargin -= cost;
}

export function isAog(state: SimState, tail: string): boolean {
  return state.aogs.some((event) => event.tail === tail);
}

export function aogFor(state: SimState, tail: string): AogEvent | undefined {
  return state.aogs.find((event) => event.tail === tail);
}

function effectiveAge(state: SimState, aircraft: Aircraft): number {
  // Deferred items wear it like extra years (sim/mxChecks.ts).
  return wornAge(aircraft) * MAINTENANCE_AGE_FACTOR * executiveMaintenanceMultiplier(state, aircraft.typeCode);
}

/** Today's chance this plane goes AOG. Exported for the dev tools and any readout that wants to explain it. */
export function aogChance(state: SimState, aircraft: Aircraft): number {
  const base = effectiveAge(state, aircraft) * AOG_CHANCE_PER_EFFECTIVE_YEAR;
  // The busiest hour it actually uses: a takeoff or landing at a crowded field in a crowded hour.
  const loads = state.schedule
    .filter((leg) => leg.tail === aircraft.tail)
    .flatMap((leg) => [airportLoadAt(state, leg.origin, hourOf(leg.departMinute)), airportLoadAt(state, leg.dest, hourOf(leg.departMinute + leg.blockMinutes))]);
  const busiest = Math.max(0, ...loads);
  const congestion = 1 + CONGESTION_RISK_PER_LOAD * Math.max(0, busiest - CONGESTION_RISK_ONSET_LOAD);
  const strain = 1 + UTILISATION_STRAIN_PER_SHARE * Math.max(0, aircraftUtilisation(state, aircraft.tail).share - UTILISATION_STRAIN_ONSET);
  return Math.min(AOG_CHANCE_MAX, base * congestion * strain);
}

/** What a plane's flying earns a day, roughly: the sum of its rotations' values. For the engine book. */
function planeDayValue(state: SimState, tail: string): number {
  return rotationsForTail(state, tail).reduce((total, rotation) => total + rotationValue(state, rotation), 0);
}

/** What one rotation earns a day, roughly: each leg's share of its route's margin. For choosing what to cover first. */
function rotationValue(state: SimState, rotation: Rotation): number {
  let value = 0;
  for (const leg of rotation.legs) {
    const settings = state.routeSettings[marketKey(leg.origin, leg.dest)];
    if (!settings) continue;
    const summary = summarizeMarket(leg.origin, leg.dest, state, settings);
    if (summary.freq > 0) value += summary.margin / summary.freq;
  }
  return value;
}

/**
 * Move each grounded plane's rotations onto other planes where they fit,
 * most profitable first, and record what's left uncovered. Run every
 * morning, so time the player frees up is used the next day.
 */
function coverGroundedPlanes(state: SimState): void {
  for (const event of state.aogs) {
    const rotations = rotationsForTail(state, event.tail).sort((a, b) => rotationValue(state, b) - rotationValue(state, a));
    if (rotations.length === 0) {
      event.uncoveredRoutes = [];
      continue;
    }
    const { covered, movedLegIds, scheduledAt } = coverRotations(state, event.tail, rotations);
    event.coveredRotations += covered;
    event.movedLegIds.push(...movedLegIds);
    if (covered > 0) event.scheduledAt = { ...event.scheduledAt, ...scheduledAt };
    event.uncoveredRoutes = [
      ...new Set(
        rotationsForTail(state, event.tail).flatMap((rotation) =>
          rotation.legs.filter((leg) => leg.origin === event.base).map((leg) => `${leg.origin}–${leg.dest}`),
        ),
      ),
    ];
  }
}

/**
 * The morning pass, from step.ts's day rollover, before the day's
 * cancellations are counted: planes whose repair is done come back, new
 * AOGs are rolled, and every grounded plane's rotations are covered as far
 * as the pools allow.
 */
export function rollDailyAogs(state: SimState, dayStartMinute: number): void {
  rollEngineDay(state, dayStartMinute);
  const repaired = state.aogs.filter((event) => event.returnsAtMinute <= dayStartMinute);
  state.aogs = state.aogs.filter((event) => event.returnsAtMinute > dayStartMinute);
  for (const event of repaired) {
    const aircraft = state.aircraft.find((a) => a.tail === event.tail);
    if (aircraft && event.refitTo) applyRefit(aircraft, event.refitTo);
    if (aircraft && event.check) {
      if (event.checkKind === 'D') finishDCheck(state, aircraft);
      else finishHeavyCheck(state, aircraft);
    }
    handBackCover(state, event);
  }
  // Heavy checks overdue past the grace (sim/mxChecks.ts): grounded, the same way, for the work left.
  const bayClaims: BayClaims = new Map();
  const forced = forcedHeavyChecks(state, bayClaims);
  const checksToStart = [
    ...forced.map((check) => ({ ...check, fault: 'C check overdue' })),
    ...bookedHeavyChecks(state, forced.map((check) => check.aircraft), bayClaims).map((check) => ({ ...check, fault: 'C check booked' })),
  ];
  const dChecks = bookedDChecks(state, checksToStart.map((check) => check.aircraft), bayClaims).map((check) => ({ ...check, fault: 'D check booked', checkKind: 'D' as const }));
  for (const { aircraft, days, fault, checkKind } of [...checksToStart.map((check) => ({ ...check, checkKind: undefined })), ...dChecks]) {
    state.lastAogDay = dayIndex(state);
    state.aogs.push({
      tail: aircraft.tail,
      base: aircraft.atAirport ?? aircraft.baseAirport!,
      fault,
      returnsAtMinute: dayStartMinute + days * MINUTES_PER_DAY,
      uncoveredRoutes: [],
      coveredRotations: 0,
      movedLegIds: [],
      check: true,
      ...(checkKind ? { checkKind } : {}),
    });
  }

  // After the checks have taken their bays: a refit takes what's left, and a plane starting a check waits.
  // Planes behind their type's standard cabin are ordered theirs first, one per base (sim/fleetCabins.ts).
  rollFleetCabins(state);
  startRefits(state, dayStartMinute);

  for (const aircraft of state.aircraft) {
    // Always draw, whatever the outcome below, so how many random numbers a
    // day consumes doesn't depend on who happens to be grounded, so a
    // balance comparison stays on the same random stream either way.
    const [roll, afterRoll] = nextRandom(state.rngSeed);
    const [durationRoll, afterDuration] = nextRandom(afterRoll);
    state.rngSeed = afterDuration;

    if (isAog(state, aircraft.tail) || state.groundedTails.includes(aircraft.tail)) continue;
    // Only a plane sitting at its base, or at its night-stop station
    // (sim/nightStops.ts), can go down there. A long-haul aircraft still in
    // the air at midnight is skipped until it lands.
    const atNightStop = aircraft.atAirport !== null && aircraft.atAirport === nightStopStation(state, aircraft.tail);
    if (aircraft.status !== 'ground' || !aircraft.baseAirport || (aircraft.atAirport !== aircraft.baseAirport && !atNightStop)) continue;
    // Nor one ferrying to another base (sim/rebase.ts).
    if (aircraft.rebase) continue;
    if (roll >= aogChance(state, aircraft)) continue;

    const maxExtraDays = DURATION_BASE_EXTRA_DAYS + Math.round(effectiveAge(state, aircraft) * DURATION_EXTRA_DAYS_PER_EFFECTIVE_YEAR);
    const faultDays = 1 + Math.floor(durationRoll * durationRoll * (maxExtraDays + 1));
    const fault = FAULTS[Math.floor(durationRoll * 997) % FAULTS.length];
    // An engine fault waits for a lease engine, or is covered by the class's engine plan (sim/enginePool.ts).
    const engine = fault === 'engine' ? engineFault(state, aircraft.typeCode, faultDays, dayStartMinute, planeDayValue(state, aircraft.tail)) : null;
    const days = engine?.days ?? faultDays;
    if (engine && engine.shopCost > 0) chargeEngineShop(state, engine.shopCost);
    state.lastAogDay = dayIndex(state);
    state.aogs.push({
      tail: aircraft.tail,
      base: aircraft.baseAirport,
      fault,
      returnsAtMinute: dayStartMinute + days * MINUTES_PER_DAY,
      uncoveredRoutes: [],
      coveredRotations: 0,
      movedLegIds: [],
    });
  }

  coverGroundedPlanes(state);
}

/** Refits ordered (sim/cabins.ts) start on a plane on the ground at its base, flying nothing else meanwhile. */
function startRefits(state: SimState, dayStartMinute: number): void {
  for (const aircraft of state.aircraft) startRefitIfAtBase(state, aircraft, dayStartMinute);
}

function startRefitIfAtBase(state: SimState, aircraft: Aircraft, dayStartMinute: number): void {
  if (!aircraft.refitPending || isAog(state, aircraft.tail) || aircraft.rebase) return;
  if (aircraft.status !== 'ground' || !aircraft.baseAirport || aircraft.atAirport !== aircraft.baseAirport) return;
  // In a bay when its base has a hangar rated for the class with one free; otherwise contracted out by the hour.
  const inBay = heavyRated(state, aircraft.baseAirport, aircraft.typeCode) && freeHeavyBays(state, aircraft.baseAirport) > 0;
  if (!inBay) chargeMaintenance(state, contractCost(refitWorkMinutes(aircraft.typeCode)));
  state.aogs.push({
    tail: aircraft.tail,
    base: aircraft.baseAirport,
    fault: 'cabin refit',
    returnsAtMinute: dayStartMinute + refitDays(aircraft.typeCode) * MINUTES_PER_DAY,
    uncoveredRoutes: [],
    coveredRotations: 0,
    movedLegIds: [],
    refitTo: aircraft.refitPending,
    ...(inBay ? { inBay: true } : {}),
  });
  delete aircraft.refitPending;
}

/**
 * A long-haul pair that lands after midnight is in the air at every morning
 * pass, so its refit would never find it at base. It starts when the plane
 * touches down there instead.
 */
export function startRefitOnLanding(state: SimState, aircraft: Aircraft): void {
  if (!aircraft.refitPending) return;
  startRefitIfAtBase(state, aircraft, dayStartMinute(state));
  if (!aircraft.refitPending) coverGroundedPlanes(state);
}

/** Whole days until it's back, counting from now. */
export function daysUntilReturn(state: SimState, event: AogEvent): number {
  return Math.max(1, Math.ceil((event.returnsAtMinute - state.simMinute) / MINUTES_PER_DAY));
}

/** What cutting one day off this repair costs, or null when it's already due back tomorrow morning. */
export function expediteCost(state: SimState, tail: string): number | null {
  const event = aogFor(state, tail);
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!event || !aircraft || event.refitTo || event.check || daysUntilReturn(state, event) <= 1) return null;
  return EXPEDITE_LEASE_DAYS_PER_DAY * aircraft.leaseCostPerDay;
}

export function expediteRepair(state: SimState, tail: string): { ok: true; message: string } | { ok: false; reason: string } {
  const cost = expediteCost(state, tail);
  const event = aogFor(state, tail);
  if (cost === null || !event) return { ok: false, reason: 'It is already due back tomorrow morning.' };
  if (state.cash < cost) return { ok: false, reason: `Needs $${cost.toLocaleString()} on hand.` };
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.maintenance += cost;
  state.todayMargin -= cost;
  event.returnsAtMinute -= MINUTES_PER_DAY;
  return { ok: true, message: `${tail} expedited · back ${daysUntilReturn(state, event)}d` };
}
