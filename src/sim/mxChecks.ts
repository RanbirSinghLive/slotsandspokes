import { contractCost, hasMxBase, outstationCheck } from './bases';
import { dayStartMinute } from './clock';
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
/** The heavy check's work starts being done this many days before it's due. */
export const HEAVY_WINDOW_DAYS = 10;
export const OVERDUE_GRACE_DAYS = 7;
/** Hangar minutes a heavy check takes, by class. */
const HEAVY_WORK_MINUTES: Record<string, number> = { PROP: 480, REGIONAL: 600, NARROWBODY: 720, WIDEBODY: 960 };

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

/** Days until the heavy check is due: negative once overdue. */
export function heavyCheckDueIn(aircraft: Aircraft): number {
  return HEAVY_INTERVAL_DAYS - daysSinceHeavyCheck(aircraft);
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
  for (const aircraft of state.aircraft) {
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    if (legs.length === 0 || aircraft.rebase) continue;
    if (state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    aircraft.daysSinceHeavyCheck = daysSinceHeavyCheck(aircraft) + 1;

    let result: NightResult;
    const station = aircraft.status === 'ground' ? aircraft.atAirport : null;
    const firstDeparture = dayStartMinute + Math.min(...legs.map((leg) => leg.departMinute));
    const night = firstDeparture - RELEASE_MINUTES - aircraft.groundSinceMinute;
    const work = lineCheckMinutes(state, aircraft);
    if (!station || (!hasMxBase(state, station) && outstationCheck(state, station) === 'defer')) {
      result = 'away';
    } else if (!hasMxBase(state, station)) {
      // Contracted at the station: paid for the work, however the night turns out.
      result = night < work ? 'short' : 'contracted';
      chargeMaintenance(state, contractCost(work));
    } else {
      result = night < work ? 'short' : night >= work + CLEAR_SPARE_MINUTES && deferredItems(aircraft) > 0 ? 'cleared' : 'checked';
      // What the night has left after the line check goes toward the heavy check, once it's open.
      if (heavyCheckOpen(aircraft) && night > work) {
        aircraft.heavyBankedMinutes = heavyBankedMinutes(aircraft) + Math.round(night - work);
        if (heavyBankedMinutes(aircraft) >= heavyCheckWorkMinutes(aircraft.typeCode)) finishHeavyCheck(aircraft);
      }
    }
    if (result === 'away' || result === 'short') aircraft.deferredItems = deferredItems(aircraft) + 1;
    if (result === 'cleared') {
      // A heavy check finished tonight has already cleared them all.
      aircraft.deferredItems = Math.max(0, deferredItems(aircraft) - 1);
      if (aircraft.deferredItems === 0) delete aircraft.deferredItems;
    }
    results[aircraft.tail] = result;

  }
  state.lastNightChecks = results;
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
    if (!hasMxBase(state, aircraft.atAirport ?? '')) chargeMaintenance(state, contractCost(lineCheckMinutes(state, aircraft) * deferredItems(aircraft)));
    delete aircraft.deferredItems;
  }
  return holds;
}

/**
 * Heavy checks overdue past the grace, from sim/aog.ts's morning pass:
 * each plane at base is grounded for the work it has left, in whole days.
 * A base with no maintenance has the work contracted, paid here.
 */
export function forcedHeavyChecks(state: SimState): { aircraft: Aircraft; days: number }[] {
  const forced = state.aircraft
    .filter((aircraft) => heavyCheckDueIn(aircraft) <= -OVERDUE_GRACE_DAYS)
    .filter((aircraft) => aircraft.status === 'ground' && aircraft.atAirport === aircraft.baseAirport && !aircraft.rebase)
    .filter((aircraft) => !state.aogs.some((event) => event.tail === aircraft.tail));
  return forced.map((aircraft) => {
    const workLeft = heavyCheckWorkMinutes(aircraft.typeCode) - heavyBankedMinutes(aircraft);
    if (!hasMxBase(state, aircraft.atAirport ?? '')) chargeMaintenance(state, contractCost(workLeft));
    return { aircraft, days: Math.max(1, Math.ceil(workLeft / MINUTES_PER_DAY)) };
  });
}

/** A heavy check done: the interval starts again and every deferred item is cleared. */
export function finishHeavyCheck(aircraft: Aircraft): void {
  aircraft.daysSinceHeavyCheck = 0;
  delete aircraft.deferredItems;
  delete aircraft.heavyBankedMinutes;
}

/**
 * Tonight's line check, as it's shaping up: the plane's projected last
 * landing (sim/cascade.ts, so a day running late shows tonight getting
 * shorter before it happens) against tomorrow's first departure, less
 * RELEASE_MINUTES, and the work it needs, and where its day ends: at a
 * maintenance base, contracted at a station, or away with no check. Null
 * for a plane with nothing to fly.
 */
export function tonightCheck(
  state: SimState,
  tail: string,
): { night: number; work: number; station: string; away: boolean; contracted: boolean; short: boolean } | null {
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
  const contracted = !hasMxBase(state, station) && outstationCheck(state, station) === 'contract';
  const away = !hasMxBase(state, station) && !contracted;
  return { night, work, station, away, contracted, short: !away && night < work };
}
