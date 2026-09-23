import { MIN_TURN_MINUTES } from './schedule';
import { isLongHaulRoundTrip, rotationsForTail, scheduledTurnMinutes, USABLE_DAY_END_MINUTE, type Rotation } from './utilisation';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';

/**
 * The 22:00 curfew: the hard end of a delay's spread.
 *
 * The usable day ends at 22:00 (sim/utilisation.ts) and the route builder
 * only schedules rotations that are back at base by then. A delay can
 * still push the real day past it. When it does, the rotation that would
 * run over is cancelled before it leaves base, rather than flown late
 * into the night.
 *
 * This is deliberately a hard rule, not a dice roll. The random causes
 * (an aircraft breaking down, weather closing an airport) are small drips
 * that come and go; this one is the certain consequence of lateness
 * nobody absorbed. Every minute of unabsorbed delay moves the end of the
 * day closer to 22:00, and once it's past, the last rotation of the day
 * goes. So a missing turn buffer costs twice: late flights first, then
 * cancelled ones.
 *
 * Why the whole rotation, and only from base: airlines cancel in pairs so
 * the aircraft stays where it's needed tomorrow. Cancelling one leg away
 * from base would leave the plane stranded at an outstation. A plane
 * that's already out always flies home, even if that means landing late.
 */

/**
 * When a rotation would land back at base if it left now, assuming no new
 * delay: each later leg leaves at its scheduled time or once the plane has
 * turned, whichever is later.
 */
export function projectedReturnMinute(rotation: Rotation, departMinute: number, dayStart: number): number {
  let clock = departMinute;
  rotation.legs.forEach((leg, i) => {
    if (i > 0) clock = Math.max(dayStart + leg.departMinute, clock + MIN_TURN_MINUTES);
    clock += leg.blockMinutes;
  });
  return clock;
}

/** Whether leaving now would bring this rotation home after the curfew. */
export function breaksCurfew(state: SimState, rotation: Rotation, departMinute: number, dayStart: number): boolean {
  // A long-haul round trip is meant to run round the clock (see
  // isLongHaulRoundTrip()), so the curfew doesn't apply to it.
  const clockMinutes = rotation.legs.reduce(
    (total, leg) => total + leg.blockMinutes + scheduledTurnMinutes(state, leg.origin, leg.dest),
    0,
  );
  if (isLongHaulRoundTrip(rotation.legs.length, clockMinutes)) return false;
  return projectedReturnMinute(rotation, departMinute, dayStart) > dayStart + USABLE_DAY_END_MINUTE;
}

/** The rotation `leg` opens, or null when it's partway through one. */
export function rotationStartingWith(state: SimState, leg: ScheduleLeg): Rotation | null {
  return rotationsForTail(state, leg.tail).find((rotation) => rotation.legs[0] === leg) ?? null;
}
