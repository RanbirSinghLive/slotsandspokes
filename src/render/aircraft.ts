import { geoInterpolate } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { bearing } from '../sim/geo';
import { isOnTimeArrival } from '../sim/delays';
import { classRank } from '../sim/aircraftClasses';
import type { ActiveFlight, SimState } from '../sim/state';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// One size per rung of the class ladder (sim/aircraftClasses.ts: Propeller,
// Regional, Narrowbody, Widebody, smallest first) — the only visual
// difference between classes on the map itself. A widebody flight should
// read as visibly bigger than a propeller flight next to it without
// needing to zoom in; the old fixed AIRCRAFT_LENGTH/WIDTH is now just the
// fallback for a tail whose class can't be resolved, which shouldn't
// happen in practice but costs nothing to guard.
const AIRCRAFT_SIZE_BY_RANK: { length: number; width: number }[] = [
  { length: 6, width: 4.5 }, // Propeller
  { length: 7.5, width: 5.5 }, // Regional
  { length: 9, width: 6.5 }, // Narrowbody
  { length: 11, width: 8 }, // Widebody
];
const DEFAULT_AIRCRAFT_SIZE = { length: 7, width: 5 };
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

// How close the pointer has to be to a plane to hover it. More generous
// than the sprite itself: it's a small moving target.
const HOVER_RADIUS_PX = 12;
const HOVER_RING_STROKE = '#ffffff';

type FlightPose = { x: number; y: number; rotation: number };

/**
 * Where a flight is on screen right now and which way it points. Shared
 * by drawing and hover hit-testing so the thing you hover is exactly the
 * thing drawn.
 */
function flightPose(flight: ActiveFlight, nowFractionalMinute: number): FlightPose | null {
  const origin = airportsByIata.get(flight.origin);
  const dest = airportsByIata.get(flight.dest);
  if (!origin || !dest) return null;

  const blockMinutes = flight.arriveMinute - flight.departMinute;
  const rawT = (nowFractionalMinute - flight.departMinute) / blockMinutes;
  const t = Math.min(Math.max(rawT, 0), 1);

  const interpolate = geoInterpolate([origin.lon, origin.lat], [dest.lon, dest.lat]);
  const here = interpolate(t);
  const point = projection(here);
  if (!point) return null;

  const ahead = interpolate(Math.min(t + HEADING_SAMPLE_STEP, 1));
  const compassBearing = bearing({ lon: here[0], lat: here[1] }, { lon: ahead[0], lat: ahead[1] });

  // geoMercator always draws north as "up" and east as "right" (it's a
  // conformal projection, which is precisely the property that makes this
  // shortcut valid), so a compass bearing (0 = north, clockwise) converts
  // to a canvas rotation with one fixed adjustment: ctx.rotate() measures
  // its angle clockwise from due east, not due north, so we subtract 90
  // degrees. This only holds because the map never uses any projection
  // but Mercator — see render/projection.ts.
  return { x: point[0], y: point[1], rotation: ((compassBearing - 90) * Math.PI) / 180 };
}

/** The airborne flight under a screen point, nearest first, or null. */
export function findFlightAt(screenX: number, screenY: number, state: SimState, nowFractionalMinute: number): ActiveFlight | null {
  let best: ActiveFlight | null = null;
  let bestDistance = HOVER_RADIUS_PX;
  for (const flight of state.activeFlights) {
    const pose = flightPose(flight, nowFractionalMinute);
    if (!pose) continue;
    const distance = Math.hypot(pose.x - screenX, pose.y - screenY);
    if (distance <= bestDistance) {
      best = flight;
      bestDistance = distance;
    }
  }
  return best;
}

/** The screen point a flight is drawn at, for anchoring its hover tooltip. */
export function flightScreenPoint(flight: ActiveFlight, nowFractionalMinute: number): [number, number] | null {
  const pose = flightPose(flight, nowFractionalMinute);
  return pose ? [pose.x, pose.y] : null;
}

/**
 * Draw every currently-airborne aircraft as a small triangle pointed in its
 * direction of travel, sized by its class (AIRCRAFT_SIZE_BY_RANK above) —
 * the one place on the map a widebody actually looks bigger than a
 * propeller, which is otherwise only visible in the sidebar's icons
 * (ui/planeIcons.ts). Color still means only late-vs-on-time, unchanged:
 * two visual channels each carrying one clear meaning, rather than
 * overloading either with a second.
 *
 * Position is computed fresh from `nowFractionalMinute` every call, not
 * interpolated between simulated ticks — see CLAUDE.md's note under "Time"
 * for why. This keeps the motion smooth at any speed multiplier, including
 * paused, without any extra tweening state to keep in sync.
 */
export function drawAircraft(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  nowFractionalMinute: number,
  hoveredLegId: string | null = null,
): void {
  // Rebuilt fresh each call rather than kept around between frames — the
  // fleet changes (leases, deliveries) rarely enough that this is cheap
  // insurance against ever reading a stale tail, same "recompute, don't
  // cache" reasoning render/routes.ts and render/demand.ts already use.
  const aircraftByTail = new Map(state.aircraft.map((aircraft) => [aircraft.tail, aircraft]));

  for (const flight of state.activeFlights) {
    const pose = flightPose(flight, nowFractionalMinute);
    if (!pose) continue;

    const rank = classRank(aircraftByTail.get(flight.tail)?.typeCode ?? '');
    const size = AIRCRAFT_SIZE_BY_RANK[rank] ?? DEFAULT_AIRCRAFT_SIZE;

    // Same rule as the On-Time stat, so a plane drawn late is one that will count as late.
    const isLate = !isOnTimeArrival(flight.arriveMinute, flight.scheduledArriveMinute);
    drawTriangle(ctx, pose.x, pose.y, pose.rotation, isLate ? AIRCRAFT_FILL_LATE : AIRCRAFT_FILL, size);

    if (flight.legId === hoveredLegId) {
      ctx.beginPath();
      ctx.arc(pose.x, pose.y, size.length + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = HOVER_RING_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  fillStyle: string,
  size: { length: number; width: number },
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.beginPath();
  ctx.moveTo(size.length, 0);
  ctx.lineTo(-size.length * 0.5, size.width * 0.5);
  ctx.lineTo(-size.length * 0.5, -size.width * 0.5);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();

  ctx.restore();
}
