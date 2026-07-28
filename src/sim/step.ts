import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, legCost, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket, marketKey } from './schedule';
import { nextRandom } from './rng';
import { rollDailyWeather, WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES } from './weather';
import { rollCompetitorRouteOpenings } from './competitors';
import type { SimState, ActiveFlight } from './state';

const MINUTES_PER_DAY = 1440;

const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);

// A departing flight's total arrival delay is the sum of three causes,
// each addressing a different question:
//
//   1. Age (rollAgeDelay) — this aircraft's own baseline mechanical/
//      operational unreliability, worse the older the airframe. A
//      brand-new (age 0) aircraft reproduces this model's old flat
//      65%-on-time/45-minute-max numbers almost exactly, on purpose —
//      age is a genuine widening of the old model, not a silent re-tune
//      of the game's whole balance in the same pass.
//   2. Weather (rollWeatherDelay) — an airport with active weather
//      (sim/weather.ts) rolls against far worse odds. Unchanged in
//      spirit from before this rework.
//   3. Knock-on (knockOnDelayMinutes) — *not* a fresh random event: a
//      deterministic fraction of however late this flight is already
//      departing, because an earlier leg on this same tail ate into its
//      turn buffer. Real airline delays compound through a rotation
//      rather than just shifting a flight's day later by a fixed
//      amount — a rushed turnaround loses its gate slot, its ATC slot,
//      its crew's slack — and this is the crude version of that.
//
// Deliberately additive and independent rather than one combined
// distribution, so a fourth cause (maintenance events, crew, ATC) can
// join this same list later without reshaping the first three.
const AGE_ON_TIME_PROBABILITY_BASE = 0.65;
const AGE_ON_TIME_PROBABILITY_PER_YEAR = 0.01;
const AGE_ON_TIME_PROBABILITY_FLOOR = 0.35;
const AGE_MAX_DELAY_MINUTES_BASE = 45;
const AGE_MAX_DELAY_MINUTES_PER_YEAR = 2;
const KNOCK_ON_FACTOR = 0.25;

/**
 * One bernoulli-then-severity delay roll, shared by the age and weather
 * causes below. Returns [delayMinutes, nextSeed] — the same shape
 * nextRandom() itself returns, so the caller just does
 * `state.rngSeed = nextSeed`.
 *
 * One random draw decides whether this cause produces any delay at all.
 * A second draw, taken only when it does, decides how badly: squaring
 * that roll (severityRoll * severityRoll) skews the result toward the
 * low end of [1, maxDelayMinutes] — most delays are minor, with an
 * occasional long tail, rather than every delay length being equally
 * likely.
 */
function rollCauseDelay(
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
 * Cause 1: age. Reliability degrades linearly with age from the model's
 * original 65%-on-time/45-minute-max baseline (age 0 reproduces it
 * almost exactly), floored so a genuinely ancient airframe still isn't a
 * coin flip on every single departure.
 */
function rollAgeDelay(seed: number, ageYears: number): [delayMinutes: number, nextSeed: number] {
  const onTimeProbability = Math.max(
    AGE_ON_TIME_PROBABILITY_FLOOR,
    AGE_ON_TIME_PROBABILITY_BASE - AGE_ON_TIME_PROBABILITY_PER_YEAR * ageYears,
  );
  const maxDelayMinutes = AGE_MAX_DELAY_MINUTES_BASE + AGE_MAX_DELAY_MINUTES_PER_YEAR * ageYears;
  return rollCauseDelay(seed, onTimeProbability, maxDelayMinutes);
}

/** Cause 2: weather. Clear skies at the origin contribute nothing. */
function rollWeatherDelay(seed: number, hasWeatherAtOrigin: boolean): [delayMinutes: number, nextSeed: number] {
  if (!hasWeatherAtOrigin) return [0, seed];
  return rollCauseDelay(seed, WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES);
}

/**
 * Cause 3: knock-on. `lateAtDepartureMinutes` is how far past its
 * scheduled slot this flight is *actually* departing — zero for a flight
 * that got away on time, whatever the reason; positive only when an
 * earlier leg on this same tail was still occupying it past that slot.
 * No random draw: this cause is entirely a function of state already
 * determined by the time this flight departs, not a fresh event of its
 * own.
 */
function knockOnDelayMinutes(lateAtDepartureMinutes: number): number {
  return Math.round(Math.max(0, lateAtDepartureMinutes) * KNOCK_ON_FACTOR);
}

/**
 * One flight's delay, broken out by cause rather than pre-summed — the
 * On-Time panel's "top delay codes" ranking (`ui/onTime.ts`) needs to
 * attribute minutes to age/weather/knock-on individually, not just know
 * the total that actually delayed the flight.
 */
export type DelayBreakdown = { age: number; weather: number; knockOn: number };

/**
 * Roll a departing flight's total arrival delay from all three causes
 * above, threading `state.rngSeed` through the two that need it (age,
 * then weather). Returns [breakdown, nextSeed] — the same second-element
 * shape nextRandom() itself returns, so the caller just does
 * `state.rngSeed = nextSeed`; sum `breakdown`'s three fields for the
 * actual minutes to add to a flight's arrival time.
 */
function rollTotalDelayMinutes(
  seed: number,
  ageYears: number,
  hasWeatherAtOrigin: boolean,
  lateAtDepartureMinutes: number,
): [breakdown: DelayBreakdown, nextSeed: number] {
  const [age, seedAfterAge] = rollAgeDelay(seed, ageYears);
  const [weather, seedAfterWeather] = rollWeatherDelay(seedAfterAge, hasWeatherAtOrigin);
  const knockOn = knockOnDelayMinutes(lateAtDepartureMinutes);
  return [{ age, weather, knockOn }, seedAfterWeather];
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
    // Spill-and-recapture's shared pool (sim/economy.ts's flightResult())
    // is scoped to one day: unclaimed spill doesn't carry into tomorrow,
    // since nobody's actually holding a seat for anyone.
    state.spilloverByMarket = {};

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

    // Week four's competitor AI (sim/competitors.ts): once a day, each
    // competitor airline has a small independent chance to open one new
    // route. Same daily cadence as weather, for the same reason — this
    // is a day-scale event, not something worth re-checking every minute.
    rollCompetitorRouteOpenings(state, state.simMinute);
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

    // On-time performance (HUD stat next to Cash) and the knock-on delay
    // cause below share the same number: this leg was due at
    // dayStart + leg.departMinute, and it can never depart *before* that
    // (the `minuteOfDay < leg.departMinute` check above rules it out), so
    // how far past it this flight is actually departing is both "how
    // late is this one" and "how much upstream pressure is still
    // carrying forward" — a late aircraft sat waiting on an earlier leg,
    // not a fresh event of its own.
    const lateAtDepartureMinutes = state.simMinute - (dayStart + leg.departMinute);
    state.flightsDepartedTotal += 1;
    if (lateAtDepartureMinutes === 0) {
      state.flightsOnTimeTotal += 1;
    }

    // Same on-time question as the whole-airline counters just above,
    // just split out per market for the On-Time panel (ui/onTime.ts) —
    // lazily created the first time this market's first leg ever
    // departs, same "create on first use" shape routeSettings uses.
    const marketOnTimeKey = marketKey(leg.origin, leg.dest);
    const marketOnTime = (state.onTimeByMarket[marketOnTimeKey] ??= { departed: 0, onTime: 0 });
    marketOnTime.departed += 1;
    if (lateAtDepartureMinutes === 0) {
      marketOnTime.onTime += 1;
    }

    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      aircraft.ageYears,
      weatherAtOrigin,
      lateAtDepartureMinutes,
    );
    state.rngSeed = nextSeed;
    state.delayMinutesByCause.age += delayBreakdown.age;
    state.delayMinutesByCause.weather += delayBreakdown.weather;
    state.delayMinutesByCause.knockOn += delayBreakdown.knockOn;
    const delayMinutes = delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn;

    // Fare and marketing spend are market-level (RouteSettings), not
    // per-leg — every leg on this market shares the same entry.
    const routeSettings = state.routeSettings[marketOnTimeKey];

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
  // ground/turn-time gate, same three-cause delay roll — except
  // `departMinute` here is an absolute simMinute, not a minute-of-day,
  // since a positioning move never repeats: "late at departure" is just
  // `simMinute - leg.departMinute` directly, no day-start offset needed.
  // Removed from the queue the instant it departs rather than tracked in
  // `completedToday`: once it's airborne it's fully represented by its
  // ActiveFlight, and it can never come due again.
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

    // Rolled the same way a revenue leg is, but *not* added to
    // onTimeByMarket or delayMinutesByCause (see their own doc comments
    // on SimState): a positioning move isn't serving a market, so it has
    // no route-quality story to tell.
    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const lateAtDepartureMinutes = state.simMinute - leg.departMinute;
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      aircraft.ageYears,
      weatherAtOrigin,
      lateAtDepartureMinutes,
    );
    state.rngSeed = nextSeed;
    const delayMinutes = delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn;

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
          const key = marketKey(flight.origin, flight.dest);
          const spilloverAvailable = state.spilloverByMarket[key] ?? 0;
          const result = flightResult(
            { origin: flight.origin, dest: flight.dest, blockMinutes },
            type,
            marketFrequency,
            { fare: flight.fare, marketingSpend: flight.marketingSpend },
            state.competitorRoutes,
            spilloverAvailable,
          );
          state.spilloverByMarket[key] = spilloverAvailable + result.spilloverDelta;
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
