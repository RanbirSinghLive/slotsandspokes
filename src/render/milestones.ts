import { geoInterpolate } from 'd3-geo';
import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import { dayIndex } from '../sim/clock';
import { milestonesAtLastRollover, type Milestone } from '../sim/milestones';
import type { SimState } from '../sim/state';

/**
 * A one-shot pop on the map when a route or airport crosses a milestone
 * (sim/milestones.ts): a ring that swells and fades, and a chip naming
 * what was reached. Checked once per finished day, so even at 100× it's
 * a few pops a day and never a loop. Drawn in every lens, like a rival's
 * new-route flash, because the network growing is news wherever you look.
 *
 * Which day was last checked is UI bookkeeping kept here, never in state:
 * a fresh page or a loaded save starts from its current day, so nothing
 * pops for days that finished before you were watching.
 */

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const POP_DURATION_MS = 2600;
// At 100× a day lasts under two seconds, so a busy rollover shows its biggest few.
const MAX_POPS_PER_DAY = 4;
const POP_COLORS = { load: '#7fd88f', onTime: '#5ed6c8', airport: '#ffd166' } as const;

type Pop = { milestone: Milestone; startedAtMs: number };

let lastDayChecked: number | null = null;
let pops: Pop[] = [];
let popListener: ((milestones: Milestone[]) => void) | null = null;

/** Told the milestones each time a day brings pops, so the UI can play its chime (ui/popSound.ts). */
export function onMilestonePops(listener: (milestones: Milestone[]) => void): void {
  popListener = listener;
}

/** Biggest news first: an airport tier, then a higher load line, then on-time. */
function rank(milestone: Milestone): number {
  if (milestone.kind === 'airport') return 3000 + milestone.level / 100;
  if (milestone.kind === 'load') return 2000 + milestone.level * 100;
  return 1000;
}

function noteNewDay(state: SimState, nowMs: number): void {
  const today = dayIndex(state);
  if (lastDayChecked === null || today < lastDayChecked) {
    lastDayChecked = today;
    return;
  }
  if (today === lastDayChecked) return;
  lastDayChecked = today;
  const found = milestonesAtLastRollover(state)
    .filter((milestone) => (milestone.kind === 'airport' ? isAirportKnown(milestone.iata) : isAirportKnown(milestone.a) && isAirportKnown(milestone.b)))
    .sort((x, y) => rank(y) - rank(x))
    .slice(0, MAX_POPS_PER_DAY);
  for (const milestone of found) pops.push({ milestone, startedAtMs: nowMs });
  if (found.length > 0) popListener?.(found);
}

/** True while a pop is on screen, so a paused map keeps redrawing smoothly until it fades. */
export function milestonePopsActive(nowMs: number): boolean {
  return pops.some((pop) => nowMs - pop.startedAtMs < POP_DURATION_MS);
}

function label(milestone: Milestone): string {
  if (milestone.kind === 'airport') return `${milestone.iata} · ${milestone.level.toLocaleString('en-US')} pax/d`;
  const route = `${milestone.a}–${milestone.b}`;
  return milestone.kind === 'load' ? `${route} · LF ${Math.round(milestone.level * 100)}%` : `${route} · OTP ${Math.round(milestone.level * 100)}%`;
}

function anchor(milestone: Milestone): [number, number] | null {
  if (milestone.kind === 'airport') {
    const airport = airportsByIata.get(milestone.iata);
    return airport ? projection([airport.lon, airport.lat]) : null;
  }
  const from = airportsByIata.get(milestone.a);
  const to = airportsByIata.get(milestone.b);
  if (!from || !to) return null;
  return projection(geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(0.5));
}

export function drawMilestonePops(ctx: CanvasRenderingContext2D, state: SimState, nowMs: number): void {
  noteNewDay(state, nowMs);
  pops = pops.filter((pop) => nowMs - pop.startedAtMs < POP_DURATION_MS);
  if (pops.length === 0) return;

  ctx.save();
  ctx.font = '11px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { milestone, startedAtMs } of pops) {
    const point = anchor(milestone);
    if (!point) continue;
    const progress = (nowMs - startedAtMs) / POP_DURATION_MS;
    // Fast out, slow settle: the ring reaches most of its size in the first third.
    const swell = 1 - Math.pow(1 - Math.min(1, progress * 1.5), 3);
    const fade = progress < 0.75 ? 1 : 1 - (progress - 0.75) / 0.25;
    const color = POP_COLORS[milestone.kind];

    ctx.globalAlpha = fade * (1 - swell * 0.7);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(point[0], point[1], 6 + swell * 22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = fade;
    const text = label(milestone);
    const width = ctx.measureText(text).width + 12;
    const top = point[1] - 30 - swell * 6;
    ctx.fillStyle = 'rgba(10, 12, 18, 0.88)';
    ctx.fillRect(point[0] - width / 2, top, width, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, point[0], top + 8.5);
  }
  ctx.restore();
}
