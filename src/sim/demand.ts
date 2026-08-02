import airportsData from '../../data/airports.json';
import suppressedMarketsData from '../../data/suppressed-markets.json';
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
 * Markets the gravity model gets badly wrong, suppressed to zero demand.
 *
 * This is a **soft** restriction on purpose: nothing stops a route being
 * drawn on a suppressed market, it simply carries nobody, so the mistake
 * costs money rather than being forbidden outright. That keeps the rule
 * out of the route builder's constraint logic and lets it read as a
 * property of the world rather than an arbitrary ban.
 *
 * The register exists because these will accumulate. A gravity model
 * multiplied by population and divided by distance always misbehaves
 * where two airports serve the same city — enormous populations at
 * almost no distance — and this map already has one such pair. Each entry
 * carries its own reason so the next person to read the list can tell a
 * deliberate balance decision from an accident.
 */
type SuppressedMarket = { origin: string; dest: string; reason: string };

const suppressedByKey = new Map<string, SuppressedMarket>(
  (suppressedMarketsData as SuppressedMarket[]).map((m) => [[m.origin, m.dest].sort().join('-'), m]),
);

/** The reason this market is suppressed, or undefined if it isn't — for the UI to explain itself. */
export function suppressedMarketReason(originIata: string, destIata: string): string | undefined {
  return suppressedByKey.get([originIata, destIata].sort().join('-'))?.reason;
}

/**
 * The *potential* daily demand for a city pair — how many people would
 * travel between `originIata` and `destIata` on an average day if the
 * market were fully mature and well served, in either direction combined.
 * A property of the city pair, not of any airline.
 *
 * Week six renamed this from `dailyDemand()` to make an important
 * distinction explicit: this is **latent** demand, not the traffic
 * actually flying today. A market nobody serves doesn't carry this many
 * passengers — it carries almost none, and grows toward this figure only
 * as airlines actually fly it (see sim/marketDemand.ts). Everything that
 * books passengers reads *actual* demand; this is the ceiling it climbs
 * toward, and the "how big could this get" figure the map shows for a
 * market that doesn't exist yet.
 *
 * A pure function of static data (population, great-circle distance), so
 * it's cheap to call as often as needed rather than caching a matrix.
 */
export function potentialDailyDemand(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`potentialDailyDemand: unknown airport in pair ${originIata}-${destIata}`);
  }
  if (origin.iata === dest.iata) return 0;
  if (suppressedByKey.has([originIata, destIata].sort().join('-'))) return 0;

  const distanceNm = greatCircleDistanceNm(origin, dest);
  const gravity = (origin.population * dest.population) / Math.pow(distanceNm, DISTANCE_EXPONENT);
  return Math.round(gravity * SCALING_CONSTANT);
}

/**
 * Every unordered airport pair — 171 for this map's 19 airports. Static
 * geography, computed once at module load rather than on every use.
 *
 * Lives here rather than in any one consumer because two separate places
 * now need the same "every market that could exist" list: the competitor
 * AI picking a market to open (sim/competitors.ts) and the daily market
 * stimulation/decay pass (sim/marketDemand.ts). Two hand-maintained
 * copies of the same derivation is exactly the drift this codebase
 * avoids elsewhere.
 */
export const ALL_MARKET_PAIRS: [string, string][] = (() => {
  const codes = (airportsData as AirportDemandInput[]).map((airport) => airport.iata);
  const pairs: [string, string][] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      pairs.push([codes[i], codes[j]]);
    }
  }
  return pairs;
})();
