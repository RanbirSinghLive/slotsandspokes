import { dailyDemand } from './demand';
import { bookingShare } from './choiceModel';

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

// Deliberately crude for now, per WEEK-ONE.md: every flight charges the
// same fare and pays the same fraction of its seats, regardless of day.
// Good enough to see whether cash moves in a direction the numbers explain;
// nowhere near good enough to balance the game around.
const LOAD_FACTOR = 0.75;
const AVG_FARE = 185;

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
 * actually books — some people, given this fare and this market's
 * frequency, choose not to travel at all rather than fly you. `pax` is
 * whichever is smaller: the old flat load-factor figure (still the
 * ceiling on a market with plenty of demand to go around), or this
 * flight's actual booked count. `bookingShare()` also folds in yield-mix
 * segments and any static competitor serving the same market (week two's
 * layers 2 and 3) — see WEEK-TWO.md's "Layers" for what's still ahead.
 */
export function flightResult(leg: EconomyLeg, type: EconomyAircraftType, legsServingMarket: number): FlightResult {
  const demandPerFlight = dailyDemand(leg.origin, leg.dest) / legsServingMarket;
  const bookedDemand = demandPerFlight * bookingShare(AVG_FARE, legsServingMarket, leg.origin, leg.dest);
  const pax = Math.min(Math.round(type.seats * LOAD_FACTOR), Math.round(bookedDemand));
  const revenue = pax * AVG_FARE;
  const cost = (leg.blockMinutes / 60) * type.costPerBlockHour + type.costPerDeparture;
  return { pax, revenue, cost, margin: revenue - cost };
}
