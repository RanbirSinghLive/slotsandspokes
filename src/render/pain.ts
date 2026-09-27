import { geoInterpolate } from 'd3-geo';
import { airports, isAirportKnown } from './airports';
import { projection } from './projection';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_SQUEEZED_RESPITE_DAYS, respiteDaysLeft } from '../sim/pressure';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';

/**
 * The squeeze, on the map (WEEK-EIGHT.md's pain gauge, WEEK-TEN.md thread
 * 6): on each market the player flies, a small ring at the middle of the
 * route line.
 *
 * - **Red, filling**: a rival there is on a losing run
 *   (sim/rivalEconomics.ts's `losingDays`), the ring filling toward the
 *   RIVAL_CLOSE_AFTER_LOSING_DAYS that make it pull out. The worst-off
 *   rival on the market decides it. So a player can watch an Undercut
 *   working, or see that it isn't.
 * - **Green, emptying**: a rival just pulled out, and no rival will open
 *   the market for RIVAL_SQUEEZED_RESPITE_DAYS (sim/pressure.ts); the ring
 *   empties as that runs out.
 *
 * Nothing is drawn on a market with neither, so the map stays quiet until
 * there's a squeeze to watch. A pure read of state.
 */

const RING_RADIUS = 6;
const LOSING_COLOR = '#e05a5a';
const RESPITE_COLOR = '#7ed6a8';
const TRACK_COLOR = 'rgba(255, 255, 255, 0.18)';

const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));

function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, share: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, RING_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(10, 14, 24, 0.85)';
  ctx.fill();
  ctx.strokeStyle = TRACK_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.min(1, share) * 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

export function drawPainGauges(ctx: CanvasRenderingContext2D, state: SimState): void {
  const flown = new Map<string, [string, string]>();
  for (const leg of state.schedule) flown.set(marketKey(leg.origin, leg.dest), [leg.origin, leg.dest]);

  const worstLosing = new Map<string, number>();
  for (const route of state.competitorRoutes) {
    const key = marketKey(route.origin, route.dest);
    if (!flown.has(key) || !route.losingDays) continue;
    worstLosing.set(key, Math.max(worstLosing.get(key) ?? 0, route.losingDays));
  }

  for (const [key, [a, b]] of flown) {
    const losing = worstLosing.get(key) ?? 0;
    const respite = losing === 0 ? respiteDaysLeft(state, a, b) : 0;
    if (losing === 0 && respite === 0) continue;
    const from = airportByIata.get(a);
    const to = airportByIata.get(b);
    if (!from || !to || !isAirportKnown(a) || !isAirportKnown(b)) continue;
    const middle = projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(0.5));
    if (!middle) continue;
    if (losing > 0) drawRing(ctx, middle[0], middle[1], losing / RIVAL_CLOSE_AFTER_LOSING_DAYS, LOSING_COLOR);
    else drawRing(ctx, middle[0], middle[1], respite / RIVAL_SQUEEZED_RESPITE_DAYS, RESPITE_COLOR);
  }
}
