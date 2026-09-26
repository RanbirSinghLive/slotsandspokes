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
// and distances feeding into them are real (GeoNames places summed into
// each airport's catchment by src/headless/buildAirports.ts, real
// coordinates), but nothing converts "these two cities are this big and
// this far apart" into an actual passenger count from any real source.
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
 * Airports closer than this have no market between them. Two airports
 * that near serve the same place, and the gravity model would read them
 * as two big populations at almost no distance: enormous demand for a
 * trip nobody flies. The map keeps one airport per metro, so this is a
 * safety net rather than something the current airports hit. The
 * shortest real market on the map is Saint John–Fredericton, 43 nm.
 */
export const MIN_MARKET_NM = 30;

/**
 * Markets the gravity model gets badly wrong, suppressed to zero demand.
 *
 * This is a **soft** restriction on purpose: nothing stops a route being
 * drawn on a suppressed market, it simply carries nobody, so the mistake
 * costs money rather than being forbidden outright. That keeps the rule
 * out of the route builder's constraint logic and lets it read as a
 * property of the world rather than an arbitrary ban.
 *
 * Same-city pairs are handled by MIN_MARKET_NM, not by this list. It is
 * for any other pair the model gets wrong, and it is empty today. Each
 * entry carries its own reason so the next person to read the list can
 * tell a deliberate balance decision from an accident.
 */
type SuppressedMarket = { origin: string; dest: string; reason: string };

const suppressedByKey = new Map<string, SuppressedMarket>(
  (suppressedMarketsData as SuppressedMarket[]).map((m) => [[m.origin, m.dest].sort().join('-'), m]),
);

/** The reason this market has no demand, or undefined if it has some — for the UI to explain itself. */
export function suppressedMarketReason(originIata: string, destIata: string): string | undefined {
  const listed = suppressedByKey.get(pairKey(originIata, destIata));
  if (listed) return listed.reason;
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (origin && dest && originIata !== destIata && greatCircleDistanceNm(origin, dest) < MIN_MARKET_NM) {
    return `These airports are under ${MIN_MARKET_NM} nm apart and serve the same place, so nobody flies between them.`;
  }
  return undefined;
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
 * every pair is worked out once at module load and this is a lookup. The
 * map, the daily market pass and the hub model all call it for every
 * pair, and the pair count grows with the square of the airport count.
 */
export function potentialDailyDemand(originIata: string, destIata: string): number {
  if (!airportsByIata.has(originIata) || !airportsByIata.has(destIata)) {
    throw new Error(`potentialDailyDemand: unknown airport in pair ${originIata}-${destIata}`);
  }
  if (originIata === destIata) return 0;
  return potentialByPair.get(pairKey(originIata, destIata)) ?? 0;
}

/** The same key as schedule.ts's marketKey(), without sorting an array on every call. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function gravityDemand(origin: AirportDemandInput, dest: AirportDemandInput): number {
  if (suppressedByKey.has(pairKey(origin.iata, dest.iata))) return 0;
  const distanceNm = greatCircleDistanceNm(origin, dest);
  if (distanceNm < MIN_MARKET_NM) return 0;
  const gravity = (origin.population * dest.population) / Math.pow(distanceNm, DISTANCE_EXPONENT);
  return Math.round(gravity * SCALING_CONSTANT);
}

/** Great-circle distance between two of this map's airports, in nautical miles. */
export function marketDistanceNm(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) throw new Error(`marketDistanceNm: unknown airport in pair ${originIata}-${destIata}`);
  return greatCircleDistanceNm(origin, dest);
}

/**
 * Every unordered airport pair — 17,020 for this map's 185 airports. Static
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

/** potentialDailyDemand() for every pair, keyed by pairKey(). Static data, so a module-level lookup rather than state. */
const potentialByPair = new Map<string, number>(
  ALL_MARKET_PAIRS.map(([a, b]) => [pairKey(a, b), gravityDemand(airportsByIata.get(a)!, airportsByIata.get(b)!)]),
);

/**
 * ALL_MARKET_PAIRS with each pair's key and potential worked out once, for
 * passes that visit every pair every day (sim/marketDemand.ts): building
 * 17,020 keys and looking them up again each day was a measurable part of
 * a headless year.
 */
export const MARKET_PAIR_TABLE: { origin: string; dest: string; key: string; basePotential: number }[] = ALL_MARKET_PAIRS.map(
  ([origin, dest]) => ({ origin, dest, key: pairKey(origin, dest), basePotential: potentialDailyDemand(origin, dest) }),
);
