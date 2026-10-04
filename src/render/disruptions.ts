import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { isOpsView } from './opsView';
import { daysUntilReturn } from '../sim/aog';
import type { SimState } from '../sim/state';

/**
 * The Ops view's disruption layer: a wrench pin with "C-P002 · back 3d" at
 * the airport each grounded plane sits at, and today's cancelled legs as a
 * dashed red line on their route with a count. Drawn and hit-tested from
 * the same list of pins, so what is clickable is what is drawn.
 */

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const PIN_HEIGHT = 16;
const PIN_GAP = 2;
const PIN_LIFT_PX = 12;
const PIN_TEXT_PAD = 6;
const PIN_ICON_WIDTH = 18;
/** More pins than this at one airport collapse into a "+N more" row, which opens the same screen. */
const MAX_PINS_PER_AIRPORT = 4;

const PIN_FILL = 'rgba(40, 20, 20, 0.92)';
const PIN_STROKE = '#ff8080';
const PIN_TEXT = '#ffd0d0';
const CANCELLED_STROKE = '#ff6b6b';

type Pin = { text: string; x: number; y: number; width: number };

/** Pins for every grounded plane, stacked upward from its airport's dot; empty outside Ops view. */
function layoutPins(ctx: CanvasRenderingContext2D | null, state: SimState): Pin[] {
  if (!isOpsView()) return [];
  const byAirport = new Map<string, string[]>();
  for (const event of state.aogs) {
    const aircraft = state.aircraft.find((a) => a.tail === event.tail);
    const iata = aircraft?.atAirport ?? event.base;
    if (!isAirportKnown(iata)) continue;
    const texts = byAirport.get(iata) ?? [];
    texts.push(`${event.tail} · back ${daysUntilReturn(state, event)}d`);
    byAirport.set(iata, texts);
  }

  if (ctx) ctx.font = '11px system-ui, sans-serif';
  const pins: Pin[] = [];
  for (const [iata, texts] of byAirport) {
    const airport = airportsByIata.get(iata);
    const point = airport ? projection([airport.lon, airport.lat]) : null;
    if (!point) continue;
    const shown = texts.length > MAX_PINS_PER_AIRPORT ? texts.slice(0, MAX_PINS_PER_AIRPORT - 1) : texts.slice();
    if (shown.length < texts.length) shown.push(`+${texts.length - shown.length} more AOG`);
    shown.forEach((text, index) => {
      const textWidth = ctx ? ctx.measureText(text).width : text.length * 6;
      pins.push({
        text,
        x: point[0] - PIN_ICON_WIDTH / 2,
        y: point[1] - PIN_LIFT_PX - PIN_HEIGHT - index * (PIN_HEIGHT + PIN_GAP),
        width: PIN_ICON_WIDTH + textWidth + PIN_TEXT_PAD,
      });
    });
  }
  return pins;
}

/** Whether a screen point is on a pin; a click there opens the Maintenance screen. */
export function findDisruptionPinAt(screenX: number, screenY: number, state: SimState): boolean {
  return layoutPins(null, state).some((pin) => screenX >= pin.x && screenX <= pin.x + pin.width && screenY >= pin.y && screenY <= pin.y + PIN_HEIGHT);
}

function drawWrench(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = PIN_STROKE;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, -2);
  ctx.stroke();
  // The open jaw at the head.
  ctx.beginPath();
  ctx.arc(0, -4.5, 3, Math.PI * 0.75, Math.PI * 2.25, true);
  ctx.stroke();
  ctx.restore();
}

function drawCancelledLegs(ctx: CanvasRenderingContext2D, state: SimState): void {
  const counts = new Map<string, { origin: string; dest: string; count: number }>();
  const cancelled = new Set(state.cancelledToday);
  for (const leg of state.schedule) {
    if (!cancelled.has(leg.legId) || !isAirportKnown(leg.origin) || !isAirportKnown(leg.dest)) continue;
    const key = [leg.origin, leg.dest].sort().join('-');
    const entry = counts.get(key) ?? { origin: leg.origin, dest: leg.dest, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  if (counts.size === 0) return;

  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.strokeStyle = CANCELLED_STROKE;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  const labels: { x: number; y: number; text: string }[] = [];
  for (const { origin, dest, count } of counts.values()) {
    const from = airportsByIata.get(origin);
    const to = airportsByIata.get(dest);
    if (!from || !to) continue;
    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [from.lon, from.lat],
        [to.lon, to.lat],
      ],
    };
    ctx.beginPath();
    path(line);
    ctx.stroke();
    // Off the middle, where the route's own label sits.
    const at = projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(0.35));
    if (at) labels.push({ x: at[0], y: at[1], text: `${count} CNX` });
  }
  ctx.setLineDash([]);
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const label of labels) {
    const width = ctx.measureText(label.text).width + 8;
    ctx.fillStyle = PIN_FILL;
    ctx.fillRect(label.x - width / 2, label.y - 7, width, 14);
    ctx.fillStyle = PIN_TEXT;
    ctx.fillText(label.text, label.x, label.y);
  }
  ctx.restore();
}

export function drawDisruptions(ctx: CanvasRenderingContext2D, state: SimState): void {
  if (!isOpsView()) return;
  drawCancelledLegs(ctx, state);
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const pin of layoutPins(ctx, state)) {
    ctx.fillStyle = PIN_FILL;
    ctx.strokeStyle = PIN_STROKE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pin.x, pin.y, pin.width, PIN_HEIGHT, 4);
    ctx.fill();
    ctx.stroke();
    drawWrench(ctx, pin.x + PIN_ICON_WIDTH / 2, pin.y + PIN_HEIGHT / 2 + 1);
    ctx.fillStyle = PIN_TEXT;
    ctx.fillText(pin.text, pin.x + PIN_ICON_WIDTH, pin.y + PIN_HEIGHT / 2 + 0.5);
  }
  ctx.restore();
}
