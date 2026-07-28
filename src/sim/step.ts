import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, legCost, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket, marketKey } from './schedule';
import { nextRandom } from './rng';
import { rollDailyWeather, WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES } from './weather';
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
function rollDelayMinutes(
  seed: number,
  onTimeProbability: number,
  maxDelayMinutes: number,
): [delayMinutes: number, nextSeed: number] {
  const [onTimeRoll, seedAfterFirst] = nextRandom(seed);
  if (onTimeRoll < onTimeProbability) return [0, seedAfterFirst];

  const [severityRoll, seedAfterSecond] = nextRandom(seedAfterFirst);
  const delayMinutes = Math.round(1 + severityRoll * severityRoll * (maxDelayMinutes - 1));
  return [delayMinutes, seedAfterSecond];
}

/**
 * Advance the world by exactly one simulated minute. Mutates `state` in
 * place and returns nothing, per CLAUDE.md's rule for this function — no
 * randomness, no clock reads, nothing but `state` in and `state` mutated.
 *
 * Four things happen each minute, in this order:
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
 *   3. Position (week three): same gate as a scheduled departure above,
 *      but against `state.positioningLegs` instead — one-time repositioning
 *      moves the M10 route builder queues up when a route gets assigned to
 *      a tail that isn't standing at its origin (see PositioningLeg in
 *      sim/schedule.ts). Removed from the queue the moment it departs,
 *      since it never repeats.
 *   4. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination and
 *      records when (`groundSinceMinute`, for the next leg's turn-time
 *      check). A positioning flight's cost (fuel + departure, no revenue —
 *      it isn't serving a market) is applied the same as a revenue flight's
 *      full economics (sim/economy.ts) would be, and the flight is removed
 *      from the active list either way.
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

    // Marketing spend (week two's "Commercial" panel) is a per-day, per-
    // market cost, not a per-flight one — charged once here rather than in
    // the arrival loop below, since a market can have zero, one, or many
    // flights land on a given day and the spend doesn't scale with that.
    const totalMarketingSpend = Object.values(state.routeSettings).reduce(
      (total, settings) => total + settings.marketingSpend,
      0,
    );
    state.cash -= totalMarketingSpend;
    state.todayCost += totalMarketingSpend;
    state.todayMargin -= totalMarketingSpend;

    // Fleet Market lease cost (week three) — same "flat per-day charge"
    // shape as marketing spend above, not tied to whether the aircraft
    // actually flew that day. 0 for every owned aircraft, so this is a
    // no-op for the headless runner's fully-owned fleet.
    const totalLeaseCost = state.aircraft.reduce((total, aircraft) => total + aircraft.leaseCostPerDay, 0);
    state.cash -= totalLeaseCost;
    state.todayCost += totalLeaseCost;
    state.todayMargin -= totalLeaseCost;

    // Weather (sim/weather.ts) is a daily-scale event, not a per-minute
    // one — origination, spread, and expiry all happen once here rather
    // than being checked on every tick.
    rollDailyWeather(state, state.simMinute);
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

    // On-time performance (HUD stat next to Cash): this leg was due at
    // dayStart + leg.departMinute, and it can never depart *before* that
    // (the `minuteOfDay < leg.departMinute` check above rules it out) —
    // so "on time or early" collapses to "departed at exactly its due
    // minute," and anything later means it sat waiting on a late aircraft.
    state.flightsDepartedTotal += 1;
    if (state.simMinute === dayStart + leg.departMinute) {
      state.flightsOnTimeTotal += 1;
    }

    // Bare-bones weather effect (sim/weather.ts): a leg departing an
    // airport with active weather rolls against worse odds — reusing
    // M9's existing delay mechanism rather than a new aircraft state
    // (no grounding, no diversions, no cancellations yet).
    const weatherAtOrigin = state.weatherByAirport[leg.origin];
    const onTimeProbability = weatherAtOrigin ? WEATHER_ON_TIME_PROBABILITY : ON_TIME_PROBABILITY;
    const maxDelayMinutes = weatherAtOrigin ? WEATHER_MAX_DELAY_MINUTES : MAX_DELAY_MINUTES;
    const [delayMinutes, nextSeed] = rollDelayMinutes(state.rngSeed, onTimeProbability, maxDelayMinutes);
    state.rngSeed = nextSeed;

    // Fare and marketing spend are market-level (RouteSettings), not
    // per-leg — every leg on this market shares the same entry.
    const routeSettings = state.routeSettings[marketKey(leg.origin, leg.dest)];

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
      // Locked in at departure — see ActiveFlight's note on why these
      // aren't re-read from state.routeSettings at arrival.
      fare: routeSettings.fare,
      marketingSpend: routeSettings.marketingSpend,
    };
    state.activeFlights.push(activeFlight);
  }

  // Positioning legs (week three, see PositioningLeg's own comment in
  // sim/schedule.ts) depart the same way scheduled legs do above — same
  // ground/turn-time gate, same weather/delay roll — except `departMinute`
  // here is an absolute simMinute, not a minute-of-day, since a positioning
  // move never repeats. Removed from the queue the instant it departs
  // rather than tracked in `completedToday`: once it's airborne it's fully
  // represented by its ActiveFlight, and it can never come due again.
  for (let i = state.positioningLegs.length - 1; i >= 0; i--) {
    const leg = state.positioningLegs[i];
    if (state.simMinute < leg.departMinute) continue;

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue;
    if (aircraft.status !== 'ground' || aircraft.atAirport !== leg.origin) continue;
    if (state.simMinute < aircraft.groundSinceMinute + MIN_TURN_MINUTES) continue;

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    const weatherAtOrigin = state.weatherByAirport[leg.origin];
    const onTimeProbability = weatherAtOrigin ? WEATHER_ON_TIME_PROBABILITY : ON_TIME_PROBABILITY;
    const maxDelayMinutes = weatherAtOrigin ? WEATHER_MAX_DELAY_MINUTES : MAX_DELAY_MINUTES;
    const [delayMinutes, nextSeed] = rollDelayMinutes(state.rngSeed, onTimeProbability, maxDelayMinutes);
    state.rngSeed = nextSeed;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes + delayMinutes,
      scheduledArriveMinute: state.simMinute + leg.blockMinutes,
      fare: 0,
      marketingSpend: 0,
      isPositioning: true,
    };
    state.activeFlights.push(activeFlight);
    state.positioningLegs.splice(i, 1);
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

        if (flight.isPositioning) {
          // No market, no passengers, no revenue — just the real fuel and
          // departure cost of moving the aircraft (sim/economy.ts's
          // legCost(), the same formula a revenue flight's cost half uses).
          const cost = legCost(blockMinutes, type);
          state.cash -= cost;
          state.todayCost += cost;
          state.todayMargin -= cost;
        } else {
          const marketFrequency = legsServingMarket(flight.origin, flight.dest, state.schedule);
          const result = flightResult({ origin: flight.origin, dest: flight.dest, blockMinutes }, type, marketFrequency, {
            fare: flight.fare,
            marketingSpend: flight.marketingSpend,
          });
          state.cash += result.margin;
          state.todayRevenue += result.revenue;
          state.todayCost += result.cost;
          state.todayMargin += result.margin;
        }
      }
    }

    state.completedToday.push(flight.legId);
    state.activeFlights.splice(i, 1);
  }

  state.simMinute += 1;
}
