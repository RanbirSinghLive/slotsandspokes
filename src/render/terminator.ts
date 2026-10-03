import { geoCircle, geoPath } from 'd3-geo';
import { projection } from './projection';

const NIGHT_FILL = 'rgba(5, 10, 25, 0.55)';

/**
 * Draw the night hemisphere: a shadow over the half of the Earth currently
 * facing away from the sun. Formula from CLAUDE.md.
 *
 * Two astronomical quantities do the real work here:
 *  - `declination`: how far north or south of the equator the sun sits
 *    directly overhead today. It swings between about -23.44° and +23.44°
 *    over the year — that's the Earth's axial tilt — which is why this
 *    needs `dayOfYear` at all. The `+10` nudges the cosine wave so
 *    1 January lines up roughly correctly against the December solstice.
 *  - `subsolarLon`: the longitude where the sun is directly overhead right
 *    now. It's 0° at 12:00 UTC (minuteOfDay 720) and sweeps a full 360°
 *    westward every 1440 minutes — 0.25° of longitude per minute, hence
 *    dividing by 4.
 *
 * Together, [subsolarLon, declination] is the "subsolar point" — noon,
 * everywhere on Earth, happens when that point crosses your meridian. Its
 * exact opposite (the "antisolar point": add 180° of longitude, flip the
 * sign of latitude) is the center of whichever hemisphere currently has
 * midnight. A circle of 90° radius around that point — 90° of arc along
 * the sphere, not screen pixels, which is what d3.geoCircle draws — is
 * exactly the night half of the globe.
 */
export function drawTerminator(ctx: CanvasRenderingContext2D, simMinute: number, startDayOfYear: number): void {
  // The game's day 0 is the start date the player chose (sim/clock.ts).
  const dayOfYear = (startDayOfYear + Math.floor(simMinute / 1440)) % 365;
  const minuteOfDay = simMinute % 1440;

  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const subsolarLon = -(minuteOfDay - 720) / 4;
  const antisolar: [number, number] = [subsolarLon + 180, -declination];

  const nightHemisphere = geoCircle().center(antisolar).radius(90)();

  const path = geoPath(projection, ctx);
  ctx.beginPath();
  path(nightHemisphere);
  ctx.fillStyle = NIGHT_FILL;
  ctx.fill();
}
