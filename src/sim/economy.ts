import type { SegmentName } from './timeOfDay';
import { bookingShare, segmentShareAt } from './choiceModel';
import { cabinLayout, type Cabin } from './cabins';
import { DEFAULT_FARE_CLASSES, sellSeats, type FareClassSettings, type FareClassTally } from './fareClasses';
import { marketMix } from './marketCharacter';
import { flightDemandShare } from './timeOfDay';
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
  /** The part of `revenue` that is fees (sim/ancillaries.ts). */
  ancillaryRevenue: number;
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
  /** How the flight's seats sold, class by class (sim/fareClasses.ts). */
  fareClasses: FareClassTally;
};

// Deliberately crude: no flight sells more than this fraction of its
// seats, whatever the day. This is the base; spoilage management and a
// commercial officer raise it (sim/innovations.ts's loadFactorCap()). (Fare is set per market, sim/state.ts's
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

/** A market's mix scaled by today's seasonal factors: no longer summing to 1, since a season brings more or fewer travellers. */
function seasonalMix(mix: Record<SegmentName, number>, season: Record<SegmentName, number> | undefined): Record<SegmentName, number> {
  if (!season) return mix;
  return { business: mix.business * season.business, leisure: mix.leisure * season.leisure, vfr: mix.vfr * season.vfr };
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
  /**
   * When this flight and the market's others leave (schedule minutes, all
   * of your departures on the market, both directions): the flight's share
   * of the market's passengers follows how well its hour suits them, and
   * the market's hours count in the choice against rivals
   * (sim/timeOfDay.ts). Without it, flights split the market evenly.
   */
  timing?: { departMinute: number; marketDepartMinutes: number[]; crowding?: number; season?: Record<SegmentName, number> },
  /** The route's seat split between fare classes (sim/fareClasses.ts); the default when it hasn't been set. */
  fareClasses?: FareClassSettings,
  /** The plane's cabin (sim/cabins.ts): a business cabin trades economy seats for business ones. */
  cabin: Cabin = 'economy',
): FlightResult {
  const demandPerFlight = timing
    ? marketDailyDemand * flightDemandShare(timing.departMinute, timing.marketDepartMinutes, marketMix(leg.origin, leg.dest), timing.crowding)
    : marketDailyDemand / legsServingMarket;
  const connecting = connectingDailyDemand * connectingPriceResponse(fare, legsServingMarket, leg.origin, leg.dest, competitorRoutes, perks.brandEdge);
  const layout = cabinLayout(type.seats, cabin);
  const seatCeiling = Math.round(layout.economy * perks.loadFactor);
  // The seats sold class by class, in booking order (sim/fareClasses.ts).
  const sale = sellSeats({
    seats: seatCeiling,
    businessSeats: Math.round(layout.business * perks.loadFactor),
    baseFare: fare,
    demand: demandPerFlight,
    // The season scales how many of each segment want to fly today (sim/seasons.ts).
    mix: seasonalMix(marketMix(leg.origin, leg.dest), timing?.season),
    shareAt: (segment, price) =>
      segmentShareAt(segment, price, legsServingMarket, leg.origin, leg.dest, competitorRoutes, perks.brandEdge + perks.positionEdge[segment], timing?.marketDepartMinutes),
    connecting: connecting / legsServingMarket,
    recapturable: spilloverAvailable,
    classes: fareClasses ?? DEFAULT_FARE_CLASSES,
  });
  const pax = Math.round(sale.passengers);
  const spilloverDelta = sale.spilled > 0 ? Math.round(sale.spilled * perks.recaptureRate) : -Math.round(sale.recaptured);
  const yieldFactor = rivalYieldFactor(leg.origin, leg.dest, legsServingMarket, competitorRoutes);
  const ancillaryRevenue = pax * perks.ancillaryPerPassenger;
  const revenue = sale.fares * yieldFactor * perks.yieldMultiplier + ancillaryRevenue;
  const costBreakdown = legCostBreakdown(leg.blockMinutes, type, fuelPriceIndex, fuelEfficiencyMultiplier);
  const cost = costBreakdown.fuel + costBreakdown.blockNonFuel + costBreakdown.departure;
  return {
    pax,
    revenue,
    ancillaryRevenue,
    cost,
    margin: revenue - cost,
    spilloverDelta,
    costBreakdown,
    fareClasses: sale.tally,
  };
}
