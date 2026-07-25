import airportsData from '../../data/airports.json';
import { greatCircleDistanceNm } from './geo';

type AirportDemandInput = { iata: string; lat: number; lon: number; population: number };

const airportsByIata = new Map<string, AirportDemandInput>(
  (airportsData as AirportDemandInput[]).map((airport) => [airport.iata, airport]),
);

// A gravity model: demand between two places scales up with how many people
// live at each end, and down with how far apart they are — the same idea
// physics uses for gravity between two masses, which is where the name
// comes from. `DISTANCE_EXPONENT` controls how sharply demand falls off with
// distance (1 = linear falloff); `SCALING_CONSTANT` just converts the
// resulting ratio into a number of people per day. Both are deliberately
// crude, tunable knobs in the same spirit as economy.ts's LOAD_FACTOR/
// AVG_FARE — picked so the biggest city pair in this map (Montréal-Toronto)
// lands in the low thousands and the smallest (Saint John-Fredericton, two
// small cities close together) lands in the tens, not calibrated against
// any real O-D survey. See WEEK-TWO.md's "1. O-D demand" for the rationale,
// and its "Scaling strategy" note for why `population` lives as a plain
// field on each airport rather than anything StatsCan-specific.
const DISTANCE_EXPONENT = 1;
const SCALING_CONSTANT = 1.6e-8;

/**
 * The estimated number of people who want to travel between `originIata`
 * and `destIata` on an average day, in *either* direction combined — this
 * is a property of the city pair, not of a specific flight or airline.
 * Direct-service-only per WEEK-TWO.md's decision 1: this is the ceiling for
 * a route that exists, and just a visible "market size" figure for one that
 * doesn't yet.
 *
 * A pure function of static data (population, great-circle distance), so
 * it's cheap to call as often as needed rather than caching a matrix.
 */
export function dailyDemand(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`dailyDemand: unknown airport in pair ${originIata}-${destIata}`);
  }
  if (origin.iata === dest.iata) return 0;

  const distanceNm = greatCircleDistanceNm(origin, dest);
  const gravity = (origin.population * dest.population) / Math.pow(distanceNm, DISTANCE_EXPONENT);
  return Math.round(gravity * SCALING_CONSTANT);
}
