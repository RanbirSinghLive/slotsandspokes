import { isAirportKnown } from './airports';
import { drawMetroRoutes, onTimeCoreColor } from './metro';
import { marketKey } from '../sim/schedule';
import { summarizeMarket } from '../sim/marketSummary';
import { OTP_BASELINE } from '../sim/routeOtp';
import type { SimState } from '../sim/state';

/**
 * Recolouring the existing route network by a per-market metric instead
 * of drawing new geometry — the Paradox "mapmode" idea (EU4/Vic3/HoI4 all
 * do this: one map, several lenses). `'none'` is the Network lens, drawn
 * by render/routes.ts; every other mode recolours the same tubes' cores
 * so they answer one question at a glance instead of requiring a trip to
 * the Commercial or On-Time tab.
 *
 * Both modes reuse numbers the sim already produces rather than
 * inventing new ones: `summarizeMarket()` (sim/marketSummary.ts, the same
 * formula the Commercial panel's own numbers come from) for
 * profitability, and the last 7 days' on-time (sim/routeOtp.ts) for
 * on-time. Each is one of the map's lenses (main.ts's setLens()); another
 * mode is a colour function plus a lens button.
 */
export type MapMode = 'none' | 'profitability' | 'ontime';



const NO_DATA_STROKE = '#3a4258'; // same grey render/routes.ts's plain mode uses — "nothing to report" reads as the base state, not an error
const LOSS_STROKE = '#ff8080';

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
 * Red at 0% on-time, amber at OTP_BASELINE (the neutral line route
 * growth is judged against, sim/routeOtp.ts), green at 100%. Sharing that
 * constant means this map and the growth it drives can never
 * silently disagree about what "acceptable" means.
 */
export function onTimeColor(pct: number): string {
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

/** The Profit lens's core colour: margin over revenue, the Commercial panel's own numbers. */
function profitCoreColor(state: SimState, origin: string, dest: string): string {
  const routeSettings = state.routeSettings[marketKey(origin, dest)];
  if (!routeSettings) return NO_DATA_STROKE;
  const summary = summarizeMarket(origin, dest, state, routeSettings);
  return profitabilityColor(summary.margin, summary.revenue);
}

/**
 * Draw the route network recoloured by `mode`, as the Network lens's
 * tubes (render/metro.ts): width is seats a day and the core fills with
 * load, so only the core's colour changes between lenses. Called from
 * main.ts's render() in place of drawRoutes() whenever a mapmode is
 * active, and like the competition overlay it replaces the plain layer
 * rather than adding to it, since drawing both would double every line.
 * Routes to airports the airport filter hides are left out, as drawRoutes() does.
 */
export function drawRouteMapMode(ctx: CanvasRenderingContext2D, state: SimState, mode: MapMode): void {
  if (mode === 'none') return;
  const routes = new Map<string, { origin: string; dest: string }>();
  for (const [key, market] of distinctMarkets(state)) {
    if (isAirportKnown(market.origin) && isAirportKnown(market.dest)) routes.set(key, market);
  }
  drawMetroRoutes(ctx, state, routes, mode === 'profitability' ? profitCoreColor : onTimeCoreColor);
}
