import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { potentialDailyDemand } from '../sim/demand';
import { actualDailyDemand, currentPotentialDemand } from '../sim/marketDemand';
import type { SimState } from '../sim/state';

const DEMAND_STROKE = '#4a90d9';
const SERVED_HIGHLIGHT = '#ffd166';
const MIN_ARC_WIDTH = 0.75;
const MAX_ARC_WIDTH = 6;
const MIN_ARC_ALPHA = 0.25;
const MAX_ARC_ALPHA = 0.9;

// Potential is drawn as a wide, faint arc and actual demand as a solid
// one on top of it, so the gap between them *is* the headroom: a fat
// ghost with a thin bright core is a big market nobody has built yet, and
// the two converging means a market near maturity. Demand grows
// (sim/marketDemand.ts), and this gap is what the map can teach that a
// table wouldn't.
const POTENTIAL_ALPHA = 0.22;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

// Every distinct pair among the map's airports. Only the pair list is
// static: the demand figures move day to day, so drawDemandLayer() reads
// them per frame.
const pairs: { origin: string; dest: string }[] = [];
for (let i = 0; i < airports.length; i++) {
  for (let j = i + 1; j < airports.length; j++) {
    pairs.push({ origin: airports[i].iata, dest: airports[j].iata });
  }
}

// The busiest pair's *potential*, which is static — so the arc scale
// stays fixed as markets grow into it. Scaling to the current busiest
// actual instead would rescale the whole map every day and make growth
// impossible to see, since every arc would grow together.
const maxPotential = Math.max(...pairs.map((p) => potentialDailyDemand(p.origin, p.dest)));

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/**
 * Which pairs currently have at least one scheduled leg, in either
 * direction — the same bidirectional definition render/routes.ts uses for
 * the route network, so "served" here means the same thing it does there.
 * Computed fresh from `state.schedule` on every call, so the halo moves
 * as soon as a route is added or removed.
 */
function servedPairsFrom(state: SimState): Set<string> {
  const served = new Set<string>();
  for (const leg of state.schedule) {
    served.add(pairKey(leg.origin, leg.dest));
  }
  return served;
}

/**
 * The Demand overlay, a toggle layered on the base map (see main.ts's
 * render()): every city pair drawn as a geodesic arc, width and opacity scaled
 * to that pair's estimated daily demand (sim/demand.ts) — the busiest
 * markets stand out as the thickest, brightest lines. A pair that already
 * has scheduled service (same "served" definition render/routes.ts uses)
 * gets an amber halo behind its arc, so it's visible at a glance which
 * big markets are already flown and which are still white space.
 *
 * Doesn't draw airports: the base layer draws them once, and drawing
 * them here too would double every dot.
 */
export function drawDemandLayer(ctx: CanvasRenderingContext2D, state: SimState): void {
  const path = geoPath(projection, ctx);
  const servedPairs = servedPairsFrom(state);

  for (const { origin, dest } of pairs) {
    if (!isAirportKnown(origin) || !isAirportKnown(dest)) continue;
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;

    const potential = currentPotentialDemand(state, origin, dest);
    const actual = actualDailyDemand(state, origin, dest);

    // Both widths share the same scale (the busiest pair's potential), so
    // the two arcs on one market are directly comparable by eye.
    const potentialT = potential / maxPotential;
    const actualT = actual / maxPotential;
    const potentialWidth = MIN_ARC_WIDTH + potentialT * (MAX_ARC_WIDTH - MIN_ARC_WIDTH);
    const actualWidth = MIN_ARC_WIDTH + actualT * (MAX_ARC_WIDTH - MIN_ARC_WIDTH);
    const actualAlpha = MIN_ARC_ALPHA + actualT * (MAX_ARC_ALPHA - MIN_ARC_ALPHA);

    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [originAirport.lon, originAirport.lat],
        [destAirport.lon, destAirport.lat],
      ],
    };

    if (servedPairs.has(pairKey(origin, dest))) {
      ctx.beginPath();
      path(line);
      ctx.strokeStyle = SERVED_HIGHLIGHT;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = potentialWidth + 3;
      ctx.stroke();
    }

    // Potential first, underneath — the "how big could this get" ghost.
    ctx.beginPath();
    path(line);
    ctx.strokeStyle = DEMAND_STROKE;
    ctx.globalAlpha = POTENTIAL_ALPHA;
    ctx.lineWidth = potentialWidth;
    ctx.stroke();

    // Actual on top — what really flies today.
    ctx.beginPath();
    path(line);
    ctx.strokeStyle = DEMAND_STROKE;
    ctx.globalAlpha = actualAlpha;
    ctx.lineWidth = actualWidth;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}
