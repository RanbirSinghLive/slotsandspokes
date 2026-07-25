import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket } from './schedule';
import { nextRandom } from './rng';
import type { SimState, ActiveFlight } from './state';

const MINUTES_PER_DAY = 1440;

const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);

// Deliberately crude, same spirit as sim/economy.ts: most flights are on
// time, and when one isn't, it's usually short with an occasional long
// one — a fixed distribution for this phase, not something tunable from
// the UI.
const ON_TIME_PROBABILITY = 0.65;
const MAX_DELAY_MINUTES = 45;

/**
 * Roll how many minutes late a departing flight's arrival will be. Returns
 * [delayMinutes, nextSeed] — the same shape nextRandom() itself returns, so
 * the caller just does `state.rngSeed = nextSeed`.
 *
 * One random draw decides whether the flight is delayed at all. A second
 * draw, taken only when it is, decides how badly: squaring that roll
 * (severityRoll * severityRoll) skews the result toward the low end of
 * [1, MAX_DELAY_MINUTES] — most delays are minor, with an occasional long
 * tail, rather than every delay length being equally likely.
 */
function rollDelayMinutes(seed: number): [delayMinutes: number, nextSeed: number] {
  const [onTimeRoll, seedAfterFirst] = nextRandom(seed);
  if (onTimeRoll < ON_TIME_PROBABILITY) return [0, seedAfterFirst];

  const [severityRoll, seedAfterSecond] = nextRandom(seedAfterFirst);
  const delayMinutes = Math.round(1 + severityRoll * severityRoll * (MAX_DELAY_MINUTES - 1));
  return [delayMinutes, seedAfterSecond];
}

/**
 * Advance the world by exactly one simulated minute. Mutates `state` in
 * place and returns nothing, per CLAUDE.md's rule for this function — no
 * randomness, no clock reads, nothing but `state` in and `state` mutated.
 *
 * Three things happen each minute, in this order:
 *   1. Day rollover: if this is minute 0 of a new day, today's tallies
 *      (completedToday, todayRevenue, todayCost, todayMargin) reset to zero
 *      before anything else happens.
 *   2. Depart: any scheduled leg whose departure time has arrived (M9: *at
 *      or after* `departMinute`, not only the exact minute — see below),
 *      not already flown or in the air today, flown by an aircraft that's
 *      on the ground at the correct airport and past its minimum turn time
 *      (MIN_TURN_MINUTES since it last landed), takes off — it becomes an
 *      ActiveFlight with a randomly rolled arrival delay (sim/rng.ts) and
 *      its aircraft flips to airborne.
 *   3. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination and
 *      records when (`groundSinceMinute`, for the next leg's turn-time
 *      check), the flight's economics (sim/economy.ts) are applied to cash
 *      and today's running totals, and the flight is removed from the
 *      active list.
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
 *
 * Why "at or after" instead of "exactly at" departMinute (M9): once delays
 * exist, an aircraft can still be airborne or mid-turnaround at the exact
 * minute its next leg was supposed to leave. An exact-match check would
 * just silently skip that leg for the rest of the day the moment it missed
 * its slot. Checking "has the scheduled time passed, and are we still
 * waiting to fly this specific leg today" instead means a late aircraft
 * departs as soon as it's actually ready — which is the whole mechanism
 * that lets one delay push a later one back, rather than the schedule
 * quietly giving up on it.
 */
export function step(state: SimState): void {
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;
  const dayStart = state.simMinute - minuteOfDay;

  if (minuteOfDay === 0) {
    state.completedToday = [];
    state.todayRevenue = 0;
    state.todayCost = 0;
    state.todayMargin = 0;
  }

  for (const leg of state.schedule) {
    if (minuteOfDay < leg.departMinute) continue; // not due yet today

    const alreadyHandledToday =
      state.completedToday.includes(leg.legId) || state.activeFlights.some((f) => f.legId === leg.legId);
    if (alreadyHandledToday) continue;

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue; // this tail isn't part of the active fleet yet
    if (aircraft.status !== 'ground' || aircraft.atAirport !== leg.origin) continue;
    if (state.simMinute < aircraft.groundSinceMinute + MIN_TURN_MINUTES) continue; // still turning around

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    const [delayMinutes, nextSeed] = rollDelayMinutes(state.rngSeed);
    state.rngSeed = nextSeed;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes + delayMinutes,
      // What arriveMinute would be with a fully on-time departure today and
      // zero delay — the honest "should have landed by" time, for the
      // panel to compare against.
      scheduledArriveMinute: dayStart + leg.departMinute + leg.blockMinutes,
      // Locked in at departure — see ActiveFlight's note on why this isn't
      // re-read from state.schedule at arrival.
      fare: leg.fare,
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
      aircraft.groundSinceMinute = state.simMinute;

      const type = aircraftTypesByCode.get(aircraft.typeCode);
      if (type) {
        const blockMinutes = flight.arriveMinute - flight.departMinute;
        const marketFrequency = legsServingMarket(flight.origin, flight.dest, state.schedule);
        const result = flightResult(
          { origin: flight.origin, dest: flight.dest, blockMinutes, fare: flight.fare },
          type,
          marketFrequency,
        );
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
