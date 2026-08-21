import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { marketKey } from '../sim/schedule';
import { summarizeMarket } from '../sim/marketSummary';
import { OTP_BASELINE } from '../sim/reputation';
import type { SimState } from '../sim/state';

/**
 * Recolouring the existing route network by a per-market metric instead
 * of drawing new geometry — the Paradox "mapmode" idea (EU4/Vic3/HoI4 all
 * do this: one map, several lenses). `'none'` is the base game, same flat
 * grey render/routes.ts already draws; every other mode replaces that
 * with a colour that answers one question at a glance instead of
 * requiring a trip to the Commercial or On-Time tab.
 *
 * Two modes to start, both reusing numbers the sim already produces
 * rather than inventing new ones: `summarizeMarket()` (sim/marketSummary.ts,
 * the same formula the Commercial panel's own numbers come from) for
 * profitability, and `state.onTimeByMarket` for on-time. More modes are
 * additive — a new entry in `MAP_MODES` plus a colour function, nothing
 * structural.
 */
export type MapMode = 'none' | 'profitability' | 'ontime';

export const MAP_MODES: { mode: MapMode; label: string }[] = [
  { mode: 'none', label: 'Off' },
  { mode: 'profitability', label: 'Profitability' },
  { mode: 'ontime', label: 'On-Time' },
];

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const NO_DATA_STROKE = '#3a4258'; // same grey render/routes.ts's plain mode uses — "nothing to report" reads as the base state, not an error
const LOSS_STROKE = '#ff8080';
const LINE_WIDTH = 2; // thicker than the plain 1px route line — a mapmode is meant to be read at a glance, not squinted at

// Exported so main.ts's legend swatches are literally these colours,
// never a second set of hex values that could drift from what the map
// actually draws.
export const MAP_MODE_COLORS = { loss: '#ff8080', breakeven: '#ffd166', profit: '#7fd88f', noData: NO_DATA_STROKE };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(from: [number, number, number], to: [number, number, number], t: number): string {
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const b = Math.round(lerp(from[2], to[2], t));
  return `rgb(${r}, ${g}, ${b})`;
}

const RED: [number, number, number] = [255, 128, 128];
const AMBER: [number, number, number] = [255, 209, 102];
const GREEN: [number, number, number] = [127, 216, 143];

/**
 * Margin as a share of revenue, red at -20% or worse, amber at breakeven,
 * green at +20% or better. A ratio rather than a raw dollar figure so a
 * thin regional market and a fat transcon one land on the same scale —
 * the question a mapmode answers is "is this market healthy," not "which
 * market makes the most money" (the Commercial table's sort already
 * answers that one).
 */
function profitabilityColor(margin: number, revenue: number): string {
  if (revenue <= 0) return LOSS_STROKE; // costing money with nobody paying for it
  const ratio = Math.max(-0.2, Math.min(0.2, margin / revenue));
  return ratio < 0 ? lerpColor(RED, AMBER, (ratio + 0.2) / 0.2) : lerpColor(AMBER, GREEN, ratio / 0.2);
}

/**
 * Red at 0% on-time, amber at OTP_BASELINE (Reputation's own "neutral
 * day" benchmark — see sim/reputation.ts), green at 100%. Sharing that
 * constant means this map and the Reputation number it feeds can never
 * silently disagree about what "acceptable" means.
 */
function onTimeColor(pct: number): string {
  return pct < OTP_BASELINE ? lerpColor(RED, AMBER, pct / OTP_BASELINE) : lerpColor(AMBER, GREEN, (pct - OTP_BASELINE) / (1 - OTP_BASELINE));
}

/** Every distinct market currently in `state.schedule` — same bidirectional definition render/routes.ts uses. */
function distinctMarkets(state: SimState): Map<string, { origin: string; dest: string }> {
  const markets = new Map<string, { origin: string; dest: string }>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (!markets.has(key)) markets.set(key, { origin: leg.origin, dest: leg.dest });
  }
  return markets;
}

/**
 * Draw the route network recoloured by `mode`. Called from main.ts's
 * render() in place of drawRoutes() whenever a mapmode is active — same
 * "replaces, doesn't add to" relationship render/competition.ts's overlay
 * already has with the plain route layer, and for the same reason:
 * drawing both would double every line.
 */
export function drawRouteMapMode(ctx: CanvasRenderingContext2D, state: SimState, mode: MapMode): void {
  if (mode === 'none') return;
  const path = geoPath(projection, ctx);

  ctx.lineWidth = LINE_WIDTH;
  for (const { origin, dest } of distinctMarkets(state).values()) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;

    let color: string = NO_DATA_STROKE;
    if (mode === 'profitability') {
      const routeSettings = state.routeSettings[marketKey(origin, dest)];
      if (routeSettings) {
        const summary = summarizeMarket(origin, dest, state, routeSettings);
        color = profitabilityColor(summary.margin, summary.revenue);
      }
    } else {
      const stats = state.onTimeByMarket[marketKey(origin, dest)];
      if (stats && stats.departed > 0) color = onTimeColor(stats.onTime / stats.departed);
    }

    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [originAirport.lon, originAirport.lat],
        [destAirport.lon, destAirport.lat],
      ],
    };
    ctx.strokeStyle = color;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
}
