import aircraftTypesData from '../../data/aircraft-types.json';
import { marketKey, recommendedFare } from './schedule';
import type { SimState } from './state';
import type { SegmentName } from './timeOfDay';

/**
 * Brand position (WEEK-FOURTEEN.md, stage 3): what the airline is known
 * for, from what it charges. It's the network's fare level (every flight's
 * fare against its going rate, weighted by seats) averaged over about
 * BRAND_DAYS, so it takes months to build and months to move: a moat,
 * not a switch.
 *
 * - **Low-cost** (under LOW_COST_LEVEL): leisure and VFR travellers
 *   prefer you to a rival, business travellers less.
 * - **Premium** (over PREMIUM_LEVEL): the reverse.
 * - **Mainline** between: neither.
 *
 * The pull grows smoothly with distance from 100%, up to MAX_POSITION_EDGE
 * of booking utility at FULL_POSITION_GAP (for scale, that's about 25 NPS
 * points, sim/nps.ts). It counts against rivals only, like NPS: a name
 * wins travellers from other airlines, it doesn't make more people fly.
 */

export type BrandPosition = 'Low-cost' | 'Mainline' | 'Premium';

/** About how many days of fares the position remembers. */
export const BRAND_DAYS = 60;
export const LOW_COST_LEVEL = 0.9;
export const PREMIUM_LEVEL = 1.15;
/** The most a position pulls a segment, in booking utility. */
const MAX_POSITION_EDGE = 0.2;
/** How far from 100% the pull is full. */
const FULL_POSITION_GAP = 0.25;

const seatsByTypeCode = new Map((aircraftTypesData as Array<{ code: string; seats: number }>).map((type) => [type.code, type.seats]));

/** Today's network fare level: every leg's seats at its market's fare, over the same seats at the going rate. Null with nothing flying. */
export function networkFareLevelToday(state: SimState): number | null {
  const seatsByTail = new Map(state.aircraft.map((a) => [a.tail, seatsByTypeCode.get(a.typeCode) ?? 0]));
  let charged = 0;
  let going = 0;
  for (const leg of state.schedule) {
    const seats = seatsByTail.get(leg.tail) ?? 0;
    const fare = state.routeSettings[marketKey(leg.origin, leg.dest)]?.fare;
    if (!seats || !fare) continue;
    charged += seats * fare;
    going += seats * recommendedFare(leg.origin, leg.dest);
  }
  return going > 0 ? charged / going : null;
}

/** The remembered level: 100% until the airline has flown. */
export function brandLevel(state: SimState): number {
  return state.brandLevel ?? 1;
}

/** Once a day at rollover: the remembered level moves 1/BRAND_DAYS of the way to today's. */
export function rollDailyBrand(state: SimState): void {
  const today = networkFareLevelToday(state);
  if (today === null) return;
  const level = brandLevel(state);
  state.brandLevel = Math.round((level + (today - level) / BRAND_DAYS) * 10_000) / 10_000;
}

export function brandPosition(state: SimState): BrandPosition {
  const level = brandLevel(state);
  return level < LOW_COST_LEVEL ? 'Low-cost' : level > PREMIUM_LEVEL ? 'Premium' : 'Mainline';
}

/** How much each segment prefers you to a rival for your position, in booking utility. */
export function positionEdge(state: SimState): Record<SegmentName, number> {
  const pull = Math.max(-1, Math.min(1, (1 - brandLevel(state)) / FULL_POSITION_GAP)) * MAX_POSITION_EDGE;
  // Positive pull is low-cost: leisure and VFR towards you, business away.
  return { leisure: pull, vfr: pull * 0.7, business: -pull };
}
