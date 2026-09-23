import { classByCode } from './aircraftClasses';
import { marketKey, nextLegId, type ScheduleLeg } from './schedule';
import {
  aircraftUtilisation,
  isLongHaulRoundTrip,
  rotationsForTail,
  scheduledTurnMinutes,
  USABLE_DAY_END_MINUTE,
  USABLE_DAY_START_MINUTE,
  type PoolEffect,
  type Rotation,
} from './utilisation';
import type { SimState } from './state';

/**
 * Per-route turn buffer: extra scheduled ground time after every flight on
 * a market, on top of the physical MIN_TURN_MINUTES.
 *
 * Why it exists: the route builder packs every rotation at exactly the
 * minimum turn, so a plane that lands even a few minutes late departs its
 * next leg late, and the lateness compounds down the rest of its day
 * (sim/delays.ts's knock-on cause). A buffer is slack that absorbs a late
 * arrival before it reaches the next departure. It costs aircraft time —
 * every buffered turn is counted in utilisation (sim/utilisation.ts), so
 * a buffered plane fits fewer flights into its day.
 *
 * The buffer belongs to the route the plane just flew, because that's the
 * delay it protects against: a buffer on YUL–YYZ pads the turn *after*
 * each YUL–YYZ flight, whichever direction it went.
 *
 * Changing a buffer re-times the schedule, which is the one part of this
 * that isn't obvious. Every aircraft flying the route has its whole day
 * re-spaced from its first departure. If that pushes a plane past the end
 * of the usable day, one of its rotations moves to another plane of the
 * same class at the same base — the pool the day budget is really kept
 * in. If no plane in that pool has room, the change is refused, and the
 * reason is what the menu shows on the greyed-out button.
 */

/** The choices the route card offers, in minutes. */
export const TURN_BUFFER_CHOICES = [0, 15, 30, 45, 60];

/** Same nudge the route builder uses to dodge two tails departing the same market at the same minute. */
const COLLISION_NUDGE_MINUTES = 5;
const MAX_COLLISION_NUDGES = 24;

export type TurnBufferPlan =
  | {
      ok: true;
      schedule: ScheduleLeg[];
      completedToday: string[];
      /** How many rotations had to move to another plane to make room. */
      moved: number;
      /** Change in booked minutes per pool, for the hover preview. */
      effects: PoolEffect[];
    }
  | { ok: false; reason: string };

function collides(schedule: ScheduleLeg[], leg: ScheduleLeg, departMinute: number): boolean {
  return schedule.some(
    (other) => other !== leg && other.origin === leg.origin && other.dest === leg.dest && other.departMinute === departMinute,
  );
}

/**
 * Re-space one aircraft's whole day, keeping its first departure where it
 * is: each leg leaves one block time plus one scheduled turn after the
 * previous one. Mutates the legs in `work.schedule`.
 */
function repackTail(work: SimState, tail: string): void {
  const legs = work.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (legs.length === 0) return;

  let cursor = legs[0].departMinute;
  for (const leg of legs) {
    let departMinute = cursor;
    for (let nudge = 0; nudge < MAX_COLLISION_NUDGES && collides(work.schedule, leg, departMinute); nudge++) {
      departMinute += COLLISION_NUDGE_MINUTES;
    }
    leg.departMinute = departMinute;
    cursor = departMinute + leg.blockMinutes + scheduledTurnMinutes(work, leg.origin, leg.dest);
  }
}

/** Whether this tail's day, as currently scheduled, ends inside the usable day. */
function tailFits(work: SimState, tail: string): boolean {
  const legs = work.schedule.filter((leg) => leg.tail === tail);
  if (legs.length === 0) return true;
  // A long-haul round trip is allowed to run round the clock (see
  // isLongHaulRoundTrip()); its utilisation already counts as one full day.
  const clockMinutes = legs.reduce((total, leg) => total + leg.blockMinutes + scheduledTurnMinutes(work, leg.origin, leg.dest), 0);
  if (isLongHaulRoundTrip(legs.length, clockMinutes)) return true;
  const lastArrival = Math.max(...legs.map((leg) => leg.departMinute + leg.blockMinutes));
  return lastArrival <= USABLE_DAY_END_MINUTE;
}

/**
 * A rotation partway through being flown today can't move: its plane is
 * already away from base on it, and would be stranded wherever it landed.
 */
function isInProgress(state: SimState, rotation: Rotation): boolean {
  const flown = (leg: ScheduleLeg) =>
    state.completedToday.includes(leg.legId) ||
    state.cancelledToday.includes(leg.legId) ||
    state.activeFlights.some((flight) => flight.legId === leg.legId);
  const airborne = rotation.legs.some((leg) => state.activeFlights.some((flight) => flight.legId === leg.legId));
  return airborne || (rotation.legs.some(flown) && !rotation.legs.every(flown));
}

/**
 * Move `rotation` off `fromTail` onto another plane of the same class
 * based at the same airport, appended after that plane's own day. Tries
 * the least-worked plane first. Returns false, with nothing changed, when
 * none of them has room.
 */
function rehome(work: SimState, state: SimState, rotation: Rotation, fromTail: string): boolean {
  const from = state.aircraft.find((a) => a.tail === fromTail);
  if (!from || !from.baseAirport) return false;

  const candidates = state.aircraft
    .filter((a) => a.tail !== fromTail && a.typeCode === from.typeCode && a.baseAirport === from.baseAirport)
    .sort((a, b) => aircraftUtilisation(work, a.tail).minutes - aircraftUtilisation(work, b.tail).minutes);

  // Flown or cancelled already today: either way, done for today.
  const wasHandledToday = rotation.legs.every(
    (leg) => state.completedToday.includes(leg.legId) || state.cancelledToday.includes(leg.legId),
  );

  for (const target of candidates) {
    const targetLegs = work.schedule.filter((leg) => leg.tail === target.tail);
    const lastLeg = targetLegs.reduce<ScheduleLeg | null>(
      (latest, leg) => (!latest || leg.departMinute > latest.departMinute ? leg : latest),
      null,
    );
    // Start after the target's own last flight and its turn, or at the
    // opening of the usable day on a plane with nothing scheduled;
    // repackTail() below then spaces the moved legs properly.
    let startMinute = lastLeg
      ? lastLeg.departMinute + lastLeg.blockMinutes + scheduledTurnMinutes(work, lastLeg.origin, lastLeg.dest)
      : USABLE_DAY_START_MINUTE;

    const moved: ScheduleLeg[] = [];
    for (const leg of rotation.legs) {
      const copy: ScheduleLeg = { ...leg, tail: target.tail, legId: nextLegId(target.tail, work.schedule), departMinute: startMinute };
      startMinute += 1; // keeps the moved legs in order until repackTail() spaces them
      work.schedule.push(copy);
      moved.push(copy);
    }
    repackTail(work, target.tail);

    if (tailFits(work, target.tail)) {
      // A rotation already flown (or cancelled) today under its old leg
      // ids mustn't fly today under its new ones.
      if (wasHandledToday) work.completedToday.push(...moved.map((leg) => leg.legId));
      return true;
    }

    work.schedule = work.schedule.filter((leg) => !moved.includes(leg));
    repackTail(work, target.tail);
  }
  return false;
}

/** Booked minutes per base+class pool, for working out the preview's effects. */
function pooledMinutes(state: SimState): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport) continue;
    const key = `${aircraft.baseAirport}|${aircraft.typeCode}`;
    minutes.set(key, (minutes.get(key) ?? 0) + aircraftUtilisation(state, aircraft.tail).minutes);
  }
  return minutes;
}

/**
 * Work out what setting this market's buffer to `bufferMinutes` would do,
 * on a copy — nothing here touches `state`. The same plan drives the
 * button's enabled state, its hover preview and the change itself, so the
 * three can't disagree.
 */
export function planTurnBufferChange(state: SimState, a: string, b: string, bufferMinutes: number): TurnBufferPlan {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings) return { ok: false, reason: 'Nothing flies this route.' };

  const work: SimState = {
    ...state,
    schedule: state.schedule.map((leg) => ({ ...leg })),
    routeSettings: { ...state.routeSettings, [key]: { ...settings, turnBufferMinutes: bufferMinutes } },
    completedToday: [...state.completedToday],
  };

  const affectedTails = [...new Set(work.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key).map((leg) => leg.tail))];
  let moved = 0;

  for (const tail of affectedTails) {
    repackTail(work, tail);

    while (!tailFits(work, tail)) {
      const aircraft = state.aircraft.find((x) => x.tail === tail);
      const className = classByCode(aircraft?.typeCode ?? '')?.name ?? 'aircraft';
      const base = aircraft?.baseAirport ?? '?';
      const noRoom =
        `Not enough spare ${className} time at ${base}: ${tail}'s day would run past 22:00, ` +
        `and no other ${className} based at ${base} has room for one of its rotations. ` +
        `Lease another ${className} at ${base} (tap ${base}, then Plane), or remove a flight.`;

      const rotations = rotationsForTail(work, tail);
      // Moving the only rotation would just move the problem.
      if (rotations.length <= 1) return { ok: false, reason: noRoom };
      const movable = rotations.filter((rotation) => !isInProgress(state, rotation));
      if (movable.length === 0) return { ok: false, reason: noRoom };

      // The latest one, so the plane keeps the start of its day.
      const toMove = movable.reduce((latest, rotation) => (rotation.departMinute > latest.departMinute ? rotation : latest));
      work.schedule = work.schedule.filter((leg) => !toMove.legs.includes(leg));
      if (!rehome(work, state, toMove, tail)) return { ok: false, reason: noRoom };
      moved += 1;
      repackTail(work, tail);
    }
  }

  const before = pooledMinutes(state);
  const after = pooledMinutes(work);
  const effects: PoolEffect[] = [];
  for (const [poolKey, minutes] of after) {
    const delta = minutes - (before.get(poolKey) ?? 0);
    if (delta === 0) continue;
    const [base, classCode] = poolKey.split('|');
    effects.push({ base, classCode, minutes: delta });
  }

  return { ok: true, schedule: work.schedule, completedToday: work.completedToday, moved, effects };
}

/** Set this market's buffer and re-time the schedule to match. */
export function applyTurnBufferChange(
  state: SimState,
  a: string,
  b: string,
  bufferMinutes: number,
): { ok: true; moved: number } | { ok: false; reason: string } {
  const plan = planTurnBufferChange(state, a, b, bufferMinutes);
  if (!plan.ok) return plan;

  // A plane with nothing scheduled that just took a moved rotation starts
  // its day at its base — the same placement the route builder's
  // commitRotation() gives a plane's first rotation, and for the same
  // reason: otherwise a plane parked elsewhere would never reach its legs.
  for (const aircraft of state.aircraft) {
    const hadNothing = !state.schedule.some((leg) => leg.tail === aircraft.tail);
    const hasSomething = plan.schedule.some((leg) => leg.tail === aircraft.tail);
    if (hadNothing && hasSomething && aircraft.status === 'ground' && aircraft.baseAirport) {
      aircraft.atAirport = aircraft.baseAirport;
    }
  }

  state.routeSettings[marketKey(a, b)].turnBufferMinutes = bufferMinutes;
  state.schedule = plan.schedule;
  state.completedToday = plan.completedToday;
  return { ok: true, moved: plan.moved };
}
