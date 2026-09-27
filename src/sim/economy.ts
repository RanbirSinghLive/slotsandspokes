import { bookingShare } from './choiceModel';
import { recommendedFare } from './schedule';
import { FUEL_SHARE_OF_BLOCK_HOUR_COST } from './fuel';
import type { CompetitorOffering } from './competitors';
import type { BookingPerks } from './innovations';
import { rivalYieldFactor } from './pressure';

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
   * market left behind. The caller (sim/step.ts, sim/marketSummary.ts) is
   * the one that actually owns the pool; flightResult() stays a pure
   * function of its inputs, same as before, just reporting the delta
   * rather than mutating anything itself.
   */
  spilloverDelta: number;
  /**
   * `cost` above, itemized — so the caller can attribute this flight's
   * spending to the right categories (`SimState.todayCostByCategory`)
   * without recomputing the formula itself.
   */
  costBreakdown: CostBreakdown;
  /**
   * The intermediate passenger counts this flight's `pax` was arrived at
   * through, in order. Exposed for the same reason `costBreakdown` is:
   * the Dev tab's revenue funnel (ui/devTools.ts) needs to show *where*
   * passengers are lost, and recomputing these outside this function
   * would be a second copy of the formula free to drift from the real
   * one.
   */
  demandBreakdown: DemandBreakdown;
};

export type DemandBreakdown = {
  /** This flight's share of the market's actual daily demand, after splitting across frequencies. */
  allocatedDemand: number;
  /** How many of those actually book *you*, after the choice model weighs fare, frequency and competitors. */
  bookedDemand: number;
  /** The most this aircraft will carry — seats times LOAD_FACTOR. */
  seatCeiling: number;
  /** Booked passengers turned away because the aircraft was full. Zero when there was spare room. */
  spilled: number;
  /** Passengers picked up from the market's shared recapture pool. Zero when this flight was itself full. */
  recaptured: number;
};

// Deliberately crude: no flight sells more than this fraction of its
// seats, whatever the day. (Fare is set per market, sim/state.ts's
// RouteSettings.)
// Exported so sim/marketSummary.ts can tell whether a market's `pax` figure is
// pinned at this ceiling (seat-capped — more demand exists than the plane
// can hold) or below it (demand-capped — raising fare will cost real pax).
export const LOAD_FACTOR = 0.75;

/**
 * Spill and recapture: a seat-capped
 * flight's overflow demand doesn't just vanish. Real airline revenue
 * management distinguishes "spill" (total overflow) from "recapture"
 * (the fraction of it the *same* airline gets back on one of its own
 * other flights, rather than losing it to a competitor or a traveler
 * giving up) — this is that fraction. Deliberately crude, same spirit
 * as `LOAD_FACTOR`: a flat rate, not fit to any real study,
 * picked to make recapture a real but partial rescue rather than either
 * "spill is always fully recovered" (too generous) or "recapture
 * doesn't exist". A loyalty scheme (sim/innovations.ts) raises it.
 */
export const RECAPTURE_RATE = 0.4;

/**
 * The block-hours-and-departure cost of one leg, independent of how many
 * passengers it carries. Exported so a market's summary can show its
 * expected cost without duplicating this formula.
 *
 * costPerBlockHour splits into a fuel-sensitive slice
 * (FUEL_SHARE_OF_BLOCK_HOUR_COST) and the rest (flying crews,
 * maintenance, overhead): `fuelPriceIndex` (1.0 = baseline, sim/fuelPrice.ts)
 * multiplies the fuel slice, and `fuelEfficiencyMultiplier` (lower is
 * better; winglet retrofits, sim/innovations.ts) multiplies on top.
 */
export function legCost(
  blockMinutes: number,
  type: EconomyAircraftType,
  fuelPriceIndex: number,
  fuelEfficiencyMultiplier: number,
): number {
  const { fuel, blockNonFuel, departure } = legCostBreakdown(
    blockMinutes,
    type,
    fuelPriceIndex,
    fuelEfficiencyMultiplier,
  );
  return fuel + blockNonFuel + departure;
}

/**
 * The same three components of a leg's cost, itemized rather than summed —
 * the cost attribution (`SimState.todayCostByCategory`). `legCost()`
 * above is literally the sum of these three, so the total and the
 * breakdown can never disagree about what a flight cost: there's only one
 * formula, and the total is derived from the parts rather than computed
 * alongside them.
 */
export type CostBreakdown = {
  /** The fuel-sensitive slice, after the price index and any efficiency upgrades. */
  fuel: number;
  /** Everything else bundled into costPerBlockHour — crew, maintenance, overhead. */
  blockNonFuel: number;
  /** The flat per-departure charge, independent of how long the leg is. */
  departure: number;
};

export function legCostBreakdown(
  blockMinutes: number,
  type: EconomyAircraftType,
  fuelPriceIndex: number,
  fuelEfficiencyMultiplier: number,
): CostBreakdown {
  const blockHourCost = (blockMinutes / 60) * type.costPerBlockHour;
  const baseFuelPortion = blockHourCost * FUEL_SHARE_OF_BLOCK_HOUR_COST;
  return {
    fuel: baseFuelPortion * fuelPriceIndex * fuelEfficiencyMultiplier,
    // Whatever is left once fuel is removed: the flying crews' pay,
    // maintenance, and everything else bundled together (sim/crews.ts
    // charges only crews standing by).
    blockNonFuel: blockHourCost * (1 - FUEL_SHARE_OF_BLOCK_HOUR_COST),
    departure: type.costPerDeparture,
  };
}

/**
 * The revenue, cost, and margin for one completed flight. Applied on
 * arrival (see sim/step.ts) — a flight in the air hasn't earned or spent
 * anything yet as far as the books are concerned.
 *
 * `marketDailyDemand` is how many people *actually* fly this market on an
 * average day right now — the stimulated figure from
 * `sim/marketDemand.ts`'s `actualDailyDemand()`, not the gravity model's
 * potential. Passed in rather than looked up here so this stays a pure
 * function of its inputs, and so the caller decides whether it's reading
 * live state or previewing a hypothetical.
 *
 * `legsServingMarket` is how many scheduled legs (either direction, see
 * `sim/schedule.ts`'s `legsServingMarket()`) currently split this leg's
 * market between them — that demand is divided evenly across all of them,
 * so a second frequency on an already-thin market doesn't create new
 * passengers, it just splits the same ones two ways. (Adding frequency
 * does grow the market, but over days, through stimulation — not
 * instantly within one flight's economics.) Of that per-flight slice, only
 * `bookingShare()` (`sim/choiceModel.ts`, the "connective piece")
 * actually books — some people, given `fare` and this market's
 * frequency, choose a competitor or not to travel at all rather than fly
 * you. `fare` feeds both the choice model's price term *and* revenue
 * directly — raising it trades booked passengers for margin per
 * passenger, the core yield-management tension. Rivals on the market also
 * cut the fare each passenger pays (`rivalYieldFactor()`, sim/pressure.ts).
 *
 * `spilloverAvailable` is this market's shared recapture pool as of right
 * now (today, before this flight) — see `SimState.spilloverByMarket`.
 * Two outcomes, mutually exclusive:
 *   - This flight's own booked demand exceeds its seats: it's seat-capped
 *     at the old flat ceiling, same as before, but now a `perks.recaptureRate`
 *     fraction of the overflow it couldn't carry gets deposited into the
 *     pool for a later flight on this same market to pick up, instead of
 *     the whole overflow just vanishing.
 *   - This flight has spare room: it tops up with whatever's waiting in
 *     the pool (capped at however much room is actually left), on top of
 *     its own booked demand — recovered passengers who couldn't get the
 *     earlier flight, still flying you rather than a competitor.
 * `pax` never exceeds the seat ceiling either way.
 */
/** Pricing under the going rate wins connecting passengers too, but at most this many times as many. */
const MAX_CONNECTING_PRICE_GAIN = 1.5;

/**
 * How a route's fare scales the connecting passengers it gets
 * (sim/hubs.ts): its booking share at this fare over its share at the
 * going rate (sim/choiceModel.ts), so connecting passengers react to
 * price exactly as local ones do; otherwise an over-priced hub's planes
 * stayed full on connections after local passengers had gone to rivals.
 * Shared with the Plan hub planner (sim/hubPlanner.ts) so its estimates
 * see the same thing.
 */
export function connectingPriceResponse(
  fare: number,
  legsServingMarket: number,
  origin: string,
  dest: string,
  competitorRoutes: CompetitorOffering[],
  brandEdge: number,
): number {
  const atFare = bookingShare(fare, legsServingMarket, origin, dest, competitorRoutes, brandEdge);
  const atGoingRate = bookingShare(recommendedFare(origin, dest), legsServingMarket, origin, dest, competitorRoutes, brandEdge);
  return atGoingRate > 0 ? Math.min(MAX_CONNECTING_PRICE_GAIN, atFare / atGoingRate) : 1;
}

export function flightResult(
  leg: EconomyLeg,
  type: EconomyAircraftType,
  fuelPriceIndex: number,
  fuelEfficiencyMultiplier: number,
  marketDailyDemand: number,
  /**
   * Connecting passengers a day riding this market on their way through a
   * hub (sim/hubs.ts). They're the airline's own customers, already booked
   * onto its network, so they skip the booking-share split with rivals
   * and are simply added to each flight's bookings. Passed in rather than
   * derived here so this stays a pure function of its inputs.
   */
  connectingDailyDemand: number,
  legsServingMarket: number,
  // The one lever this prices from. A flight passes the fare it locked in
  // at departure (step.ts), a preview the market's current or proposed one.
  fare: number,
  competitorRoutes: CompetitorOffering[],
  spilloverAvailable: number,
  // What the airline brings to booking on this market beyond fare and
  // frequency (sim/innovations.ts's bookingPerks()): its name, the
  // ticket's yield, and how many turned-away passengers wait for a later
  // flight.
  perks: BookingPerks,
): FlightResult {
  const demandPerFlight = marketDailyDemand / legsServingMarket;
  const share = bookingShare(fare, legsServingMarket, leg.origin, leg.dest, competitorRoutes, perks.brandEdge);
  const connecting = connectingDailyDemand * connectingPriceResponse(fare, legsServingMarket, leg.origin, leg.dest, competitorRoutes, perks.brandEdge);
  const bookedDemand = demandPerFlight * share + connecting / legsServingMarket;
  const seatCeiling = Math.round(type.seats * LOAD_FACTOR);
  const roundedBooked = Math.round(bookedDemand);

  let pax: number;
  let spilloverDelta: number;
  let spilled = 0;
  let recaptured = 0;
  if (roundedBooked > seatCeiling) {
    pax = seatCeiling;
    spilled = roundedBooked - seatCeiling;
    spilloverDelta = Math.round(spilled * perks.recaptureRate);
  } else {
    const spareCapacity = seatCeiling - roundedBooked;
    recaptured = Math.min(spareCapacity, spilloverAvailable);
    pax = roundedBooked + recaptured;
    spilloverDelta = -recaptured;
  }

  const yieldFactor = rivalYieldFactor(leg.origin, leg.dest, legsServingMarket, competitorRoutes);
  const revenue = pax * fare * yieldFactor * perks.yieldMultiplier;
  const costBreakdown = legCostBreakdown(leg.blockMinutes, type, fuelPriceIndex, fuelEfficiencyMultiplier);
  const cost = costBreakdown.fuel + costBreakdown.blockNonFuel + costBreakdown.departure;
  return {
    pax,
    revenue,
    cost,
    margin: revenue - cost,
    spilloverDelta,
    costBreakdown,
    demandBreakdown: {
      allocatedDemand: demandPerFlight,
      bookedDemand: roundedBooked,
      seatCeiling,
      spilled,
      recaptured,
    },
  };
}
