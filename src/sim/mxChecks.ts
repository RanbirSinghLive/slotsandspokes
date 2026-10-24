import { recordMaintenanceAccrual } from './unitEconomics';
import { contractCost, heavyBays, heavyRated, lineCapacity, lineRated } from './bases';
import { dayStartMinute } from './clock';
import { executiveToleranceExtraDays, executiveToleranceMultiplier } from './executives';
import { nightStopStation } from './nightStops';
import { projectRestOfDay } from './cascade';
import { rotationsForTail } from './utilisation';
import type { ScheduleLeg } from './schedule';
import type { Aircraft, SimState } from './state';

/**
 * Maintenance checks (WEEK-FOURTEEN.md, stage 4).
 *
 * **The line check is a night at one of your line bases** (sim/bases.ts),
 * LINE_CHECK_MINUTES of hangar work, needed once every
 * LINE_INTERVAL_NIGHTS nights a plane flies. Each night a line base checks
 * as many planes asleep there as its level, the longest since a check
 * first, so a base with room checks planes early and the fleet's checks
 * spread across the nights. A plane's night runs from its landing to
 * RELEASE_MINUTES before its first departure; one with CLEAR_SPARE_MINUTES
 * to spare after the work clears an item. Line checks are never bought: a
 * plane due one that sleeps where it can't be checked (no line base, a full
 * one, an unrated class, or in the air), or whose check night is too
 * short, carries a **deferred item** to tomorrow, and another each night
 * until it's checked.
 *
 * **Deferred items wear the plane.** Each counts as DEFERRED_AGE_YEARS more
 * age for breakdowns and mechanical delays (sim/aog.ts, sim/delays.ts), so
 * a plane worked through its nights breaks down more. At MX_HOLD_AT the
 * plane is held where it is the next morning: its first rotation is
 * cancelled ("MX hold") while the items are cleared, by contract away
 * from a maintenance base.
 *
 * **The heavy check** is HEAVY_WORK_MINUTES of hangar work every
 * HEAVY_INTERVAL_DAYS days the plane flies, done as one stretch with the
 * plane out of service, in a hangar bay or contracted out: booked by the
 * player once HEAVY_WINDOW_DAYS before it's due, or forced when the plane
 * is OVERDUE_GRACE_DAYS past due, as an AOG (sim/aog.ts), at its base,
 * until the work is done. Done, it clears every deferred item. So the lever
 * is picking the quiet week, not the shape of the plane's night.
 */

/** A line check's hangar minutes, by class. */
const LINE_CHECK_MINUTES: Record<string, number> = { PROP: 210, REGIONAL: 240, NARROWBODY: 300, WIDEBODY: 390 };
/** A plane needs a line check once in this many nights. */
export const LINE_INTERVAL_NIGHTS = 5;
/** A plane is handed back from the hangar this long before its first departure. */
export const RELEASE_MINUTES = 60;
/** Spare hangar time beyond the night's work that clears one deferred item. */
const CLEAR_SPARE_MINUTES = 120;
/** Each deferred item counts as this much more age for breakdowns and mechanical delays. */
export const DEFERRED_AGE_YEARS = 3;
/** Deferred items at which the plane is held at base for a morning. */
export const MX_HOLD_AT = 3;
export const HEAVY_INTERVAL_DAYS = 90;
/**
 * The heavy check is the C check. It is due after HEAVY_INTERVAL_DAYS flying
 * days, C_INTERVAL_HOURS airborne or C_INTERVAL_CYCLES landed, whichever
 * comes first, so a plane flown hard comes due sooner than one flown lightly.
 */
export const C_INTERVAL_HOURS = 900;
export const C_INTERVAL_CYCLES = 750;
/** The heavy check's work starts being done this many days before it's due. */
export const HEAVY_WINDOW_DAYS = 15;
export const OVERDUE_GRACE_DAYS = 7;
/**
 * Hangar minutes a heavy check takes, by class: whole days, so the plane is
 * out of service 2, 2, 3 or 4 days. Rare and heavy rather than frequent and
 * light, so a fast-forwarded game isn't a constant queue for the hangar.
 */
const HEAVY_WORK_MINUTES: Record<string, number> = { PROP: 2880, REGIONAL: 2880, NARROWBODY: 4320, WIDEBODY: 5760 };

/**
 * The share of a flight's non-fuel block-hour cost that is maintenance.
 * It is held back from the flight and paid when the plane's next A or heavy check is
 * done, so maintenance comes as a lump you can see coming rather than a
 * trickle. Route margins and rivals still count the whole cost, so only
 * when the money leaves changes.
 */
export const MAINTENANCE_SHARE_OF_NON_FUEL = 0.2;

/**
 * The A check: a light check due every A_INTERVAL_HOURS flown or
 * A_INTERVAL_CYCLES landed, whichever comes first, so a plane on short hops
 * is due as soon as one on long ones. It is done on nights at a line base,
 * out of what the line check leaves, before anything goes toward the heavy
 * check. It opens A_WINDOW of the way to due, and a plane past A_OVERDUE of
 * the interval adds a deferred item every night it flies.
 */
export const A_INTERVAL_HOURS = 100;
export const A_INTERVAL_CYCLES = 80;
export const A_WINDOW = 0.8;
export const A_OVERDUE = 1.25;
/** Hangar minutes an A check takes, by class. */
const A_WORK_MINUTES: Record<string, number> = { PROP: 240, REGIONAL: 300, NARROWBODY: 360, WIDEBODY: 480 };

/**
 * The D check: an overhaul due after D_INTERVAL_DAYS flying days or
 * D_INTERVAL_HOURS airborne, whichever comes first. It takes the plane out of
 * service for days, so it is only ever booked by the player, never forced; a
 * plane past due wears like D_WEAR_YEARS more years of age until it goes in.
 */
export const D_INTERVAL_DAYS = 720;
export const D_INTERVAL_HOURS = 7200;
/** Booking opens this many days before it's due. */
export const D_WINDOW_DAYS = 60;
export const D_WEAR_YEARS = 2;
/** Days out of service and hangar hours of work, by class. */
const D_DAYS: Record<string, number> = { PROP: 10, REGIONAL: 14, NARROWBODY: 18, WIDEBODY: 24 };
const D_WORK_HOURS: Record<string, number> = { PROP: 120, REGIONAL: 200, NARROWBODY: 320, WIDEBODY: 480 };

const MINUTES_PER_DAY = 1440;

export function lineCheckMinutes(aircraft: Aircraft): number {
  return LINE_CHECK_MINUTES[aircraft.typeCode] ?? LINE_CHECK_MINUTES.PROP;
}

/** Nights since the plane's last line check. A plane with none yet starts at a point set by its tail, so a fleet isn't all due the same night. */
export function nightsSinceLine(aircraft: Aircraft): number {
  if (aircraft.nightsSinceLine !== undefined) return aircraft.nightsSinceLine;
  let hash = 0;
  for (const char of aircraft.tail) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % (LINE_INTERVAL_NIGHTS - 1);
}

/** Whether the plane gets a deferred item if tonight isn't its line check. */
export function lineDue(aircraft: Aircraft): boolean {
  return nightsSinceLine(aircraft) + 1 >= LINE_INTERVAL_NIGHTS;
}

/** Nights the plane can still go without a line check before one is due: 0 means tonight. */
export function lineNightsLeft(aircraft: Aircraft): number {
  return Math.max(0, LINE_INTERVAL_NIGHTS - 1 - nightsSinceLine(aircraft));
}

export function deferredItems(aircraft: Aircraft): number {
  return aircraft.deferredItems ?? 0;
}

/** The age a plane behaves as for breakdowns and mechanical delays: its own, plus its deferred items. */
export function wornAge(aircraft: Aircraft): number {
  return aircraft.ageYears + DEFERRED_AGE_YEARS * deferredItems(aircraft) + (dCheckOverdue(aircraft) ? D_WEAR_YEARS : 0) + toleranceWearYears(aircraft);
}

export function heavyCheckWorkMinutes(typeCode: string): number {
  return HEAVY_WORK_MINUTES[typeCode] ?? HEAVY_WORK_MINUTES.PROP;
}

/** Hangar minutes done toward the heavy check this time round. */
export function heavyBankedMinutes(aircraft: Aircraft): number {
  return aircraft.heavyBankedMinutes ?? 0;
}

/** Airborne hours flown since the last heavy check. Counted from when the clocks were added, so an older save starts at zero. */
export function flightHoursSinceHeavy(aircraft: Aircraft): number {
  return (aircraft.flightMinutesSinceHeavy ?? 0) / 60;
}

export function cyclesSinceHeavy(aircraft: Aircraft): number {
  return aircraft.cyclesSinceHeavy ?? 0;
}

export function maintenanceReserve(aircraft: Aircraft): number {
  return aircraft.maintenanceReserve ?? 0;
}

/**
 * A landed flight's maintenance slice, held back from today's cost and
 * cash and added to the plane's reserve. Returns the amount held back, so
 * the caller can take it out of what it just booked.
 */
export function accrueMaintenance(aircraft: Aircraft, blockNonFuel: number): number {
  const held = blockNonFuel * MAINTENANCE_SHARE_OF_NON_FUEL;
  aircraft.maintenanceReserve = maintenanceReserve(aircraft) + held;
  return held;
}

/** Pay what the plane has built up: at a heavy check, and when it goes back to the lessor. */
export function settleMaintenance(state: SimState, aircraft: Aircraft): void {
  const owed = maintenanceReserve(aircraft);
  if (owed > 0) {
    chargeMaintenance(state, owed);
    recordMaintenanceAccrual(state, -owed);
  }
  delete aircraft.maintenanceReserve;
}

/** One landed flight on the plane's clocks: its airborne minutes and one cycle. */
export function recordFlown(aircraft: Aircraft, airborneMinutes: number): void {
  aircraft.flightMinutesSinceA = flightMinutesSinceA(aircraft) + Math.max(0, airborneMinutes);
  aircraft.cyclesSinceA = (aircraft.cyclesSinceA ?? 0) + 1;
  aircraft.flightMinutesSinceHeavy = (aircraft.flightMinutesSinceHeavy ?? 0) + Math.max(0, airborneMinutes);
  aircraft.cyclesSinceHeavy = (aircraft.cyclesSinceHeavy ?? 0) + 1;
  aircraft.flightMinutesSinceD = (aircraft.flightMinutesSinceD ?? 0) + Math.max(0, airborneMinutes);
}

/**
 * Airborne minutes since the last A check. A plane from an older save, or one
 * just leased, starts part-way through the interval, staggered by its tail.
 */
export function flightMinutesSinceA(aircraft: Aircraft): number {
  if (aircraft.flightMinutesSinceA !== undefined) return aircraft.flightMinutesSinceA;
  let hash = 0;
  for (let i = 0; i < aircraft.tail.length; i++) hash = (hash * 17 + aircraft.tail.charCodeAt(i)) % 991;
  return (hash % A_INTERVAL_HOURS) * 60;
}

/** How far through its A interval the plane is: 1 is due, whichever of hours and cycles is further along. */
export function aCheckProgress(aircraft: Aircraft): number {
  return Math.max(flightMinutesSinceA(aircraft) / 60 / A_INTERVAL_HOURS, (aircraft.cyclesSinceA ?? 0) / A_INTERVAL_CYCLES);
}

export function aCheckWorkMinutes(typeCode: string): number {
  return A_WORK_MINUTES[typeCode] ?? A_WORK_MINUTES.PROP;
}

export function aBankedMinutes(aircraft: Aircraft): number {
  return aircraft.aBankedMinutes ?? 0;
}

/** Whether nights at a line base count toward the A check yet. */
export function aCheckOpen(aircraft: Aircraft): boolean {
  return aCheckProgress(aircraft) >= A_WINDOW;
}

export function aCheckOverdue(aircraft: Aircraft): boolean {
  return aCheckProgress(aircraft) >= A_OVERDUE;
}

/** An A check done: the interval starts again and the maintenance built up is paid. */
export function finishACheck(state: SimState, aircraft: Aircraft): void {
  settleMaintenance(state, aircraft);
  aircraft.flightMinutesSinceA = 0;
  aircraft.cyclesSinceA = 0;
  delete aircraft.aBankedMinutes;
}

/**
 * Flying days since the last D check. A plane just leased or from an older
 * save starts part-way through, staggered by tail but never within the
 * booking window, so no fleet comes due at once and no new game opens on one.
 */
export function daysSinceD(aircraft: Aircraft): number {
  if (aircraft.daysSinceD !== undefined) return aircraft.daysSinceD;
  let hash = 0;
  for (let i = 0; i < aircraft.tail.length; i++) hash = (hash * 13 + aircraft.tail.charCodeAt(i)) % 983;
  return (hash * 7) % (D_INTERVAL_DAYS - D_WINDOW_DAYS - 60);
}

export function flightHoursSinceD(aircraft: Aircraft): number {
  return (aircraft.flightMinutesSinceD ?? 0) / 60;
}

/** How far through its D interval, in days: flying days, or hours scaled to the same interval, whichever is further. */
export function dCheckProgressDays(aircraft: Aircraft): number {
  return Math.max(daysSinceD(aircraft), (flightHoursSinceD(aircraft) / D_INTERVAL_HOURS) * D_INTERVAL_DAYS);
}

/** Days until the D check is due: negative once overdue. */
export function dCheckDueIn(aircraft: Aircraft): number {
  return Math.round(D_INTERVAL_DAYS - dCheckProgressDays(aircraft));
}

export function dCheckOpen(aircraft: Aircraft): boolean {
  return dCheckDueIn(aircraft) <= D_WINDOW_DAYS;
}

export function dCheckOverdue(aircraft: Aircraft): boolean {
  return dCheckDueIn(aircraft) < 0;
}

export function dCheckDays(typeCode: string): number {
  return D_DAYS[typeCode] ?? D_DAYS.PROP;
}

/** Whether nights at base count toward the heavy check yet. */
export function heavyCheckOpen(aircraft: Aircraft): boolean {
  return heavyCheckDueIn(aircraft) <= HEAVY_WINDOW_DAYS;
}

/**
 * Flying days since its last heavy check. A plane from an older save, or
 * one just leased, starts part-way through its interval, staggered by its
 * tail, so a fleet doesn't all come due on the same day.
 */
export function daysSinceHeavyCheck(aircraft: Aircraft): number {
  if (aircraft.daysSinceHeavyCheck !== undefined) return aircraft.daysSinceHeavyCheck;
  let hash = 0;
  for (let i = 0; i < aircraft.tail.length; i++) hash = (hash * 31 + aircraft.tail.charCodeAt(i)) % 997;
  // Times 11, so neighbouring tails (C-P001, C-P002) land 11 days apart rather than one. Never inside two windows of due, so no new game opens on one.
  return (hash * 11) % (HEAVY_INTERVAL_DAYS - 2 * HEAVY_WINDOW_DAYS);
}

/**
 * How far through its heavy interval the plane is, in days: its flying days,
 * or its hours or cycles scaled to the same interval, whichever is furthest.
 */
export function heavyCheckProgressDays(aircraft: Aircraft): number {
  return Math.max(
    daysSinceHeavyCheck(aircraft),
    (flightHoursSinceHeavy(aircraft) / C_INTERVAL_HOURS) * HEAVY_INTERVAL_DAYS,
    (cyclesSinceHeavy(aircraft) / C_INTERVAL_CYCLES) * HEAVY_INTERVAL_DAYS,
  );
}

/** Days until the heavy check is due: negative once overdue. */
export function heavyCheckDueIn(aircraft: Aircraft): number {
  return Math.round(HEAVY_INTERVAL_DAYS - heavyCheckProgressDays(aircraft)) + (aircraft.heavyShiftDays ?? 0);
}

/**
 * Tolerance: a C check inside its window can be pushed later by 1, 5 or 15
 * days, for a fee, to spread out checks that fall together. It is a soft
 * gate, not free slack:
 * - each push on the same check costs 50% more than the one before;
 * - the most a check can be pushed is a base allowance, plus what the
 *   heavy maintenance director and the base's hangar bays add (`toleranceCapDays`);
 * - every day the check runs past its unpushed due date wears the plane like
 *   extra age (`toleranceWearYears`), so more breakdowns and delays until it
 *   goes in.
 */
export const TOLERANCE_STEPS = [1, 5, 15] as const;
export const TOLERANCE_BASE_CAP_DAYS = 10;
export const TOLERANCE_BAY_DAYS = 2;
export const TOLERANCE_MAX_CAP_DAYS = 20;
export const TOLERANCE_WEAR_YEARS_PER_DAY = 0.1;
export const TOLERANCE_ESCALATION = 0.5;
const TOLERANCE_COST_FACTOR: Record<number, number> = { 1: 0.5, 5: 2, 15: 5 };

/** The most this plane's C check can be pushed in all: base allowance, the Director's days and 2 a hangar bay at its base. */
export function toleranceCapDays(state: SimState, aircraft: Aircraft): number {
  const bays = aircraft.baseAirport ? heavyBays(state, aircraft.baseAirport) : 0;
  return Math.min(TOLERANCE_MAX_CAP_DAYS, TOLERANCE_BASE_CAP_DAYS + executiveToleranceExtraDays(state, aircraft.typeCode) + TOLERANCE_BAY_DAYS * bays);
}

/** Extra age a pushed plane wears while its check is past the date it would have fallen due. */
export function toleranceWearYears(aircraft: Aircraft): number {
  const shift = aircraft.heavyShiftDays ?? 0;
  if (shift === 0) return 0;
  const daysPastUnpushedDue = shift - heavyCheckDueIn(aircraft);
  return TOLERANCE_WEAR_YEARS_PER_DAY * Math.min(shift, Math.max(0, daysPastUnpushedDue));
}

/** What pushing this plane's C check later by `days` costs, dearer for each earlier push on it. */
export function heavyToleranceCost(state: SimState, aircraft: Aircraft, days: number): number {
  const escalation = 1 + TOLERANCE_ESCALATION * (aircraft.heavyPushes ?? 0);
  return Math.round(contractCost(heavyCheckWorkMinutes(aircraft.typeCode)) * (TOLERANCE_COST_FACTOR[days] ?? 0) * escalation * executiveToleranceMultiplier(state, aircraft.typeCode));
}

export function heavyShiftOf(aircraft: Aircraft): number {
  return aircraft.heavyShiftDays ?? 0;
}

/** Why a plane's C check can't be pushed by `days` now, or null when it can. */
export function heavyToleranceBlocker(state: SimState, aircraft: Aircraft, days: number): string | null {
  if (!heavyCheckOpen(aircraft)) return `Opens ${HEAVY_WINDOW_DAYS}d before due`;
  if (state.aogs.some((event) => event.tail === aircraft.tail) || aircraft.heavyCheckBooked) return 'Grounded or booked already';
  const cap = toleranceCapDays(state, aircraft);
  if ((aircraft.heavyShiftDays ?? 0) + days > cap) return `Cap ${cap}d · more with a Director or hangar bays`;
  const cost = heavyToleranceCost(state, aircraft, days);
  if (state.cash < cost) return `Needs $${cost.toLocaleString()} on hand`;
  return null;
}

/** Push the C check later by `days`, paying the fee. Returns the fee, or null when it isn't allowed. */
export function applyHeavyTolerance(state: SimState, aircraft: Aircraft, days: number): number | null {
  if (!TOLERANCE_STEPS.includes(days as 1 | 5 | 15) || heavyToleranceBlocker(state, aircraft, days)) return null;
  const cost = heavyToleranceCost(state, aircraft, days);
  chargeMaintenance(state, cost);
  aircraft.heavyShiftDays = (aircraft.heavyShiftDays ?? 0) + days;
  aircraft.heavyPushes = (aircraft.heavyPushes ?? 0) + 1;
  return cost;
}

/** The night just ended, judged at midnight: whether the plane got its check. */
/**
 * A plane's first flying night: its hour and cycle clocks start as far
 * through their intervals as its staggered day clocks. Without this every
 * plane leased together runs on hours from zero, and the hours clock, not
 * the stagger, decides when the fleet comes due: all at once.
 */
function staggerUsageClocks(aircraft: Aircraft): void {
  const cShare = daysSinceHeavyCheck(aircraft) / HEAVY_INTERVAL_DAYS;
  aircraft.flightMinutesSinceHeavy = (aircraft.flightMinutesSinceHeavy ?? 0) + Math.round(cShare * C_INTERVAL_HOURS * 60);
  aircraft.cyclesSinceHeavy = (aircraft.cyclesSinceHeavy ?? 0) + Math.round(cShare * C_INTERVAL_CYCLES);
  if (aircraft.daysSinceD === undefined) {
    const dShare = daysSinceD(aircraft) / D_INTERVAL_DAYS;
    aircraft.flightMinutesSinceD = (aircraft.flightMinutesSinceD ?? 0) + Math.round(dShare * D_INTERVAL_HOURS * 60);
  }
}

/** Checked, checked with an item cleared, too short to check, not due and not checked, or due and not checked. */
export type NightResult = 'checked' | 'cleared' | 'short' | 'free' | 'away';

/**
 * Tonight's line check, at the midnight rollover (sim/step.ts), for every
 * plane that flies: away, short, checked, or checked with time to clear an
 * item. Planes on an AOG, a refit, a heavy check or a ferry to a new base
 * are in the hangar or in transit, and skip it. Also counts a flying day
 * toward the heavy check, and forces an overdue one.
 */
/**
 * Where and when a plane's night starts, judged at the rollover: parked,
 * since it landed; or still in the air on a flight that lands before
 * `releaseBy` (a day that ends just after midnight), from that landing.
 * Null when it is still flying at release time: no night at all.
 */
export function nightStart(state: SimState, aircraft: Aircraft, releaseBy: number): { station: string; since: number } | null {
  if (aircraft.status === 'ground') return aircraft.atAirport ? { station: aircraft.atAirport, since: aircraft.groundSinceMinute } : null;
  const flight = state.activeFlights.find((f) => f.tail === aircraft.tail);
  return flight && flight.arriveMinute < releaseBy ? { station: flight.dest, since: flight.arriveMinute } : null;
}

export function rollNightlyChecks(state: SimState, dayStartMinute: number): void {
  const results: Record<string, NightResult> = {};
  const checked: { aircraft: Aircraft; station: string | null; since: number }[] = [];
  for (const aircraft of state.aircraft) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    if (aircraft.rebase || state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    if (legs.length === 0) {
      // A day on the ground at a line base is its line check and clears an item: the work is done in daylight.
      if (aircraft.status === 'ground' && lineRated(state, aircraft.atAirport ?? '', aircraft.typeCode)) {
        aircraft.nightsSinceLine = 0;
        if (deferredItems(aircraft) > 0) aircraft.deferredItems = deferredItems(aircraft) - 1;
        if (aircraft.deferredItems === 0) delete aircraft.deferredItems;
      }
      continue;
    }
    if (aircraft.daysSinceHeavyCheck === undefined) staggerUsageClocks(aircraft);
    aircraft.daysSinceHeavyCheck = daysSinceHeavyCheck(aircraft) + 1;
    aircraft.daysSinceD = daysSinceD(aircraft) + 1;
    const firstDeparture = dayStartMinute + Math.min(...legs.map((leg) => leg.departMinute));
    const start = nightStart(state, aircraft, firstDeparture - RELEASE_MINUTES);
    checked.push({ aircraft, station: start?.station ?? null, since: start?.since ?? 0 });
  }
  const sleepers = checked.flatMap((entry) => (entry.station ? [{ aircraft: entry.aircraft, station: entry.station }] : []));
  const inHouse = lineCheckedTails(state, sleepers);

  for (const { aircraft, station, since } of checked) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    let result: NightResult;
    const firstDeparture = dayStartMinute + Math.min(...legs.map((leg) => leg.departMinute));
    const night = firstDeparture - RELEASE_MINUTES - since;
    const work = lineCheckMinutes(aircraft);
    const checkedHere = station !== null && inHouse.has(aircraft.tail);
    if (checkedHere) result = night < work ? 'short' : night >= work + CLEAR_SPARE_MINUTES && deferredItems(aircraft) > 0 ? 'cleared' : 'checked';
    else result = lineDue(aircraft) ? 'away' : 'free';
    aircraft.nightsSinceLine = result === 'checked' || result === 'cleared' ? 0 : nightsSinceLine(aircraft) + 1;
    // What a night at a rated line base has left after any line check goes to the A check once it's open. The C check never banks nights: it is one stretch out of service.
    const atLineBase = station !== null && lineRated(state, station, aircraft.typeCode);
    const spare = atLineBase ? Math.round(night - (checkedHere && result !== 'short' ? work : 0)) : 0;
    if (spare > 0 && aCheckOpen(aircraft)) {
      const used = Math.min(spare, aCheckWorkMinutes(aircraft.typeCode) - aBankedMinutes(aircraft));
      aircraft.aBankedMinutes = aBankedMinutes(aircraft) + used;
      if (aBankedMinutes(aircraft) >= aCheckWorkMinutes(aircraft.typeCode)) finishACheck(state, aircraft);
    }
    // A due check missed or cut short, or an A check long overdue, leaves an item for tomorrow.
    const missed = result === 'away' || (result === 'short' && nightsSinceLine(aircraft) >= LINE_INTERVAL_NIGHTS);
    if (missed || aCheckOverdue(aircraft)) aircraft.deferredItems = deferredItems(aircraft) + 1;
    if (result === 'cleared') {
      // A heavy check finished tonight has already cleared them all.
      aircraft.deferredItems = Math.max(0, deferredItems(aircraft) - 1);
      if (aircraft.deferredItems === 0) delete aircraft.deferredItems;
    }
    results[aircraft.tail] = result;
  }
  state.lastNightChecks = results;
}

/**
 * Wear levelling, each morning before the night's checks are judged: a
 * plane whose night would be too short for its line check, or that carries
 * more deferred items than an idle twin, hands its whole day to that twin
 * (same type and base, parked at the same airport with nothing to fly and
 * a long enough night of its own). The worn plane rests the day, and the
 * day goes back at the next rollover like a swap (sim/controller.ts), so a
 * plane flying a day too long for its nights alternates with its spare
 * instead of piling up items. Free: it's planned overnight.
 */
export function levelWear(state: SimState, dayStart: number): void {
  const busy = new Set(state.schedule.map((leg) => leg.tail));
  const unavailable = (aircraft: Aircraft) =>
    aircraft.status !== 'ground' ||
    !!aircraft.rebase ||
    state.aogs.some((event) => event.tail === aircraft.tail) ||
    state.groundedTails.includes(aircraft.tail) ||
    nightStopStation(state, aircraft.tail) !== null;
  const used = new Set<string>();
  for (const worn of state.aircraft) {
    const legs = state.schedule.filter((leg) => leg.tail === worn.tail);
    if (legs.length === 0 || used.has(worn.tail) || worn.lineLocked) continue;
    if (worn.rebase || state.aogs.some((event) => event.tail === worn.tail) || state.groundedTails.includes(worn.tail)) continue;
    const firstLeg = legs.reduce((first, leg) => (leg.departMinute < first.departMinute ? leg : first));
    const releaseBy = dayStart + firstLeg.departMinute - RELEASE_MINUTES;
    // Parked at base, or landing there before the day starts.
    const wornNight = nightStart(state, worn, releaseBy);
    if (!wornNight || wornNight.station !== firstLeg.origin || worn.baseAirport !== firstLeg.origin) continue;
    const work = lineCheckMinutes(worn);
    const nightFor = (aircraft: Aircraft) => releaseBy - aircraft.groundSinceMinute;
    const wornShort = lineDue(worn) && releaseBy - wornNight.since < work;
    const twin = state.aircraft.find(
      (other) =>
        other.tail !== worn.tail &&
        !other.lineLocked &&
        !busy.has(other.tail) &&
        !used.has(other.tail) &&
        other.typeCode === worn.typeCode &&
        other.baseAirport === worn.baseAirport &&
        other.atAirport === firstLeg.origin &&
        !unavailable(other) &&
        nightFor(other) >= work &&
        (wornShort ? deferredItems(other) <= deferredItems(worn) : deferredItems(other) < deferredItems(worn)),
    );
    if (!twin) continue;
    const swapped = (state.swappedToday ??= []);
    for (const leg of legs) {
      if (!swapped.some((entry) => entry.legId === leg.legId)) swapped.push({ legId: leg.legId, fromTail: leg.tail });
      leg.tail = twin.tail;
    }
    used.add(worn.tail);
    used.add(twin.tail);
  }
}

/**
 * Of the planes sleeping at stations, the tails whose night is a line
 * check: at a line base rated for their class, up to its level, the
 * longest since a check first (then the most deferred items).
 */
export function lineCheckedTails(state: SimState, sleepers: { aircraft: Aircraft; station: string }[]): Set<string> {
  const done = new Set<string>();
  const byStation = new Map<string, Aircraft[]>();
  for (const { aircraft, station } of sleepers) {
    if (!lineRated(state, station, aircraft.typeCode)) continue;
    byStation.set(station, [...(byStation.get(station) ?? []), aircraft]);
  }
  for (const [station, planes] of byStation) {
    planes.sort((a, b) => nightsSinceLine(b) - nightsSinceLine(a) || deferredItems(b) - deferredItems(a) || a.tail.localeCompare(b.tail));
    for (const plane of planes.slice(0, lineCapacity(state, station))) done.add(plane.tail);
  }
  return done;
}

/** Maintenance spending outside the flights: contracted checks. */
export function chargeMaintenance(state: SimState, cost: number): void {
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.maintenance += cost;
  state.todayMargin -= cost;
}

/**
 * Planes held this morning for their deferred items: the legs of each
 * one's first rotation, to cancel ("MX hold"), its items cleared. Held
 * where it slept, with the work contracted away from a maintenance base
 * (a line check's worth for each item). A plane in the air overnight
 * can't be held, and keeps flying.
 */
export function morningHolds(state: SimState): { tail: string; legIds: string[] }[] {
  const holds: { tail: string; legIds: string[] }[] = [];
  for (const aircraft of state.aircraft) {
    if (deferredItems(aircraft) < MX_HOLD_AT) continue;
    if (state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    const first = rotationsForTail(state, aircraft.tail)[0];
    if (!first) continue;
    // Still in the air, it is held once it lands, if that's before the rotation's first departure.
    const start = nightStart(state, aircraft, dayStartMinute(state) + first.legs[0].departMinute);
    if (!start || start.station !== first.legs[0].origin) continue;
    holds.push({ tail: aircraft.tail, legIds: first.legs.map((leg) => leg.legId) });
    if (!lineRated(state, start.station, aircraft.typeCode)) chargeMaintenance(state, contractCost(lineCheckMinutes(aircraft) * deferredItems(aircraft)));
    delete aircraft.deferredItems;
  }
  return holds;
}

/**
 * Heavy checks overdue past the grace, from sim/aog.ts's morning pass:
 * each plane at base is grounded for the work it has left, in whole days.
 * Done in house at a hangar rated for the class; elsewhere the work is
 * contracted, paid here.
 */
export function forcedHeavyChecks(state: SimState, claimed: BayClaims = new Map()): { aircraft: Aircraft; days: number }[] {
  return groundForHeavyCheck(state, state.aircraft.filter((aircraft) => heavyCheckDueIn(aircraft) <= -OVERDUE_GRACE_DAYS), claimed);
}

/** Bays taken so far this morning by checks starting, by station. */
export type BayClaims = Map<string, number>;

/** A C or D check, or a refit done in house, holds a bay until the plane is back. */
export function holdsBay(event: { check?: boolean; inBay?: boolean }): boolean {
  return event.check === true || event.inBay === true;
}

/** Bays at a hangar not held by a plane in a C or D check or a refit. */
export function freeHeavyBays(state: SimState, station: string, claimed: BayClaims = new Map()): number {
  const inCheck = state.aogs.filter((event) => holdsBay(event) && event.base === station).length;
  return Math.max(0, heavyBays(state, station) - inCheck - (claimed.get(station) ?? 0));
}

/**
 * Whether a check starting at a station is done in house: a hangar rated
 * for the class with a bay free. Otherwise it's contracted out and paid by
 * the hour, so a fleet whose checks all fall due together pays for the
 * bays it didn't stagger around. Takes the bay when it returns true.
 */
function takesBay(state: SimState, station: string, typeCode: string, claimed: BayClaims): boolean {
  if (!heavyRated(state, station, typeCode) || freeHeavyBays(state, station, claimed) === 0) return false;
  claimed.set(station, (claimed.get(station) ?? 0) + 1);
  return true;
}

/**
 * Checks the player booked (bookHeavyCheck): the same grounding as a forced
 * one, taken the next morning. A booked plane that isn't at its base or
 * night stop that morning stays booked until it is. Planes in `skip` (already
 * forced this morning) are left alone.
 */
export function bookedHeavyChecks(state: SimState, skip: Aircraft[], claimed: BayClaims = new Map()): { aircraft: Aircraft; days: number }[] {
  const booked = groundForHeavyCheck(state, state.aircraft.filter((aircraft) => aircraft.heavyCheckBooked && !skip.includes(aircraft)), claimed);
  for (const { aircraft } of booked) delete aircraft.heavyCheckBooked;
  return booked;
}

function groundForHeavyCheck(state: SimState, candidates: Aircraft[], claimed: BayClaims): { aircraft: Aircraft; days: number }[] {
  const grounded = candidates
    // At its base, or where it sleeps on a night stop (sim/nightStops.ts).
    .filter((aircraft) => aircraft.status === 'ground' && (aircraft.atAirport === aircraft.baseAirport || aircraft.atAirport === nightStopStation(state, aircraft.tail)) && !aircraft.rebase)
    .filter((aircraft) => !state.aogs.some((event) => event.tail === aircraft.tail));
  return grounded.map((aircraft) => {
    const workLeft = heavyCheckWorkMinutes(aircraft.typeCode) - heavyBankedMinutes(aircraft);
    if (!takesBay(state, aircraft.atAirport ?? '', aircraft.typeCode, claimed)) chargeMaintenance(state, contractCost(workLeft));
    return { aircraft, days: Math.max(1, Math.ceil(workLeft / MINUTES_PER_DAY)) };
  });
}

/** What booking a plane's C check now would do: days grounded, contract cost (0 in house) and rotations it takes off the plane. Null when it can't be booked. */
export function previewHeavyCheckBooking(state: SimState, tail: string): { days: number; cost: number; rotations: number } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || !canBookHeavyCheck(state, aircraft)) return null;
  const workLeft = heavyCheckWorkMinutes(aircraft.typeCode) - heavyBankedMinutes(aircraft);
  return {
    days: Math.max(1, Math.ceil(workLeft / MINUTES_PER_DAY)),
    cost: heavyRated(state, aircraft.atAirport ?? '', aircraft.typeCode) && freeHeavyBays(state, aircraft.atAirport ?? '') > 0 ? 0 : contractCost(workLeft),
    rotations: rotationsForTail(state, tail).length,
  };
}

/** Bookable: parked at its base, C check inside its window, not already booked, in check or rebasing. */
export function canBookHeavyCheck(state: SimState, aircraft: Aircraft): boolean {
  return (
    !aircraft.heavyCheckBooked &&
    !aircraft.dCheckBooked &&
    heavyCheckOpen(aircraft) &&
    aircraft.status === 'ground' &&
    aircraft.atAirport === aircraft.baseAirport &&
    !aircraft.rebase &&
    !state.aogs.some((event) => event.tail === aircraft.tail)
  );
}

/** Why an open C check can't be booked right now, or null when it can (or isn't open). */
export function heavyBookBlocker(state: SimState, aircraft: Aircraft): string | null {
  if (!heavyCheckOpen(aircraft) || aircraft.heavyCheckBooked || aircraft.dCheckBooked || canBookHeavyCheck(state, aircraft)) return null;
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return 'Grounded already';
  if (aircraft.rebase) return 'Rebasing';
  if (aircraft.status !== 'ground') return `In the air · books once parked at ${aircraft.baseAirport}`;
  return `At ${aircraft.atAirport} · books once parked at ${aircraft.baseAirport}`;
}

/** A heavy check done: the interval starts again, every deferred item is cleared and the maintenance reserve is paid. */
export function finishHeavyCheck(state: SimState, aircraft: Aircraft): void {
  settleMaintenance(state, aircraft);
  aircraft.daysSinceHeavyCheck = 0;
  delete aircraft.deferredItems;
  delete aircraft.heavyCheckBooked;
  delete aircraft.heavyShiftDays;
  delete aircraft.heavyPushes;
  delete aircraft.heavyBankedMinutes;
  delete aircraft.flightMinutesSinceHeavy;
  delete aircraft.cyclesSinceHeavy;
}

/**
 * Tonight's line check, as it's shaping up: the plane's projected last
 * landing (sim/cascade.ts, so a day running late shows tonight getting
 * shorter before it happens) against tomorrow's first departure, less
 * RELEASE_MINUTES, and the work it needs, and where its day ends: checked
 * at a line base with room and the class rated, not due so free, or due
 * and missed (away). Null for a plane with nothing to fly.
 */
/**
 * The plane's flying tomorrow, earliest first: its legs today, with any
 * line slip's hand-over (sim/lineSlips.ts) already made, since that
 * flying changes plane at the rollover.
 */
export function tomorrowsLegs(state: SimState, tail: string): ScheduleLeg[] {
  const handOver = new Map((state.lineSlipsToday ?? []).flatMap((slip) => slip.handOver.map((entry) => [entry.legId, entry.toTail] as const)));
  return state.schedule.filter((leg) => (handOver.get(leg.legId) ?? leg.tail) === tail).sort((a, b) => a.departMinute - b.departMinute);
}

export function tonightCheck(
  state: SimState,
  tail: string,
): { night: number; work: number; station: string; inHouse: boolean; away: boolean; due: boolean; nightsLeft: number; short: boolean; banking: 'A' | null } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (!aircraft || legs.length === 0) return null;
  const dayStart = dayStartMinute(state);
  const last = legs[legs.length - 1];
  const projected = projectRestOfDay(state, tail).filter((p) => !p.cancelled);
  const landing = projected.length > 0 ? projected[projected.length - 1].projectedArriveMinute : Math.max(dayStart + last.departMinute + last.blockMinutes, aircraft.status === 'ground' && legs.every((leg) => state.completedToday.includes(leg.legId) || state.cancelledToday.includes(leg.legId)) ? aircraft.groundSinceMinute : 0);
  // Tomorrow's first flight, on the line the plane keeps after any slip today (sim/lineSlips.ts).
  const tomorrow = tomorrowsLegs(state, tail);
  const night = dayStart + MINUTES_PER_DAY + (tomorrow[0] ?? legs[0]).departMinute - RELEASE_MINUTES - landing;
  const work = lineCheckMinutes(aircraft);
  const station = last.dest;
  // Who else ends the day at this station decides whether the line base has room.
  const sleepers = state.aircraft.flatMap((other) => {
    const otherLegs = state.schedule.filter((leg) => leg.tail === other.tail).sort((a, b) => a.departMinute - b.departMinute);
    return otherLegs.length > 0 && otherLegs[otherLegs.length - 1].dest === station ? [{ aircraft: other, station }] : [];
  });
  const inHouse = lineCheckedTails(state, sleepers).has(tail);
  const due = lineDue(aircraft);
  const away = !inHouse && due;
  const short = inHouse && night < work;
  // Whether the night's spare hours at a rated line base go to an A check, as rollNightlyChecks() will do.
  const spare = night - (inHouse && !short ? work : 0);
  const banking = lineRated(state, station, aircraft.typeCode) && spare > 0 && aCheckOpen(aircraft) ? ('A' as const) : null;
  return { night, work, station, inHouse, away, due, nightsLeft: lineNightsLeft(aircraft), short, banking };
}

/** Bookable: parked at its base, D check inside its window, and no other check booked, running or rebasing. */
export function canBookDCheck(state: SimState, aircraft: Aircraft): boolean {
  return (
    !aircraft.dCheckBooked &&
    !aircraft.heavyCheckBooked &&
    dCheckOpen(aircraft) &&
    aircraft.status === 'ground' &&
    aircraft.atAirport === aircraft.baseAirport &&
    !aircraft.rebase &&
    !state.aogs.some((event) => event.tail === aircraft.tail)
  );
}

/** Why an open D check can't be booked right now, or null when it can (or is booked already or not open). */
export function dBookBlocker(state: SimState, aircraft: Aircraft): string | null {
  if (!dCheckOpen(aircraft) || aircraft.dCheckBooked || canBookDCheck(state, aircraft)) return null;
  if (aircraft.heavyCheckBooked) return 'C check booked · cancel it first';
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return 'Grounded already';
  if (aircraft.rebase) return 'Rebasing';
  if (aircraft.status !== 'ground') return `In the air · books once parked at ${aircraft.baseAirport}`;
  return `At ${aircraft.atAirport} · books once parked at ${aircraft.baseAirport}`;
}

/** What booking a plane's D check now would do: days grounded, contract cost (0 in house) and rotations it takes off the plane. Null when it can't be booked. */
export function previewDCheckBooking(state: SimState, tail: string): { days: number; cost: number; rotations: number } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || !canBookDCheck(state, aircraft)) return null;
  return {
    days: dCheckDays(aircraft.typeCode),
    cost: heavyRated(state, aircraft.atAirport ?? '', aircraft.typeCode) && freeHeavyBays(state, aircraft.atAirport ?? '') > 0 ? 0 : dCheckContractCost(aircraft.typeCode),
    rotations: rotationsForTail(state, tail).length,
  };
}

function dCheckContractCost(typeCode: string): number {
  return contractCost((D_WORK_HOURS[typeCode] ?? D_WORK_HOURS.PROP) * 60);
}

/**
 * D checks the player booked: grounded the next morning for the whole
 * overhaul, the same way a C check is. A booked plane that isn't at its base
 * that morning stays booked until it is. Planes in `skip` (already starting a
 * C check) wait.
 */
export function bookedDChecks(state: SimState, skip: Aircraft[], claimed: BayClaims = new Map()): { aircraft: Aircraft; days: number }[] {
  const going = state.aircraft
    .filter((aircraft) => aircraft.dCheckBooked && !skip.includes(aircraft))
    .filter((aircraft) => aircraft.status === 'ground' && (aircraft.atAirport === aircraft.baseAirport || aircraft.atAirport === nightStopStation(state, aircraft.tail)) && !aircraft.rebase)
    .filter((aircraft) => !state.aogs.some((event) => event.tail === aircraft.tail));
  return going.map((aircraft) => {
    delete aircraft.dCheckBooked;
    if (!takesBay(state, aircraft.atAirport ?? '', aircraft.typeCode, claimed)) chargeMaintenance(state, dCheckContractCost(aircraft.typeCode));
    return { aircraft, days: dCheckDays(aircraft.typeCode) };
  });
}

/** A D check done: the overhaul clock starts again, and the C and A checks are done with it. */
export function finishDCheck(state: SimState, aircraft: Aircraft): void {
  finishHeavyCheck(state, aircraft);
  aircraft.flightMinutesSinceA = 0;
  aircraft.cyclesSinceA = 0;
  delete aircraft.aBankedMinutes;
  aircraft.daysSinceD = 0;
  delete aircraft.flightMinutesSinceD;
  delete aircraft.dCheckBooked;
}
