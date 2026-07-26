import airportsData from '../../data/airports.json';
import { greatCircleDistanceNm } from './geo';
import { nextRandom } from './rng';
import type { SimState } from './state';

export type WeatherKind = 'thunderstorm' | 'snowstorm';

export type WeatherEvent = {
  kind: WeatherKind;
  endsAtMinute: number;
};

const MINUTES_PER_DAY = 1440;

// Two airports "adjacent" enough for weather to spread between them —
// reuses the same great-circle distance sim/geo.ts already computes for
// block time, no new authored data. 200nm happens to split the map into
// exactly the two clusters you'd expect a real weather cell to move
// within: the Ontario/Québec group (YUL/YOW/YQB/YYZ) and the Maritime
// group (YHZ/YSJ/YFC/YQM/YYG) — YYT (St. John's) has no neighbor within
// range, so weather there never spreads, which matches how isolated it
// actually is.
const ADJACENCY_THRESHOLD_NM = 200;

// Crude seasonal windows (day-of-year, 0 = Jan 1, same formula
// render/terminator.ts already uses for the day/night terminator) — not
// real climatology, just "thunderstorms in summer, snowstorms in
// winter," the same "principled but not researched" spirit as
// economy.ts's constants. Winter wraps past day 365 into the new year.
const SUMMER_START_DAY = 152; // ~June 1
const SUMMER_END_DAY = 243; // ~Aug 31
const WINTER_START_DAY = 335; // ~Dec 1
const WINTER_END_DAY = 59; // ~Feb 28

const DAILY_ORIGINATION_PROBABILITY = 0.08;
const DAILY_SPREAD_PROBABILITY = 0.25;
const MIN_DURATION_MINUTES = 120;
const MAX_DURATION_MINUTES = 360;

// Bare-bones effect, per WEEK-THREE.md: weather doesn't ground aircraft or
// force diversions, it just makes sim/step.ts's existing delay roll (M9)
// worse at the *origin* airport — reusing the mechanism rather than
// inventing a new aircraft state.
export const WEATHER_ON_TIME_PROBABILITY = 0.2;
export const WEATHER_MAX_DELAY_MINUTES = 90;

type AirportLocation = { iata: string; lat: number; lon: number };
const airports = airportsData as AirportLocation[];

// Every airport's neighbors within ADJACENCY_THRESHOLD_NM — static
// geography, computed once rather than on every daily roll.
const neighborsByIata = new Map<string, string[]>();
for (const a of airports) {
  neighborsByIata.set(
    a.iata,
    airports.filter((b) => b.iata !== a.iata && greatCircleDistanceNm(a, b) <= ADJACENCY_THRESHOLD_NM).map((b) => b.iata),
  );
}

function seasonalKind(dayOfYear: number): WeatherKind | null {
  if (dayOfYear >= SUMMER_START_DAY && dayOfYear <= SUMMER_END_DAY) return 'thunderstorm';
  if (dayOfYear >= WINTER_START_DAY || dayOfYear <= WINTER_END_DAY) return 'snowstorm';
  return null;
}

/**
 * Advance the weather board by one day: expire anything whose window has
 * passed, let active storms spread to adjacent airports, then roll fresh
 * storms at whatever's left uncovered and in season. Called once per
 * simulated day from step.ts's day-rollover handling — not every minute,
 * since weather is a daily-scale event, not a per-minute one.
 *
 * Every roll goes through the same seeded PRNG (`state.rngSeed`) as every
 * other random draw in sim/, so a given seed always produces the
 * identical weather history — same requirement CLAUDE.md's determinism
 * rule already holds M9's delay rolls to.
 */
export function rollDailyWeather(state: SimState, dayStartMinute: number): void {
  for (const iata of Object.keys(state.weatherByAirport)) {
    if (state.weatherByAirport[iata].endsAtMinute <= dayStartMinute) {
      delete state.weatherByAirport[iata];
    }
  }

  function roll(): number {
    const [value, nextSeed] = nextRandom(state.rngSeed);
    state.rngSeed = nextSeed;
    return value;
  }
  function rollDuration(): number {
    return Math.round(MIN_DURATION_MINUTES + roll() * (MAX_DURATION_MINUTES - MIN_DURATION_MINUTES));
  }

  // Spread first, from whatever survived the expiry check above (i.e.
  // yesterday's storms) — so a storm's neighbors get a chance to catch it
  // before today's independent origination roll runs on top.
  for (const iata of Object.keys(state.weatherByAirport)) {
    const source = state.weatherByAirport[iata];
    for (const neighbor of neighborsByIata.get(iata) ?? []) {
      if (state.weatherByAirport[neighbor]) continue;
      if (roll() < DAILY_SPREAD_PROBABILITY) {
        state.weatherByAirport[neighbor] = { kind: source.kind, endsAtMinute: dayStartMinute + rollDuration() };
      }
    }
  }

  const dayOfYear = Math.floor(dayStartMinute / MINUTES_PER_DAY) % 365;
  const kind = seasonalKind(dayOfYear);
  if (!kind) return; // outside both seasons — no new storms originate, but existing ones still expire/spread on schedule

  for (const airport of airports) {
    if (state.weatherByAirport[airport.iata]) continue;
    if (roll() < DAILY_ORIGINATION_PROBABILITY) {
      state.weatherByAirport[airport.iata] = { kind, endsAtMinute: dayStartMinute + rollDuration() };
    }
  }
}
