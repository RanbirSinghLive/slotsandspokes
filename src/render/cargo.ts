import { geoInterpolate, geoPath } from 'd3-geo';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { CARGO_GOODS, airportCargo, bestCargoPartners, lanesBetween, laneDollarsPerDay, producedTonnes, neededTonnes, type Lane } from '../sim/cargo';
import type { SimState } from '../sim/state';

/**
 * The Cargo lens: which goods an airport makes and which it needs, read
 * from pictures and two colours, with no words.
 *
 * - **A badge is a good**: a round icon (a fish for seafood). An **amber**
 *   ring with a ▲ means the airport makes it, a **teal** ring with a ▼
 *   means it needs it.
 * - **A lane is amber to teal**: a line shaded from the airport that
 *   makes the good to the one that needs it, the good's icon at its middle.
 * - **Idle**: each airport shows its specialty and its biggest need, thinned
 *   so badges never overlap; airports on your routes come first. Your
 *   freight-carrying routes are drawn as lanes, thicker the more it pays.
 * - **Focus** (hover or select an airport): everything else drops away and
 *   you see that airport's goods, its best partners, and only the goods
 *   that match between them. Dashed lanes are ones you don't fly yet.
 *
 * Reads only sim/cargo.ts's numbers, and draws under the airport dots.
 */

/** One icon per good, in the order of data/cargo-goods.json. */
export const CARGO_GOOD_GLYPHS: Record<string, string> = {
  seafood: '🐟',
  produce: '🥬',
  autoparts: '⚙️',
  aerospace: '🚀',
  electronics: '💻',
  parcels: '📦',
  medical: '💊',
  minerals: '⛏️',
  supplies: '🧰',
  textiles: '👕',
};

export function cargoGlyph(goodId: string): string {
  return CARGO_GOOD_GLYPHS[goodId] ?? '•';
}

export const MAKES_COLOR = '#ffb347';
export const NEEDS_COLOR = '#5ed6c4';
const BADGE_RADIUS = 9;
const BADGE_FONT = '11px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
/** Idle badges closer than this on screen are thinned to the busier airport. */
const IDLE_MIN_GAP_PX = 34;
const FOCUS_PARTNERS = 6;
const FLOWN_MIN_WIDTH = 1.5;
const FLOWN_MAX_WIDTH = 5;
/** Daily dollars of matched freight that draw a flown route at full width. */
const FULL_WIDTH_DOLLARS = 4000;
/** Lanes shorter than this on screen skip the middle icon. */
const MIN_LANE_PX_FOR_ICON = 48;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));
/** Airports in busiest-first order for thinning idle badges, computed once. */
const airportsBusiestFirst = airports
  .map((airport) => {
    const cargo = airportCargo(airport.iata);
    const volume =
      cargo.produces.reduce((total, id) => total + producedTonnes(airport.iata, id), 0) +
      cargo.needs.reduce((total, id) => total + neededTonnes(airport.iata, id), 0);
    return { airport, cargo, volume };
  })
  .filter((entry) => entry.volume > 0)
  .sort((x, y) => y.volume - x.volume);

type FlownLane = { lane: Lane; dollarsPerDay: number; bothWays: boolean };

let flownCache: { signature: string; lanes: FlownLane[]; ends: Set<string> } | null = null;

/** The best lane each way on each market you fly, cached until the schedule changes. */
function flownLanes(state: SimState): { lanes: FlownLane[]; ends: Set<string> } {
  const markets = new Map<string, [string, string]>();
  for (const leg of state.schedule) markets.set(leg.origin < leg.dest ? `${leg.origin}-${leg.dest}` : `${leg.dest}-${leg.origin}`, [leg.origin, leg.dest]);
  const signature = [...markets.keys()].sort().join('|');
  if (flownCache?.signature !== signature) {
    const lanes: FlownLane[] = [];
    const ends = new Set<string>();
    for (const [a, b] of markets.values()) {
      const forward = lanesBetween(a, b)[0];
      const back = lanesBetween(b, a)[0];
      for (const lane of [forward, back]) {
        if (!lane) continue;
        lanes.push({ lane, dollarsPerDay: laneDollarsPerDay(lane), bothWays: Boolean(forward && back) });
        ends.add(a);
        ends.add(b);
      }
    }
    flownCache = { signature, lanes, ends };
  }
  return flownCache;
}

let focusCache: { iata: string; known: number; partners: ReturnType<typeof bestCargoPartners> } | null = null;

function focusPartners(state: SimState, iata: string) {
  if (focusCache?.iata !== iata || focusCache.known !== state.knownAirports.length) {
    focusCache = { iata, known: state.knownAirports.length, partners: bestCargoPartners(iata, state.knownAirports, FOCUS_PARTNERS) };
  }
  return focusCache.partners;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** One good as a round icon: amber ring and ▲ for "makes", teal ring and ▼ for "needs". */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, goodId: string, role: 'makes' | 'needs'): void {
  const color = role === 'makes' ? MAKES_COLOR : NEEDS_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, BADGE_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(14, 18, 28, 0.88)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = BADGE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(cargoGlyph(goodId), x, y + 0.5);
  // The triangle repeats the ring colour for anyone who can't tell amber from teal.
  const tipY = role === 'makes' ? y - BADGE_RADIUS - 4 : y + BADGE_RADIUS + 4;
  const baseY = role === 'makes' ? y - BADGE_RADIUS : y + BADGE_RADIUS;
  ctx.beginPath();
  ctx.moveTo(x, tipY);
  ctx.lineTo(x - 3.5, baseY);
  ctx.lineTo(x + 3.5, baseY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** A row of badges centred on `x`. */
function drawBadgeRow(ctx: CanvasRenderingContext2D, x: number, y: number, goodIds: string[], role: 'makes' | 'needs'): void {
  const step = BADGE_RADIUS * 2 + 3;
  const left = x - ((goodIds.length - 1) * step) / 2;
  goodIds.forEach((id, index) => drawBadge(ctx, left + index * step, y, id, role));
}

/** A lane: a line shaded amber (makes) to teal (needs), with the good's icon at its middle. */
function drawLane(ctx: CanvasRenderingContext2D, lane: Lane, width: number, dashed: boolean, offsetPx: number): void {
  const from = airportsByIata.get(lane.from);
  const to = airportsByIata.get(lane.to);
  if (!from || !to) return;
  const start = projection([from.lon, from.lat]);
  const end = projection([to.lon, to.lat]);
  const middle = projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(0.5));
  if (!start || !end || !middle) return;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const dx = length > 0 ? (-(end[1] - start[1]) / length) * offsetPx : 0;
  const dy = length > 0 ? ((end[0] - start[0]) / length) * offsetPx : 0;
  const gradient = ctx.createLinearGradient(start[0], start[1], end[0], end[1]);
  gradient.addColorStop(0, MAKES_COLOR);
  gradient.addColorStop(1, NEEDS_COLOR);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.beginPath();
  geoPath(projection, ctx)({ type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] });
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.strokeStyle = gradient;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
  if (length >= MIN_LANE_PX_FOR_ICON) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.font = BADGE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.arc(middle[0], middle[1], 8, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(14, 18, 28, 0.88)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(cargoGlyph(lane.good.id), middle[0], middle[1] + 0.5);
    ctx.restore();
  }
}

/** `focus` is the airport whose partners get lanes: the hovered one, else the selected one, else none. */
export function drawCargoLayer(ctx: CanvasRenderingContext2D, state: SimState, focus: string | null): void {
  const focused = focus !== null && isAirportKnown(focus) && airportsByIata.has(focus);
  if (focused) drawFocus(ctx, state, focus);
  else drawIdle(ctx, state);
  ctx.globalAlpha = 1;
}

function drawIdle(ctx: CanvasRenderingContext2D, state: SimState): void {
  const { lanes, ends } = flownLanes(state);
  for (const entry of lanes) {
    if (!isAirportKnown(entry.lane.from) || !isAirportKnown(entry.lane.to)) continue;
    const width = lerp(FLOWN_MIN_WIDTH, FLOWN_MAX_WIDTH, Math.min(1, entry.dollarsPerDay / FULL_WIDTH_DOLLARS));
    drawLane(ctx, entry.lane, width, false, entry.bothWays ? 2.5 : 0);
  }

  // Badges: your airports first, then the busiest, skipping any too close to one already placed.
  const ordered = [...airportsBusiestFirst].sort((x, y) => Number(ends.has(y.airport.iata)) - Number(ends.has(x.airport.iata)));
  const placed: [number, number][] = [];
  for (const { airport, cargo } of ordered) {
    if (!isAirportKnown(airport.iata)) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    if (placed.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) < IDLE_MIN_GAP_PX)) continue;
    placed.push(point);
    const makes = cargo.produces[0];
    const needs = cargo.needs[0];
    const gap = BADGE_RADIUS + 2;
    if (makes && needs) {
      drawBadge(ctx, point[0] - gap, point[1] - BADGE_RADIUS - 6, makes, 'makes');
      drawBadge(ctx, point[0] + gap, point[1] - BADGE_RADIUS - 6, needs, 'needs');
    } else if (makes) drawBadge(ctx, point[0], point[1] - BADGE_RADIUS - 6, makes, 'makes');
    else if (needs) drawBadge(ctx, point[0], point[1] - BADGE_RADIUS - 6, needs, 'needs');
  }
}

function drawFocus(ctx: CanvasRenderingContext2D, state: SimState, focus: string): void {
  // A veil over the routes and basemap drawn so far, so the lanes and icons are what you read.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(8, 11, 18, 0.6)';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  const flown = new Set(state.schedule.map((leg) => (leg.origin === focus ? leg.dest : leg.origin)));
  const partners = focusPartners(state, focus).filter((entry) => isAirportKnown(entry.partner));
  const biggest = partners[0]?.dollarsPerDay || 1;

  // Lanes first, so the badges sit on top of them.
  for (const entry of partners) {
    const outbound = lanesBetween(focus, entry.partner);
    const inbound = lanesBetween(entry.partner, focus);
    const bothWays = outbound.length > 0 && inbound.length > 0;
    const width = 1 + 3 * (entry.dollarsPerDay / biggest);
    const dashed = !flown.has(entry.partner);
    if (outbound[0]) drawLane(ctx, outbound[0], width, dashed, bothWays ? 2.5 : 0);
    if (inbound[0]) drawLane(ctx, inbound[0], width, dashed, bothWays ? 2.5 : 0);
  }

  // Partners show only the goods that match with the focus, so what lines up is what you see.
  for (const entry of partners) {
    const airport = airportsByIata.get(entry.partner);
    const point = airport && projection([airport.lon, airport.lat]);
    if (!point) continue;
    const makes = lanesBetween(entry.partner, focus).map((lane) => lane.good.id);
    const needs = lanesBetween(focus, entry.partner).map((lane) => lane.good.id);
    const above = point[1] - BADGE_RADIUS - 6;
    if (makes.length > 0) drawBadgeRow(ctx, point[0], above, makes, 'makes');
    if (needs.length > 0) drawBadgeRow(ctx, point[0], makes.length > 0 ? above - BADGE_RADIUS * 2 - 8 : above, needs, 'needs');
  }

  // The focus airport shows everything it makes (above) and needs (below).
  const origin = airportsByIata.get(focus);
  const point = origin && projection([origin.lon, origin.lat]);
  const cargo = airportCargo(focus);
  if (point) {
    drawBadgeRow(ctx, point[0], point[1] - BADGE_RADIUS - 6, cargo.produces, 'makes');
    drawBadgeRow(ctx, point[0], point[1] + BADGE_RADIUS + 6, cargo.needs, 'needs');
  }
}

/** The key under the lens: each good's icon and name (the name is its hover tip). */
export function cargoLegend(): { glyph: string; label: string }[] {
  return CARGO_GOODS.map((good) => ({ glyph: cargoGlyph(good.id), label: good.name }));
}
