import { geoInterpolate, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { drawBasemap } from './basemap';
import { airports } from './airports';
import { projection, withFittedView } from './projection';
import { seatsADayByMarket, widthForSeats } from './routeWidth';
import { dailyDeparturesAt } from '../sim/airports';
import { dayIndex } from '../sim/clock';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { gameDateWithYear } from '../ui/format';
import { glyphSvg, type GlyphName } from '../ui/glyphs';

/**
 * The shareable picture of the player's network: the map fitted to the
 * network's own extent, so the whole network fills the card, with the home
 * airport, the date and a few numbers as icons. Drawn to its own canvas
 * through the shared projection, borrowed for the moment and then handed
 * back (projection.ts's withFittedView), so the live map never moves.
 * A pure read of `state`.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** Drawn at twice the CSS size so the image stays sharp when shared. */
const CARD_PIXEL_RATIO = 2;

// Room kept clear of the network for the title above and the numbers below.
const INSET = { top: 120, right: 90, bottom: 120, left: 90 };
// A one-airport network would zoom in without limit; this is the smallest span shown.
const MIN_SPAN_DEG = { lon: 8, lat: 4 };

const ROUTE_STROKE = '#ffd166';
const AIRPORT_FILL = '#f2f5fb';
const HOME_STROKE = '#5ed6c4';
const SCRIM = '5, 7, 12';
const TEXT = '#e6ebf5';
const TEXT_DIM = '#8d97ae';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

type Network = {
  /** Distinct city pairs, either direction counting once. */
  routes: { origin: string; dest: string; seatsADay: number }[];
  /** Every airport on the schedule, plus home, and how many flights leave it each day. */
  stops: Map<string, number>;
};

function readNetwork(state: SimState): Network {
  const seats = seatsADayByMarket(state);
  const seen = new Set<string>();
  const routes: Network['routes'] = [];
  const stops = new Map<string, number>([[state.homeAirport, 0]]);
  for (const leg of state.schedule) {
    for (const iata of [leg.origin, leg.dest]) {
      if (!stops.has(iata)) stops.set(iata, dailyDeparturesAt(state, iata));
    }
    const key = marketKey(leg.origin, leg.dest);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ origin: leg.origin, dest: leg.dest, seatsADay: seats.get(key) ?? 0 });
  }
  for (const iata of stops.keys()) stops.set(iata, dailyDeparturesAt(state, iata));
  return { routes, stops };
}

/** Points the map must show: every airport, and along each arc, since a long great circle bows away from its two ends. */
function pointsToFit(network: Network): [number, number][] {
  const points: [number, number][] = [];
  for (const iata of network.stops.keys()) {
    const airport = airportsByIata.get(iata);
    if (airport) points.push([airport.lon, airport.lat]);
  }
  for (const { origin, dest } of network.routes) {
    const from = airportsByIata.get(origin);
    const to = airportsByIata.get(dest);
    if (!from || !to) continue;
    const along = geoInterpolate([from.lon, from.lat], [to.lon, to.lat]);
    for (let step = 1; step < 8; step++) points.push(along(step / 8) as [number, number]);
  }
  if (points.length === 0) points.push([0, 0]);
  // Pad a tiny extent (a lone home airport) out to a region worth looking at.
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const spanLon = Math.max(...lons) - Math.min(...lons);
  const spanLat = Math.max(...lats) - Math.min(...lats);
  const centreLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const centreLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  if (spanLon < MIN_SPAN_DEG.lon) points.push([centreLon - MIN_SPAN_DEG.lon / 2, centreLat], [centreLon + MIN_SPAN_DEG.lon / 2, centreLat]);
  if (spanLat < MIN_SPAN_DEG.lat) points.push([centreLon, Math.max(-80, centreLat - MIN_SPAN_DEG.lat / 2)], [centreLon, Math.min(80, centreLat + MIN_SPAN_DEG.lat / 2)]);
  return points;
}

/** Draw the whole card, icons included, and hand back its canvas. */
export async function drawNetworkCard(state: SimState): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH * CARD_PIXEL_RATIO;
  canvas.height = CARD_HEIGHT * CARD_PIXEL_RATIO;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(CARD_PIXEL_RATIO, CARD_PIXEL_RATIO);

  const network = readNetwork(state);
  withFittedView(CARD_WIDTH, CARD_HEIGHT, INSET, pointsToFit(network), () => {
    drawBasemap(ctx);
    drawNetworkLines(ctx, network);
    drawNetworkAirports(ctx, state, network);
  });
  drawScrims(ctx);
  drawTitle(ctx, state);
  await drawNumbers(ctx, state, network);
  return canvas;
}

function drawNetworkLines(ctx: CanvasRenderingContext2D, network: Network): void {
  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.lineCap = 'round';
  // Heaviest last, so a busy trunk is never buried under thin routes.
  const byWeight = [...network.routes].sort((a, b) => a.seatsADay - b.seatsADay);
  for (const { origin, dest, seatsADay } of byWeight) {
    const from = airportsByIata.get(origin);
    const to = airportsByIata.get(dest);
    if (!from || !to) continue;
    const line: LineString = { type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] };
    const width = 1.5 + (widthForSeats(seatsADay) - 1) * 0.9;
    ctx.beginPath();
    path(line);
    ctx.strokeStyle = `rgba(255, 209, 102, 0.22)`;
    ctx.lineWidth = width + 5;
    ctx.stroke();
    ctx.strokeStyle = ROUTE_STROKE;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.restore();
}

type Placed = { x: number; y: number; w: number; h: number };
const overlaps = (a: Placed, b: Placed): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawNetworkAirports(ctx: CanvasRenderingContext2D, state: SimState, network: Network): void {
  const placed: Placed[] = [];
  const stops = [...network.stops.entries()].sort((a, b) => (a[0] === state.homeAirport ? -1 : b[0] === state.homeAirport ? 1 : b[1] - a[1]));
  const dots: { x: number; y: number; r: number; iata: string }[] = [];
  for (const [iata, departures] of stops) {
    const airport = airportsByIata.get(iata);
    const at = airport ? projection([airport.lon, airport.lat]) : null;
    if (!at) continue;
    const r = 3.5 + Math.min(5, Math.sqrt(departures) * 0.9);
    dots.push({ x: at[0], y: at[1], r, iata });
    placed.push({ x: at[0] - r, y: at[1] - r, w: r * 2, h: r * 2 });
  }
  ctx.save();
  for (const { x, y, r, iata } of dots) {
    const home = iata === state.homeAirport;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = AIRPORT_FILL;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = home ? HOME_STROKE : 'rgba(5, 7, 12, 0.85)';
    ctx.stroke();
    if (home) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = HOME_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  // Codes next to their dots, biggest first; one that would sit on another label or dot is left off.
  ctx.font = `600 13px ${FONT}`;
  ctx.textBaseline = 'middle';
  for (const { x, y, r, iata } of dots) {
    const width = ctx.measureText(iata).width;
    const gap = r + 7;
    const tries: Placed[] = [
      { x: x + gap, y: y - 8, w: width, h: 16 },
      { x: x - gap - width, y: y - 8, w: width, h: 16 },
      { x: x - width / 2, y: y - gap - 14, w: width, h: 16 },
      { x: x - width / 2, y: y + gap - 2, w: width, h: 16 },
    ];
    const spot = tries.find((box) => box.x > 6 && box.x + box.w < CARD_WIDTH - 6 && box.y > 6 && box.y + box.h < CARD_HEIGHT - 6 && !placed.some((other) => overlaps(box, other)));
    if (!spot) continue;
    placed.push(spot);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(${SCRIM}, 0.85)`;
    ctx.lineJoin = 'round';
    ctx.strokeText(iata, spot.x, spot.y + 8);
    ctx.fillStyle = TEXT;
    ctx.fillText(iata, spot.x, spot.y + 8);
  }
  ctx.restore();
}

/** Darken the top and bottom edges so the title and numbers read over any map. */
function drawScrims(ctx: CanvasRenderingContext2D): void {
  const top = ctx.createLinearGradient(0, 0, 0, 130);
  top.addColorStop(0, `rgba(${SCRIM}, 0.92)`);
  top.addColorStop(1, `rgba(${SCRIM}, 0)`);
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_WIDTH, 130);
  const bottom = ctx.createLinearGradient(0, CARD_HEIGHT - 120, 0, CARD_HEIGHT);
  bottom.addColorStop(0, `rgba(${SCRIM}, 0)`);
  bottom.addColorStop(1, `rgba(${SCRIM}, 0.95)`);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, CARD_HEIGHT - 120, CARD_WIDTH, 120);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_WIDTH - 2, CARD_HEIGHT - 2);
}

function drawTitle(ctx: CanvasRenderingContext2D, state: SimState): void {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText(state.homeAirport, 40, 66);
  const codeWidth = ctx.measureText(state.homeAirport).width;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(`Day ${dayIndex(state)} · ${gameDateWithYear(state, dayIndex(state))}`, 40 + codeWidth + 22, 66);
  ctx.restore();
}

// The numbers, as an icon and a count: no words on the card.
const ROUTES_ICON = '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="5" r="2"/><path d="M6.5 16.5 10.8 6.8M13.8 5.7 17.3 6.3M6.8 17 17.4 8.3"/>';

function iconImage(inner: string, colour: string): Promise<HTMLImageElement> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('icon failed to load'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** A glyph's drawing without its <svg> wrapper. */
function glyphInner(name: GlyphName): string {
  return glyphSvg(name).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

async function drawNumbers(ctx: CanvasRenderingContext2D, state: SimState, network: Network): Promise<void> {
  const stats: { icon: string; value: number }[] = [
    { icon: glyphInner('plane'), value: state.aircraft.length },
    { icon: ROUTES_ICON, value: network.routes.length },
    { icon: glyphInner('mapPin'), value: [...network.stops.keys()].length },
    { icon: glyphInner('boarding'), value: state.schedule.length },
  ];
  const icons = await Promise.all(stats.map((stat) => iconImage(stat.icon, ROUTE_STROKE)));
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  let x = 40;
  const baseline = CARD_HEIGHT - 36;
  stats.forEach((stat, index) => {
    ctx.drawImage(icons[index], x, baseline - 34, 40, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 34px ${FONT}`;
    const text = String(stat.value);
    ctx.fillText(text, x + 50, baseline);
    x += 50 + ctx.measureText(text).width + 44;
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT_DIM;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText('Slots & Spokes', CARD_WIDTH - 40, baseline);
  ctx.restore();
}
