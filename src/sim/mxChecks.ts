import { contractCost, heavyBays, heavyRated, lineCapacity, lineRated, outstationCheck } from './bases';
import { dayStartMinute } from './clock';
import { nightStopStation } from './nightStops';
import { projectRestOfDay } from './cascade';
import { rotationsForTail } from './utilisation';
import type { Aircraft, SimState } from './state';

/**
 * Maintenance checks (WEEK-FOURTEEN.md, stage 4).
 *
 * **The line check is a night at a maintenance base** (sim/bases.ts).
 * Every night a plane that flew needs LINE_CHECK_MINUTES of hangar work,
 * more for every cycle (takeoff and landing) it flies a day. Its night
 * runs from its landing to RELEASE_MINUTES before its first departure. A
 * night with CLEAR_SPARE_MINUTES to spare after the work clears an item.
 * Sleeping anywhere else, the night is a **contracted check**, paid by the
 * hour of work, or no check, by the station's setting. A plane with no
 * check (deferred, or in the air overnight), or one whose night is shorter
 * than the work, carries a **deferred item** to tomorrow.
 *
 * **Deferred items wear the plane.** Each counts as DEFERRED_AGE_YEARS more
 * age for breakdowns and mechanical delays (sim/aog.ts, sim/delays.ts), so
 * a plane worked through its nights breaks down more. At MX_HOLD_AT the
 * plane is held where it is the next morning: its first rotation is
 * cancelled ("MX hold") while the items are cleared, by contract away
 * from a maintenance base.
 *
 * **The heavy check** is HEAVY_WORK_MINUTES of hangar work every
 * HEAVY_INTERVAL_DAYS days the plane flies, done at night: from
 * HEAVY_WINDOW_DAYS before it's due, whatever each night at a maintenance
 * base has left after the line check goes toward it. Done, it clears every
 * deferred item. A plane with long nights finishes it in two or three
 * without missing a flight; one flown hard from first light to curfew
 * makes slow progress; nights elsewhere make none. Only a plane
 * OVERDUE_GRACE_DAYS past due is grounded for it, as an AOG (sim/aog.ts),
 * at its base, until the work left is done, by contract if its base has
 * no maintenance. So the lever is the shape of the plane's day and where
 * it sleeps, not a date.
 */

/** Hangar minutes a night, by class: a base, and more per cycle flown. */
const LINE_CHECK_MINUTES: Record<string, { base: number; perCycle: number }> = {
  PROP: { base: 120, perCycle: 24 },
  REGIONAL: { base: 150, perCycle: 24 },
  NARROWBODY: { base: 180, perCycle: 30 },
  WIDEBODY: { base: 240, perCycle: 36 },
};
/** A plane is handed back from the hangar this long before its first departure. */
export const RELEASE_MINUTES = 60;
/** Spare hangar time beyond the night's work that clears one deferred item. */
const CLEAR_SPARE_MINUTES = 120;
/** Each deferred item counts as this much more age for breakdowns and mechanical delays. */
export const DEFERRED_AGE_YEARS = 3;
/** Deferred items at which the plane is held at base for a morning. */
export const MX_HOLD_AT = 3;
export const HEAVY_INTERVAL_DAYS = 30;
/**
 * The heavy check is the C check. It is due after HEAVY_INTERVAL_DAYS flying
 * days, C_INTERVAL_HOURS airborne or C_INTERVAL_CYCLES landed, whichever
 * comes first, so a plane flown hard comes due sooner than one flown lightly.
 */
export const C_INTERVAL_HOURS = 300;
export const C_INTERVAL_CYCLES = 250;
/** The heavy check's work starts being done this many days before it's due. */
export const HEAVY_WINDOW_DAYS = 10;
export const OVERDUE_GRACE_DAYS = 7;
/** Hangar minutes a heavy check takes, by class. */
const HEAVY_WORK_MINUTES: Record<string, number> = { PROP: 480, REGIONAL: 600, NARROWBODY: 720, WIDEBODY: 960 };

/**
 * The share of a flight's non-fuel block-hour cost that is maintenance.
 * It is held back from the flight and paid when the plane's heavy check is
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

const MINUTES_PER_DAY = 1440;

export function lineCheckMinutes(state: SimState, aircraft: Aircraft): number {
  const spec = LINE_CHECK_MINUTES[aircraft.typeCode] ?? LINE_CHECK_MINUTES.PROP;
  const cycles = state.schedule.filter((leg) => leg.tail === aircraft.tail).length;
  return spec.base + spec.perCycle * cycles;
}

export function deferredItems(aircraft: Aircraft): number {
  return aircraft.deferredItems ?? 0;
}

/** The age a plane behaves as for breakdowns and mechanical delays: its own, plus its deferred items. */
export function wornAge(aircraft: Aircraft): number {
  return aircraft.ageYears + DEFERRED_AGE_YEARS * deferredItems(aircraft);
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
  if (owed > 0) chargeMaintenance(state, owed);
  delete aircraft.maintenanceReserve;
}

/** One landed flight on the plane's clocks: its airborne minutes and one cycle. */
export function recordFlown(aircraft: Aircraft, airborneMinutes: number): void {
  aircraft.flightMinutesSinceA = flightMinutesSinceA(aircraft) + Math.max(0, airborneMinutes);
  aircraft.cyclesSinceA = (aircraft.cyclesSinceA ?? 0) + 1;
  aircraft.flightMinutesSinceHeavy = (aircraft.flightMinutesSinceHeavy ?? 0) + Math.max(0, airborneMinutes);
  aircraft.cyclesSinceHeavy = (aircraft.cyclesSinceHeavy ?? 0) + 1;
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
  // Times 11, so neighbouring tails (C-P001, C-P002) land 11 days apart rather than one.
  return (hash * 11) % HEAVY_INTERVAL_DAYS;
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
  return Math.round(HEAVY_INTERVAL_DAYS - heavyCheckProgressDays(aircraft));
}

/** The night just ended, judged at midnight: whether the plane got its check. */
export type NightResult = 'checked' | 'cleared' | 'short' | 'contracted' | 'away';

/**
 * Tonight's line check, at the midnight rollover (sim/step.ts), for every
 * plane that flies: away, short, checked, or checked with time to clear an
 * item. Planes on an AOG, a refit, a heavy check or a ferry to a new base
 * are in the hangar or in transit, and skip it. Also counts a flying day
 * toward the heavy check, and forces an overdue one.
 */
export function rollNightlyChecks(state: SimState, dayStartMinute: number): void {
  const results: Record<string, NightResult> = {};
  const checked: { aircraft: Aircraft; station: string | null }[] = [];
  for (const aircraft of state.aircraft) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    if (legs.length === 0 || aircraft.rebase) continue;
    if (state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    aircraft.daysSinceHeavyCheck = daysSinceHeavyCheck(aircraft) + 1;
    checked.push({ aircraft, station: aircraft.status === 'ground' ? aircraft.atAirport : null });
  }
  const sleepers = checked.flatMap((entry) => (entry.station ? [{ aircraft: entry.aircraft, station: entry.station }] : []));
  const inHouse = lineCheckedTails(state, sleepers);
  const bays = heavyBayTails(state, sleepers);

  for (const { aircraft, station } of checked) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    let result: NightResult;
    const firstDeparture = dayStartMinute + Math.min(...legs.map((leg) => leg.departMinute));
    const night = firstDeparture - RELEASE_MINUTES - aircraft.groundSinceMinute;
    const work = lineCheckMinutes(state, aircraft);
    if (!station || (!inHouse.has(aircraft.tail) && outstationCheck(state, station) === 'defer')) {
      result = 'away';
    } else if (!inHouse.has(aircraft.tail)) {
      // Contracted at the station: paid for the work, however the night turns out.
      result = night < work ? 'short' : 'contracted';
      chargeMaintenance(state, contractCost(work));
    } else {
      result = night < work ? 'short' : night >= work + CLEAR_SPARE_MINUTES && deferredItems(aircraft) > 0 ? 'cleared' : 'checked';
    }
    // What the night has left after the line check goes to the A check first, once it's open (contracted where there's no line base), then toward the heavy check in a hangar bay.
    let spare = night > work ? Math.round(night - work) : 0;
    if (station && result !== 'away' && spare > 0 && aCheckOpen(aircraft)) {
      const used = Math.min(spare, aCheckWorkMinutes(aircraft.typeCode) - aBankedMinutes(aircraft));
      if (!inHouse.has(aircraft.tail)) chargeMaintenance(state, contractCost(used));
      aircraft.aBankedMinutes = aBankedMinutes(aircraft) + used;
      spare -= used;
      if (aBankedMinutes(aircraft) >= aCheckWorkMinutes(aircraft.typeCode)) finishACheck(state, aircraft);
    }
    if (station && result !== 'away' && bays.has(aircraft.tail) && spare > 0) {
      aircraft.heavyBankedMinutes = heavyBankedMinutes(aircraft) + spare;
      if (heavyBankedMinutes(aircraft) >= heavyCheckWorkMinutes(aircraft.typeCode)) finishHeavyCheck(state, aircraft);
    }
    // A night away or too short, or an A check long overdue, leaves an item for tomorrow.
    if (result === 'away' || result === 'short' || aCheckOverdue(aircraft)) aircraft.deferredItems = deferredItems(aircraft) + 1;
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
 * Of the planes sleeping at stations, the tails whose night is a line
 * check in house: at a line base rated for their class, the ones with the
 * most deferred items first, up to the base's level.
 */
export function lineCheckedTails(state: SimState, sleepers: { aircraft: Aircraft; station: string }[]): Set<string> {
  const done = new Set<string>();
  const byStation = new Map<string, Aircraft[]>();
  for (const { aircraft, station } of sleepers) {
    if (!lineRated(state, station, aircraft.typeCode)) continue;
    byStation.set(station, [...(byStation.get(station) ?? []), aircraft]);
  }
  for (const [station, planes] of byStation) {
    planes.sort((a, b) => deferredItems(b) - deferredItems(a) || a.tail.localeCompare(b.tail));
    for (const plane of planes.slice(0, lineCapacity(state, station))) done.add(plane.tail);
  }
  return done;
}

/**
 * The planes holding a hangar bay: at a hangar rated for their class, with
 * the heavy check open, the closest to due first, up to the bays left
 * after planes in a forced check there.
 */
export function heavyBayTails(state: SimState, sleepers: { aircraft: Aircraft; station: string }[]): Set<string> {
  const held = new Set<string>();
  const byStation = new Map<string, Aircraft[]>();
  for (const { aircraft, station } of sleepers) {
    if (!heavyRated(state, station, aircraft.typeCode) || !heavyCheckOpen(aircraft)) continue;
    byStation.set(station, [...(byStation.get(station) ?? []), aircraft]);
  }
  for (const [station, planes] of byStation) {
    const inForcedCheck = state.aogs.filter((event) => event.check && event.base === station).length;
    planes.sort((a, b) => heavyCheckDueIn(a) - heavyCheckDueIn(b) || a.tail.localeCompare(b.tail));
    for (const plane of planes.slice(0, Math.max(0, heavyBays(state, station) - inForcedCheck))) held.add(plane.tail);
  }
  return held;
}

/** The planes asleep at each station tonight, as they stand now: grounded planes where they are. */
export function sleepersNow(state: SimState): { aircraft: Aircraft; station: string }[] {
  return state.aircraft.flatMap((aircraft) => (aircraft.status === 'ground' && aircraft.atAirport ? [{ aircraft, station: aircraft.atAirport }] : []));
}

/** Maintenance spending outside the flights: contracted checks. */
function chargeMaintenance(state: SimState, cost: number): void {
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
    if (deferredItems(aircraft) < MX_HOLD_AT || aircraft.status !== 'ground') continue;
    if (state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    const first = rotationsForTail(state, aircraft.tail)[0];
    if (!first) continue;
    holds.push({ tail: aircraft.tail, legIds: first.legs.map((leg) => leg.legId) });
    if (!lineRated(state, aircraft.atAirport ?? '', aircraft.typeCode)) chargeMaintenance(state, contractCost(lineCheckMinutes(state, aircraft) * deferredItems(aircraft)));
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
export function forcedHeavyChecks(state: SimState): { aircraft: Aircraft; days: number }[] {
  return groundForHeavyCheck(state, state.aircraft.filter((aircraft) => heavyCheckDueIn(aircraft) <= -OVERDUE_GRACE_DAYS));
}

/**
 * Checks the player booked (bookHeavyCheck): the same grounding as a forced
 * one, taken the next morning. A booked plane that isn't at its base or
 * night stop that morning stays booked until it is. Planes in `skip` (already
 * forced this morning) are left alone.
 */
export function bookedHeavyChecks(state: SimState, skip: Aircraft[]): { aircraft: Aircraft; days: number }[] {
  const booked = groundForHeavyCheck(state, state.aircraft.filter((aircraft) => aircraft.heavyCheckBooked && !skip.includes(aircraft)));
  for (const { aircraft } of booked) delete aircraft.heavyCheckBooked;
  return booked;
}

function groundForHeavyCheck(state: SimState, candidates: Aircraft[]): { aircraft: Aircraft; days: number }[] {
  const grounded = candidates
    // At its base, or where it sleeps on a night stop (sim/nightStops.ts).
    .filter((aircraft) => aircraft.status === 'ground' && (aircraft.atAirport === aircraft.baseAirport || aircraft.atAirport === nightStopStation(state, aircraft.tail)) && !aircraft.rebase)
    .filter((aircraft) => !state.aogs.some((event) => event.tail === aircraft.tail));
  return grounded.map((aircraft) => {
    const workLeft = heavyCheckWorkMinutes(aircraft.typeCode) - heavyBankedMinutes(aircraft);
    if (!heavyRated(state, aircraft.atAirport ?? '', aircraft.typeCode)) chargeMaintenance(state, contractCost(workLeft));
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
    cost: heavyRated(state, aircraft.atAirport ?? '', aircraft.typeCode) ? 0 : contractCost(workLeft),
    rotations: rotationsForTail(state, tail).length,
  };
}

/** Bookable: parked at its base, C check inside its window, not already booked, in check or rebasing. */
export function canBookHeavyCheck(state: SimState, aircraft: Aircraft): boolean {
  return (
    !aircraft.heavyCheckBooked &&
    heavyCheckOpen(aircraft) &&
    aircraft.status === 'ground' &&
    aircraft.atAirport === aircraft.baseAirport &&
    !aircraft.rebase &&
    !state.aogs.some((event) => event.tail === aircraft.tail)
  );
}

/** A heavy check done: the interval starts again, every deferred item is cleared and the maintenance reserve is paid. */
export function finishHeavyCheck(state: SimState, aircraft: Aircraft): void {
  settleMaintenance(state, aircraft);
  aircraft.daysSinceHeavyCheck = 0;
  delete aircraft.deferredItems;
  delete aircraft.heavyCheckBooked;
  delete aircraft.heavyBankedMinutes;
  delete aircraft.flightMinutesSinceHeavy;
  delete aircraft.cyclesSinceHeavy;
}

/**
 * Tonight's line check, as it's shaping up: the plane's projected last
 * landing (sim/cascade.ts, so a day running late shows tonight getting
 * shorter before it happens) against tomorrow's first departure, less
 * RELEASE_MINUTES, and the work it needs, and where its day ends: checked
 * in house at a line base with room and the class rated, contracted at a
 * station, or away with no check. Null for a plane with nothing to fly.
 */
export function tonightCheck(
  state: SimState,
  tail: string,
): { night: number; work: number; station: string; inHouse: boolean; away: boolean; contracted: boolean; short: boolean; banking: 'A' | 'C' | 'A+C' | null } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (!aircraft || legs.length === 0) return null;
  const dayStart = dayStartMinute(state);
  const last = legs[legs.length - 1];
  const projected = projectRestOfDay(state, tail).filter((p) => !p.cancelled);
  const landing = projected.length > 0 ? projected[projected.length - 1].projectedArriveMinute : Math.max(dayStart + last.departMinute + last.blockMinutes, aircraft.status === 'ground' && legs.every((leg) => state.completedToday.includes(leg.legId) || state.cancelledToday.includes(leg.legId)) ? aircraft.groundSinceMinute : 0);
  const night = dayStart + MINUTES_PER_DAY + legs[0].departMinute - RELEASE_MINUTES - landing;
  const work = lineCheckMinutes(state, aircraft);
  const station = last.dest;
  // Who else ends the day at this station decides whether the line base has room.
  const sleepers = state.aircraft.flatMap((other) => {
    const otherLegs = state.schedule.filter((leg) => leg.tail === other.tail).sort((a, b) => a.departMinute - b.departMinute);
    return otherLegs.length > 0 && otherLegs[otherLegs.length - 1].dest === station ? [{ aircraft: other, station }] : [];
  });
  const inHouse = lineCheckedTails(state, sleepers).has(tail);
  const contracted = !inHouse && outstationCheck(state, station) === 'contract';
  const away = !inHouse && !contracted;
  const short = !away && night < work;
  // Whether the night's spare hours go to an A check, then a C check in a bay, as rollNightlyChecks() will do.
  let spare = !away && night > work ? night - work : 0;
  const bankingA = spare > 0 && aCheckOpen(aircraft);
  if (bankingA) spare -= Math.min(spare, aCheckWorkMinutes(aircraft.typeCode) - aBankedMinutes(aircraft));
  const bankingC = !away && spare > 0 && heavyBayTails(state, sleepers).has(tail);
  return { night, work, station, inHouse, away, contracted, short, banking: bankingA && bankingC ? 'A+C' : bankingA ? 'A' : bankingC ? 'C' : null };
}
