import airportsData from '../../data/airports.json';
import { MX_HOME_FREE_LEVELS } from './bases';
import { STARTING_CREW_CLASS, STARTING_CREWS } from './crews';
import { placeHomeRival } from './competitors';
import { ensureRivalFleets } from './market';
import { DIFFICULTY_SETTINGS, type GameDifficulty } from './difficulty';
import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { marketDistanceNm, potentialDailyDemand } from './demand';
import { START_DAY_OF_YEAR, startingSimMinute, type StartSeason } from './clock';
import { revealReach } from './reach';
import { countryOf, legRights } from './rights';
import { createStartingFleet, type SimState } from './state';
import { makeOffers } from './contracts';

/**
 * Choosing where the airline starts. A new game begins with one
 * propeller plane at a home city the player picks, so the home has to
 * have somewhere to fly it: a city is offered only if at least
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

/** The airports a starting propeller can fly a market to from `iata`. */
export function homeNeighbours(iata: string): string[] {
  return airports
    .filter((other) => other.iata !== iata && marketDistanceNm(iata, other.iata) <= PROPELLER_RANGE_NM && potentialDailyDemand(iata, other.iata) > 0 && legRights(countryOf(iata), iata, other.iata).ok)
    .map((other) => other.iata);
}

/** Every city the player may start from, biggest first. */
export function homeOptions(): HomeOption[] {
  return airports
    .map((airport) => ({
      iata: airport.iata,
      name: airport.name,
      population: airport.population,
      neighbours: homeNeighbours(airport.iata).length,
    }))
    .filter((option) => option.neighbours >= MIN_NEIGHBOURS)
    .sort((a, b) => b.population - a.population);
}

/**
 * Start the game from `iata`. Only meant for the very start: it replaces
 * the fleet, so calling it once routes are flying would strand them.
 */
export function chooseHome(state: SimState, iata: string, season: StartSeason = 'summer', difficulty: GameDifficulty = 'medium', eventsOff = false): void {
  state.homeAirport = iata;
  state.difficulty = difficulty;
  if (eventsOff) state.eventsOff = true;
  state.cash = DIFFICULTY_SETTINGS[difficulty].startingCash;
  // The calendar starts on the chosen season's date (sim/clock.ts).
  state.startDayOfYear = START_DAY_OF_YEAR[season];
  // The airline's day runs on home time (sim/clock.ts), so the clock
  // starts at home midnight rather than UTC midnight.
  state.simMinute = startingSimMinute(iata);
  state.aircraft = createStartingFleet(iata);
  // Home is the first crew base, crewed for the starting plane (sim/crews.ts).
  state.crewBases = { [iata]: { crewsByClass: { [STARTING_CREW_CLASS]: STARTING_CREWS }, hiring: [], retraining: [], cabinByClass: {}, cabinHiring: [] } };
  // And the first maintenance bases (sim/bases.ts): home's line base and hangar, three planes a night and three bays, rated for the starting plane.
  state.lineBases = { [iata]: MX_HOME_FREE_LEVELS };
  state.heavyBases = { [iata]: MX_HOME_FREE_LEVELS };
  state.mxRatings = { [iata]: [STARTING_CREW_CLASS] };
  // Whatever the placeholder home revealed is forgotten: the map opens up
  // around the city actually chosen.
  state.knownAirports = [];
  revealReach(state);
  // A rival already flies from the new home (sim/competitors.ts), with
  // its plane from before the game (sim/market.ts).
  placeHomeRival(state);
  ensureRivalFleets(state);
  // The first contracts (sim/contracts.ts), more and bigger for a weak home.
  makeOffers(state, true);
}
