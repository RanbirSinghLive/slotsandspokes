import aircraftTypesData from '../../data/aircraft-types.json';
import { rivalBookingShare } from './choiceModel';
import type { CompetitorOffering } from './competitors';
import { LOAD_FACTOR, legCost, type EconomyAircraftType } from './economy';
import { leaseRateFor } from './leasing';
import { preferredRivalClass, rivalFlights } from './market';
import { actualDailyDemand } from './marketDemand';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_CLOSE_GRACE_DAYS, RIVAL_REOPEN_COOLDOWN_DAYS } from './pressure';
import { computeBlockMinutes, legsServingMarket, marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Whether a rival route pays, estimated with the player's own formulas so
 * rivals live by the same economics the player does. Rivals keep no
 * books, so this is worked out fresh from the state each day:
 *
 *   passengers = market demand × this route's booking share
 *                (sim/choiceModel.ts, with the player and every other
 *                rival in the softmax), capped by its seats at the
 *                standard load factor
 *   revenue    = passengers × its fare
 *   cost       = its flights × the fleet's average legCost() per flight,
 *                plus this route's share of the fleet's plane leases
 *
 * A rival "daily flight" is one departure here, the same unit the choice
 * model compares against the player's legs. Rivals don't assign planes to
 * routes, so every route is flown by the airline's actual fleet
 * (`state.competitorFleets`) on average: its seats and its cost per
 * flight averaged over the planes it has, and its leases shared out by
 * each route's part of the airline's flights. A plane it keeps without
 * enough flying for it is paid for across all its routes.
 */

type TypeSpec = EconomyAircraftType & { code: string; cruiseKts: number };
const MINUTES_PER_DAY = 1440;

const typesByCode = new Map((aircraftTypesData as TypeSpec[]).map((type) => [type.code, type]));

export type RivalRouteResult = { passengers: number; revenue: number; cost: number; margin: number };

/**
 * The rival's planes by class. An airline with no fleet on record (only
 * before sim/market.ts's ensureRivalFleets() has run) is taken to fly the
 * class its size calls for.
 */
function fleetMix(state: SimState, code: string): { type: TypeSpec; count: number }[] {
  const fleet = state.competitorFleets[code] ?? [];
  const classes = fleet.length > 0 ? fleet : [preferredRivalClass(rivalFlights(state, code))];
  const counts = new Map<string, number>();
  for (const typeCode of classes) counts.set(typeCode, (counts.get(typeCode) ?? 0) + 1);
  return [...counts.entries()].map(([typeCode, count]) => ({ type: typesByCode.get(typeCode)!, count }));
}

export function rivalRouteDailyResult(state: SimState, route: CompetitorOffering): RivalRouteResult {
  const mix = fleetMix(state, route.code);
  const planes = mix.reduce((sum, { count }) => sum + count, 0);
  const average = (valueOf: (type: TypeSpec) => number) => mix.reduce((sum, { type, count }) => sum + valueOf(type) * count, 0) / planes;

  const settings = state.routeSettings[marketKey(route.origin, route.dest)];
  const playerLegs = legsServingMarket(route.origin, route.dest, state.schedule);
  const share = rivalBookingShare(
    route,
    settings?.fare ?? 0,
    playerLegs,
    settings?.marketingSpend ?? 0,
    state.competitorRoutes,
  );
  const seats = route.dailyFrequency * Math.round(average((type) => type.seats) * LOAD_FACTOR);
  const passengers = Math.min(actualDailyDemand(state, route.origin, route.dest) * share, seats);
  const revenue = passengers * route.fare;

  const costPerFlight = average((type) =>
    legCost(computeBlockMinutes(route.origin, route.dest, type.cruiseKts), type, state.fuelPriceIndex, 1),
  );
  const flying = route.dailyFrequency * costPerFlight;
  const fleetLeases = mix.reduce((sum, { type, count }) => sum + leaseRateFor(type.code) * count, 0);
  const leases = (route.dailyFrequency / Math.max(1, rivalFlights(state, route.code))) * fleetLeases;
  const cost = flying + leases;

  return { passengers, revenue, cost, margin: revenue - cost };
}

/**
 * Once a day, from step.ts's rollover: update every rival route's losing
 * streak, and close any route past its grace period that has lost money
 * RIVAL_CLOSE_AFTER_LOSING_DAYS days running. The airline keeps the
 * plane, so its next route opening doesn't need a new lease, and won't
 * reopen the same market for RIVAL_REOPEN_COOLDOWN_DAYS. An airline whose
 * last route closes leaves the map. Deterministic: no random draws.
 */
export function closeLosingRivalRoutes(state: SimState): void {
  const graceMinutes = RIVAL_CLOSE_GRACE_DAYS * MINUTES_PER_DAY;
  // Judge every route against the same day's market before removing any,
  // so the order routes are listed in can't change who closes.
  const closing = new Set<CompetitorOffering>();
  for (const route of state.competitorRoutes) {
    const losing = rivalRouteDailyResult(state, route).margin < 0;
    route.losingDays = losing ? (route.losingDays ?? 0) + 1 : 0;
    const pastGrace = state.simMinute - route.openedAtMinute >= graceMinutes;
    if (pastGrace && route.losingDays >= RIVAL_CLOSE_AFTER_LOSING_DAYS) closing.add(route);
  }
  // Remember closures for the reopening cooldown, dropping ones past it.
  const since = state.simMinute - RIVAL_REOPEN_COOLDOWN_DAYS * MINUTES_PER_DAY;
  state.rivalClosures = (state.rivalClosures ?? []).filter((closure) => closure.closedAtMinute >= since);
  if (closing.size === 0) return;
  for (const route of closing) {
    state.rivalClosures.push({ code: route.code, market: marketKey(route.origin, route.dest), closedAtMinute: state.simMinute });
  }
  state.competitorRoutes = state.competitorRoutes.filter((route) => !closing.has(route));
}

export type RivalRouteOutlook = RivalRouteResult & {
  /** Days in a row it has lost money, as of the last rollover. */
  losingDays: number;
  /** Days of its grace period left, during which losses can't close it. */
  graceDaysLeft: number;
  /**
   * If it keeps losing money: days until closeLosingRivalRoutes() closes
   * it (the later of its grace ending and its streak reaching
   * RIVAL_CLOSE_AFTER_LOSING_DAYS). Null while it's making money.
   */
  closesInDays: number | null;
};

/** Where one rival route stands today: what it makes, its losing streak, and how long until losses would close it. */
export function rivalRouteOutlook(state: SimState, route: CompetitorOffering): RivalRouteOutlook {
  const result = rivalRouteDailyResult(state, route);
  const losingDays = route.losingDays ?? 0;
  const daysOpen = Math.floor((state.simMinute - route.openedAtMinute) / MINUTES_PER_DAY);
  const graceDaysLeft = Math.max(0, RIVAL_CLOSE_GRACE_DAYS - daysOpen);
  const closesInDays =
    result.margin < 0 ? Math.max(1, graceDaysLeft, RIVAL_CLOSE_AFTER_LOSING_DAYS - losingDays) : null;
  return { ...result, losingDays, graceDaysLeft, closesInDays };
}
