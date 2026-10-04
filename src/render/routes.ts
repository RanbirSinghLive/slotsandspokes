import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { distanceToArc } from './competition';
import { getMapPreview } from './preview';
import { spillingMarkets } from '../sim/unmetDemand';
import { flightsEachWay, formatFrequency, formatYield, marketYieldCents } from '../sim/routeYield';
import { isOpsView } from './opsView';
import type { SimState } from '../sim/state';
import { routeWidthsByMarket } from './routeWidth';

import { fareGapSuffix } from './fareGap';

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
 * the markets the player is operating right now. Recomputed every call
 * (cheap: a few dozen legs) rather than cached, so adding or removing a
 * route shows up on the very next frame. A LineString with just its two
 * endpoints is enough — d3.geoPath resamples along the great circle
 * between them as it projects, which is what produces the curved look
 * (see CLAUDE.md's note on this under "Geography").
 */
export function drawRoutes(ctx: CanvasRenderingContext2D, state: SimState, withLabels = false): void {
  const path = geoPath(projection, ctx);

  const distinctRoutes = new Map<string, { origin: string; dest: string }>();
  for (const leg of state.schedule) {
    // The airport filter's shown list (ui/airportFilter.ts): a route to an airport it hides isn't drawn or clickable.
    if (!isAirportKnown(leg.origin) || !isAirportKnown(leg.dest)) continue;
    const key = routeKey(leg.origin, leg.dest);
    if (!distinctRoutes.has(key)) {
      distinctRoutes.set(key, { origin: leg.origin, dest: leg.dest });
    }
  }

  ctx.strokeStyle = ROUTE_STROKE;
  ctx.lineWidth = 1;
  const widths = routeWidthsByMarket(state);

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

    if (widths) ctx.lineWidth = widths.get(routeKey(origin, dest)) ?? 1;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }

  // Ops view: labels wait until the airports have claimed their space (render/opsHub.ts).
  if (withLabels) {
    if (isOpsView()) deferredLabelRoutes = distinctRoutes;
    else drawRouteLabels(ctx, state, distinctRoutes);
  }

  // A route with more demand than seats, in the same amber as the Demand
  // lens's rim round its airports: the one that needs a flight or a
  // bigger plane.
  const spilling = spillingMarkets(state);
  if (spilling.size > 0) {
    ctx.save();
    ctx.strokeStyle = SPILL_STROKE;
    ctx.lineWidth = 2;
    for (const { origin, dest } of distinctRoutes.values()) {
      if (!spilling.has(routeKey(origin, dest))) continue;
      ctx.lineWidth = Math.max(2, widths?.get(routeKey(origin, dest)) ?? 0);
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
    if (!isAirportKnown(leg.origin) || !isAirportKnown(leg.dest)) continue;
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

const SELECTED_GLOW = 'rgba(94, 214, 200, 0.25)';
const SELECTED_STROKE = '#5ed6c8';

/**
 * The route the side panel is showing (ui/selection.ts), drawn on top of
 * whatever route layer is on: a wide soft glow under a bright line, so
 * the map shows which route the panel describes. Drawn whatever the map
 * mode, since the panel shows it whatever the map mode.
 */
export function drawSelectedRoute(ctx: CanvasRenderingContext2D, a: string, b: string): void {
  const origin = airportsByIata.get(a);
  const dest = airportsByIata.get(b);
  if (!origin || !dest) return;
  const line: LineString = { type: 'LineString', coordinates: [[origin.lon, origin.lat], [dest.lon, dest.lat]] };
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.lineCap = 'round';
  for (const [strokeStyle, lineWidth] of [[SELECTED_GLOW, 9], [SELECTED_STROKE, 2.5]] as const) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
  ctx.restore();
}

const LABEL_FONT = '10px ui-monospace, Consolas, monospace';
const LABEL_TEXT = '#9aa4bd';

// Positions tried along each arc, in order, for a label that collides
// with one already placed: the middle first, then either side of it.
const LABEL_POSITIONS = [0.5, 0.4, 0.6, 0.3, 0.7];
const LABEL_HEIGHT = 14;
const LABEL_GAP = 2;

type LabelBox = { left: number; top: number; right: number; bottom: number };

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Each route's flights a day each way and its yield (cents per passenger
 * nautical mile, last 7 days) along its arc, so fares compare at a glance.
 * Frequency counts one direction, not both added together.
 *
 * Where routes fan out of one hub their arcs run close together, so
 * labels are placed busiest route first. A label slides along its arc to
 * the first spot that clears every label already placed, and is left off
 * when none does; zooming in spreads the arcs apart and brings it back.
 */
function drawRouteLabels(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  routes: Map<string, { origin: string; dest: string }>,
  avoid: readonly LabelBox[] = [],
  only: ReadonlySet<string> | null = null,
): void {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const labelled = [...routes.entries()]
    .map(([key, { origin, dest }]) => ({
      key,
      origin,
      dest,
      flightsEachWay: Math.max(...flightsEachWay(state, origin, dest)),
    }))
    .filter(({ key }) => only === null || only.has(key))
    .sort((a, b) => b.flightsEachWay - a.flightsEachWay || (a.key < b.key ? -1 : 1));

  const placed: LabelBox[] = [...avoid];
  for (const { origin, dest } of labelled) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;
    const along = geoInterpolate([originAirport.lon, originAirport.lat], [destAirport.lon, destAirport.lat]);
    const text = `${formatFrequency(state, origin, dest)} · ${formatYield(marketYieldCents(state, origin, dest))}${fareGapSuffix(state, origin, dest)}`;
    const halfWidth = ctx.measureText(text).width / 2 + 3;

    for (const t of LABEL_POSITIONS) {
      const point = projection(along(t));
      if (!point) continue;
      const box = {
        left: point[0] - halfWidth - LABEL_GAP,
        right: point[0] + halfWidth + LABEL_GAP,
        top: point[1] - LABEL_HEIGHT / 2 - LABEL_GAP,
        bottom: point[1] + LABEL_HEIGHT / 2 + LABEL_GAP,
      };
      if (placed.some((other) => boxesOverlap(box, other))) continue;
      placed.push(box);
      ctx.fillStyle = 'rgba(10, 12, 18, 0.8)';
      ctx.fillRect(point[0] - halfWidth, point[1] - LABEL_HEIGHT / 2, halfWidth * 2, LABEL_HEIGHT);
      ctx.fillStyle = LABEL_TEXT;
      ctx.fillText(text, point[0], point[1]);
      break;
    }
  }
  ctx.restore();
}

let deferredLabelRoutes: Map<string, { origin: string; dest: string }> | null = null;

/**
 * Ops view: the route labels drawRoutes() held back, drawn once the airports
 * have claimed their space. `visible` limits them to those route keys, or
 * null for every route. Draws nothing if no routes were drawn this frame.
 */
export function drawDeferredRouteLabels(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  avoid: readonly LabelBox[],
  visible: (routes: ReadonlyMap<string, { origin: string; dest: string }>) => ReadonlySet<string> | null,
): void {
  const routes = deferredLabelRoutes;
  deferredLabelRoutes = null;
  if (!routes) return;
  drawRouteLabels(ctx, state, routes, avoid, visible(routes));
}
