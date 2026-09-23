import { knockOnDelayMinutes, isOnTimeArrival } from './delays';
import { executiveDelayMultiplier } from './executives';
import { MIN_TURN_MINUTES, type ScheduleLeg } from './schedule';
import type { SimState } from './state';

const MINUTES_PER_DAY = 1440;

/**
 * Where a late aircraft's lateness is headed: the rest of its day, leg by
 * leg, if nothing *new* goes wrong. Used by the map (render/cascade.ts)
 * when the player hovers a plane — the thing CLAUDE.md says the map exists
 * to teach is how one delay spreads through the rest of that aircraft's
 * day, and this is that spread, computed rather than guessed.
 *
 * It replays step()'s own rules forward: a leg can't leave before its
 * scheduled time or before the plane has had MIN_TURN_MINUTES on the
 * ground, and leaving late adds the knock-on cause (sim/delays.ts) on top.
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
  const dayStart = Math.floor(flight.scheduledDepartMinute / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const current = state.schedule.find((leg) => leg.legId === flight.legId);
  if (!current) return [];

  const remaining = state.schedule
    .filter((leg) => leg.tail === tail && leg.departMinute > current.departMinute)
    .sort((a, b) => a.departMinute - b.departMinute);

  const projected: ProjectedLeg[] = [];
  let readyAt = flight.arriveMinute + MIN_TURN_MINUTES;
  for (const leg of remaining) {
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
    });
    readyAt = arriveMinute + MIN_TURN_MINUTES;
  }
  return projected;
}
