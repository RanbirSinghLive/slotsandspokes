import { knockOnDelayMinutes, isOnTimeArrival } from './delays';
import { executiveDelayMultiplier } from './executives';
import { MIN_TURN_MINUTES, type ScheduleLeg } from './schedule';
import { breaksCurfew } from './curfew';
import { rotationsForTail } from './utilisation';
import { dayStartMinute } from './clock';
import type { SimState } from './state';

/**
 * Where a late aircraft's lateness is headed: the rest of its day, leg by
 * leg, if nothing *new* goes wrong. Used by the map (render/cascade.ts)
 * when the player hovers a plane — the thing CLAUDE.md says the map exists
 * to teach is how one delay spreads through the rest of that aircraft's
 * day, and this is that spread, computed rather than guessed.
 *
 * It replays step()'s own rules forward: a leg can't leave before its
 * scheduled time or before the plane has had MIN_TURN_MINUTES on the
 * ground, leaving late adds the knock-on cause (sim/delays.ts) on top, and
 * a rotation that couldn't be home by the 22:00 curfew is cancelled whole
 * (sim/curfew.ts).
 * It deliberately leaves out the random causes (age, weather) — they
 * haven't been rolled yet, so projecting them would be inventing delays.
 * What's left is the delay the plane is already carrying and how far the
 * schedule's slack will or won't absorb it: exactly what a turn buffer
 * (sim/turnBuffer.ts) changes.
 */
export type ProjectedLeg = {
  leg: ScheduleLeg;
  /** Absolute simMinutes. */
  projectedDepartMinute: number;
  projectedArriveMinute: number;
  /** How far past its scheduled arrival it's projected to land; 0 or less means early/on the dot. */
  lateMinutes: number;
  onTime: boolean;
  /** Cancelled by the curfew: never flies, so the times above are just its schedule. */
  cancelled: boolean;
};

/**
 * The legs of one plane's day still to come, in the order they will be
 * flown: the rest of a rotation already under way (always flown, the plane
 * is away from base) and then each later rotation (leaving from base,
 * where the curfew can cancel it, or the controller can: sim/controller.ts).
 */
type RemainingRotation = { legs: ScheduleLeg[]; mustFly: boolean };

/** Replays the remaining rotations from `readyAt`, step() rule for step() rule. */
function replayRemaining(
  state: SimState,
  dayStart: number,
  readyAtStart: number,
  remaining: RemainingRotation[],
  controllerCancelled: ReadonlySet<string>,
): ProjectedLeg[] {
  const projected: ProjectedLeg[] = [];
  let readyAt = readyAtStart;

  const fly = (leg: ScheduleLeg): void => {
    const scheduledDepart = dayStart + leg.departMinute;
    const departMinute = Math.max(scheduledDepart, readyAt);
    const knockOn = Math.round(knockOnDelayMinutes(departMinute - scheduledDepart) * executiveDelayMultiplier(state));
    const arriveMinute = departMinute + leg.blockMinutes + knockOn;
    const scheduledArrive = scheduledDepart + leg.blockMinutes;
    projected.push({
      leg,
      projectedDepartMinute: departMinute,
      projectedArriveMinute: arriveMinute,
      lateMinutes: arriveMinute - scheduledArrive,
      onTime: isOnTimeArrival(arriveMinute, scheduledArrive),
      cancelled: false,
    });
    readyAt = arriveMinute + MIN_TURN_MINUTES;
  };

  const markCancelled = (legs: ScheduleLeg[]): void => {
    for (const leg of legs) {
      const scheduledDepart = dayStart + leg.departMinute;
      projected.push({
        leg,
        projectedDepartMinute: scheduledDepart,
        projectedArriveMinute: scheduledDepart + leg.blockMinutes,
        lateMinutes: 0,
        onTime: false,
        cancelled: true,
      });
    }
  };

  for (const rotation of remaining) {
    if (rotation.mustFly) {
      rotation.legs.forEach(fly);
      continue;
    }
    const departMinute = Math.max(dayStart + rotation.legs[0].departMinute, readyAt);
    // The plane stays at base when a rotation is cancelled, so readyAt doesn't move.
    if (controllerCancelled.has(rotation.legs[0].legId) || breaksCurfew(state, rotationOf(state, rotation.legs), departMinute, dayStart)) {
      markCancelled(rotation.legs);
      continue;
    }
    rotation.legs.forEach(fly);
  }
  return projected;
}

/** breaksCurfew() reads a Rotation; the one of these legs, rebuilt from the schedule. */
function rotationOf(state: SimState, legs: ScheduleLeg[]) {
  return rotationsForTail(state, legs[0].tail).find((rotation) => rotation.legs[0] === legs[0])!;
}

/**
 * The legs `tail` still has to fly today after the one it's in the air on,
 * projected forward. Empty if the tail isn't airborne.
 */
export function projectRestOfDay(state: SimState, tail: string): ProjectedLeg[] {
  const flight = state.activeFlights.find((f) => f.tail === tail);
  if (!flight) return [];

  // The schedule's day this flight belongs to, from when it was due to
  // leave — not from "now", which may already be past midnight.
  const dayStart = dayStartMinute(state, flight.scheduledDepartMinute);
  const current = state.schedule.find((leg) => leg.legId === flight.legId);
  if (!current) return [];

  const rotations = rotationsForTail(state, tail);
  const currentIndex = rotations.findIndex((rotation) => rotation.legs.includes(current));
  if (currentIndex === -1) return [];

  const currentRotation = rotations[currentIndex];
  const remaining: RemainingRotation[] = [
    { legs: currentRotation.legs.slice(currentRotation.legs.indexOf(current) + 1), mustFly: true },
    ...rotations.slice(currentIndex + 1).map((rotation) => ({ legs: rotation.legs, mustFly: false })),
  ];
  return replayRemaining(state, dayStart, flight.arriveMinute + MIN_TURN_MINUTES, remaining, new Set());
}

/**
 * The same projection for a plane waiting on the ground: the part of its
 * day not flown, cancelled or moved to tomorrow yet, from the moment it is
 * ready to leave. `cancelRotationsStarting` names rotations (by their first
 * leg's id) to leave out, so the controller can price a cancellation by
 * comparing two replays. Empty for a plane in the air, AOG or grounded for
 * the day, which can't be steered.
 */
export function projectGroundedDay(state: SimState, tail: string, cancelRotationsStarting: ReadonlySet<string> = new Set()): ProjectedLeg[] {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || aircraft.status !== 'ground' || state.aogs.some((event) => event.tail === tail) || state.groundedTails.includes(tail)) return [];

  const handled = new Set([...state.completedToday, ...state.cancelledToday, ...(state.retimedToday ?? [])]);
  const remaining: RemainingRotation[] = [];
  for (const rotation of rotationsForTail(state, tail)) {
    const pending = rotation.legs.filter((leg) => !handled.has(leg.legId));
    if (pending.length === 0) continue;
    // Part-flown: the plane is away from base and always flies home.
    remaining.push({ legs: pending, mustFly: pending.length < rotation.legs.length });
  }
  if (remaining.length === 0) return [];

  const dayStart = dayStartMinute(state, state.simMinute);
  const readyAt = Math.max(state.simMinute, aircraft.groundSinceMinute + MIN_TURN_MINUTES);
  return replayRemaining(state, dayStart, readyAt, remaining, cancelRotationsStarting);
}
