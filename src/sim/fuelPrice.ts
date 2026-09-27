import aircraftTypesData from '../../data/aircraft-types.json';
import { executiveHedgePremiumMultiplier } from './executives';
import { dayIndex } from './clock';
import { legCostBreakdown, type EconomyAircraftType } from './economy';
import { FUEL_PRICE_BASELINE, FUEL_PRICE_MAX } from './fuel';
import { nextRandom } from './rng';
import { activeShock } from './shocks';
import type { SimState } from './state';

/**
 * The fuel market (WEEK-TEN.md, thread 10): a price that moves every day,
 * and a hedge the player can buy as a bet on where it goes.
 *
 * **The price** is the baseline times two things: a slow random walk that
 * wanders and drifts back (`state.fuelWalk`, a log-deviation from the
 * baseline, so +0.1 is about 10% dearer), and a fuel spike (sim/shocks.ts)
 * on top while one runs. The walk is mean-reverting: each day it keeps
 * (1 − FUEL_WALK_REVERSION) of yesterday's deviation and adds a random
 * step, so over a month it typically sits within about ±15% of the
 * baseline. It is the market price: rivals pay it, and so does the player
 * without a hedge.
 *
 * **A hedge** locks today's price on all the airline's fuel for 30, 60 or
 * 90 days, for a premium paid up front. If fuel rises, the airline pays
 * the locked price and wins the difference; if it falls, it still pays
 * the locked price and loses it. The premium grows with the term and is
 * set so that hedging at random loses a little on average, spikes
 * included (measured in headless runs): a hedge is a bet on timing, not
 * free insurance (CLAUDE.md, the game's philosophy: an edge, and a
 * temporary one).
 */

/** Share of yesterday's deviation from the baseline the walk gives up each day. */
export const FUEL_WALK_REVERSION = 0.05;
/** The largest daily step of the walk, as a log-deviation (0.05 is about 5%). */
export const FUEL_WALK_STEP = 0.05;
/** The cheapest fuel gets, as an index. */
export const FUEL_PRICE_MIN = 0.6;
/** Days of price the chart keeps. */
export const FUEL_HISTORY_DAYS = 90;

/** The hedge lengths on offer, in days. */
export const HEDGE_TERMS = [30, 60, 90];
/** A hedge's premium, as a share of the fuel it covers: a flat part plus a part per day of term. */
export const HEDGE_BASE_PREMIUM = 0.01;
export const HEDGE_PREMIUM_PER_DAY = 0.0002;

export type FuelHedge = {
  /** The price index locked in. */
  lockedPrice: number;
  startDay: number;
  /** The first day it no longer covers. */
  endDay: number;
  /** Paid up front. */
  premium: number;
  /** What it has saved so far against the market price: negative when it has cost money. Premium not included. */
  saved: number;
};

/**
 * Move the market price one day: step the walk, apply any fuel spike, and
 * record it for the chart. Once a day at rollover, after the shocks roll
 * (which may start or end a spike). Draws one number every day.
 */
export function rollDailyFuelPrice(state: SimState): void {
  const [draw, next] = nextRandom(state.rngSeed);
  state.rngSeed = next;
  const walk = (state.fuelWalk ?? 0) * (1 - FUEL_WALK_REVERSION) + (draw * 2 - 1) * FUEL_WALK_STEP;
  state.fuelWalk = walk;
  const shock = activeShock(state);
  const spike = shock?.kind === 'fuel' ? 1 + shock.magnitude : 1;
  state.fuelPriceIndex = Math.min(FUEL_PRICE_MAX, Math.max(FUEL_PRICE_MIN, FUEL_PRICE_BASELINE * Math.exp(walk) * spike));
  state.fuelPriceHistory = [...(state.fuelPriceHistory ?? []), state.fuelPriceIndex].slice(-FUEL_HISTORY_DAYS);
}

/** The hedge covering today, or null. */
export function activeHedge(state: SimState): FuelHedge | null {
  const hedge = state.fuelHedge;
  if (!hedge) return null;
  const today = dayIndex(state);
  return today >= hedge.startDay && today < hedge.endDay ? hedge : null;
}

/** The price index the airline pays for fuel today: the locked one under a hedge, the market's otherwise. */
export function airlineFuelPrice(state: SimState): number {
  return activeHedge(state)?.lockedPrice ?? state.fuelPriceIndex;
}

/**
 * Book what the hedge saved on one flight's fuel, `fuelPaid` being what
 * the flight paid at the locked price. Called on each arrival (step.ts).
 */
export function recordHedgedFuel(state: SimState, fuelPaid: number): void {
  const hedge = activeHedge(state);
  if (!hedge || hedge.lockedPrice <= 0) return;
  hedge.saved += fuelPaid * (state.fuelPriceIndex / hedge.lockedPrice - 1);
}

const typesByCode = new Map((aircraftTypesData as (EconomyAircraftType & { code: string })[]).map((type) => [type.code, type]));

/** What the schedule's fuel costs a day at the baseline price: what a hedge's premium is priced on. */
export function dailyFuelBillAtBaseline(state: SimState): number {
  const typeByTail = new Map(state.aircraft.map((aircraft) => [aircraft.tail, typesByCode.get(aircraft.typeCode)]));
  let bill = 0;
  for (const leg of state.schedule) {
    const type = typeByTail.get(leg.tail);
    if (type) bill += legCostBreakdown(leg.blockMinutes, type, FUEL_PRICE_BASELINE, state.fuelEfficiencyMultiplier).fuel;
  }
  return bill;
}

export type HedgeQuote = {
  days: number;
  lockedPrice: number;
  premium: number;
  /** The fuel it would cover, at the locked price, for the whole term: what the premium is a share of. */
  covers: number;
  /** Why it can't be bought now, or null. */
  blocked: string | null;
};

/** What a hedge of this length would cost today. */
export function hedgeQuote(state: SimState, days: number): HedgeQuote {
  const lockedPrice = state.fuelPriceIndex;
  const covers = dailyFuelBillAtBaseline(state) * lockedPrice * days;
  // A treasury CFO gets a better price from the banks (sim/executives.ts).
  const premium = Math.round(covers * (HEDGE_BASE_PREMIUM + HEDGE_PREMIUM_PER_DAY * days) * executiveHedgePremiumMultiplier(state));
  let blocked: string | null = null;
  const current = activeHedge(state);
  if (current) blocked = `Your hedge runs until day ${current.endDay}.`;
  else if (covers <= 0) blocked = 'Nothing is flying: there is no fuel to hedge.';
  else if (state.cash < premium) blocked = `Needs $${premium.toLocaleString()} on hand.`;
  return { days, lockedPrice, premium, covers, blocked };
}

/** Buy a hedge: pay the premium and lock today's price from today. */
export function buyHedge(state: SimState, days: number): { ok: true; message: string } | { ok: false; reason: string } {
  if (!HEDGE_TERMS.includes(days)) return { ok: false, reason: 'No hedge of that length.' };
  const quote = hedgeQuote(state, days);
  if (quote.blocked) return { ok: false, reason: quote.blocked };
  const today = dayIndex(state);
  state.cash -= quote.premium;
  state.fuelHedge = { lockedPrice: quote.lockedPrice, startDay: today, endDay: today + days, premium: quote.premium, saved: 0 };
  return { ok: true, message: `Fuel hedged at today's price for ${days} days, for $${quote.premium.toLocaleString()}.` };
}

/** The price as the player reads it: "+8%" or "−5%" against the usual price, or "usual". */
export function describeFuelPrice(index: number): string {
  const percent = Math.round((index / FUEL_PRICE_BASELINE - 1) * 100);
  if (percent === 0) return 'usual price';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`;
}
