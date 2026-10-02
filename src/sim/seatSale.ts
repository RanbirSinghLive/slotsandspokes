import { dayIndex } from './clock';
import { DEFAULT_FARE_CLASSES, type FareClassSettings } from './fareClasses';
import { marketKey } from './schedule';
import { summarizeMarket } from './marketSummary';
import type { SimState } from './state';

/**
 * Seat sales (WEEK-FOURTEEN.md, stage 3): a short, loud price cut on one
 * route. For SALE_DAYS, Saver sells at SALE_SAVER_PRICE of the fare
 * instead of 75%, with at least SALE_SAVER_SHARE of the seats, and the
 * market builds SALE_GROWTH times as fast (sim/marketDemand.ts): new
 * travellers try it. Rivals read it as a cut and answer it
 * (sim/competitors.ts), so a sale can start a fare war. One per route
 * every SALE_COOLDOWN_DAYS, counted from its start, so a sale is a
 * moment rather than a standing price.
 */

export const SALE_DAYS = 7;
export const SALE_COOLDOWN_DAYS = 30;
export const SALE_SAVER_PRICE = 0.5;
const SALE_SAVER_SHARE = 0.4;
export const SALE_GROWTH = 2;
/** How a sale looks to a rival watching your fares: the fare cut by this share. */
export const SALE_RIVAL_READ = 0.15;

/** Whether this market's seat sale runs today. */
export function onSale(state: SimState, key: string): boolean {
  const sale = state.routeSettings[key]?.sale;
  return sale !== undefined && dayIndex(state) < sale.startDay + SALE_DAYS;
}

/** Days left of a sale running today, or null. */
export function saleDaysLeft(state: SimState, key: string): number | null {
  const sale = state.routeSettings[key]?.sale;
  if (!sale || !onSale(state, key)) return null;
  return sale.startDay + SALE_DAYS - dayIndex(state);
}

/** The route's seat split as sold today: its own (or `classes`, for a forecast), or the sale's when one runs. */
export function effectiveFareClasses(state: SimState, key: string, classes: FareClassSettings = state.routeSettings[key]?.fareClasses ?? DEFAULT_FARE_CLASSES): FareClassSettings {
  if (!onSale(state, key)) return classes;
  const saverShare = Math.max(classes.saverShare, SALE_SAVER_SHARE);
  // Saver takes its extra seats from Flex first, then Full.
  const flexShare = Math.max(0, Math.min(classes.flexShare, 1 - saverShare));
  return { saverShare, flexShare, saverPrice: SALE_SAVER_PRICE };
}

/** Why a sale can't start on this market now, or null when it can. */
export function saleBlockedReason(state: SimState, a: string, b: string): string | null {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings || !state.schedule.some((leg) => marketKey(leg.origin, leg.dest) === key)) return 'Not flown.';
  if (onSale(state, key)) return 'On sale now.';
  if (settings.sale) {
    const next = settings.sale.startDay + SALE_COOLDOWN_DAYS;
    if (dayIndex(state) < next) return `Next sale in ${next - dayIndex(state)}d.`;
  }
  return null;
}

export function startSeatSale(state: SimState, a: string, b: string): { ok: true; message: string } | { ok: false; reason: string } {
  const blocked = saleBlockedReason(state, a, b);
  if (blocked) return { ok: false, reason: blocked };
  const settings = state.routeSettings[marketKey(a, b)];
  settings.sale = { startDay: dayIndex(state) };
  return { ok: true, message: `Seat sale ${a}–${b} · ${SALE_DAYS}d · Saver $${Math.round(settings.fare * SALE_SAVER_PRICE)}` };
}

/**
 * What a day of a sale would make on this market against a normal day,
 * through the game's own forecast (sim/marketSummary.ts): the sale is
 * started on the route for the forecast and taken off again. Leaves out
 * what it adds by building the market faster, which pays later.
 */
export function saleMarginChangePerDay(state: SimState, a: string, b: string): number {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings) return 0;
  const before = summarizeMarket(a, b, state, settings).margin;
  const had = settings.sale;
  settings.sale = { startDay: dayIndex(state) };
  const during = summarizeMarket(a, b, state, settings).margin;
  if (had) settings.sale = had;
  else delete settings.sale;
  return Math.round(during - before);
}
