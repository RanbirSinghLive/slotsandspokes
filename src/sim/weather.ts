import { inStormSeason, STORM_SEASON_MULTIPLIER, STORM_SEVERITY_MULTIPLIER } from './shocks';
import { calendarDayOfYear, dayIndex } from './clock';
import airportsData from '../../data/airports.json';
import { greatCircleDistanceNm } from './geo';
import { nextRandom } from './rng';
import type { SimState } from './state';

export type WeatherKind = 'thunderstorm' | 'snowstorm';

/**
 * Weather has two severities. Moderate weather worsens the departure
 * delay roll. **Severe** weather closes the airport outright: nothing
 * departs from it, and everything scheduled to is cancelled, as real
 * airports close above some storm severity.
 */
export type WeatherSeverity = 'moderate' | 'severe';

export type WeatherEvent = {
  kind: WeatherKind;
  severity: WeatherSeverity;
  endsAtMinute: number;
};

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

// Moderate weather doesn't ground aircraft or force diversions: it makes
// the delay roll (sim/delays.ts) worse at the *origin* airport — reusing the mechanism rather than
// inventing a new aircraft state.
export const WEATHER_ON_TIME_PROBABILITY = 0.2;
export const WEATHER_MAX_DELAY_MINUTES = 90;

/**
 * Chance that a storm — newly formed or spread — is severe enough to
 * close its airport rather than merely delay departures from it.
 *
 * Deliberately small, and it has to be: weather in this sim is a
 * **day-scale** event by design (see rollDailyWeather's own note), so a
 * closure grounds that airport's whole day rather than a few hours of
 * it. Measured at 18% the first time, that wiped out 27% of the schedule
 * and moved the optimum on two unrelated sweep levers.
 *
 * Sub-day closure windows were tried as the alternative and rejected:
 * storms are created spanning the start of the day, so a real window
 * meant they only ever caught the small hours and the mechanic never
 * fired at all. Matching the model's existing day-scale treatment and
 * making severe weather rare is both simpler and consistent with how
 * every other part of this file already behaves.
 *
 * There's also no player lever against it, unlike crew shortages (reserve
 * depth) or mechanical events (maintenance staffing and fleet age), which
 * is its own argument for keeping it a background risk rather than a
 * major cause.
 */
const SEVERE_WEATHER_PROBABILITY = 0.04;

/**
/**
 * Whether this airport is closed today — the cancellation trigger, as
 * opposed to the delay one, which any active storm triggers regardless of
 * severity. Day-scale like the rest of this file.
 */
export function isAirportClosed(state: SimState, iata: string): boolean {
  return state.weatherByAirport[iata]?.severity === 'severe';
}

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
 * identical weather history, as CLAUDE.md's determinism rule requires.
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
  // Inside a storm season (sim/shocks.ts) storms close airports more often.
  function rollSeverity(iata: string): WeatherSeverity {
    const chance = SEVERE_WEATHER_PROBABILITY * (inStormSeason(state, iata) ? STORM_SEVERITY_MULTIPLIER : 1);
    return roll() < chance ? 'severe' : 'moderate';
  }

  // Spread first, from whatever survived the expiry check above (i.e.
  // yesterday's storms) — so a storm's neighbors get a chance to catch it
  // before today's independent origination roll runs on top.
  for (const iata of Object.keys(state.weatherByAirport)) {
    const source = state.weatherByAirport[iata];
    for (const neighbor of neighborsByIata.get(iata) ?? []) {
      if (state.weatherByAirport[neighbor]) continue;
      if (roll() < DAILY_SPREAD_PROBABILITY) {
        // A spreading storm rolls its own severity rather than inheriting
        // the source's — the same cell can close one airport and merely
        // delay the next one over, which is how it actually works.
        state.weatherByAirport[neighbor] = {
          kind: source.kind,
          severity: rollSeverity(neighbor),
          endsAtMinute: dayStartMinute + rollDuration(),
        };
      }
    }
  }

  const dayOfYear = calendarDayOfYear(state, dayIndex(state, dayStartMinute));
  const season = seasonalKind(dayOfYear);

  for (const airport of airports) {
    if (state.weatherByAirport[airport.iata]) continue;
    // Outside both seasons no new storms form, except inside a storm
    // season (sim/shocks.ts), where they form more often in any season.
    const storming = inStormSeason(state, airport.iata);
    const kind = season ?? (storming ? 'thunderstorm' : null);
    if (!kind) continue;
    if (roll() < DAILY_ORIGINATION_PROBABILITY * (storming ? STORM_SEASON_MULTIPLIER : 1)) {
      state.weatherByAirport[airport.iata] = {
        kind,
        severity: rollSeverity(airport.iata),
        endsAtMinute: dayStartMinute + rollDuration(),
      };
    }
  }
}
