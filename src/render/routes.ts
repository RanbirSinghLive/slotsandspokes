import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { scheduleLegs } from '../sim/schedule';

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

const distinctRoutes = new Map<string, { origin: string; dest: string }>();
for (const leg of scheduleLegs) {
  const key = routeKey(leg.origin, leg.dest);
  if (!distinctRoutes.has(key)) {
    distinctRoutes.set(key, { origin: leg.origin, dest: leg.dest });
  }
}

/**
 * Draw every distinct route as a thin, dim arc. A LineString with just its
 * two endpoints is enough — d3.geoPath resamples along the great circle
 * between them as it projects, which is what produces the curved look (see
 * CLAUDE.md's note on this under "Geography").
 */
export function drawRoutes(ctx: CanvasRenderingContext2D): void {
  const path = geoPath(projection, ctx);

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
