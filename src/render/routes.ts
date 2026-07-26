import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import type { SimState } from '../sim/state';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const ROUTE_STROKE = '#3a4258';

/**
 * Distinct origin-destination city pairs, ignoring direction — YUL-YYZ and
 * YYZ-YUL are the same line on the map, so we only need to draw it once
 * even though the schedule has separate legs for each direction.
 */
function routeKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

/**
 * Draw one thin arc per distinct market currently in `state.schedule` —
 * the markets the player is actually operating *right now*, not the
 * original `data/schedule.json` template. Recomputed fresh every call
 * (cheap: a dozen-ish legs, a Map) rather than cached — this used to be
 * a module-level Map built once from the static `scheduleLegs` import,
 * which meant the M10 route builder and week three's route-removal
 * button were both silently invisible here: adding or removing a route
 * never changed what this drew, since it was never reading from the
 * live, mutable schedule at all. A LineString with just its two
 * endpoints is enough — d3.geoPath resamples along the great circle
 * between them as it projects, which is what produces the curved look
 * (see CLAUDE.md's note on this under "Geography").
 */
export function drawRoutes(ctx: CanvasRenderingContext2D, state: SimState): void {
  const path = geoPath(projection, ctx);

  const distinctRoutes = new Map<string, { origin: string; dest: string }>();
  for (const leg of state.schedule) {
    const key = routeKey(leg.origin, leg.dest);
    if (!distinctRoutes.has(key)) {
      distinctRoutes.set(key, { origin: leg.origin, dest: leg.dest });
    }
  }

  ctx.strokeStyle = ROUTE_STROKE;
  ctx.lineWidth = 1;

  for (const { origin, dest } of distinctRoutes.values()) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;

    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [originAirport.lon, originAirport.lat],
        [destAirport.lon, destAirport.lat],
      ],
    };

    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
}
