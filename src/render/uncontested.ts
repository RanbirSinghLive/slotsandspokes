import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { currentPotentialDemand } from '../sim/marketDemand';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';

/**
 * The Uncontested lens: where no rival flies.
 *
 * - **Your routes**: solid green where no rival serves the market (your
 *   edge, until one arrives), grey where one does.
 * - **Open markets**: dashed teal lines for the biggest markets that start
 *   at an airport you already serve and that nobody, you included, flies
 *   yet. These are the edges rivals haven't arbitraged away.
 *
 * Drawn in place of the plain route layer, like the Profit and On-time
 * lenses (render/mapmodes.ts).
 */

export const UNCONTESTED_COLORS = { yours: '#7fd88f', contested: '#3a4258', open: '#5ed6c4' };

/** How many open markets get a line: every pair at once would be thousands of lines. */
const OPEN_MARKETS_SHOWN = 12;
const ROUTE_WIDTH = 2;
const OPEN_WIDTH = 1.5;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

type OpenMarket = { origin: string; dest: string };

/**
 * The last open-market list and what it was worked out from. It scores every
 * known airport against every airport you serve, too much to repeat every
 * frame; the answer only changes when a route, a rival or the known airports change.
 */
let cache: { state: SimState; inputs: string; open: OpenMarket[] } | null = null;

function openMarkets(state: SimState, rivalMarkets: Set<string>, ownMarkets: Set<string>): OpenMarket[] {
  const inputs = `${state.schedule.length}|${state.competitorRoutes.length}|${state.knownAirports?.length ?? 0}|${Math.floor(state.simMinute / 1440)}`;
  if (cache?.state === state && cache.inputs === inputs) return cache.open;

  const served = new Set<string>();
  for (const leg of state.schedule) {
    served.add(leg.origin);
    served.add(leg.dest);
  }

  const candidates: (OpenMarket & { potential: number })[] = [];
  const seen = new Set<string>();
  for (const from of served) {
    for (const other of airports) {
      if (other.iata === from || !isAirportKnown(other.iata)) continue;
      const key = marketKey(from, other.iata);
      if (seen.has(key) || rivalMarkets.has(key) || ownMarkets.has(key)) continue;
      seen.add(key);
      const potential = currentPotentialDemand(state, from, other.iata);
      if (potential > 0) candidates.push({ origin: from, dest: other.iata, potential });
    }
  }
  candidates.sort((x, y) => y.potential - x.potential);
  const open = candidates.slice(0, OPEN_MARKETS_SHOWN).map(({ origin, dest }) => ({ origin, dest }));
  cache = { state, inputs, open };
  return open;
}

function lineBetween(origin: string, dest: string): LineString | null {
  const from = airportsByIata.get(origin);
  const to = airportsByIata.get(dest);
  if (!from || !to) return null;
  return {
    type: 'LineString',
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  };
}

export function drawUncontestedLayer(ctx: CanvasRenderingContext2D, state: SimState): void {
  const path = geoPath(projection, ctx);
  const rivalMarkets = new Set(state.competitorRoutes.map((route) => marketKey(route.origin, route.dest)));
  const ownMarkets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = OPEN_WIDTH;
  ctx.strokeStyle = UNCONTESTED_COLORS.open;
  for (const { origin, dest } of openMarkets(state, rivalMarkets, ownMarkets)) {
    const line = lineBetween(origin, dest);
    if (!line) continue;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
  ctx.restore();

  const drawn = new Set<string>();
  ctx.lineWidth = ROUTE_WIDTH;
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (drawn.has(key)) continue;
    drawn.add(key);
    const line = lineBetween(leg.origin, leg.dest);
    if (!line) continue;
    ctx.strokeStyle = rivalMarkets.has(key) ? UNCONTESTED_COLORS.contested : UNCONTESTED_COLORS.yours;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
}
