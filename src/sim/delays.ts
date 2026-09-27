import { nextRandom } from './rng';
import { WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES } from './weather';

/**
 * The four causes a departing flight's arrival delay is built from, kept
 * apart from the tick loop (sim/step.ts). That also lets the delay
 * distributions be
 * *sampled* from outside the simulation (ui/devTools.ts histograms them
 * to show what the model actually produces) without exporting the
 * internals of the tick function to do it.
 *
 * Each cause addresses a different question:
 *
 *   1. Age (rollAgeDelay) — this aircraft's own baseline mechanical/
 *      operational unreliability, worse the older the airframe: a
 *      brand-new (age 0) aircraft is about 65% on time, with delays of
 *      up to 45 minutes.
 *   2. Weather (rollWeatherDelay) — an airport with active weather
 *      (sim/weather.ts) rolls against far worse odds.
 *   3. Knock-on (knockOnDelayMinutes) — *not* a fresh random event: a
 *      deterministic fraction of however late this flight is already
 *      departing, because an earlier leg on this same tail ate into its
 *      turn buffer. Real airline delays compound through a rotation
 *      rather than just shifting a flight's day later by a fixed
 *      amount — a rushed turnaround loses its gate slot, its ATC slot,
 *      its crew's slack — and this is the crude version of that.
 *   4. Congestion (rollCongestionDelay) — the busier of the flight's two
 *      airports, judged against its capacity (sim/airports.ts's
 *      airportLoad()). Nothing at a quiet field; a steep rise as an
 *      airport fills up. This is the on-time price of building a hub.
 *
 * Deliberately additive and independent rather than one combined
 * distribution, so another cause (crew, ATC) can join this same list
 * later without reshaping the others.
 */
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

/** The odds and worst case an aircraft of this age departs against — exported so ui/devTools.ts can label its histograms with the real figures rather than restating them by hand. */
export function ageDelayParameters(ageYears: number): { onTimeProbability: number; maxDelayMinutes: number } {
  return {
    onTimeProbability: Math.max(
      AGE_ON_TIME_PROBABILITY_FLOOR,
      AGE_ON_TIME_PROBABILITY_BASE - AGE_ON_TIME_PROBABILITY_PER_YEAR * ageYears,
    ),
    maxDelayMinutes: AGE_MAX_DELAY_MINUTES_BASE + AGE_MAX_DELAY_MINUTES_PER_YEAR * ageYears,
  };
}

/**
 * Cause 1: age. Reliability degrades linearly with age from the model's
 * original 65%-on-time/45-minute-max baseline (age 0 reproduces it
 * almost exactly), floored so a genuinely ancient airframe still isn't a
 * coin flip on every single departure.
 */
export function rollAgeDelay(
  seed: number,
  ageYears: number,
  maintenanceFactor = 1,
): [delayMinutes: number, nextSeed: number] {
  // Maintenance scales *effective* age rather than adding a fourth delay
  // cause (sim/aog.ts's MAINTENANCE_AGE_FACTOR, a maintenance COO): a
  // well-kept airframe behaves younger than its years. Defaults to 1, the
  // raw age, for callers that don't pass one (the histogram sampler in
  // ui/devTools.ts).
  const { onTimeProbability, maxDelayMinutes } = ageDelayParameters(ageYears * maintenanceFactor);
  return rollCauseDelay(seed, onTimeProbability, maxDelayMinutes);
}

/** Cause 2: weather. Clear skies at the origin contribute nothing. */
export function rollWeatherDelay(seed: number, hasWeatherAtOrigin: boolean): [delayMinutes: number, nextSeed: number] {
  if (!hasWeatherAtOrigin) return [0, seed];
  return rollCauseDelay(seed, WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES);
}

/**
 * Cause 4: congestion. `load` is the busier end's peak traffic over its
 * capacity (sim/airports.ts's airportLoad()). Below CONGESTION_ONSET_LOAD
 * an airport is simply not busy enough to queue anyone, and no random
 * number is drawn. Above it, both the chance of a delay and the worst case
 * climb, the chance on a squared curve: queues stay short while there's
 * slack and grow quickly once there isn't, which is how real ones behave.
 *
 *   load 0.5 → never delayed
 *   load 0.75 → about 9% delayed, up to 35 min
 *   load 1.0 (full) → 35% delayed, up to 55 min
 *   load 1.2 and above → 60% delayed, up to ~70 min
 */
const CONGESTION_ONSET_LOAD = 0.5;
const CONGESTION_CHANCE_AT_FULL = 0.35;
const CONGESTION_CHANCE_MAX = 0.6;
const CONGESTION_MAX_DELAY_BASE = 15;
const CONGESTION_MAX_DELAY_PER_UNIT = 40;
const CONGESTION_MAX_OVERLOAD = 1.5;

/** The chance and worst case a departure faces at this load — exported so the airport view can show them. */
export function congestionParameters(load: number): { delayChance: number; maxDelayMinutes: number } {
  if (load <= CONGESTION_ONSET_LOAD) return { delayChance: 0, maxDelayMinutes: 0 };
  const pressure = Math.min(CONGESTION_MAX_OVERLOAD, (load - CONGESTION_ONSET_LOAD) / (1 - CONGESTION_ONSET_LOAD));
  return {
    delayChance: Math.min(CONGESTION_CHANCE_MAX, CONGESTION_CHANCE_AT_FULL * pressure * pressure),
    maxDelayMinutes: Math.round(CONGESTION_MAX_DELAY_BASE + CONGESTION_MAX_DELAY_PER_UNIT * pressure),
  };
}

export function rollCongestionDelay(seed: number, load: number): [delayMinutes: number, nextSeed: number] {
  const { delayChance, maxDelayMinutes } = congestionParameters(load);
  if (delayChance === 0) return [0, seed];
  return rollCauseDelay(seed, 1 - delayChance, maxDelayMinutes);
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
export function knockOnDelayMinutes(lateAtDepartureMinutes: number): number {
  return Math.round(Math.max(0, lateAtDepartureMinutes) * KNOCK_ON_FACTOR);
}

/**
 * How the On-Time stat decides whether a flight counts: judged at
 * *arrival*, and on time if it landed no more than this many minutes
 * after its scheduled arrival. This is the industry's usual definition
 * (arrival within 14 minutes 59 seconds; with whole-minute time here,
 * 15 is the same line).
 *
 * Arrival rather than departure because arrival is what the passenger
 * feels. Under the old departure-based rule a leg's own rolled delay
 * could never make *that* leg late, only the next one, so the first leg
 * of every aircraft's day was on time by construction.
 */
export const ON_TIME_GRACE_MINUTES = 15;

/** Whether a flight that landed at `arriveMinute` counts as on time. Shared by the sim's counters and the map's late colouring so the two can't disagree. */
export function isOnTimeArrival(arriveMinute: number, scheduledArriveMinute: number): boolean {
  return arriveMinute - scheduledArriveMinute <= ON_TIME_GRACE_MINUTES;
}

/**
 * One flight's delay, broken out by cause rather than pre-summed — the
 * On-Time panel's "top delay codes" ranking (`ui/onTime.ts`) needs to
 * attribute minutes to age/weather/knock-on individually, not just know
 * the total that actually delayed the flight.
 */
export type DelayBreakdown = { age: number; weather: number; knockOn: number; congestion: number };

/**
 * Roll a departing flight's total arrival delay from all four causes
 * above, threading `state.rngSeed` through the three that need it (age,
 * weather, then congestion). Returns [breakdown, nextSeed] — the same second-element
 * shape nextRandom() itself returns, so the caller just does
 * `state.rngSeed = nextSeed`; sum `breakdown`'s three fields for the
 * actual minutes to add to a flight's arrival time.
 */
export function rollTotalDelayMinutes(
  seed: number,
  ageYears: number,
  hasWeatherAtOrigin: boolean,
  lateAtDepartureMinutes: number,
  congestionLoad: number,
  maintenanceFactor = 1,
): [breakdown: DelayBreakdown, nextSeed: number] {
  const [age, seedAfterAge] = rollAgeDelay(seed, ageYears, maintenanceFactor);
  const [weather, seedAfterWeather] = rollWeatherDelay(seedAfterAge, hasWeatherAtOrigin);
  const [congestion, seedAfterCongestion] = rollCongestionDelay(seedAfterWeather, congestionLoad);
  const knockOn = knockOnDelayMinutes(lateAtDepartureMinutes);
  return [{ age, weather, knockOn, congestion }, seedAfterCongestion];
}
