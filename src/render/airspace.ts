import { geoCircle, geoPath } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { isOpsView } from './opsView';
import { activeClosures, announcedClosures, closureIsRelevant } from '../sim/airspace';
import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';

/**
 * Airspace closures (sim/airspace.ts): a translucent red disc with a
 * hatched edge and a name, on every lens, since a closure is the state of
 * the world like weather, not operating detail. A closure announced for
 * later is a dashed outline only. The Ops lens adds the dashed red
 * line of each flight that is flying round one.
 */

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

/** A degree of arc is 60 nautical miles. */
const NM_PER_DEGREE = 60;
const FILL = 'rgba(255, 60, 60, 0.16)';
const EDGE = 'rgba(255, 110, 110, 0.85)';
const LABEL = '#ffd0d0';
const DETOUR_STROKE = 'rgba(255, 110, 110, 0.9)';

export function drawAirspaceClosures(ctx: CanvasRenderingContext2D, state: SimState): void {
  const active = activeClosures(state).filter((closure) => closureIsRelevant(state, closure));
  const announced = announcedClosures(state).filter((closure) => closureIsRelevant(state, closure));
  if (active.length === 0 && announced.length === 0) return;

  const path = geoPath(projection, ctx);
  const today = dayIndex(state);
  ctx.save();
  for (const closure of [...active, ...announced]) {
    const disc = geoCircle().center([closure.lon, closure.lat]).radius(closure.radiusNm / NM_PER_DEGREE)();
    const isActive = closure.startDay <= today;
    ctx.beginPath();
    path(disc);
    if (isActive) {
      ctx.fillStyle = FILL;
      ctx.fill();
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = EDGE;
    ctx.setLineDash(isActive ? [6, 4] : [2, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    const centre = projection([closure.lon, closure.lat]);
    if (!centre) continue;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = LABEL;
    ctx.fillText(
      isActive ? `${closure.name} · ${closure.endDay - today}d` : `${closure.name} · closes in ${closure.startDay - today}d`,
      centre[0],
      centre[1],
    );
  }

  if (isOpsView()) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = DETOUR_STROKE;
    ctx.setLineDash([4, 3]);
    for (const flight of state.activeFlights) {
      if (!flight.via) continue;
      const origin = airportsByIata.get(flight.origin);
      const dest = airportsByIata.get(flight.dest);
      if (!origin || !dest) continue;
      ctx.beginPath();
      path({ type: 'LineString', coordinates: [[origin.lon, origin.lat], flight.via, [dest.lon, dest.lat]] });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}
