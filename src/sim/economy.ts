import { dailyDemand } from './demand';
import { bookingShare } from './choiceModel';
import { FUEL_SHARE_OF_BLOCK_HOUR_COST } from './fuel';
import type { CompetitorOffering } from './competitors';
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
  /**
   * How this flight changed the market's shared same-day recapture pool
   * (`state.spilloverByMarket`, sim/state.ts) — positive if this flight
   * was seat-capped and added its own recoverable spill to it, negative
   * if it had spare room and drew from what an earlier flight on this
   * market left behind. The caller (sim/step.ts, ui/commercial.ts) is
   * the one that actually owns the pool; flightResult() stays a pure
   * function of its inputs, same as before, just reporting the delta
   * rather than mutating anything itself.
   */
  spilloverDelta: number;
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
 * Spill and recapture (week four, requested directly): a seat-capped
 * flight's overflow demand doesn't just vanish. Real airline revenue
 * management distinguishes "spill" (total overflow) from "recapture"
 * (the fraction of it the *same* airline gets back on one of its own
 * other flights, rather than losing it to a competitor or a traveler
 * giving up) — this is that fraction. Deliberately crude, same spirit
 * as `LOAD_FACTOR`/`AVG_FARE`: a flat rate, not fit to any real study,
 * picked to make recapture a real but partial rescue rather than either
 * "spill is always fully recovered" (too generous) or "recapture
 * doesn't exist" (the old behavior this replaces).
 */
const RECAPTURE_RATE = 0.4;

/**
 * The block-hours-and-departure cost of one leg, independent of how many
 * passengers it carries. Exported so ui/commercial.ts can show a market's
 * expected cost without duplicating this formula.
 *
 * Week six's fuel price mechanic (sim/fuel.ts) splits costPerBlockHour
 * into a fixed slice (crew, maintenance, overhead — still blended into
 * that one flat figure, not modeled separately) and a fuel-sensitive
 * slice (FUEL_SHARE_OF_BLOCK_HOUR_COST), rather than touching the
 * aircraft-type data itself: `fuelPriceIndex` (1.0 = baseline) multiplies
 * directly into that fuel slice, and `fuelEfficiencyMultiplier` (1.0 =
 * no mitigation adopted, lower is better) multiplies on top of it — the
 * hook a future tech tree's fuel-efficiency initiatives can turn down.
 */
export function legCost(
  blockMinutes: number,
  type: EconomyAircraftType,
  fuelPriceIndex: number,
  fuelEfficiencyMultiplier: number,
): number {
  const blockHourCost = (blockMinutes / 60) * type.costPerBlockHour;
  const fuelPortion = blockHourCost * FUEL_SHARE_OF_BLOCK_HOUR_COST;
  const nonFuelPortion = blockHourCost - fuelPortion;
  return nonFuelPortion + fuelPortion * fuelPriceIndex * fuelEfficiencyMultiplier + type.costPerDeparture;
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
 * competitor or not to travel at all rather than fly you. `routeSettings.fare`
 * feeds both the choice model's price term *and* revenue directly —
 * raising it trades booked passengers for margin per passenger, the core
 * yield-management tension. Marketing spend, by contrast, is a pure
 * cost-for-share trade (see sim/step.ts's day-rollover handling for where
 * that cost is charged — once per day per market, not per flight).
 *
 * `spilloverAvailable` is this market's shared recapture pool as of right
 * now (today, before this flight) — see `SimState.spilloverByMarket`.
 * Two outcomes, mutually exclusive:
 *   - This flight's own booked demand exceeds its seats: it's seat-capped
 *     at the old flat ceiling, same as before, but now a `RECAPTURE_RATE`
 *     fraction of the overflow it couldn't carry gets deposited into the
 *     pool for a later flight on this same market to pick up, instead of
 *     the whole overflow just vanishing.
 *   - This flight has spare room: it tops up with whatever's waiting in
 *     the pool (capped at however much room is actually left), on top of
 *     its own booked demand — recovered passengers who couldn't get the
 *     earlier flight, still flying you rather than a competitor.
 * `pax` never exceeds the seat ceiling either way.
 */
export function flightResult(
  leg: EconomyLeg,
  type: EconomyAircraftType,
  fuelPriceIndex: number,
  fuelEfficiencyMultiplier: number,
  legsServingMarket: number,
  routeSettings: RouteSettings,
  competitorRoutes: CompetitorOffering[],
  spilloverAvailable: number,
): FlightResult {
  const demandPerFlight = dailyDemand(leg.origin, leg.dest) / legsServingMarket;
  const bookedDemand =
    demandPerFlight *
    bookingShare(
      routeSettings.fare,
      legsServingMarket,
      leg.origin,
      leg.dest,
      routeSettings.marketingSpend,
      competitorRoutes,
    );
  const seatCeiling = Math.round(type.seats * LOAD_FACTOR);
  const roundedBooked = Math.round(bookedDemand);

  let pax: number;
  let spilloverDelta: number;
  if (roundedBooked > seatCeiling) {
    pax = seatCeiling;
    const spill = roundedBooked - seatCeiling;
    spilloverDelta = Math.round(spill * RECAPTURE_RATE);
  } else {
    const spareCapacity = seatCeiling - roundedBooked;
    const recaptured = Math.min(spareCapacity, spilloverAvailable);
    pax = roundedBooked + recaptured;
    spilloverDelta = -recaptured;
  }

  const revenue = pax * routeSettings.fare;
  const cost = legCost(leg.blockMinutes, type, fuelPriceIndex, fuelEfficiencyMultiplier);
  return { pax, revenue, cost, margin: revenue - cost, spilloverDelta };
}
