import airportsData from '../../data/airports.json';
import { countryOf } from './rights';

/**
 * A coarse region for an airport, from its country and where it sits on
 * the map. Airports carry no province or state, so Canada and the US are
 * cut along longitude and latitude lines that are right for the big
 * airports and may put a border town in its neighbour; every other country
 * is its own region. It is for grouping a network's routes on a page, not
 * for any rule: nothing in the sim decides anything from it.
 */
type Position = { lat: number; lon: number };
const positions = new Map((airportsData as ({ iata: string } & Position)[]).map((a) => [a.iata, { lat: a.lat, lon: a.lon }]));

function canadianRegion({ lat, lon }: Position): string {
  if (lon <= -95) return 'Western Canada';
  // The Maritimes and Newfoundland: past the Maine line in the south, or beyond Quebec's Gaspé in the east.
  if ((lon > -68 && lat < 48) || lon > -64) return 'Atlantic Canada';
  // East of the Ottawa River, or Quebec's north-west.
  if (lon > -74.5 || (lat > 46.5 && lon > -79.5)) return 'Quebec';
  return 'Ontario';
}

function americanRegion({ lat, lon }: Position): string {
  if (lon <= -100) return 'US West';
  if (lat >= 39 && lon > -80.5) return 'US Northeast';
  if (lat < 39 && lon > -92) return 'US Southeast';
  return 'US Central';
}

/** The region of an airport, or 'Unknown' for one with no position. */
export function regionOf(iata: string): string {
  const position = positions.get(iata);
  const country = countryOf(iata);
  if (!position || country === undefined) return 'Unknown';
  if (country === 'CA') return canadianRegion(position);
  if (country === 'US') return americanRegion(position);
  return country;
}
