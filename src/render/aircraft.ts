import { geoInterpolate } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { bearing } from '../sim/geo';
import { isOnTimeArrival } from '../sim/delays';
import { classRank } from '../sim/aircraftClasses';
import type { ActiveFlight, SimState } from '../sim/state';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// One filled silhouette per rung of the class ladder (sim/aircraftClasses.ts:
// Propeller, Regional, Narrowbody, Widebody, smallest first), drawn nose up
// in a 24 by 24 box and matching the sidebar icons in ui/planeIcons.ts
// (render/ may not import ui/, so the shapes are restated here as filled
// paths). `span` is the on-screen size of that 24 box, so a widebody still
// reads as bigger than a propeller next to it without zooming in.
const NARROW_FUSELAGE = 'M12 3C13.2 5 13.2 8.5 13.2 11.5V19L12 21.5L10.8 19V11.5C10.8 8.5 10.8 5 12 3Z';
const WIDE_FUSELAGE = 'M12 3C14 5 14 8.5 14 11.5V19L12 22L10 19V11.5C10 8.5 10 5 12 3Z';

/** A filled circle as path text, so an engine joins the rest of one Path2D. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

const AIRCRAFT_SHAPES: { path: Path2D; span: number }[] = [
  {
    // Propeller: straight wings, a bar across the nose.
    span: 15,
    path: new Path2D(
      `${NARROW_FUSELAGE}M2.5 10.5H21.5V13.5H2.5ZM8 18.5H16V20.5H8ZM8.6 2H15.4V3.2H8.6Z`,
    ),
  },
  {
    // Regional: modest sweep, rear engines, T-tail.
    span: 17,
    path: new Path2D(
      `${NARROW_FUSELAGE}M10.8 9.5L3.5 14.2V16.2L10.8 14ZM13.2 9.5L20.5 14.2V16.2L13.2 14Z` +
        'M8.6 15.5H10.8V19.5H8.6ZM13.2 15.5H15.4V19.5H13.2ZM8.5 20.4H15.5V21.6H8.5Z',
    ),
  },
  {
    // Narrowbody: long swept wings, one engine under each.
    span: 20,
    path: new Path2D(
      `${NARROW_FUSELAGE}M10.8 9L2 15.6V17.8L10.8 14.6ZM13.2 9L22 15.6V17.8L13.2 14.6Z` +
        `${circle(6.4, 13.4, 1.4)}${circle(17.6, 13.4, 1.4)}M10.8 19L7.5 21.4H10.8ZM13.2 19L16.5 21.4H13.2Z`,
    ),
  },
  {
    // Widebody: fatter fuselage, the longest wings, two engines under each.
    span: 24,
    path: new Path2D(
      `${WIDE_FUSELAGE}M10 9L1.5 16.2V19L10 15.4ZM14 9L22.5 16.2V19L14 15.4Z` +
        `${circle(4.6, 16.3, 1.3)}${circle(7.6, 13.3, 1.3)}${circle(19.4, 16.3, 1.3)}${circle(16.4, 13.3, 1.3)}` +
        'M10 19.6L6.6 22H10ZM14 19.6L17.4 22H14Z',
    ),
  },
];
const DEFAULT_SHAPE = AIRCRAFT_SHAPES[0]!;
const AIRCRAFT_FILL = '#ffd166';
// A flight running late is tinted red instead of the usual yellow —
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
 * Draw every currently-airborne aircraft as a small silhouette of its class's
 * plane, nose pointed in its direction of travel and sized by class (AIRCRAFT_SHAPES above) —
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
    const shape = AIRCRAFT_SHAPES[rank] ?? DEFAULT_SHAPE;

    // Same rule as the On-Time stat, so a plane drawn late is one that will count as late.
    const isLate = !isOnTimeArrival(flight.arriveMinute, flight.scheduledArriveMinute);
    drawSilhouette(ctx, pose.x, pose.y, pose.rotation, isLate ? AIRCRAFT_FILL_LATE : AIRCRAFT_FILL, shape);

    if (flight.legId === hoveredLegId) {
      ctx.beginPath();
      ctx.arc(pose.x, pose.y, shape.span / 2 + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = HOVER_RING_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  fillStyle: string,
  shape: { path: Path2D; span: number },
): void {
  ctx.save();
  ctx.translate(x, y);
  // The shapes are drawn nose up; `rotation` is measured from due east.
  ctx.rotate(rotation + Math.PI / 2);
  const scale = shape.span / 24;
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = fillStyle;
  ctx.fill(shape.path);
  ctx.restore();
}
