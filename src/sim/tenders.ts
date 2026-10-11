import { dayIndex } from './clock';
import type { Contract } from './contracts';
import { nextRandom } from './rng';
import { legRights, rivalHomeCountry } from './rights';
import { standingOf } from './standing';
import type { SimState } from './state';

/**
 * Tenders: a contract offer is a call for bids. The airline names a price
 * a day and a frequency; rivals that could fly the market may bid too, and
 * the buyer awards it to the best score.
 *
 * - **Reserve.** The buyer pays at most RESERVE_RATIO times the offer's
 *   reference. A solo bidder wins at any ask under it, so the edge is real
 *   and capped.
 * - **Few rivals early.** A rival is eligible when its home country may
 *   fly the market and it already serves the small community, or, once it
 *   has grown to MIN_ROUTES_AT_NETWORK_END routes and the game is past
 *   NETWORK_END_FROM_DAY, the network end. Each eligible rival then bids
 *   with PARTICIPATION_CHANCE at the deadline. With no eligible rival the
 *   bid is awarded at once; otherwise at the tender's deadline.
 * - **Score.** Price and capability (twice-daily flying), weighted by the
 *   buyer's type, plus the airline's standing with the buyer. A tie goes to
 *   the airline.
 *
 * Rolls come from the contracts' own stream (sim/contracts.ts) so a game
 * that never bids plays out as before.
 */

export type Bid = { askPerDay: number; frequency: 1 | 2 };

/** What twice-daily flying pays and carries against once a day. */
export const FREQUENCY_2_PAY = 1.6;
export const FREQUENCY_2_RIDERS = 1.5;
/** The ask band, as a share of the reference for the frequency bid. */
export const MIN_ASK_RATIO = 0.7;
export const RESERVE_RATIO = 1.3;
/** Days from the offer until a contested tender is decided. */
export const TENDER_OPEN_DAYS = 20;
/** Days an awarded airline has to start flying it. */
export const START_AFTER_AWARD_DAYS = 30;
/** What the airline's standing with a buyer adds to its bid score at full standing; rivals have none. */
const STANDING_BID_BONUS = 0.15;
const PARTICIPATION_CHANCE = 0.5;
/** Rival asks, as a share of the reference. */
const RIVAL_ASK_LOW = 0.8;
const RIVAL_ASK_HIGH = 1.15;
const RIVAL_FREQUENCY_2_CHANCE = 0.3;
const MIN_ROUTES_AT_NETWORK_END = 6;
const NETWORK_END_FROM_DAY = 180;
/** Mixed into the game's seed to start the contracts' own random stream. */
export const CONTRACT_STREAM_SALT = 0x5eed_c0de;

export type BuyerType = 'province' | 'mine' | 'health';
export const BUYER_TYPES: BuyerType[] = ['province', 'mine', 'health'];

/**
 * How a buyer scores bids: a province or ministry cares most about price, a
 * mine or resource camp about capability (twice-daily flying), a health
 * authority about both as the baseline but takes a missed day hard
 * (sim/contracts.ts's updateSatisfaction()).
 */
const PRICE_WEIGHT: Record<BuyerType, number> = { province: 0.85, mine: 0.4, health: 0.7 };

/** The buyer is the community at the far end, so a route that goes back to tender keeps its buyer. Its type never changes. */
export function buyerKey(contract: Contract): string {
  return `buyer:${contract.b}`;
}

export function buyerTypeOf(contract: Contract): BuyerType {
  let sum = 0;
  for (const char of contract.b) sum += char.charCodeAt(0);
  return BUYER_TYPES[sum % BUYER_TYPES.length];
}

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

export function frequencyOf(contract: Contract): 1 | 2 {
  return contract.frequency ?? 1;
}

export function frequencyPayMultiplier(frequency: 1 | 2): number {
  return frequency === 2 ? FREQUENCY_2_PAY : 1;
}

/** What the buyer would pay a day for this frequency at a ratio of 1. Valid until the contract is awarded. */
export function referencePerDay(contract: Contract, frequency: 1 | 2): number {
  return contract.paymentPerDay * frequencyPayMultiplier(frequency);
}

export function reservePerDay(contract: Contract, frequency: 1 | 2): number {
  return Math.floor((referencePerDay(contract, frequency) * RESERVE_RATIO) / 100) * 100;
}

export function minAskPerDay(contract: Contract, frequency: 1 | 2): number {
  return Math.ceil((referencePerDay(contract, frequency) * MIN_ASK_RATIO) / 100) * 100;
}

/** Rival airline codes that may bid on this tender, in code order. */
export function eligibleRivals(state: SimState, contract: Contract): string[] {
  const today = dayIndex(state);
  const routesByCode = new Map<string, typeof state.competitorRoutes>();
  for (const route of state.competitorRoutes) routesByCode.set(route.code, [...(routesByCode.get(route.code) ?? []), route]);
  const eligible: string[] = [];
  for (const [code, routes] of routesByCode) {
    const rivalHome = rivalHomeCountry(state.competitorRoutes, code);
    if (!legRights(rivalHome, contract.a, contract.b, []).ok) continue;
    const touches = (iata: string) => routes.some((route) => route.origin === iata || route.dest === iata);
    const servesFarEnd = touches(contract.b);
    const servesNetworkEnd = today >= NETWORK_END_FROM_DAY && routes.length >= MIN_ROUTES_AT_NETWORK_END && touches(contract.a);
    if (servesFarEnd || servesNetworkEnd) eligible.push(code);
  }
  return eligible.sort();
}

/** 0 to 1: how far under the reserve the ask sits, against the most it can be cut. */
function priceScore(askRatio: number): number {
  return Math.min(1, Math.max(0, (RESERVE_RATIO - askRatio) / (RESERVE_RATIO - MIN_ASK_RATIO)));
}

export function bidScore(askRatio: number, frequency: 1 | 2, type: BuyerType = 'health', standing = 0): number {
  const price = PRICE_WEIGHT[type];
  return price * priceScore(askRatio) + (1 - price) * (frequency === 2 ? 1 : 0.5) + (STANDING_BID_BONUS * standing) / 100;
}

function askRatioOf(contract: Contract, bid: Bid): number {
  return bid.askPerDay / referencePerDay(contract, bid.frequency);
}

/** Put in, or replace, the airline's bid on an open tender. A tender nobody else can bid on is awarded now. */
export function placeBid(state: SimState, contractId: number, askPerDay: number, frequency: 1 | 2): Outcome {
  const contract = (state.contracts ?? []).find((c) => c.id === contractId);
  if (!contract || contract.status !== 'offered') return { ok: false, reason: 'That tender is closed' };
  if (contract.awardedDay !== undefined) return { ok: false, reason: 'Already awarded to you' };
  const ask = Math.round(askPerDay / 100) * 100;
  if (ask > reservePerDay(contract, frequency)) return { ok: false, reason: `Over the buyer's reserve of $${reservePerDay(contract, frequency)}/day` };
  if (ask < minAskPerDay(contract, frequency)) return { ok: false, reason: `Under the lowest ask of $${minAskPerDay(contract, frequency)}/day` };
  contract.bid = { askPerDay: ask, frequency };
  if (eligibleRivals(state, contract).length === 0) {
    award(state, contract);
    return { ok: true, message: `Awarded · ${contract.a}–${contract.b} · $${ask}/day` };
  }
  return { ok: true, message: `Bid in · ${contract.a}–${contract.b} · decided day ${contract.tenderEndsDay ?? contract.offerEndsDay}` };
}

function award(state: SimState, contract: Contract): void {
  const bid = contract.bid;
  if (!bid) return;
  const today = dayIndex(state);
  contract.paymentPerDay = bid.askPerDay;
  contract.ridersPerDay = Math.max(1, Math.round(contract.ridersPerDay * (bid.frequency === 2 ? FREQUENCY_2_RIDERS : 1)));
  contract.frequency = bid.frequency;
  contract.awardedDay = today;
  contract.offerEndsDay = Math.max(contract.offerEndsDay, today + START_AFTER_AWARD_DAYS);
}

/**
 * Daily, for one open tender: an unbid tender that is already being flown
 * takes a bid at the reference (flying it was how an offer was taken
 * before bidding); a bid with rivals waiting is decided on the deadline.
 */
export function settleTender(state: SimState, contract: Contract, flownBothWays: boolean): void {
  if (contract.status !== 'offered' || contract.awardedDay !== undefined) return;
  if (!contract.bid && flownBothWays) contract.bid = { askPerDay: contract.paymentPerDay, frequency: 1 };
  if (!contract.bid) return;
  const rivals = eligibleRivals(state, contract);
  if (rivals.length === 0) {
    award(state, contract);
    return;
  }
  if (dayIndex(state) < (contract.tenderEndsDay ?? contract.offerEndsDay)) return;

  state.contractSeed ??= state.rngSeed ^ CONTRACT_STREAM_SALT;
  let best: { code: string; score: number } | null = null;
  for (const code of rivals) {
    const [participates, s1] = nextRandom(state.contractSeed);
    const [askRoll, s2] = nextRandom(s1);
    const [frequencyRoll, s3] = nextRandom(s2);
    state.contractSeed = s3;
    if (participates >= PARTICIPATION_CHANCE) continue;
    const frequency: 1 | 2 = frequencyRoll < RIVAL_FREQUENCY_2_CHANCE ? 2 : 1;
    const score = bidScore(RIVAL_ASK_LOW + askRoll * (RIVAL_ASK_HIGH - RIVAL_ASK_LOW), frequency, buyerTypeOf(contract));
    if (!best || score > best.score) best = { code, score };
  }
  if (best && best.score > bidScore(askRatioOf(contract, contract.bid), contract.bid.frequency, buyerTypeOf(contract), standingOf(state, buyerKey(contract)))) {
    contract.status = 'lapsed';
    contract.lostTo = best.code;
    return;
  }
  award(state, contract);
}
