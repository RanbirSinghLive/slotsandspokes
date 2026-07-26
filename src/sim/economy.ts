import { dailyDemand } from './demand';
import { bookingShare } from './choiceModel';
import type { RouteSettings } from './state';

export type EconomyLeg = {
  origin: string;
  dest: string;
  blockMinutes: number;
};

export type EconomyAircraftType = {
  seats: number;
  costPerBlockHour: number;
  costPerDeparture: number;
};

export type FlightResult = {
  pax: number;
  revenue: number;
  cost: number;
  margin: number;
};

// Deliberately crude for now, per WEEK-ONE.md: every flight pays the same
// fraction of its seats regardless of day. Fare itself is no longer flat —
// see `routeSettings.fare` below, week two's "Pricing" loop, set at the
// market level rather than per leg (sim/state.ts's RouteSettings).
// Exported so ui/commercial.ts can tell whether a market's `pax` figure is
// pinned at this ceiling (seat-capped — more demand exists than the plane
// can hold) or below it (demand-capped — raising fare will cost real pax).
export const LOAD_FACTOR = 0.75;

/**
 * The block-hours-and-departure cost of one leg, independent of how many
 * passengers it carries. Exported so ui/commercial.ts can show a market's
 * expected cost without duplicating this formula.
 */
export function legCost(blockMinutes: number, type: EconomyAircraftType): number {
  return (blockMinutes / 60) * type.costPerBlockHour + type.costPerDeparture;
}

/**
 * The revenue, cost, and margin for one completed flight. Applied on
 * arrival (see sim/step.ts) — a flight in the air hasn't earned or spent
 * anything yet as far as the books are concerned.
 *
 * `legsServingMarket` is how many scheduled legs (either direction, see
 * `sim/schedule.ts`'s `legsServingMarket()`) currently split this leg's
 * market between them — the route's total daily demand (week two's
 * `sim/demand.ts`) is divided evenly across all of them, so a second
 * frequency on an already-thin market doesn't create new passengers, it
 * just splits the same ones two ways. Of that per-flight slice, only
 * `bookingShare()` (`sim/choiceModel.ts`, week two's "connective piece")
 * actually books — some people, given `routeSettings.fare`,
 * `routeSettings.marketingSpend`, and this market's frequency, choose a
 * competitor or not to travel at all rather than fly you. `pax` is
 * whichever is smaller: the old flat load-factor figure (still the
 * ceiling on a market with plenty of demand to go around), or this
 * flight's actual booked count. `routeSettings.fare` feeds both the choice
 * model's price term *and* revenue directly — raising it trades booked
 * passengers for margin per passenger, the core yield-management tension.
 * Marketing spend, by contrast, is a pure cost-for-share trade (see
 * sim/step.ts's day-rollover handling for where that cost is charged —
 * once per day per market, not per flight).
 */
export function flightResult(
  leg: EconomyLeg,
  type: EconomyAircraftType,
  legsServingMarket: number,
  routeSettings: RouteSettings,
): FlightResult {
  const demandPerFlight = dailyDemand(leg.origin, leg.dest) / legsServingMarket;
  const bookedDemand =
    demandPerFlight *
    bookingShare(routeSettings.fare, legsServingMarket, leg.origin, leg.dest, routeSettings.marketingSpend);
  const pax = Math.min(Math.round(type.seats * LOAD_FACTOR), Math.round(bookedDemand));
  const revenue = pax * routeSettings.fare;
  const cost = legCost(leg.blockMinutes, type);
  return { pax, revenue, cost, margin: revenue - cost };
}
