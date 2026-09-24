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

  const projected: ProjectedLeg[] = [];
  let readyAt = flight.arriveMinute + MIN_TURN_MINUTES;

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

  // The rest of the rotation it's on: already away from base, so it
  // always flies home.
  const currentRotation = rotations[currentIndex];
  currentRotation.legs.slice(currentRotation.legs.indexOf(current) + 1).forEach(fly);

  // Each later rotation starts from base, where the curfew can cancel it.
  for (const rotation of rotations.slice(currentIndex + 1)) {
    const first = rotation.legs[0];
    const departMinute = Math.max(dayStart + first.departMinute, readyAt);
    if (breaksCurfew(state, rotation, departMinute, dayStart)) {
      for (const leg of rotation.legs) {
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
      continue; // the plane stays at base, so readyAt doesn't move
    }
    rotation.legs.forEach(fly);
  }
  return projected;
}
