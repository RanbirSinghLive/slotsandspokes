import { scheduleLegs } from './schedule';
import type { SimState, ActiveFlight } from './state';

const MINUTES_PER_DAY = 1440;

/**
 * Advance the world by exactly one simulated minute. Mutates `state` in
 * place and returns nothing, per CLAUDE.md's rule for this function — no
 * randomness, no clock reads, nothing but `state` in and `state` mutated.
 *
 * Two things happen each minute, in this order:
 *   1. Depart: any scheduled leg whose departure time is right now, flown
 *      by an aircraft that's on the ground at the correct airport, takes
 *      off — it becomes an ActiveFlight and its aircraft flips to airborne.
 *   2. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination, and
 *      the flight is removed from the active list.
 *
 * `scheduleLegs` is "the daily repeating schedule" (CLAUDE.md), so matching
 * against `state.simMinute % MINUTES_PER_DAY` makes every leg fire again at
 * the same local-to-the-schedule time on day 1, day 2, and so on.
 */
export function step(state: SimState): void {
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;

  for (const leg of scheduleLegs) {
    if (leg.departMinute !== minuteOfDay) continue;

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue; // this tail isn't part of the active fleet yet
    if (aircraft.status !== 'ground' || aircraft.atAirport !== leg.origin) continue;

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes,
    };
    state.activeFlights.push(activeFlight);
  }

  for (let i = state.activeFlights.length - 1; i >= 0; i--) {
    const flight = state.activeFlights[i];
    if (state.simMinute < flight.arriveMinute) continue;

    const aircraft = state.aircraft.find((a) => a.tail === flight.tail);
    if (aircraft) {
      aircraft.status = 'ground';
      aircraft.atAirport = flight.dest;
      aircraft.activeLegId = null;
    }

    state.completedToday.push(flight.legId);
    state.activeFlights.splice(i, 1);
  }

  state.simMinute += 1;
}
