import { dailyDemand } from './demand';
import { bookingShare } from './choiceModel';

export type EconomyLeg = {
  origin: string;
  dest: string;
  blockMinutes: number;
  fare: number;
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
// see `leg.fare` below, week two's "Pricing" loop (sim/schedule.ts's
// recommendedFare(), player-overridable in the schedule editor).
const LOAD_FACTOR = 0.75;

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
 * actually books — some people, given `leg.fare` and this market's
 * frequency, choose a competitor or not to travel at all rather than fly
 * you. `pax` is whichever is smaller: the old flat load-factor figure
 * (still the ceiling on a market with plenty of demand to go around), or
 * this flight's actual booked count. `leg.fare` feeds both the choice
 * model's price term *and* revenue directly — raising it trades booked
 * passengers for margin per passenger, the core yield-management tension,
 * for free, now that both halves of that tradeoff exist.
 */
export function flightResult(leg: EconomyLeg, type: EconomyAircraftType, legsServingMarket: number): FlightResult {
  const demandPerFlight = dailyDemand(leg.origin, leg.dest) / legsServingMarket;
  const bookedDemand = demandPerFlight * bookingShare(leg.fare, legsServingMarket, leg.origin, leg.dest);
  const pax = Math.min(Math.round(type.seats * LOAD_FACTOR), Math.round(bookedDemand));
  const revenue = pax * leg.fare;
  const cost = (leg.blockMinutes / 60) * type.costPerBlockHour + type.costPerDeparture;
  return { pax, revenue, cost, margin: revenue - cost };
}
