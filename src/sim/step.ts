import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, type EconomyAircraftType } from './economy';
import type { SimState, ActiveFlight } from './state';

const MINUTES_PER_DAY = 1440;

const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);

/**
 * Advance the world by exactly one simulated minute. Mutates `state` in
 * place and returns nothing, per CLAUDE.md's rule for this function — no
 * randomness, no clock reads, nothing but `state` in and `state` mutated.
 *
 * Three things happen each minute, in this order:
 *   1. Day rollover: if this is minute 0 of a new day, today's tallies
 *      (completedToday, todayRevenue, todayCost, todayMargin) reset to zero
 *      before anything else happens.
 *   2. Depart: any scheduled leg whose departure time is right now, flown
 *      by an aircraft that's on the ground at the correct airport, takes
 *      off — it becomes an ActiveFlight and its aircraft flips to airborne.
 *   3. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination, the
 *      flight's economics (sim/economy.ts) are applied to cash and today's
 *      running totals, and the flight is removed from the active list.
 *
 * The reset happens at the *start* of the new day rather than the end of
 * the old one deliberately: it means that right up until the moment the
 * next day's first minute is processed, `state.todayRevenue` etc. still
 * hold the just-finished day's real totals — which is what lets something
 * outside step() (the M7 headless runner, for instance) read "yesterday's
 * numbers" cleanly between calls, instead of catching them already zeroed.
 *
 * `state.schedule` is "the daily repeating schedule" (CLAUDE.md), so
 * matching against `state.simMinute % MINUTES_PER_DAY` makes every leg fire
 * again at the same local-to-the-schedule time on day 1, day 2, and so on.
 * It's read from `state` rather than a shared module-level constant so
 * that the M8 schedule editor's edits — mutating a leg's `departMinute`
 * directly — take effect on the very next tick that reaches this loop.
 */
export function step(state: SimState): void {
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;

  if (minuteOfDay === 0) {
    state.completedToday = [];
    state.todayRevenue = 0;
    state.todayCost = 0;
    state.todayMargin = 0;
  }

  for (const leg of state.schedule) {
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

      const type = aircraftTypesByCode.get(aircraft.typeCode);
      if (type) {
        const blockMinutes = flight.arriveMinute - flight.departMinute;
        const result = flightResult({ blockMinutes }, type);
        state.cash += result.margin;
        state.todayRevenue += result.revenue;
        state.todayCost += result.cost;
        state.todayMargin += result.margin;
      }
    }

    state.completedToday.push(flight.legId);
    state.activeFlights.splice(i, 1);
  }

  state.simMinute += 1;
}
