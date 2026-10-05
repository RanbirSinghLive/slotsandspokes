import { geoPath } from 'd3-geo';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { CARGO_GOODS, airportCargoVolume, bestCargoPartners, lanesBetween, laneDollarsPerDay } from '../sim/cargo';
import type { SimState } from '../sim/state';

/**
 * The Cargo lens: where the goods are, readable at a glance (sim/cargo.ts).
 *
 * - **A circle per airport**, sized by the tonnes a day it makes and needs,
 *   amber where it mostly ships (▲ makes) and teal where it mostly takes in
 *   (▼ needs).
 * - **Your routes that carry freight**: a line coloured by the good that
 *   pays most on the pair, thicker the more matched freight a day.
 * - **Lines only on request**: hovering (or selecting) an airport draws its
 *   best matched partners, dashed where you don't fly them yet.
 *
 * Reads only sim/cargo.ts's numbers, and draws under the airport dots.
 */

/** One colour per good; main.ts's legend swatches are literally these. */
export const CARGO_GOOD_COLORS: Record<string, string> = {
  seafood: '#4aa3df',
  produce: '#7fd88f',
  autoparts: '#b0b6c3',
  aerospace: '#c792ea',
  electronics: '#ffd166',
  parcels: '#e8a87c',
  medical: '#ff7f9f',
  minerals: '#a67c52',
  supplies: '#5ed6c4',
  textiles: '#e07bd8',
};

const MAKES_RGB: [number, number, number] = [255, 179, 71];
const NEEDS_RGB: [number, number, number] = [94, 214, 196];
const FOCUS_PARTNERS = 6;
const FLOWN_MIN_WIDTH = 1.5;
const FLOWN_MAX_WIDTH = 5;
/** Daily dollars of matched freight that draw a flown route at full width. */
const FULL_WIDTH_DOLLARS = 4000;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));
const volumeByAirport = new Map<string, { makes: number; needs: number }>();

function volumeAt(iata: string): { makes: number; needs: number } {
  let volume = volumeByAirport.get(iata);
  if (!volume) {
    volume = airportCargoVolume(iata);
    volumeByAirport.set(iata, volume);
  }
  return volume;
}

/** The pair's lanes both ways, with the good that pays most and the total matched dollars a day. */
function pairSummary(a: string, b: string): { topGood: string; dollarsPerDay: number } | null {
  const lanes = [...lanesBetween(a, b), ...lanesBetween(b, a)];
  if (lanes.length === 0) return null;
  let top = lanes[0];
  let total = 0;
  for (const lane of lanes) {
    const dollars = laneDollarsPerDay(lane);
    total += dollars;
    if (dollars > laneDollarsPerDay(top)) top = lane;
  }
  return { topGood: top.good.id, dollarsPerDay: total };
}

let flownCache: { signature: string; pairs: { a: string; b: string; topGood: string; dollarsPerDay: number }[] } | null = null;

/** Your flown markets that have matched freight, cached until the schedule changes. */
function flownLanes(state: SimState): { a: string; b: string; topGood: string; dollarsPerDay: number }[] {
  const markets = new Map<string, [string, string]>();
  for (const leg of state.schedule) markets.set(leg.origin < leg.dest ? `${leg.origin}-${leg.dest}` : `${leg.dest}-${leg.origin}`, [leg.origin, leg.dest]);
  const signature = [...markets.keys()].sort().join('|');
  if (flownCache?.signature !== signature) {
    const pairs: { a: string; b: string; topGood: string; dollarsPerDay: number }[] = [];
    for (const [a, b] of markets.values()) {
      const summary = pairSummary(a, b);
      if (summary) pairs.push({ a, b, ...summary });
    }
    flownCache = { signature, pairs };
  }
  return flownCache.pairs;
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

/** `focus` is the airport whose partners get lines: the hovered one, else the selected one, else none. */
export function drawCargoLayer(ctx: CanvasRenderingContext2D, state: SimState, focus: string | null): void {
  const path = geoPath(projection, ctx);

  for (const airport of airports) {
    if (!isAirportKnown(airport.iata)) continue;
    const { makes, needs } = volumeAt(airport.iata);
    const total = makes + needs;
    if (total <= 0) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const makesShare = makes / total;
    const rgb = [0, 1, 2].map((i) => Math.round(lerp(NEEDS_RGB[i], MAKES_RGB[i], makesShare)));
    const radius = 2 + 1.4 * Math.sqrt(total);
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(${rgb.join(', ')}, 0.3)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb.join(', ')}, 0.75)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (const lane of flownLanes(state)) {
    const from = airportsByIata.get(lane.a);
    const to = airportsByIata.get(lane.b);
    if (!from || !to || !isAirportKnown(lane.a) || !isAirportKnown(lane.b)) continue;
    ctx.beginPath();
    path({ type: 'LineString', coordinates: [[from.lon, from.lat], [to.lon, to.lat]] });
    ctx.strokeStyle = CARGO_GOOD_COLORS[lane.topGood] ?? '#9aa3b8';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = lerp(FLOWN_MIN_WIDTH, FLOWN_MAX_WIDTH, Math.min(1, lane.dollarsPerDay / FULL_WIDTH_DOLLARS));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (!focus || !isAirportKnown(focus)) return;
  const origin = airportsByIata.get(focus);
  if (!origin) return;
  const flown = new Set(state.schedule.map((leg) => (leg.origin === focus ? leg.dest : leg.origin)));
  const partners = focusPartners(state, focus);
  const biggest = partners[0]?.dollarsPerDay || 1;
  ctx.save();
  for (const entry of partners) {
    const to = airportsByIata.get(entry.partner);
    if (!to || !isAirportKnown(entry.partner)) continue;
    ctx.beginPath();
    path({ type: 'LineString', coordinates: [[origin.lon, origin.lat], [to.lon, to.lat]] });
    ctx.setLineDash(flown.has(entry.partner) ? [] : [5, 4]);
    ctx.strokeStyle = CARGO_GOOD_COLORS[entry.goods[0]] ?? '#9aa3b8';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1 + 3 * (entry.dollarsPerDay / biggest);
    ctx.stroke();
  }
  ctx.restore();
}

/** Legend rows for main.ts: every good with its colour and name. */
export function cargoLegend(): { color: string; label: string }[] {
  return CARGO_GOODS.map((good) => ({ color: CARGO_GOOD_COLORS[good.id] ?? '#9aa3b8', label: good.name }));
}
