import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { currentPotentialDemand } from '../sim/marketDemand';
import { airportDemandSize, sizeRank } from '../sim/marketSize';
import { marketKey } from '../sim/schedule';
import { hungerByAirport } from '../sim/serviceLevel';
import type { SimState } from '../sim/state';
import { unmetDemandByAirport, unmetDemandInputs, type AirportUnmet } from '../sim/unmetDemand';

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
 * - **Lines only on request**: hovering (or selecting) an airport draws
 *   its biggest markets from there, teal where nobody of yours flies yet,
 *   amber where you do, thicker the bigger. Every pair at once was
 *   thousands of lines and told nothing.
 *
 * Drawn under the routes and the airport dots, so they sit on top of it.
 */

/** A circle's radius for each size, Tiny to Huge. */
const SIZE_RADIUS_PX = [3, 5, 8, 12, 16];
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

  for (const airport of airports) {
    if (!isAirportKnown(airport.iata)) continue;
    const waiting = unmet.get(airport.iata);
    if (!waiting || waiting.latent < 1) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const radius = SIZE_RADIUS_PX[sizeRank(airportDemandSize(waiting.latent))];
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

/** The focused airport's biggest markets as arcs, to known airports only. */
function drawFocusMarkets(ctx: CanvasRenderingContext2D, state: SimState, focus: string): void {
  const from = airportsByIata.get(focus);
  if (!from || !isAirportKnown(focus)) return;
  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const markets = airports
    .filter((other) => other.iata !== focus && isAirportKnown(other.iata))
    .map((other) => ({ other, potential: currentPotentialDemand(state, focus, other.iata) }))
    .filter((market) => market.potential > 0)
    .sort((x, y) => y.potential - x.potential)
    .slice(0, FOCUS_MARKETS);
  const biggest = markets[0]?.potential ?? 1;
  const path = geoPath(projection, ctx);
  for (const { other, potential } of markets) {
    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [from.lon, from.lat],
        [other.lon, other.lat],
      ],
    };
    ctx.beginPath();
    path(line);
    ctx.strokeStyle = flown.has(marketKey(focus, other.iata)) ? FOCUS_FLOWN : FOCUS_OPEN;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = FOCUS_MIN_WIDTH + (potential / biggest) * (FOCUS_MAX_WIDTH - FOCUS_MIN_WIDTH);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
