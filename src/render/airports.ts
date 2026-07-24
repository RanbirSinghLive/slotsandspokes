import airportsData from '../../data/airports.json';
import { projection } from './projection';

export type Airport = {
  iata: string;
  name: string;
  lat: number;
  lon: number;
  utcOffsetMinutes: number;
};

export const airports: Airport[] = airportsData;

const MARKER_RADIUS = 3;
const MARKER_FILL = '#e8ecf5';
const LABEL_FILL = '#9aa3b8';
const LABEL_FONT = '12px system-ui, sans-serif';

/**
 * Draw a small dot plus its IATA code for every airport. Ten airports is few
 * enough that overlapping labels aren't worth solving yet (WEEK-ONE.md says
 * so explicitly) — this just draws every label at a fixed offset and lets
 * them collide if they collide.
 */
export function drawAirports(ctx: CanvasRenderingContext2D): void {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';

  for (const airport of airports) {
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue; // null if the point falls outside the projection's domain
    const [x, y] = point;

    ctx.beginPath();
    ctx.arc(x, y, MARKER_RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = MARKER_FILL;
    ctx.fill();

    ctx.fillStyle = LABEL_FILL;
    ctx.fillText(airport.iata, x + MARKER_RADIUS + 4, y);
  }
}
