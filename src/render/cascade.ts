import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { isOnTimeArrival } from '../sim/delays';
import type { ProjectedLeg } from '../sim/cascade';
import type { ActiveFlight } from '../sim/state';

/**
 * The hovered plane's delay, spreading. Draws the rest of the flight it's
 * on, then every leg it still has to fly today, each coloured by how late
 * it's projected to land (sim/cascade.ts) and labelled with the minutes.
 *
 * Watching the colours go red → amber → green along a rotation is what
 * shows a buffer doing its job; watching them stay red to the end of the
 * day is what shows one is missing. A pure read of state, like every
 * renderer.
 */

const ON_TIME = '#7fd88f';
const SLIGHTLY_LATE = '#ffd166';
const LATE = '#ff8080';
// Beyond this many minutes late, "late" turns from amber to red.
const VERY_LATE_MINUTES = 30;
const LABEL_FONT = '11px ui-monospace, Consolas, monospace';
// Where along each leg its label sits. Off-centre so a there-and-back
// pair's two labels land on different thirds of the same line instead of
// on top of each other.
const LABEL_POSITION = 0.35;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

function colourFor(lateMinutes: number, onTime: boolean): string {
  if (onTime) return ON_TIME;
  return lateMinutes > VERY_LATE_MINUTES ? LATE : SLIGHTLY_LATE;
}

function lateLabel(lateMinutes: number, onTime: boolean): string {
  if (onTime) return lateMinutes > 0 ? `+${lateMinutes}m ok` : 'on time';
  return `+${lateMinutes}m`;
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  from: [number, number],
  to: [number, number],
  colour: string,
  label: string,
  dashed: boolean,
): void {
  const path = geoPath(projection, ctx);
  const line: LineString = { type: 'LineString', coordinates: [from, to] };
  ctx.save();
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  path(line);
  ctx.stroke();
  ctx.restore();

  const labelPoint = projection(geoInterpolate(from, to)(LABEL_POSITION));
  if (!labelPoint) return;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
  ctx.fillRect(labelPoint[0] - width / 2 - 3, labelPoint[1] - 8, width + 6, 16);
  ctx.fillStyle = colour;
  ctx.fillText(label, labelPoint[0] - width / 2, labelPoint[1]);
}

export function drawDelayCascade(
  ctx: CanvasRenderingContext2D,
  flight: ActiveFlight,
  restOfDay: ProjectedLeg[],
  nowFractionalMinute: number,
): void {
  const origin = airportsByIata.get(flight.origin);
  const dest = airportsByIata.get(flight.dest);
  if (!origin || !dest) return;

  // The flight it's on now: solid, from where the plane is to where it lands.
  const t = Math.min(Math.max((nowFractionalMinute - flight.departMinute) / (flight.arriveMinute - flight.departMinute), 0), 1);
  const here = geoInterpolate([origin.lon, origin.lat], [dest.lon, dest.lat])(t);
  const lateNow = flight.arriveMinute - flight.scheduledArriveMinute;
  const onTimeNow = isOnTimeArrival(flight.arriveMinute, flight.scheduledArriveMinute);
  drawLeg(ctx, here, [dest.lon, dest.lat], colourFor(lateNow, onTimeNow), lateLabel(lateNow, onTimeNow), false);

  // What comes after, dashed because it hasn't happened yet.
  restOfDay.forEach((projected, i) => {
    const from = airportsByIata.get(projected.leg.origin);
    const to = airportsByIata.get(projected.leg.dest);
    if (!from || !to) return;
    drawLeg(
      ctx,
      [from.lon, from.lat],
      [to.lon, to.lat],
      colourFor(projected.lateMinutes, projected.onTime),
      `${i + 1}. ${lateLabel(projected.lateMinutes, projected.onTime)}`,
      true,
    );
  });
}
