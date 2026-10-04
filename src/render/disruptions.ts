import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airportClaimedBoxes, airports, isAirportKnown, type Box } from './airports';
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
/** Fractions along a cancelled route to try for its count tag, in order. */
const TAG_POSITIONS = [0.35, 0.65, 0.25, 0.75, 0.5, 0.15, 0.85];

type Pin = { text: string; x: number; y: number; width: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function pinBox(pin: Pin): Box {
  return { left: pin.x, top: pin.y, right: pin.x + pin.width, bottom: pin.y + PIN_HEIGHT };
}

/**
 * Where an airport's stack of pins sits relative to its dot. Candidates run
 * from the tidy default (straight above) outward: centred, right, then left
 * of the dot, one row band higher, then lower, a few bands out. The first
 * spot clear of airport labels, dots and earlier pins wins; if none is, the
 * default stays.
 */
type PinPlacement = (width: number, stackHeight: number) => [number, number];
const PIN_PLACEMENTS: PinPlacement[] = [];
for (let band = 0; band < 5; band++) {
  const extra = band * (PIN_HEIGHT + 4);
  const sides: ((width: number) => number)[] = [() => -PIN_ICON_WIDTH / 2, () => 8, (width) => -width - 8];
  for (const dx of sides) {
    PIN_PLACEMENTS.push((width) => [dx(width), -PIN_LIFT_PX - extra]);
  }
  for (const dx of sides) {
    PIN_PLACEMENTS.push((width, stackHeight) => [dx(width), PIN_LIFT_PX + extra + stackHeight - PIN_HEIGHT]);
  }
}

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
    const widths = shown.map((text) => PIN_ICON_WIDTH + (ctx ? ctx.measureText(text).width : text.length * 6) + PIN_TEXT_PAD);
    const stackWidth = Math.max(...widths);
    const stackHeight = shown.length * (PIN_HEIGHT + PIN_GAP) - PIN_GAP;
    const build = (placement: (width: number, stackHeight: number) => [number, number]): Pin[] => {
      const [dx, dy] = placement(stackWidth, stackHeight);
      return shown.map((text, index) => ({
        text,
        x: point[0] + dx,
        y: point[1] + dy - PIN_HEIGHT - index * (PIN_HEIGHT + PIN_GAP),
        width: widths[index],
      }));
    };
    const taken = [...airportClaimedBoxes(), ...pins.map(pinBox)];
    const chosen = PIN_PLACEMENTS.map(build).find((stack) => stack.every((pin) => !taken.some((box) => boxesOverlap(pinBox(pin), box))));
    pins.push(...(chosen ?? build(PIN_PLACEMENTS[0])));
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

function drawCancelledLegs(ctx: CanvasRenderingContext2D, state: SimState, pins: Pin[]): void {
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
  ctx.font = '600 10px system-ui, sans-serif';
  const taken: Box[] = [...airportClaimedBoxes(), ...pins.map(pinBox)];
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
    // Off the middle, where the route's own label sits, and slid along the
    // route to the first spot clear of airport labels, pins and other tags.
    const text = `${count} CNX`;
    const halfWidth = (ctx.measureText(text).width + 8) / 2;
    const along = geoInterpolate([from.lon, from.lat], [to.lon, to.lat]);
    let placed: { x: number; y: number; text: string } | null = null;
    for (const t of TAG_POSITIONS) {
      const at = projection(along(t));
      if (!at) continue;
      const box = { left: at[0] - halfWidth, top: at[1] - 7, right: at[0] + halfWidth, bottom: at[1] + 7 };
      if (taken.some((other) => boxesOverlap(box, other))) continue;
      placed = { x: at[0], y: at[1], text };
      taken.push(box);
      break;
    }
    if (!placed) {
      const at = projection(along(TAG_POSITIONS[0]));
      if (at) placed = { x: at[0], y: at[1], text };
    }
    if (placed) labels.push(placed);
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
  const pins = layoutPins(ctx, state);
  drawCancelledLegs(ctx, state, pins);
  ctx.save();
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const pin of pins) {
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
