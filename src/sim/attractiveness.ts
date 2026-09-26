import aircraftTypesData from '../../data/aircraft-types.json';
import { actualDailyDemand } from './marketDemand';
import { routeFixedCosts } from './routeCosts';
import { marketKey, recommendedFare } from './schedule';
import { COMPETITOR_ASSUMED_SEATS } from './serviceLevel';
import type { SimState } from './state';

/**
 * How much a rival could make by entering a market the player flies: the
 * "money on the table", in dollars a day. Profit is a signal rivals read
 * (CLAUDE.md, the game's philosophy), and they read it from the same
 * places a player does:
 *
 * - **passengers turned away**: today's demand beyond the player's seats,
 *   up to what one rival flight each way could carry, at the going fare;
 * - **a fat margin**: RIVAL_MARGIN_SHARE of the route's last week's
 *   margin after its share of slot fees and leases (sim/routeCosts.ts),
 *   the part an entrant could hope to take by splitting the market.
 *
 * A lean market (full planes that turn nobody away, priced near cost) has
 * nothing on the table, and rivals mostly leave it alone. Zero for a
 * market the player doesn't fly.
 */

const seatsByTypeCode = new Map((aircraftTypesData as { code: string; seats: number }[]).map((type) => [type.code, type.seats]));

/** Share of the player's fully costed margin an entrant expects to take. */
export const RIVAL_MARGIN_SHARE = 0.5;

export type MoneyOnTable = {
  /** Passengers a day beyond the player's seats that one rival flight each way could carry. */
  turnedAway: number;
  /** The route's margin per day over the last week, after its share of slot fees and leases. */
  fullyCostedMargin: number;
  /** Dollars a day a rival could expect: the turned-away passengers at the going fare, plus its share of the margin. */
  perDay: number;
};

export function moneyOnTable(state: SimState, a: string, b: string): MoneyOnTable {
  const key = marketKey(a, b);
  const legs = state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key);
  if (legs.length === 0) return { turnedAway: 0, fullyCostedMargin: 0, perDay: 0 };

  const classByTail = new Map(state.aircraft.map((aircraft) => [aircraft.tail, aircraft.typeCode]));
  const seats = legs.reduce((sum, leg) => sum + (seatsByTypeCode.get(classByTail.get(leg.tail) ?? '') ?? 0), 0);
  const turnedAway = Math.min(Math.max(0, actualDailyDemand(state, a, b) - seats), 2 * COMPETITOR_ASSUMED_SEATS);

  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-7);
  const cost = (state.costHistoryByMarket[key] ?? []).slice(-7);
  const ownMargin = revenue.length > 0 ? revenue.reduce((sum, r, i) => sum + r - cost[i], 0) / revenue.length : 0;
  const fixed = routeFixedCosts(state, a, b);
  const fullyCostedMargin = ownMargin - fixed.slotsPerDay - fixed.leasePerDay;

  return {
    turnedAway,
    fullyCostedMargin,
    perDay: turnedAway * recommendedFare(a, b) + RIVAL_MARGIN_SHARE * Math.max(0, fullyCostedMargin),
  };
}
