import { geoBounds, geoContains, geoPath } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopology from '../../data/world-110m.json';
import { projection } from './projection';
import { airports } from './airports';
import { isOpsView } from './opsView';
import { countryOf, domesticRightsCountries, grantedCountries, homeCountry } from '../sim/rights';
import type { SimState } from '../sim/state';

/**
 * The Rights view, drawn in the Ops lens: the countries where the home
 * carrier may fly domestic routes and sell domestic connections (its own
 * country, plus a cabotage bloc it belongs to; sim/rights.ts) get a soft
 * green tint and edge. Everywhere else is foreign: only international legs.
 * Nothing here is state: it reads the home airport and the shared data.
 */

const FILL = 'rgba(80, 200, 140, 0.12)';
const EDGE = 'rgba(110, 220, 160, 0.55)';

type CountryShape = Feature<Geometry, { name: string }>;

const shapes = (feature(worldTopology as unknown as Topology, (worldTopology as unknown as Topology).objects.countries) as unknown as {
  features: CountryShape[];
}).features;

/** ISO country of each shape, found once by which airports sit inside it (the basemap only carries names and numeric ids). */
let isoByShape: (string | undefined)[] | null = null;

function findShapeCountries(): (string | undefined)[] {
  if (isoByShape) return isoByShape;
  isoByShape = shapes.map((shape) => {
    const [[west, south], [east, north]] = geoBounds(shape);
    const votes = new Map<string, number>();
    for (const airport of airports) {
      // A box that wraps the antimeridian (west > east) is rare for these shapes; the full test below still decides.
      if (west <= east && (airport.lon < west || airport.lon > east || airport.lat < south || airport.lat > north)) continue;
      const iso = countryOf(airport.iata);
      if (iso && geoContains(shape, [airport.lon, airport.lat])) votes.set(iso, (votes.get(iso) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestVotes = 0;
    for (const [iso, count] of votes) if (count > bestVotes) [best, bestVotes] = [iso, count];
    return best;
  });
  return isoByShape;
}

export function drawRightsView(ctx: CanvasRenderingContext2D, state: SimState): void {
  if (!isOpsView()) return;
  const home = homeCountry(state);
  const open = new Set(domesticRightsCountries(home, grantedCountries(state)));
  if (open.size === 0) return;

  const isoCodes = findShapeCountries();
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.fillStyle = FILL;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  shapes.forEach((shape, index) => {
    const iso = isoCodes[index];
    if (!iso || !open.has(iso)) return;
    ctx.beginPath();
    path(shape);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}
