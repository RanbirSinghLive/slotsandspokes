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
// AVG_FARE, not calibrated against any real O-D survey — the populations
// and distances feeding into them are real (StatsCan 2021 census CMA/CA,
// real coordinates), but nothing converts "these two cities are this big
// and this far apart" into an actual passenger count from any real source.
// See WEEK-TWO.md's "1. O-D demand" for the original rationale, and its
// "Scaling strategy" note for why `population` lives as a plain field on
// each airport rather than anything StatsCan-specific.
//
// `SCALING_CONSTANT` was tripled in week four (was 1.6e-8): with only the
// Beechcraft 1900D (19 seats) available and the original constant, 31 of
// this map's 45 city pairs worked out to under 10 passengers each way —
// barely playable, since almost every market was a trap. Tripling it
// (checked against all 45 pairs before picking this number, not guessed)
// gets 10 pairs into the "one full 1900D flight" zone (10-19 each way), 19
// more workable with a second frequency or a bigger gauge, and leaves 16
// genuinely thin — still a real pitfall zone, just not swallowing the
// whole map. `DISTANCE_EXPONENT` was left alone on purpose: softening it
// instead was tried and rejected, since it blows up the biggest pairs (the
// golden triangle) far more than it helps the small ones, being a
// distance-shaped adjustment applied to what's fundamentally a
// population-size problem at the thin end.
const DISTANCE_EXPONENT = 1;
const SCALING_CONSTANT = 4.8e-8;

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
