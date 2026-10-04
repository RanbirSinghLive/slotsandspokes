import { airportClaimedBoxes, nearestAirportCandidate } from './airports';
import { drawDeferredRouteLabels, findNearestOwnRoute } from './routes';
import { isOpsView } from './opsView';
import type { SimState } from '../sim/state';
import type { Selection } from '../ui/selection';

/** An airport with this many of your routes is a busy hub: its spokes' labels show only on hover or selection. */
const BUSY_HUB_ROUTES = 6;

function routeKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

/**
 * Ops view route labels, drawn after the airports so they keep clear of
 * airport codes, 'on its way' badges and dots. At a busy hub the spokes
 * would stack into one block of text, so those labels appear only for the
 * route or airport under the pointer or in the side panel.
 */
export function drawOpsRouteLabels(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  selection: Selection,
  hover: Selection | null,
  pointer: { x: number; y: number } | null,
): void {
  if (!isOpsView()) return;
  drawDeferredRouteLabels(ctx, state, airportClaimedBoxes(), (routes) => {
    const degree = new Map<string, number>();
    for (const { origin, dest } of routes.values()) {
      degree.set(origin, (degree.get(origin) ?? 0) + 1);
      degree.set(dest, (degree.get(dest) ?? 0) + 1);
    }
    const focusAirports = new Set<string>();
    const focusRoutes = new Set<string>();
    for (const target of [selection, hover]) {
      if (!target) continue;
      if (target.kind === 'airport') focusAirports.add(target.iata);
      if (target.kind === 'route') focusRoutes.add(routeKey(target.a, target.b));
      if (target.kind === 'aircraft') {
        for (const leg of state.schedule) if (leg.tail === target.tail) focusRoutes.add(routeKey(leg.origin, leg.dest));
      }
    }
    if (pointer) {
      const airport = nearestAirportCandidate(pointer.x, pointer.y);
      if (airport) focusAirports.add(airport.airport.iata);
      const route = findNearestOwnRoute(pointer.x, pointer.y, state);
      if (route) focusRoutes.add(routeKey(route.origin, route.dest));
    }
    const visible = new Set<string>();
    for (const [key, { origin, dest }] of routes) {
      const busy = (degree.get(origin) ?? 0) >= BUSY_HUB_ROUTES || (degree.get(dest) ?? 0) >= BUSY_HUB_ROUTES;
      if (!busy || focusRoutes.has(key) || focusAirports.has(origin) || focusAirports.has(dest)) visible.add(key);
    }
    return visible;
  });
}
