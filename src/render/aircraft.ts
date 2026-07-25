import { geoInterpolate } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { bearing } from '../sim/geo';
import type { SimState } from '../sim/state';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const AIRCRAFT_LENGTH = 7;
const AIRCRAFT_WIDTH = 5;
const AIRCRAFT_FILL = '#ffd166';
// A flight running late (M9) is tinted red instead of the usual yellow —
// this is what makes a cascading delay actually watchable on the map
// itself, not just readable in the fleet panel's text.
const AIRCRAFT_FILL_LATE = '#ff5c5c';

// How far ahead (as a fraction of the whole flight) to sample when working
// out which way the aircraft is pointed. Small enough to be a good local
// approximation of the direction of travel, per CLAUDE.md's note under
// "Geography".
const HEADING_SAMPLE_STEP = 0.001;

/**
 * Draw every currently-airborne aircraft as a small triangle pointed in its
 * direction of travel.
 *
 * Position is computed fresh from `nowFractionalMinute` every call, not
 * interpolated between simulated ticks — see CLAUDE.md's note under "Time"
 * for why. This keeps the motion smooth at any speed multiplier, including
 * paused, without any extra tweening state to keep in sync.
 */
export function drawAircraft(ctx: CanvasRenderingContext2D, state: SimState, nowFractionalMinute: number): void {
  for (const flight of state.activeFlights) {
    const origin = airportsByIata.get(flight.origin);
    const dest = airportsByIata.get(flight.dest);
    if (!origin || !dest) continue;

    const blockMinutes = flight.arriveMinute - flight.departMinute;
    const rawT = (nowFractionalMinute - flight.departMinute) / blockMinutes;
    const t = Math.min(Math.max(rawT, 0), 1);

    const interpolate = geoInterpolate([origin.lon, origin.lat], [dest.lon, dest.lat]);
    const here = interpolate(t);
    const point = projection(here);
    if (!point) continue;

    const ahead = interpolate(Math.min(t + HEADING_SAMPLE_STEP, 1));
    const compassBearing = bearing({ lon: here[0], lat: here[1] }, { lon: ahead[0], lat: ahead[1] });

    // geoMercator always draws north as "up" and east as "right" (it's a
    // conformal projection, which is precisely the property that makes this
    // shortcut valid), so a compass bearing (0 = north, clockwise) converts
    // to a canvas rotation with one fixed adjustment: ctx.rotate() measures
    // its angle clockwise from due east, not due north, so we subtract 90
    // degrees. This only holds because the map never uses any projection
    // but Mercator — see render/projection.ts.
    const canvasRotation = ((compassBearing - 90) * Math.PI) / 180;

    const isLate = flight.arriveMinute > flight.scheduledArriveMinute;
    drawTriangle(ctx, point[0], point[1], canvasRotation, isLate ? AIRCRAFT_FILL_LATE : AIRCRAFT_FILL);
  }
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, fillStyle: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.beginPath();
  ctx.moveTo(AIRCRAFT_LENGTH, 0);
  ctx.lineTo(-AIRCRAFT_LENGTH * 0.5, AIRCRAFT_WIDTH * 0.5);
  ctx.lineTo(-AIRCRAFT_LENGTH * 0.5, -AIRCRAFT_WIDTH * 0.5);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();

  ctx.restore();
}
