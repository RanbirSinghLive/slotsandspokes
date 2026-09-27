import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { classByCode } from './aircraftClasses';
import { marketDistanceNm } from './demand';
import { currentPotentialDemand } from './marketDemand';
import { marketSize, type Size } from './marketSize';
import { isAircraftTypeAllowedAt, marketKey, recommendedFare } from './schedule';
import { describeServiceLevel, hungerByAirport } from './serviceLevel';
import type { SimState } from './state';

/**
 * Where to fly next (WEEK-TEN.md, thread 4): the best markets from an
 * airport that the airline doesn't fly yet, in words, for the airport
 * view. A shortlist, not an answer: it names what a player weighs (how big
 * the city pair is, how starved the far end is for service, who already
 * flies it, how far) and leaves the judgement to them, in keeping with
 * markets in words (sim/marketSize.ts).
 *
 * Only markets the airline could fly now: to an airport it can see, within
 * the range of a plane based here (or, with none based here, any plane in
 * the fleet), at airports that plane can use. Ranked by marketAppeal().
 */

type TypeSpec = { code: string; rangeNm: number };
const typesByCode = new Map((aircraftTypesData as TypeSpec[]).map((type) => [type.code, type]));
const nameByIata = new Map((airportsData as { iata: string; name: string }[]).map((airport) => [airport.iata, airport.name]));

export type FlySuggestion = {
  dest: string;
  destName: string;
  size: Size;
  /** How the far end is served, in words ("Starved for service"). */
  service: string;
  /** Rival flights a day on the market, both ways counted once. */
  rivalFlights: number;
  distanceNm: number;
  /** The going fare for the trip (sim/schedule.ts's recommendedFare()): what each seat would earn. */
  fare: number;
  /** The class that would fly it: the smallest that reaches. */
  className: string;
};

/**
 * How a market ranks in the list: its potential demand, roughly riders a
 * day. Hunger and rivals are shown in words for the player to weigh, but
 * don't rank, measured with the headless player: ranking up starved ends
 * steered it to small towns (hunger speeds a market's growth, not its
 * ceiling), and ranking down rivals' markets steered it off the biggest
 * ones, which rivals fly because they're the best. Either cut a careful
 * airline's year from Montréal by more than two-thirds. The headless
 * player (src/headless/player.ts) ranks by this too, since the list's
 * order is what a player sees; the words alone are too coarse (in a dense
 * region nearly every market reads "Huge, starved").
 */
export function marketAppeal(state: SimState, a: string, b: string): number {
  return currentPotentialDemand(state, a, b);
}

/** Rival flights a day on each market, by marketKey(). */
function rivalFlightsByMarket(state: SimState): Map<string, number> {
  const byMarket = new Map<string, number>();
  for (const route of state.competitorRoutes) {
    const key = marketKey(route.origin, route.dest);
    byMarket.set(key, (byMarket.get(key) ?? 0) + route.dailyFrequency);
  }
  return byMarket;
}

export function whereToFlyFrom(state: SimState, iata: string, limit = 5): FlySuggestion[] {
  const based = state.aircraft.filter((aircraft) => aircraft.baseAirport === iata);
  const fleet = based.length > 0 ? based : state.aircraft;
  const types = [...new Set(fleet.map((aircraft) => aircraft.typeCode))]
    .map((code) => typesByCode.get(code))
    .filter((type): type is TypeSpec => type !== undefined)
    .sort((a, b) => a.rangeNm - b.rangeNm);
  if (types.length === 0) return [];

  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const rivals = rivalFlightsByMarket(state);
  const hunger = hungerByAirport(state);

  const suggestions: (FlySuggestion & { score: number })[] = [];
  for (const dest of state.knownAirports) {
    if (dest === iata || flown.has(marketKey(iata, dest))) continue;
    const potential = currentPotentialDemand(state, iata, dest);
    if (potential <= 0) continue;
    const distanceNm = marketDistanceNm(iata, dest);
    const type = types.find((t) => t.rangeNm >= distanceNm && isAircraftTypeAllowedAt(iata, t.code) && isAircraftTypeAllowedAt(dest, t.code));
    if (!type) continue;
    const rivalFlights = rivals.get(marketKey(iata, dest)) ?? 0;
    suggestions.push({
      dest,
      destName: nameByIata.get(dest) ?? dest,
      size: marketSize(state, iata, dest),
      service: describeServiceLevel(hunger.get(dest) ?? 0).label,
      rivalFlights,
      distanceNm: Math.round(distanceNm),
      fare: recommendedFare(iata, dest),
      className: classByCode(type.code)?.name ?? type.code,
      score: marketAppeal(state, iata, dest),
    });
  }
  return suggestions
    .sort((a, b) => b.score - a.score || a.dest.localeCompare(b.dest))
    .slice(0, limit)
    .map(({ score: _score, ...suggestion }) => suggestion);
}
