import aircraftTypesData from '../../data/aircraft-types.json';
import { executiveHedgePremiumMultiplier, hasTreasuryCfo } from './executives';
import { dayIndex } from './clock';
import { legCostBreakdown, type EconomyAircraftType } from './economy';
import { FUEL_PRICE_BASELINE, FUEL_PRICE_MAX } from './fuel';
import { nextRandom } from './rng';
import { activeShock } from './shocks';
import type { SimState } from './state';

/**
 * The fuel market (WEEK-TEN.md, thread 10): a price that moves every day,
 * and a standing fuel policy the airline runs against it.
 *
 * **The price** is the baseline times two things: a slow random walk that
 * wanders and drifts back (`state.fuelWalk`, a log-deviation from the
 * baseline, so +0.1 is about 10% dearer), and a fuel spike (sim/shocks.ts)
 * on top while one runs. The walk is mean-reverting: each day it keeps
 * (1 − FUEL_WALK_REVERSION) of yesterday's deviation and adds a random
 * step, so over a month it typically sits within about ±15% of the
 * baseline. It is the market price: rivals pay it, and so does the
 * airline on whatever share of its fuel isn't hedged.
 *
 * **The policy** (`state.fuelPolicy`) has four dials:
 *   - cover: the share of the airline's fuel kept hedged;
 *   - term: how long each hedge runs;
 *   - buy: lock on any day a rung is due, or only on a dip below usual;
 *   - surcharge: how much of fuel above usual is passed into fares.
 * Cover is held as a ladder of FUEL_RUNGS overlapping hedges ("rungs"),
 * one bought every term ÷ FUEL_RUNGS days, each covering cover ÷
 * FUEL_RUNGS of the fuel at that day's price. So the airline pays a blend
 * of the last term's prices: a longer term smooths more and lags the
 * market more, both ways. Each rung's premium is paid up front and grows
 * with the term, so hedging every day at random is a slow leak; what it
 * buys is a smoother bill, and cheap fuel through a spike while rivals
 * pay the market and close losing routes (sim/rivalEconomics.ts). Buying
 * only on dips locks cheaper but can leave the ladder empty through a
 * spike. A surcharge recovers fuel cost in fares, and rivals don't
 * charge one, so it costs passengers where they compete (CLAUDE.md, the
 * game's philosophy: an edge, and a temporary one).
 */

/** Share of yesterday's deviation from the baseline the walk gives up each day. */
export const FUEL_WALK_REVERSION = 0.05;
/** The largest daily step of the walk, as a log-deviation (0.05 is about 5%). */
export const FUEL_WALK_STEP = 0.05;
/** The cheapest fuel gets, as an index. */
export const FUEL_PRICE_MIN = 0.6;
/** Days of price the chart keeps. */
export const FUEL_HISTORY_DAYS = 90;

/** The cover dial's settings: the share of fuel kept hedged. */
export const FUEL_COVERS = [0, 0.25, 0.5, 0.75];
/** The term dial's settings, in days. */
export const FUEL_TERMS = [30, 90, 180];
/** The longest term needs a treasury CFO (sim/executives.ts): the banks write long hedges only for an airline with a treasurer. */
export const FUEL_LONG_TERM = 180;
/** The surcharge dial's settings: the share of fuel above usual passed into fares. */
export const FUEL_SURCHARGES = [0, 0.5, 1];
/** How many overlapping hedges hold the cover. */
export const FUEL_RUNGS = 3;
/** "Dips only" buys a due rung only at or under this price; otherwise it waits, day by day. */
export const FUEL_DIP_PRICE = 0.97;
/**
 * Fuel's share of a fare, for the surcharge: fuel is about a third of a
 * flight's cost (FUEL_SHARE_OF_BLOCK_HOUR_COST), and fares run a little
 * over cost, so a full surcharge on fuel 40% over usual adds 12% to fares.
 */
export const FUEL_SHARE_OF_FARE = 0.3;
/** A hedge's premium, as a share of the fuel it covers: a flat part plus a part per day of term. */
export const HEDGE_BASE_PREMIUM = 0.01;
export const HEDGE_PREMIUM_PER_DAY = 0.0002;

export type FuelBuyRule = 'any' | 'dips';

export type FuelPolicy = {
  cover: number;
  termDays: number;
  buy: FuelBuyRule;
  surcharge: number;
};

/** One rung of the ladder: a share of the fuel locked at one price for a term. */
export type FuelTranche = {
  /** The price index locked in. */
  lockedPrice: number;
  /** The share of the airline's fuel it covers. */
  share: number;
  startDay: number;
  /** The first day it no longer covers. */
  endDay: number;
  /** Paid up front. */
  premium: number;
};

/** How the current policy has done since it was set. */
export type FuelBook = {
  sinceDay: number;
  /** What hedging saved against the market price: negative when it cost money. Premiums not included. */
  saved: number;
  premiums: number;
  /** Fare revenue that was surcharge. */
  surcharge: number;
  /** Rungs that came due and couldn't be paid for. */
  missed: number;
};

/** A save from before the policy: one hedge on all the fuel, the shape `state.fuelHedge` still holds. */
export type LegacyFuelHedge = { lockedPrice: number; startDay: number; endDay: number; premium: number; saved: number };

export const NO_FUEL_POLICY: FuelPolicy = { cover: 0, termDays: 90, buy: 'any', surcharge: 0 };

export function fuelPolicyOf(state: SimState): FuelPolicy {
  return state.fuelPolicy ?? NO_FUEL_POLICY;
}

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

/** The rungs covering today, including an older save's one hedge. */
export function activeTranches(state: SimState): FuelTranche[] {
  const today = dayIndex(state);
  const tranches = [...(state.fuelTranches ?? [])];
  const legacy = state.fuelHedge;
  if (legacy && !state.fuelTranches) tranches.push({ ...legacy, share: 1 });
  return tranches.filter((tranche) => today >= tranche.startDay && today < tranche.endDay);
}

/** The share of the airline's fuel hedged today, 0 to 1. */
export function hedgedShare(state: SimState): number {
  return Math.min(1, activeTranches(state).reduce((sum, tranche) => sum + tranche.share, 0));
}

/** The price index the airline pays for fuel today: the market's on the unhedged share, each rung's locked price on its own. */
export function airlineFuelPrice(state: SimState): number {
  const tranches = activeTranches(state);
  let share = 0;
  let locked = 0;
  for (const tranche of tranches) {
    const take = Math.min(tranche.share, 1 - share);
    share += take;
    locked += take * tranche.lockedPrice;
  }
  return locked + (1 - share) * state.fuelPriceIndex;
}

function bookOf(state: SimState): FuelBook {
  return (state.fuelBook ??= { sinceDay: dayIndex(state), saved: 0, premiums: 0, surcharge: 0, missed: 0 });
}

/**
 * Book what hedging saved on one flight's fuel, `fuelPaid` being what the
 * flight paid at the airline's price. Called on each arrival (step.ts).
 */
export function recordHedgedFuel(state: SimState, fuelPaid: number): void {
  const paidPrice = airlineFuelPrice(state);
  if (paidPrice <= 0 || paidPrice === state.fuelPriceIndex) return;
  bookOf(state).saved += fuelPaid * (state.fuelPriceIndex / paidPrice - 1);
}

/** Book the surcharge part of one flight's fare revenue (step.ts), for a market priced by policy or stance. */
export function recordSurcharge(state: SimState, fareRevenue: number): void {
  const surcharge = state.fuelSurcharge ?? 0;
  if (surcharge <= 0 || fareRevenue <= 0) return;
  bookOf(state).surcharge += fareRevenue * (surcharge / (1 + surcharge));
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

/** A premium's rate on the fuel it covers, for a term: the treasury CFO gets a better price from the banks. */
export function premiumRate(state: SimState, termDays: number): number {
  return (HEDGE_BASE_PREMIUM + HEDGE_PREMIUM_PER_DAY * termDays) * executiveHedgePremiumMultiplier(state);
}

/** Days between rungs under a term. */
export function rungInterval(termDays: number): number {
  return Math.max(1, Math.round(termDays / FUEL_RUNGS));
}

/** What the next rung under this policy would cost at today's price and schedule. */
export function rungPremium(state: SimState, policy: FuelPolicy): number {
  const share = policy.cover / FUEL_RUNGS;
  return Math.round(dailyFuelBillAtBaseline(state) * state.fuelPriceIndex * policy.termDays * share * premiumRate(state, policy.termDays));
}

/** Why a term can't be picked, or null. */
export function termBlocked(state: SimState, termDays: number): string | null {
  if (termDays >= FUEL_LONG_TERM && !hasTreasuryCfo(state)) return 'Needs a treasury CFO';
  return null;
}

/** The share of fares the surcharge adds today: nothing at or under the usual price. */
export function surchargeFor(state: SimState): number {
  const over = Math.max(0, state.fuelPriceIndex / FUEL_PRICE_BASELINE - 1);
  return fuelPolicyOf(state).surcharge * over * FUEL_SHARE_OF_FARE;
}


/**
 * Keep the ladder: drop rungs that have run out, and buy one when it's
 * due (and, under "dips only", the price is low enough), if there's cash
 * for it. At rollover after the price moves, and straight after the
 * policy changes so a new policy starts at once.
 */
function maintainFuelLadder(state: SimState): void {
  const today = dayIndex(state);
  // An older save's one hedge becomes a rung on its first rollover.
  if (state.fuelHedge && !state.fuelTranches) {
    state.fuelTranches = [{ ...state.fuelHedge, share: 1 }];
    delete state.fuelHedge;
  }
  state.fuelTranches = (state.fuelTranches ?? []).filter((tranche) => tranche.endDay > today);
  state.fuelSurcharge = surchargeFor(state);
  const policy = fuelPolicyOf(state);
  if (policy.cover <= 0) return;
  if (today < (state.fuelNextRungDay ?? today)) return;
  if (policy.buy === 'dips' && state.fuelPriceIndex > FUEL_DIP_PRICE) return;
  const premium = rungPremium(state, policy);
  if (premium <= 0) return;
  const book = bookOf(state);
  if (state.cash < premium) {
    book.missed += 1;
    // Try again tomorrow: a missed rung leaves a gap in the ladder.
    state.fuelNextRungDay = today + 1;
    return;
  }
  state.cash -= premium;
  book.premiums += premium;
  state.fuelTranches.push({ lockedPrice: state.fuelPriceIndex, share: policy.cover / FUEL_RUNGS, startDay: today, endDay: today + policy.termDays, premium });
  state.fuelLastRungDay = today;
  state.fuelNextRungDay = today + rungInterval(policy.termDays);
}

/** Once a day at rollover, after the price moves: keep the ladder and record the price the airline now pays, for the chart. */
export function rollDailyFuelPolicy(state: SimState): void {
  maintainFuelLadder(state);
  state.fuelPaidHistory = [...(state.fuelPaidHistory ?? []), airlineFuelPrice(state)].slice(-FUEL_HISTORY_DAYS);
}

/**
 * Set the standing policy. Rungs already bought run to the end of their
 * term. A changed policy starts a fresh book, and its next rung comes one
 * interval after the last rung bought (today if that's past), so flicking
 * the dials can't buy rungs faster than the ladder does.
 */
export function setFuelPolicy(state: SimState, policy: FuelPolicy): { ok: true; message: string } | { ok: false; reason: string } {
  if (!FUEL_COVERS.includes(policy.cover)) return { ok: false, reason: 'No cover of that size.' };
  if (!FUEL_TERMS.includes(policy.termDays)) return { ok: false, reason: 'No hedge of that length.' };
  if (!FUEL_SURCHARGES.includes(policy.surcharge)) return { ok: false, reason: 'No surcharge of that size.' };
  if (policy.buy !== 'any' && policy.buy !== 'dips') return { ok: false, reason: 'No such buying rule.' };
  const blocked = termBlocked(state, policy.termDays);
  if (blocked) return { ok: false, reason: blocked };
  const today = dayIndex(state);
  const was = fuelPolicyOf(state);
  state.fuelPolicy = { ...policy };
  const last = state.fuelLastRungDay;
  state.fuelNextRungDay = last === undefined ? today : Math.max(today, last + rungInterval(policy.termDays));
  if (was.cover !== policy.cover || was.termDays !== policy.termDays || was.buy !== policy.buy || was.surcharge !== policy.surcharge) {
    state.fuelBook = { sinceDay: today, saved: 0, premiums: 0, surcharge: 0, missed: 0 };
  }
  maintainFuelLadder(state);
  const cover = Math.round(policy.cover * 100);
  return { ok: true, message: `Fuel policy · ${cover}% hedged ${policy.termDays}d${policy.buy === 'dips' ? ' on dips' : ''} · surcharge ${Math.round(policy.surcharge * 100)}%` };
}

/** The price as the player reads it: "+8%" or "−5%" against the usual price, or "usual". */
export function describeFuelPrice(index: number): string {
  const percent = Math.round((index / FUEL_PRICE_BASELINE - 1) * 100);
  if (percent === 0) return 'usual price';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`;
}
