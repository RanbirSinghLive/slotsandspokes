import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, LOAD_FACTOR, type EconomyAircraftType } from './economy';
import { trafficShare } from './choiceModel';
import { actualDailyDemand } from './marketDemand';
import { connectingDemandOnMarket } from './hubs';
import { airlineFuelPrice } from './fuelPrice';
import { bookingPerks } from './innovations';
import type { RouteSettings, SimState } from './state';
import type { ScheduleLeg } from './schedule';

// A market can be served by more than one gauge at once (week four's
// aircraft ladder, plus M13's ability to drag a leg onto a different
// tail), so a summary can't assume one type for a whole market. Looked up
// per leg instead, same "small local map, keyed by code" pattern step.ts
// already uses; `defaultAircraftType` only covers the defensive case of a
// leg whose tail somehow isn't in the fleet (shouldn't happen —
// validateSchedule() would already be flagging that tail as stranded or
// worse — but a market summary shouldn't throw over it).
const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);
const defaultAircraftType = (aircraftTypesData as EconomyAircraftType[])[0];

function aircraftTypeForLeg(leg: ScheduleLeg, state: SimState): EconomyAircraftType {
  const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  return type ?? defaultAircraftType;
}

export type MarketSummary = {
  freq: number;
  pax: number;
  revenue: number;
  cost: number;
  margin: number;
  seatCapped: boolean;
  share: number;
  totalSeats: number;
  /** Seats a day this market can actually fill, at the load-factor ceiling — what `pax` is capped at. */
  seatCeiling: number;
};

/**
 * Every scheduled leg on `origin`-`dest`'s market, summed through the same
 * flightResult() the real simulation uses — not a reimplementation of the
 * pax/revenue/cost formula, so nothing that reads this can ever drift from
 * what step() actually does. `routeSettings` is passed in explicitly
 * (rather than read from state) so a caller mid-edit — the route view's
 * sliders (ui/inspector/route.ts) — can show the *hypothetical* result of
 * a value not committed yet. In the sim rather than the UI so
 * render/mapmodes.ts's profitability mapmode calls the identical formula
 * instead of a second copy of it.
 */
export function summarizeMarket(origin: string, dest: string, state: SimState, routeSettings: RouteSettings): MarketSummary {
  // Sorted by depart time to approximate the same chronological order
  // step.ts's arrivals actually process spill-and-recapture in — a
  // hypothetical full-day preview, not a live read of `state`'s own
  // mid-day pool, so it needs its own stand-in for "which flight happens
  // first."
  const legs = state.schedule
    .filter((leg) => (leg.origin === origin && leg.dest === dest) || (leg.origin === dest && leg.dest === origin))
    .sort((a, b) => a.departMinute - b.departMinute);
  const freq = legs.length;

  let pax = 0;
  let revenue = 0;
  let cost = 0;
  let margin = 0;
  let totalSeats = 0;
  let totalSeatCeiling = 0;
  // Local to this preview, not `state.spilloverByMarket` — that pool
  // reflects wherever the real, currently-running day actually is, not a
  // clean full-day-from-scratch hypothetical.
  let previewSpillover = 0;
  // Connecting passengers per direction, asked for once rather than once
  // per flight: the answer is the same for every leg flying that way.
  const connectingByDirection = new Map<string, number>();
  const connectingFor = (from: string, to: string) => {
    const direction = `${from}>${to}`;
    let connecting = connectingByDirection.get(direction);
    if (connecting === undefined) {
      connecting = connectingDemandOnMarket(state, from, to);
      connectingByDirection.set(direction, connecting);
    }
    return connecting;
  };
  const perks = bookingPerks(state, origin, dest);
  for (const leg of legs) {
    const type = aircraftTypeForLeg(leg, state);
    const result = flightResult(
      { origin: leg.origin, dest: leg.dest, blockMinutes: leg.blockMinutes },
      type,
      airlineFuelPrice(state),
      state.fuelEfficiencyMultiplier,
      actualDailyDemand(state, leg.origin, leg.dest),
      connectingFor(leg.origin, leg.dest),
      freq,
      routeSettings.fare,
      state.competitorRoutes,
      previewSpillover,
      perks,
    );
    previewSpillover += result.spilloverDelta;
    pax += result.pax;
    revenue += result.revenue;
    cost += result.cost;
    margin += result.margin;
    totalSeats += type.seats;
    totalSeatCeiling += Math.round(type.seats * LOAD_FACTOR);
  }

  // A market is "seat-capped" when every one of its flights is pinned at
  // the load-factor ceiling — there's more demand than the fleet can
  // carry there, so raising fare trades away spare demand nobody could
  // fly anyway. Anything short of that ceiling is "demand-capped": every
  // remaining passenger is real, so raising fare will cost real pax.
  // Summed per leg's own type rather than one type times frequency, since
  // a market can now be served by more than one gauge at once.
  const seatCapped = freq > 0 && pax >= totalSeatCeiling;

  // Market share (choiceModel.ts's trafficShare()) is a property of the
  // market, not of any one leg on it — the same fare and frequency feed
  // it as bookingShare, just excluding "stay home" from the
  // denominator, so it answers "of people who fly this market, what
  // fraction fly you" rather than "what fraction of the addressable
  // population books at all." Direct-competitor-driven only for now —
  // connecting itineraries aren't modeled (WEEK-TWO.md decision 1), so a
  // rival reachable only by connecting through a third city can't yet
  // pull share away here.
  const share = freq > 0 ? trafficShare(routeSettings.fare, freq, origin, dest, state.competitorRoutes, perks.brandEdge) : 1;

  return { freq, pax, revenue, cost, margin, seatCapped, share, totalSeats, seatCeiling: totalSeatCeiling };
}
