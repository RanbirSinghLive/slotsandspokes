import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { onTimeColor } from './mapmodes';
import { seatsADayByMarket, widthForSeats } from './routeWidth';
import { marketLoadFactor } from '../sim/loadFactor';
import { weekOnWeekLoad } from '../sim/milestones';
import { trailingMarketOtp } from '../sim/routeOtp';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';

/**
 * The Network lens draws each route as a tube that fills with passengers,
 * so the map shows how full and how punctual the network is at a glance,
 * the way a Mini Metro line fills with riders:
 *
 * - The tube's width is its seats a day (render/routeWidth.ts's scale).
 * - The core inside it is as wide as the route's load factor over the
 *   last 7 days: a hollow tube is flying air, a solid one is full.
 * - The core's colour is the route's on-time share over the same week,
 *   on the Ops lens's red-amber-green scale.
 * - ▲ or ▼ along the line is this week's load against last week's, when
 *   it moved by TREND_STEP or more.
 *
 * Everything is a trailing week, never one departure, so the picture
 * changes as the network does rather than flickering flight by flight.
 */

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

export const METRO_COLORS = { track: '#3a4258', noOtp: '#8fa3c7', up: '#7fd88f', down: '#ff8080' };

// Wide enough at the start (a few propellers) that the fill reads, and a busy trunk stays under 12 px.
const MIN_TUBE_PX = 4;
const TUBE_SCALE = 1.7;
const TUBE_BASE_PX = 3;
const MIN_CORE_PX = 1.5;
const TREND_STEP = 0.05;
const TREND_AT = 0.65;
const TREND_FONT = 'bold 10px ui-monospace, Consolas, monospace';

/** The tube's outer width for a route's seats a day. */
export function tubeWidth(seatsADay: number): number {
  return Math.max(MIN_TUBE_PX, TUBE_BASE_PX + TUBE_SCALE * widthForSeats(seatsADay));
}

export function drawMetroRoutes(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  routes: ReadonlyMap<string, { origin: string; dest: string }>,
): void {
  const path = geoPath(projection, ctx);
  const seats = seatsADayByMarket(state);
  const lines: { key: string; origin: string; dest: string; line: LineString; width: number }[] = [];
  for (const { origin, dest } of routes.values()) {
    const from = airportsByIata.get(origin);
    const to = airportsByIata.get(dest);
    if (!from || !to) continue;
    const key = marketKey(origin, dest);
    lines.push({
      key,
      origin,
      dest,
      line: { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
      width: tubeWidth(seats.get(key) ?? 0),
    });
  }
  // Thin routes last, so a regional spoke stays visible where it crosses a trunk.
  lines.sort((x, y) => y.width - x.width || (x.key < y.key ? -1 : 1));

  ctx.save();
  ctx.lineCap = 'round';
  // Tracks first, for every route, so no core is cut by another route's track.
  for (const { line, width } of lines) {
    ctx.strokeStyle = METRO_COLORS.track;
    ctx.lineWidth = width;
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
  for (const { origin, dest, line, width } of lines) {
    const load = marketLoadFactor(state, origin, dest).factor;
    if (load === null || load <= 0) continue;
    const otp = trailingMarketOtp(state, origin, dest).otp;
    ctx.strokeStyle = otp === null ? METRO_COLORS.noOtp : onTimeColor(otp);
    ctx.lineWidth = Math.max(MIN_CORE_PX, width * Math.min(1, load));
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }

  ctx.font = TREND_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { origin, dest } of lines) {
    const trend = weekOnWeekLoad(state, origin, dest);
    if (!trend || Math.abs(trend.now - trend.before) < TREND_STEP) continue;
    const from = airportsByIata.get(origin)!;
    const to = airportsByIata.get(dest)!;
    // Off-centre, since a rival's squeeze gauge (render/pain.ts) sits at the middle.
    const point = projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(TREND_AT));
    if (!point) continue;
    const up = trend.now > trend.before;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.8)';
    ctx.fillRect(point[0] - 6, point[1] - 6, 12, 12);
    ctx.fillStyle = up ? METRO_COLORS.up : METRO_COLORS.down;
    ctx.fillText(up ? '▲' : '▼', point[0], point[1] + 0.5);
  }
  ctx.restore();
}
