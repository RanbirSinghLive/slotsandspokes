import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { dailyDemand } from '../sim/demand';
import type { SimState } from '../sim/state';

const DEMAND_STROKE = '#4a90d9';
const SERVED_HIGHLIGHT = '#ffd166';
const MIN_ARC_WIDTH = 0.75;
const MAX_ARC_WIDTH = 6;
const MIN_ARC_ALPHA = 0.25;
const MAX_ARC_ALPHA = 0.9;
const MIN_AIRPORT_RADIUS = 3;
const MAX_AIRPORT_RADIUS_BONUS = 12;
const AIRPORT_LABEL_FILL = '#9aa3b8';
const AIRPORT_LABEL_FONT = '12px system-ui, sans-serif';

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

// Every distinct pair among the 10 airports, each with its estimated daily
// demand (sim/demand.ts) — computed once at module load since population
// and distance never change at runtime. 45 pairs for 10 airports.
const pairs: { origin: string; dest: string; demand: number }[] = [];
for (let i = 0; i < airports.length; i++) {
  for (let j = i + 1; j < airports.length; j++) {
    const origin = airports[i].iata;
    const dest = airports[j].iata;
    pairs.push({ origin, dest, demand: dailyDemand(origin, dest) });
  }
}

const maxDemand = Math.max(...pairs.map((p) => p.demand));
const maxPopulation = Math.max(...airports.map((a) => a.population));

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/**
 * Which pairs currently have at least one scheduled leg, in either
 * direction — the same bidirectional definition render/routes.ts uses for
 * the route network, so "served" here means the same thing it does there.
 * Computed fresh from `state.schedule` on every call rather than cached
 * from the static `scheduleLegs` template at import time — the same fix
 * render/routes.ts already got: cached, this halo would never move even
 * as routes were added or removed in-game.
 */
function servedPairsFrom(state: SimState): Set<string> {
  const served = new Set<string>();
  for (const leg of state.schedule) {
    served.add(pairKey(leg.origin, leg.dest));
  }
  return served;
}

/**
 * The "Demand" map mode: every one of the 45 city pairs drawn as a
 * geodesic arc, width and opacity scaled to that pair's estimated daily
 * demand (sim/demand.ts) — the busiest markets stand out as the thickest,
 * brightest lines. A pair that already has scheduled service (same
 * "served" definition render/routes.ts uses) gets an amber halo behind its
 * arc, so it's visible at a glance which big markets are already flown and
 * which are still white space.
 *
 * Airport circles are sized by population (`sqrt` scaling, so *area*
 * roughly tracks population instead of radius — otherwise Toronto would
 * visually swallow the map) rather than the fixed dot Ops mode uses.
 *
 * Read-only, like the rotation board's first pass — this answers "where's
 * the market" before any interaction gets built on top of it.
 */
export function drawDemandLayer(ctx: CanvasRenderingContext2D, state: SimState): void {
  const path = geoPath(projection, ctx);
  const servedPairs = servedPairsFrom(state);

  for (const { origin, dest, demand } of pairs) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;

    const t = demand / maxDemand; // 0..1, relative to the single busiest pair
    const width = MIN_ARC_WIDTH + t * (MAX_ARC_WIDTH - MIN_ARC_WIDTH);
    const alpha = MIN_ARC_ALPHA + t * (MAX_ARC_ALPHA - MIN_ARC_ALPHA);

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
      ctx.lineWidth = width + 3;
      ctx.stroke();
    }

    ctx.beginPath();
    path(line);
    ctx.strokeStyle = DEMAND_STROKE;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.font = AIRPORT_LABEL_FONT;
  ctx.textBaseline = 'middle';

  for (const airport of airports) {
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const [x, y] = point;

    const radius = MIN_AIRPORT_RADIUS + Math.sqrt(airport.population / maxPopulation) * MAX_AIRPORT_RADIUS_BONUS;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#e8ecf5';
    ctx.fill();

    ctx.fillStyle = AIRPORT_LABEL_FILL;
    ctx.fillText(airport.iata, x + radius + 4, y);
  }
}
