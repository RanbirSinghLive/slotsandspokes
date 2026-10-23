import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { baselineScale, projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { marketDistanceNm } from '../sim/demand';
import { airportDemandSize, sizeRank } from '../sim/marketSize';
import { hungerByAirport } from '../sim/serviceLevel';
import type { SimState } from '../sim/state';
import { unmetDemandByAirport, unmetDemandInputs, type AirportUnmet } from '../sim/unmetDemand';
import { contractsOf } from '../sim/contracts';
import { spokeFlowsFrom } from '../sim/spokeFlows';
import type { Airport } from './airports';

/**
 * The Demand lens: where to fly next, readable at a glance.
 *
 * - **A circle per airport**, sized by how many people want to fly from
 *   there and aren't on your planes (sim/unmetDemand.ts's latent demand),
 *   in the same five steps the panel names in words (Tiny to Huge,
 *   sim/marketSize.ts), so the map and the airport view agree.
 * - **Its colour is the opportunity**: teal where the airport is
 *   underserved by every airline (sim/serviceLevel.ts), brighter when
 *   starved, since new routes there build their market fastest; grey
 *   where it's already well served.
 * - **An amber rim** where you're turning passengers away today: a route
 *   of yours there needs more seats.
 * - **Contracts on offer** (sim/contracts.ts): a dashed gold
 *   line and ring.
 * - **Lines only on request**: hovering (or selecting) an airport draws
 *   its biggest markets from there and how each could reach your network
 *   (drawFocusMarkets()). Every pair at once was thousands of lines and
 *   told nothing.
 *
 * Drawn under the routes and the airport dots, so they sit on top of it.
 */

/** A circle's radius for each size, Tiny to Huge. */
const SIZE_RADIUS_PX = [3, 5, 8, 12, 16];
/** Circles shrink with the zoom, down to this share of their size, so a whole continent stays readable. */
const MIN_RADIUS_SHARE = 0.3;
const MIN_RADIUS_PX = 1.5;
const TEAL = '94, 214, 196';
const GREY = '154, 163, 184';
const SPILL_RIM = '#ffb347';
/** Below this hunger an airport counts as well served: grey, not teal. */
const HUNGER_MIN = 0.25;
/** How many of the focused airport's markets get a line. */
const FOCUS_MARKETS = 6;
const FOCUS_MIN_WIDTH = 1;
const FOCUS_MAX_WIDTH = 6;
const FOCUS_OPEN = '#5ed6c4';
const FOCUS_FLOWN = '#ffd166';
/** A market that could ride your network, changing planes at one of your airports. */
export const FOCUS_NETWORK = '#8fb8ff';
/** How many markets past the fog get a stub. */
const FOGGED_MARKETS = 3;
/** How far a stub reaches toward a market past the fog. */
const FOGGED_STUB_NM = 120;
/** How far along the hub's leg a "+N" chip sits. */
const CHIP_FROM_HUB_NM = 90;
const CHIP_FONT = '10px ui-monospace, Consolas, monospace';
const CONTRACT_GOLD = '#e8c170';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/**
 * The last unmetDemandByAirport() and hungerByAirport() answers and what
 * they were worked out from. Both walk every known airport pair, too much
 * to repeat every frame; their inputs change only when a route, a plane
 * or a rival changes, or a day ends.
 */
let cache: { state: SimState; inputs: string; unmet: Map<string, AirportUnmet>; hunger: Map<string, number> } | null = null;

function cached(state: SimState): { unmet: Map<string, AirportUnmet>; hunger: Map<string, number> } {
  const rivalFlights = state.competitorRoutes.reduce((total, route) => total + route.dailyFrequency, 0);
  const inputs = `${unmetDemandInputs(state)}|${state.competitorRoutes.length}|${rivalFlights}`;
  if (cache?.state !== state || cache.inputs !== inputs) {
    cache = { state, inputs, unmet: unmetDemandByAirport(state), hunger: hungerByAirport(state) };
  }
  return cache;
}

/** `focus` is the airport whose markets get lines: the hovered one, else the selected one, else none. */
export function drawDemandLayer(ctx: CanvasRenderingContext2D, state: SimState, focus: string | null): void {
  const { unmet, hunger } = cached(state);
  if (focus) drawFocusMarkets(ctx, state, focus);
  drawContractOffers(ctx, state);

  // Zoomed out, the same pixel sizes pile into one blot. Circles shrink with the zoom, and
  // a smaller airport that would sit inside a bigger one's circle is left out until the player zooms in.
  const radiusShare = Math.min(1, Math.max(MIN_RADIUS_SHARE, Math.pow(projection.scale() / baselineScale, 0.6)));
  const crowded = radiusShare < 1;
  const waitingAirports = airports
    .filter((airport) => isAirportKnown(airport.iata) && (unmet.get(airport.iata)?.latent ?? 0) >= 1)
    .sort((a, b) => unmet.get(b.iata)!.latent - unmet.get(a.iata)!.latent);
  const drawn: { x: number; y: number; radius: number }[] = [];

  for (const airport of waitingAirports) {
    const waiting = unmet.get(airport.iata)!;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const radius = Math.max(MIN_RADIUS_PX, SIZE_RADIUS_PX[sizeRank(airportDemandSize(waiting.latent))] * radiusShare);
    if (crowded && drawn.some((other) => Math.hypot(other.x - point[0], other.y - point[1]) < other.radius)) continue;
    drawn.push({ x: point[0], y: point[1], radius });
    const hungry = hunger.get(airport.iata) ?? 0;
    const rgb = hungry >= HUNGER_MIN ? TEAL : GREY;
    const alpha = hungry >= HUNGER_MIN ? 0.18 + 0.3 * hungry : 0.14;

    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb}, ${Math.min(0.8, alpha + 0.25)})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (waiting.spilled >= 1) {
      ctx.beginPath();
      ctx.arc(point[0], point[1], radius + 2, 0, 2 * Math.PI);
      ctx.strokeStyle = SPILL_RIM;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

/**
 * Contracts on offer (sim/contracts.ts): a dashed gold line on
 * the market and a ring at the community it serves, so an offer can be
 * found where the opportunities are.
 */
function drawContractOffers(ctx: CanvasRenderingContext2D, state: SimState): void {
  const path = geoPath(projection, ctx);
  for (const contract of contractsOf(state)) {
    if (contract.status !== 'offered') continue;
    const from = airportsByIata.get(contract.a);
    const to = airportsByIata.get(contract.b);
    if (!from || !to || !isAirportKnown(contract.a) || !isAirportKnown(contract.b)) continue;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = CONTRACT_GOLD;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    path({ type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] });
    ctx.stroke();
    const point = projection([to.lon, to.lat]);
    if (point) {
      ctx.beginPath();
      ctx.arc(point[0], point[1], 9, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * The focused airport's biggest markets (sim/spokeFlows.ts), thicker the
 * more people want to fly them:
 *
 * - amber where you fly it nonstop, teal where nothing of yours is on the way;
 * - blue, bent through one of your airports, where it could connect there,
 *   with a "+N" chip for its connecting passengers a day once grown. A leg of
 *   it you don't fly yet is dashed: the spoke to add, or the trunk;
 * - a short faded stub, no name, toward a big market past the fog.
 */
function drawFocusMarkets(ctx: CanvasRenderingContext2D, state: SimState, focus: string): void {
  const from = airportsByIata.get(focus);
  if (!from || !isAirportKnown(focus)) return;
  const known = spokeFlowsFrom(state, focus, FOCUS_MARKETS, isAirportKnown);
  const fogged = spokeFlowsFrom(state, focus, FOGGED_MARKETS, (iata) => !isAirportKnown(iata));
  const biggest = Math.max(1, known[0]?.potential ?? 0, fogged[0]?.potential ?? 0);
  const widthFor = (potential: number) => FOCUS_MIN_WIDTH + (potential / biggest) * (FOCUS_MAX_WIDTH - FOCUS_MIN_WIDTH);
  const path = geoPath(projection, ctx);
  const arc = (a: Airport, b: Airport, colour: string, width: number, dashed: boolean) => {
    ctx.beginPath();
    path({ type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } satisfies LineString);
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const chips: { point: [number, number]; text: string }[] = [];

  ctx.save();
  ctx.globalAlpha = 0.75;
  for (const flow of known) {
    const other = airportsByIata.get(flow.other);
    if (!other) continue;
    const width = widthFor(flow.potential);
    const hub = flow.hub ? airportsByIata.get(flow.hub) : undefined;
    if ((flow.kind === 'viaHub' || flow.kind === 'needsTrunk') && hub) {
      arc(from, hub, FOCUS_NETWORK, width, !flow.spokeFlown);
      arc(hub, other, FOCUS_NETWORK, width, flow.kind === 'needsTrunk');
      // Near the hub, so the chip stays on screen while the far end is off it.
      const along = Math.min(0.5, CHIP_FROM_HUB_NM / Math.max(1, marketDistanceNm(hub.iata, other.iata)));
      const point = projection(geoInterpolate([hub.lon, hub.lat], [other.lon, other.lat])(along));
      if (point) chips.push({ point: [point[0], point[1]], text: `+${Math.round(flow.connecting)}` });
    } else {
      arc(from, other, flow.kind === 'nonstop' ? FOCUS_FLOWN : FOCUS_OPEN, width, false);
    }
  }

  // Past the fog: which way the big markets lie, not where they are.
  ctx.globalAlpha = 0.4;
  for (const flow of fogged) {
    const other = airportsByIata.get(flow.other);
    if (!other) continue;
    const toward = geoInterpolate([from.lon, from.lat], [other.lon, other.lat]);
    const stub = Math.min(1, FOGGED_STUB_NM / Math.max(1, marketDistanceNm(focus, flow.other)));
    ctx.beginPath();
    path({ type: 'LineString', coordinates: [[from.lon, from.lat], toward(stub)] } satisfies LineString);
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = FOCUS_OPEN;
    ctx.lineWidth = widthFor(flow.potential);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.font = CHIP_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { point, text } of chips) {
    const halfWidth = ctx.measureText(text).width / 2 + 3;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.8)';
    ctx.fillRect(point[0] - halfWidth, point[1] - 7, halfWidth * 2, 14);
    ctx.fillStyle = FOCUS_NETWORK;
    ctx.fillText(text, point[0], point[1]);
  }
  ctx.restore();
}
