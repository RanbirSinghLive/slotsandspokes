import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { distanceToArc } from './competition';
import { getMapPreview } from './preview';
import { spillingMarkets } from '../sim/unmetDemand';
import type { SimState } from '../sim/state';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const ROUTE_STROKE = '#3a4258';
const SPILL_STROKE = '#ffb347';
const PREVIEW_STROKE = { add: '#7fd88f', change: '#ffd166', remove: '#ff8080' } as const;

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

  // A route with more demand than seats, in the same amber as the solid
  // pips at its ends: the one that needs a flight or a bigger plane.
  const spilling = spillingMarkets(state);
  if (spilling.size > 0) {
    ctx.save();
    ctx.strokeStyle = SPILL_STROKE;
    ctx.lineWidth = 2;
    for (const { origin, dest } of distinctRoutes.values()) {
      if (!spilling.has(routeKey(origin, dest))) continue;
      const originAirport = airportsByIata.get(origin);
      const destAirport = airportsByIata.get(dest);
      if (!originAirport || !destAirport) continue;
      ctx.beginPath();
      path({
        type: 'LineString',
        coordinates: [
          [originAirport.lon, originAirport.lat],
          [destAirport.lon, destAirport.lat],
        ],
      } as LineString);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The route the hovered menu button would change, drawn over the top:
  // green for an added flight, amber for a change, red and dashed for a
  // removal (render/preview.ts).
  const preview = getMapPreview();
  if (!preview) return;
  ctx.save();
  ctx.lineWidth = 3;
  for (const { origin, dest, kind } of preview.routes) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;
    ctx.strokeStyle = PREVIEW_STROKE[kind];
    ctx.setLineDash(kind === 'remove' ? [6, 4] : []);
    ctx.beginPath();
    path({
      type: 'LineString',
      coordinates: [
        [originAirport.lon, originAirport.lat],
        [destAirport.lon, destAirport.lat],
      ],
    } as LineString);
    ctx.stroke();
  }
  ctx.restore();
}

// How close a click has to land to a route's arc to count as hitting it.
const ROUTE_HIT_RADIUS_PX = 8;

export type RouteHitCandidate = { origin: string; dest: string; distPx: number; ratio: number };

/**
 * The player's own route (a market, either direction) under a screen
 * point, if any, plus *how* close (`ratio`, `distPx / ROUTE_HIT_RADIUS_PX`
 * — see render/airports.ts's nearestAirportCandidate() for the full
 * reasoning). Uses the same arc-distance test the competition hover uses,
 * so a click and a hover agree about what "on the line" means.
 *
 * ui/mapMenu.ts's handleMapMenuMouseDown() is this function's only
 * caller, and it always needs the ratio to compare against an airport
 * candidate — so unlike findNearestAirport() (which keeps a plain
 * wrapper for the route builder's drag-to-draw gesture, which genuinely
 * only ever wants "nearest airport, full stop"), there's no reason to
 * keep a ratio-less version of this one around.
 */
export function findNearestOwnRoute(screenX: number, screenY: number, state: SimState): RouteHitCandidate | null {
  const distinct = new Map<string, { origin: string; dest: string }>();
  for (const leg of state.schedule) {
    const key = routeKey(leg.origin, leg.dest);
    if (!distinct.has(key)) distinct.set(key, { origin: leg.origin, dest: leg.dest });
  }

  let nearest: { origin: string; dest: string } | null = null;
  let nearestDist = ROUTE_HIT_RADIUS_PX;
  for (const { origin, dest } of distinct.values()) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;
    const dist = distanceToArc(originAirport, destAirport, screenX, screenY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = { origin, dest };
    }
  }
  return nearest ? { ...nearest, distPx: nearestDist, ratio: nearestDist / ROUTE_HIT_RADIUS_PX } : null;
}
