import airportsData from '../../data/airports.json';
import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { marketDistanceNm, potentialDailyDemand } from './demand';
import { startingSimMinute } from './clock';
import { revealReach } from './reach';
import { createStartingFleet, type SimState } from './state';

/**
 * Choosing where the airline starts. A new game begins with two
 * propeller planes at a home city the player picks, so the home has to
 * have somewhere to fly them: a city is offered only if at least
 * MIN_NEIGHBOURS other airports sit within a propeller's range, counting
 * only pairs that actually have a market (a second airport in the same
 * city has none). That keeps the list to places with a first route, and
 * it is derived from the data rather than listed, so adding an airport to
 * data/airports.json can add a home city without touching this file.
 */

export const PROPELLER_RANGE_NM = AIRCRAFT_CLASSES[0].rangeNm;
const MIN_NEIGHBOURS = 3;

type AirportSpec = { iata: string; name: string; population: number };
const airports = airportsData as AirportSpec[];

export type HomeOption = {
  iata: string;
  name: string;
  population: number;
  /** Airports a propeller can reach from here and fly a market to. */
  neighbours: number;
};

/** Every city the player may start from, biggest first. */
export function homeOptions(): HomeOption[] {
  return airports
    .map((airport) => ({
      iata: airport.iata,
      name: airport.name,
      population: airport.population,
      neighbours: airports.filter(
        (other) =>
          other.iata !== airport.iata &&
          marketDistanceNm(airport.iata, other.iata) <= PROPELLER_RANGE_NM &&
          potentialDailyDemand(airport.iata, other.iata) > 0,
      ).length,
    }))
    .filter((option) => option.neighbours >= MIN_NEIGHBOURS)
    .sort((a, b) => b.population - a.population);
}

/**
 * Start the game from `iata`. Only meant for the very start: it replaces
 * the fleet, so calling it once routes are flying would strand them.
 */
export function chooseHome(state: SimState, iata: string): void {
  state.homeAirport = iata;
  // The airline's day runs on home time (sim/clock.ts), so the clock
  // starts at home midnight rather than UTC midnight.
  state.simMinute = startingSimMinute(iata);
  state.aircraft = createStartingFleet(iata);
  // Whatever the placeholder home revealed is forgotten: the map opens up
  // around the city actually chosen.
  state.knownAirports = [];
  revealReach(state);
}
