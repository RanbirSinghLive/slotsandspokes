import { geoInterpolate } from 'd3-geo';
import { projection, baselineScale } from './projection';
import { airports } from './airports';
import type { ActiveFlight } from '../sim/state';

// Ops view extras for a plane (see render/opsView.ts): bigger as the map
// zooms in, a fading trail along its geodesic, a pulsing halo when late,
// and a tail label. All of it is read from the flight and the projection;
// nothing is written to state.

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const MAX_PLANE_SCALE = 1.7;
/** Zoom (multiple of the home view) from which every plane carries its tail. */
const TAIL_ALL_ZOOM = 3;

const TRAIL_SEGMENTS = 7;
const TRAIL_MINUTES = 30;
const TRAIL_MAX_FRACTION = 0.15;
const TRAIL_ALPHA = 0.9;
const TRAIL_WIDTH_PX = 2.2;

const HALO_COLOR = '255, 92, 92';
const HALO_PULSE_MS = 1600;

const TAIL_FONT = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';

/** Reused every frame so trails allocate no point arrays. */
const trailX = new Float64Array(TRAIL_SEGMENTS + 1);
const trailY = new Float64Array(TRAIL_SEGMENTS + 1);

/** How much larger than its base size a plane is drawn: 1 at the home view, up to 1.7 close in. */
export function opsPlaneScale(): number {
  const zoom = projection.scale() / baselineScale;
  return Math.min(Math.max(1 + 0.25 * Math.log2(zoom), 1), MAX_PLANE_SCALE);
}

/** Fading line behind the plane, sampled back along the same geodesic the plane flies. */
export function drawPlaneTrail(ctx: CanvasRenderingContext2D, flight: ActiveFlight, nowFractionalMinute: number): void {
  const origin = airportsByIata.get(flight.origin);
  const dest = airportsByIata.get(flight.dest);
  if (!origin || !dest) return;
  const block = flight.arriveMinute - flight.departMinute;
  if (block <= 0) return;
  const t = Math.min(Math.max((nowFractionalMinute - flight.departMinute) / block, 0), 1);
  if (t <= 0 || t >= 1) return;

  const span = Math.min(t, TRAIL_MAX_FRACTION, TRAIL_MINUTES / block);
  const interpolate = geoInterpolate([origin.lon, origin.lat], [dest.lon, dest.lat]);
  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const point = projection(interpolate(t - (span * i) / TRAIL_SEGMENTS));
    if (!point) return;
    trailX[i] = point[0];
    trailY[i] = point[1];
  }

  ctx.save();
  ctx.lineWidth = TRAIL_WIDTH_PX;
  ctx.lineCap = 'round';
  for (let i = 0; i < TRAIL_SEGMENTS; i++) {
    const fade = 1 - i / TRAIL_SEGMENTS;
    ctx.strokeStyle = `rgba(150, 215, 255, ${(TRAIL_ALPHA * fade * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(trailX[i]!, trailY[i]!);
    ctx.lineTo(trailX[i + 1]!, trailY[i + 1]!);
    ctx.stroke();
  }
  ctx.restore();
}

/** Soft red glow that breathes around a late plane, so lateness reads as a signal and not a fill colour. */
export function drawLateHalo(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const pulse = 0.5 + 0.5 * Math.sin((performance.now() / HALO_PULSE_MS) * 2 * Math.PI);
  const outer = radius * (1.5 + 0.35 * pulse);
  const glow = ctx.createRadialGradient(x, y, radius * 0.4, x, y, outer);
  glow.addColorStop(0, `rgba(${HALO_COLOR}, ${(0.45 + 0.2 * pulse).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${HALO_COLOR}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, outer, 0, 2 * Math.PI);
  ctx.fill();
}

/** Tail beside the plane: for every plane close in, for the hovered or selected one when zoomed out. */
export function drawTailLabel(ctx: CanvasRenderingContext2D, tail: string, x: number, y: number, radius: number, highlighted: boolean): void {
  if (!highlighted && projection.scale() / baselineScale < TAIL_ALL_ZOOM) return;
  ctx.save();
  ctx.font = TAIL_FONT;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8, 14, 24, 0.85)';
  ctx.fillStyle = '#e8eef7';
  const labelX = x + radius + 4;
  ctx.strokeText(tail, labelX, y);
  ctx.fillText(tail, labelX, y);
  ctx.restore();
}
