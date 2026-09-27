import aircraftTypesData from '../../data/aircraft-types.json';
import { connectingDemandOnMarket } from './hubs';
import { actualDailyDemand } from './marketDemand';
import { routeFixedCosts } from './routeCosts';
import { rivalSlotQuote } from './slots';
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
 *
 * **Moats** discount it (CLAUDE.md: durable advantages exist but take a
 * long time to build):
 *
 * - **frequency dominance**: booking share follows frequency, so a rival's
 *   one flight against many gets little. Discounted by
 *   flights / (flights + DOMINANCE_FLIGHTS);
 * - **hub feed**: passengers connecting through the player's hub ride the
 *   whole itinerary, which a one-route entrant can't sell. Discounted by
 *   the share of the market's passengers who are connecting.
 * - **slot control**: an entrant pays today's slot price at both ends
 *   (sim/slots.ts), which a busy hub drives up, and nothing is on the
 *   table at a full airport.
 */

const seatsByTypeCode = new Map((aircraftTypesData as { code: string; seats: number }[]).map((type) => [type.code, type.seats]));

/** Share of the player's fully costed margin an entrant expects to take. */
export const RIVAL_MARGIN_SHARE = 0.5;

/** The player's daily flights on a market at which frequency dominance halves what's on the table. */
export const DOMINANCE_FLIGHTS = 4;

export type MoneyOnTable = {
  /** Passengers a day beyond the player's seats that one rival flight each way could carry. */
  turnedAway: number;
  /** The route's margin per day over the last week, after its share of slot fees and leases. */
  fullyCostedMargin: number;
  /** How much of the table frequency dominance keeps from rivals, 0–1. */
  dominance: number;
  /** How much of the table the hub's connecting passengers keep from rivals, 0–1. */
  hubFeed: number;
  /** What a rival's slots for one daily round trip would cost a day, or null if either airport is full. */
  rivalSlotFees: number | null;
  /** Dollars a day a rival could expect: the turned-away passengers at the going fare, plus its share of the margin, less what the moats keep. */
  perDay: number;
};

export function moneyOnTable(state: SimState, a: string, b: string): MoneyOnTable {
  const key = marketKey(a, b);
  const legs = state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key);
  if (legs.length === 0) return { turnedAway: 0, fullyCostedMargin: 0, dominance: 0, hubFeed: 0, rivalSlotFees: null, perDay: 0 };

  const classByTail = new Map(state.aircraft.map((aircraft) => [aircraft.tail, aircraft.typeCode]));
  const seats = legs.reduce((sum, leg) => sum + (seatsByTypeCode.get(classByTail.get(leg.tail) ?? '') ?? 0), 0);
  const turnedAway = Math.min(Math.max(0, actualDailyDemand(state, a, b) - seats), 2 * COMPETITOR_ASSUMED_SEATS);

  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-7);
  const cost = (state.costHistoryByMarket[key] ?? []).slice(-7);
  const ownMargin = revenue.length > 0 ? revenue.reduce((sum, r, i) => sum + r - cost[i], 0) / revenue.length : 0;
  const fixed = routeFixedCosts(state, a, b);
  const fullyCostedMargin = ownMargin - fixed.slotsPerDay - fixed.leasePerDay - fixed.overheadPerDay;

  // Legs count both directions; frequency here is flights each way.
  const flightsEachWay = legs.length / 2;
  const dominance = flightsEachWay / (flightsEachWay + DOMINANCE_FLIGHTS);
  const local = actualDailyDemand(state, a, b);
  const connecting = connectingDemandOnMarket(state, a, b);
  const hubFeed = connecting + local > 0 ? connecting / (connecting + local) : 0;

  const onTable = turnedAway * recommendedFare(a, b) + RIVAL_MARGIN_SHARE * Math.max(0, fullyCostedMargin);
  // What getting in would cost: slots at both ends at today's price, and
  // nothing to be had at all if either airport is full.
  const rivalSlotFees = rivalSlotQuote(state, a, b);
  return {
    turnedAway,
    fullyCostedMargin,
    dominance,
    hubFeed,
    rivalSlotFees,
    perDay: rivalSlotFees === null ? 0 : Math.max(0, onTable * (1 - dominance) * (1 - hubFeed) - rivalSlotFees),
  };
}
