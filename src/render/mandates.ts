import { geoInterpolate } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { isOpsView } from './opsView';
import { mandateIsActive, mandatesOf } from '../sim/mandates';
import type { SimState } from '../sim/state';

/** Ops lens only: an amber star on each route flying a priority flight (sim/mandates.ts). */

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));
/** Where along the route the star sits, off the middle where the route's own label is. */
const STAR_ALONG = 0.35;

export function drawMandateStars(ctx: CanvasRenderingContext2D, state: SimState): void {
  if (!isOpsView()) return;
  ctx.save();
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb454';
  ctx.strokeStyle = 'rgba(10, 12, 18, 0.9)';
  ctx.lineWidth = 3;
  for (const mandate of mandatesOf(state)) {
    if (!mandateIsActive(state, mandate)) continue;
    const from = airportsByIata.get(mandate.origin);
    const to = airportsByIata.get(mandate.dest);
    if (!from || !to) continue;
    const at = projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(STAR_ALONG));
    if (!at) continue;
    ctx.strokeText('★', at[0], at[1]);
    ctx.fillText('★', at[0], at[1]);
  }
  ctx.restore();
}
