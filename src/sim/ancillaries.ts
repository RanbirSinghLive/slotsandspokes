import { dayIndex } from './clock';
import { marketMix } from './marketCharacter';
import { marketKey } from './schedule';
import type { SimState } from './state';
import type { SegmentName } from './timeOfDay';

/**
 * Ancillary fees (WEEK-TWENTYFOUR.md): an airline-wide dial for what a
 * ticket does not include. Level 0 is today's game, bags included. Level 1
 * charges for a checked bag; level 2 for every bag plus seat choice.
 *
 * A fee earns on every passenger, most from leisure and VFR travellers
 * and least from business ones (whose bags a company pays for). It costs
 * NPS in the same proportion, so it pays on a leisure route and wastes
 * goodwill on a business trunk. Half of that goodwill cost is permanent;
 * the other half is the gap to what rivals charge, and rivals copy a
 * fee slowly (rollAncillaries()), so a fee is a head start that fades
 * into a plain cost of doing business. The dial moves at most once in
 * ANCILLARY_LOCK_DAYS so a peak-season switch-on can't be flipped back.
 *
 * A route can override the dial (RouteSettings.feeLevel). The NPS cost of
 * a fee is heavier where a rival flies the market, since passengers can
 * compare, and lighter where nobody else does: so the edge is to charge
 * where you are alone and go easy where you meet a rival.
 */

export type AncillaryLevel = 0 | 1 | 2;

export const ANCILLARY_LEVELS: readonly AncillaryLevel[] = [0, 1, 2];
export const ANCILLARY_NAMES: Record<AncillaryLevel, string> = { 0: 'Bags included', 1: 'Checked bag fee', 2: 'All bags and seat fee' };
/** Dollars charged per paying passenger, by level. */
export const ANCILLARY_FEE: Record<AncillaryLevel, number> = { 0: 0, 1: 10, 2: 20 };
/** NPS points lost per flight at a level, before the segment weighting. */
const ANCILLARY_NPS_COST: Record<AncillaryLevel, number> = { 0: 0, 1: 6, 2: 16 };
/** The share of each segment that pays the fee. */
const PAYING_SHARE: Record<SegmentName, number> = { business: 0.25, leisure: 0.85, vfr: 0.6 };
/** How strongly each segment marks the airline down for a fee (1 = the average traveller). */
const FEE_ANNOYANCE: Record<SegmentName, number> = { business: 0.5, leisure: 1.2, vfr: 1.1 };
/** Days the dial stays put after it moves. */
export const ANCILLARY_LOCK_DAYS = 30;
/** Days a route's own level stays put after it moves. */
export const ROUTE_FEE_LOCK_DAYS = 14;
/** The NPS cost of a fee on a market a rival flies, and on one nobody else flies. */
const CONTESTED_NPS_FACTOR = 1.5;
const UNCONTESTED_NPS_FACTOR = 0.6;
/** The share of the gap to the player's level rivals close each day. */
const RIVAL_COPY_RATE = 1 / 120;
/** The part of the NPS cost that never fades. */
const PERMANENT_SHARE = 0.5;

export function ancillaryLevel(state: SimState): AncillaryLevel {
  return (state.ancillaryLevel ?? 0) as AncillaryLevel;
}

/** Whether a rival flies this market. */
export function isContested(state: SimState, origin: string, dest: string): boolean {
  const key = marketKey(origin, dest);
  return state.competitorRoutes.some((route) => marketKey(route.origin, route.dest) === key);
}

/** The fee level on a market: the route's own, else the airline's dial. */
export function feeLevelOn(state: SimState, origin: string, dest: string): AncillaryLevel {
  return (state.routeSettings[marketKey(origin, dest)]?.feeLevel ?? ancillaryLevel(state)) as AncillaryLevel;
}

function mixWeighted(origin: string, dest: string, weight: Record<SegmentName, number>): number {
  const mix = marketMix(origin, dest);
  return mix.business * weight.business + mix.leisure * weight.leisure + mix.vfr * weight.vfr;
}

/** Fee revenue per passenger on this market at the current level. */
export function ancillaryPerPassenger(state: SimState, origin: string, dest: string): number {
  const level = feeLevelOn(state, origin, dest);
  if (level === 0) return 0;
  return ANCILLARY_FEE[level] * mixWeighted(origin, dest, PAYING_SHARE);
}

/**
 * What the fee adds to the price a segment compares, in dollars: the fee
 * times the share of that segment that pays it. Passengers weigh the
 * whole trip cost, so a fee costs bookings as well as NPS.
 */
export function ancillaryPriceDrag(state: SimState, origin: string, dest: string): Record<SegmentName, number> {
  const fee = ANCILLARY_FEE[feeLevelOn(state, origin, dest)];
  return { business: fee * PAYING_SHARE.business, leisure: fee * PAYING_SHARE.leisure, vfr: fee * PAYING_SHARE.vfr };
}

/** The NPS points a flight on this market loses to the fee; 0 at level 0. */
export function ancillaryNpsPenalty(state: SimState, origin: string, dest: string): number {
  const level = feeLevelOn(state, origin, dest);
  if (level === 0) return 0;
  const gap = Math.max(0, (level - (state.rivalFeeLevel ?? 0)) / level);
  const share = PERMANENT_SHARE + (1 - PERMANENT_SHARE) * gap;
  const comparison = isContested(state, origin, dest) ? CONTESTED_NPS_FACTOR : UNCONTESTED_NPS_FACTOR;
  return ANCILLARY_NPS_COST[level] * share * comparison * mixWeighted(origin, dest, FEE_ANNOYANCE);
}

/** Why the dial can't move now, or null. */
export function ancillaryBlockedReason(state: SimState, level: AncillaryLevel): string | null {
  if (level === ancillaryLevel(state)) return 'Already set.';
  const since = dayIndex(state) - (state.ancillaryChangedDay ?? -Infinity);
  if (since < ANCILLARY_LOCK_DAYS) return `Locked ${ANCILLARY_LOCK_DAYS - since}d more.`;
  return null;
}

export function setAncillaryLevel(state: SimState, level: AncillaryLevel): { ok: true; message: string } | { ok: false; reason: string } {
  const blocked = ancillaryBlockedReason(state, level);
  if (blocked) return { ok: false, reason: blocked };
  state.ancillaryLevel = level;
  state.ancillaryChangedDay = dayIndex(state);
  return { ok: true, message: `${ANCILLARY_NAMES[level]} from today.` };
}

/** Daily: fee money rolls to yesterday, and rivals move toward what the player charges, and back down when the player drops its fee. */
export function rollAncillaries(state: SimState): void {
  const earned = state.todayAncillaryRevenue ?? 0;
  state.yesterdayAncillaryRevenue = earned;
  state.ancillaryRevenueTotal = (state.ancillaryRevenueTotal ?? 0) + earned;
  state.todayAncillaryRevenue = 0;
  const target = ancillaryLevel(state);
  const rival = state.rivalFeeLevel ?? 0;
  if (target === 0 && rival === 0) return;
  state.rivalFeeLevel = rival + (target - rival) * RIVAL_COPY_RATE;
}

/** Why a route's level can't move now, or null. */
export function routeFeeBlockedReason(state: SimState, origin: string, dest: string, level: AncillaryLevel | null): string | null {
  const settings = state.routeSettings[marketKey(origin, dest)];
  if (!settings) return 'No such route.';
  if ((settings.feeLevel ?? null) === level) return 'Already set.';
  const since = dayIndex(state) - (settings.feeChangedDay ?? -Infinity);
  if (since < ROUTE_FEE_LOCK_DAYS) return `Locked ${ROUTE_FEE_LOCK_DAYS - since}d more.`;
  return null;
}

/** Set one route's fee level, or null to follow the airline's dial. */
export function setRouteFeeLevel(state: SimState, origin: string, dest: string, level: AncillaryLevel | null): { ok: true; message: string } | { ok: false; reason: string } {
  const blocked = routeFeeBlockedReason(state, origin, dest, level);
  if (blocked) return { ok: false, reason: blocked };
  const settings = state.routeSettings[marketKey(origin, dest)];
  if (level === null) delete settings.feeLevel;
  else settings.feeLevel = level;
  settings.feeChangedDay = dayIndex(state);
  return { ok: true, message: `${origin}–${dest} ${level === null ? 'follows the airline dial' : ANCILLARY_NAMES[level]}.` };
}
