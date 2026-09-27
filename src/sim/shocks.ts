import airportsData from '../../data/airports.json';
import { dayIndex } from './clock';
import { FUEL_SHARE_OF_BLOCK_HOUR_COST } from './fuel';
import { greatCircleDistanceNm } from './geo';
import { nextRandom } from './rng';
import type { SimState } from './state';

/**
 * Shocks: announced events that make the world less steady for a while
 * (WEEK-NINE.md, thread 4). Growth at any cost should be dangerous, and
 * what punishes it is a shock arriving when the cash cushion is thin and
 * the fleet over-extended; a careful airline should come through bruised.
 *
 * - **Fuel spike**: fuel up by `magnitude` (40–80%) for its length, on
 *   top of wherever the daily price is (sim/fuelPrice.ts).
 *   Fuel is FUEL_SHARE_OF_BLOCK_HOUR_COST of the block-hour cost, so every
 *   flight costs about 15–30% more.
 * - **Recession**: every market's potential down by `magnitude` (15–25%);
 *   demand already flying above the new ceiling falls to it at once.
 * - **Storm season**: round one airport, within STORM_RADIUS_NM, storms
 *   form STORM_SEASON_MULTIPLIER times as often, in or out of season, and
 *   close airports more often (sim/weather.ts).
 *
 * At most one at a time, none before FIRST_SHOCK_DAY (the early valley
 * is hard enough), and none within CALM_AFTER_SHOCK_DAYS of the last. Every roll comes from the seeded stream, the same number
 * each day whether or not one starts, so a seed still repeats exactly.
 */

export type ShockKind = 'fuel' | 'recession' | 'storms';

export type Shock = {
  kind: ShockKind;
  /** The airline's day it began and the first day it's over. */
  startDay: number;
  endDay: number;
  /** Fuel: the rise (0.6 is 60% dearer). Recession: the fall in potential (0.2 is 20% lower). Storms: unused. */
  magnitude: number;
  /** Storms: the airport the season is centred on. */
  centre?: string;
};

/** No shocks before this day. */
export const FIRST_SHOCK_DAY = 60;
/** The daily chance of a shock starting, while none is running or just ended. About three a year. */
export const SHOCK_CHANCE_PER_DAY = 1 / 90;
/** Days of calm after a shock ends before another can start, so they don't arrive back to back. */
export const CALM_AFTER_SHOCK_DAYS = 30;
/** Storm season's reach round its centre, and how much likelier storms are inside it. */
export const STORM_RADIUS_NM = 400;
export const STORM_SEASON_MULTIPLIER = 3;
/** How much likelier a storm is to close its airport inside a storm season. */
export const STORM_SEVERITY_MULTIPLIER = 2;

const KINDS: ShockKind[] = ['fuel', 'recession', 'storms'];
/** [shortest, longest] length in days, and [smallest, largest] magnitude, by kind. */
const RANGES: Record<ShockKind, { days: [number, number]; magnitude: [number, number] }> = {
  fuel: { days: [30, 75], magnitude: [0.4, 0.8] },
  recession: { days: [60, 120], magnitude: [0.15, 0.25] },
  storms: { days: [21, 42], magnitude: [0, 0] },
};

type Located = { iata: string; name: string; lat: number; lon: number };
const airports = airportsData as Located[];
const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/** The shock running today, if any. Optional in the save: older games have none. */
export function activeShock(state: SimState): Shock | null {
  const shock = state.shock ?? null;
  return shock && dayIndex(state) < shock.endDay ? shock : null;
}

/** What a recession leaves of every market's potential: 1 when there's none. */
export function recessionFactor(state: SimState): number {
  const shock = activeShock(state);
  return shock?.kind === 'recession' ? 1 - shock.magnitude : 1;
}

/** Whether an airport is inside the running storm season. */
export function inStormSeason(state: SimState, iata: string): boolean {
  const shock = activeShock(state);
  if (shock?.kind !== 'storms' || !shock.centre) return false;
  const centre = airportByIata.get(shock.centre);
  const airport = airportByIata.get(iata);
  return !!centre && !!airport && greatCircleDistanceNm(centre, airport) <= STORM_RADIUS_NM;
}

/**
 * Once a day at rollover, before the weather, fuel and demand rolls read
 * it: end a shock that's run its course, and maybe start one. Draws five
 * numbers every day, whatever happens.
 */
export function rollDailyShocks(state: SimState): void {
  const draws: number[] = [];
  for (let i = 0; i < 5; i++) {
    const [value, next] = nextRandom(state.rngSeed);
    state.rngSeed = next;
    draws.push(value);
  }
  const [chanceRoll, kindRoll, daysRoll, magnitudeRoll, centreRoll] = draws;
  const today = dayIndex(state);

  // The last shock stays on record after it ends, for the calm that follows it.
  const calm = !state.shock || today >= state.shock.endDay + CALM_AFTER_SHOCK_DAYS;
  if (calm && today >= FIRST_SHOCK_DAY && chanceRoll < SHOCK_CHANCE_PER_DAY) {
    const kind = KINDS[Math.min(KINDS.length - 1, Math.floor(kindRoll * KINDS.length))];
    const range = RANGES[kind];
    const days = Math.round(range.days[0] + daysRoll * (range.days[1] - range.days[0]));
    const magnitude = Math.round((range.magnitude[0] + magnitudeRoll * (range.magnitude[1] - range.magnitude[0])) * 100) / 100;
    state.shock = { kind, startDay: today, endDay: today + days, magnitude };
    if (kind === 'storms') {
      // Centred on an airport the player knows, so the season lands where it can matter.
      const known = state.knownAirports.length > 0 ? state.knownAirports : airports.map((airport) => airport.iata);
      state.shock.centre = known[Math.min(known.length - 1, Math.floor(centreRoll * known.length))];
    }
  }
}

const namesByIata = new Map(airports.map((airport) => [airport.iata, airport.name]));

export type ShockDescription = {
  /** Stable while the shock lasts, for dismissing its alert. */
  key: string;
  /** What's happening, for the ticker and the alert strip. */
  headline: string;
  /** What it does to one route, or null if it doesn't touch that route. */
  onRoute: (a: string, b: string) => string | null;
};

function moreDays(count: number): string {
  return `${count} more day${count === 1 ? '' : 's'}`;
}

/**
 * The running shock in words, for the ticker, the alert strip and the
 * route view. Null when none is running.
 */
export function describeShock(state: SimState): ShockDescription | null {
  const shock = activeShock(state);
  if (!shock) return null;
  const left = `for about ${moreDays(shock.endDay - dayIndex(state))}`;
  const key = `shock:${shock.kind}:${shock.startDay}`;
  const percent = Math.round(shock.magnitude * 100);
  if (shock.kind === 'fuel') {
    const flightCost = Math.round(shock.magnitude * FUEL_SHARE_OF_BLOCK_HOUR_COST * 100);
    return {
      key,
      headline: `Fuel spike: fuel costs ${percent}% more ${left}.`,
      onRoute: () => `Fuel spike: flights here cost about ${flightCost}% more ${left}.`,
    };
  }
  if (shock.kind === 'recession') {
    return {
      key,
      headline: `Recession: every market's demand is ${percent}% lower ${left}.`,
      onRoute: () => `Recession: demand here is ${percent}% lower ${left}.`,
    };
  }
  const centre = shock.centre ?? '';
  const place = namesByIata.get(centre) ?? centre;
  return {
    key,
    headline: `Storm season around ${place}: storms ${STORM_SEASON_MULTIPLIER}× as likely within ${STORM_RADIUS_NM} nm, and more of them close airports, ${left}.`,
    onRoute: (a, b) =>
      inStormSeason(state, a) || inStormSeason(state, b)
        ? `Storm season around ${place}: expect more weather delays and closures here ${left}.`
        : null,
  };
}

/** What the last shock was called once it's over, for the ticker's "it's over" line. */
export function shockEndedLine(shock: Shock): string {
  if (shock.kind === 'fuel') return 'The fuel spike is over: fuel is back to its usual price.';
  if (shock.kind === 'recession') return 'The recession is over: demand is back where it was heading.';
  return `The storm season around ${namesByIata.get(shock.centre ?? '') ?? shock.centre} is over.`;
}
