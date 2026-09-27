import aircraftTypesData from '../../data/aircraft-types.json';
import { connectingPriceResponse, legCost, LOAD_FACTOR, type EconomyAircraftType } from './economy';
import { connectingDemandOnMarket, connectingPassengersThrough, connectingFlowsAt, spokesOf, suggestSpokes, planHubStyleChange } from './hubs';
import { HUB_STYLES, HUB_STYLE_ORDER, hubStyleAt, type HubStyle } from './hubStyle';
import { airportLoad } from './airports';
import { summarizeMarket } from './marketSummary';
import { legsServingMarket, marketKey, recommendedFare, type ScheduleLeg } from './schedule';
import { USABLE_DAY_END_MINUTE, USABLE_DAY_MINUTES } from './utilisation';
import type { SimState } from './state';

/**
 * The Plan hub window's brain: what's being left on the table at a hub,
 * as a short list of moves, each valued in dollars a day.
 *
 * Every move is valued the same careful way, because the obvious way is
 * wrong. More connections only earn anything if there are empty seats to
 * put them in: a hub whose planes are already full gains nothing from
 * connecting more people, and measured, a Tight-banks Montréal connected
 * the most passengers of any style and earned the least. So each move's
 * extra connecting passengers are capped, route by route, by the seats
 * that route has spare, and then:
 *
 *   - Frequency (one more daily round trip to a spoke): minus the extra
 *     flights' direct cost.
 *   - Hub style: minus the aircraft time its hub wait uses, priced at what
 *     that time costs in lease. That's also what makes "go back to
 *     Rolling" a real recommendation when the waves are filling nothing.
 *   - New spokes: shown, valued once grown, but never counted as "missed"
 *     — they're growth ideas, not something the current network is
 *     getting wrong.
 *
 * `missedPerDay` (the best frequency move plus the best style move) is
 * what colours the always-visible Plan hub button: yellow once it's worth
 * a look, red once it's worth acting on.
 */

export const HUB_MISSED_WARN_PER_DAY = 500;
export const HUB_MISSED_ACT_PER_DAY = 2500;
/** A style isn't recommended if it would push the airport's peak load past this — the congestion would eat the gain. */
const MAX_RECOMMENDED_LOAD = 0.75;
/**
 * ...nor if it would push any plane's scheduled day to within this many
 * minutes of the 22:00 curfew (sim/curfew.ts): the planner can't price
 * the cancellations that follow, so it doesn't recommend walking into them.
 */
const CURFEW_MARGIN_MINUTES = 45;

function latestArrival(schedule: ScheduleLeg[]): number {
  return Math.max(0, ...schedule.map((leg) => leg.departMinute + leg.blockMinutes));
}

const typesByCode = new Map(
  (aircraftTypesData as (EconomyAircraftType & { code: string; name: string; seats: number })[]).map((t) => [t.code, t]),
);

export type HubMove =
  | { kind: 'frequency'; spoke: string; gainPerDay: number; extraConnecting: number }
  | { kind: 'style'; style: HubStyle; gainPerDay: number; extraConnecting: number }
  | { kind: 'spoke'; spoke: string; gainPerDay: number; extraConnecting: number };

export type StylePreview = {
  style: HubStyle;
  connecting: number;
  load: number;
  /** Null when the schedule can absorb it; otherwise why not. */
  blockedReason: string | null;
};

export type HubPlan = {
  hub: string;
  style: HubStyle;
  connecting: number;
  spokes: { iata: string; flightsPerDay: number }[];
  /** Connecting passengers a day between each pair of spokes, keyed "A|B" with A before B in `spokes` order. */
  grid: Record<string, number>;
  styles: StylePreview[];
  /** Best first; frequency and style moves only when they're worth something. */
  moves: HubMove[];
  missedPerDay: number;
  urgency: 'none' | 'warn' | 'act';
};

function fareOn(state: SimState, a: string, b: string): number {
  return state.routeSettings[marketKey(a, b)]?.fare ?? recommendedFare(a, b);
}

/** Spare sellable seats a day on each of the hub's spoke routes. */
function spareSeatsByMarket(state: SimState, hub: string): Map<string, number> {
  const spare = new Map<string, number>();
  for (const spoke of spokesOf(state, hub).keys()) {
    const settings = state.routeSettings[marketKey(hub, spoke)];
    if (!settings) continue;
    const summary = summarizeMarket(hub, spoke, state, settings);
    spare.set(spoke, Math.max(0, summary.seatCeiling - summary.pax));
  }
  return spare;
}

/**
 * Extra revenue a day from connections if `after` replaced `state`: on
 * each spoke route, the extra connecting demand, capped by the seats it
 * has spare (plus any a move adds), at that route's fare.
 */
function connectionRevenueGain(state: SimState, after: SimState, hub: string, extraSeats = new Map<string, number>()): { revenue: number; passengers: number } {
  const spare = spareSeatsByMarket(state, hub);
  let revenue = 0;
  let passengers = 0;
  for (const spoke of spokesOf(after, hub).keys()) {
    const settings = state.routeSettings[marketKey(hub, spoke)];
    // Priced the same way the economy prices them (sim/economy.ts): an
    // over-priced route wins fewer of its connections.
    const response = settings
      ? connectingPriceResponse(settings.fare, legsServingMarket(hub, spoke, after.schedule), hub, spoke, state.competitorRoutes)
      : 1;
    const gained = (connectingDemandOnMarket(after, hub, spoke) - connectingDemandOnMarket(state, hub, spoke)) * response;
    if (gained <= 0) continue;
    const carried = Math.min(gained, (spare.get(spoke) ?? 0) + (extraSeats.get(spoke) ?? 0));
    revenue += carried * fareOn(state, hub, spoke);
    passengers += carried;
  }
  // Each connecting passenger rides two spoke routes and was counted on
  // both, so the head count halves; the revenue doesn't (they pay both fares).
  return { revenue, passengers: passengers / 2 };
}

/** One more daily round trip hub–spoke, on the class already flying it: its value in connections, net of its direct cost. */
function frequencyMove(state: SimState, hub: string, spoke: string): HubMove | null {
  const existing = state.schedule.find((leg) => (leg.origin === hub && leg.dest === spoke) || (leg.origin === spoke && leg.dest === hub));
  const aircraft = existing ? state.aircraft.find((a) => a.tail === existing.tail) : undefined;
  const type = aircraft ? typesByCode.get(aircraft.typeCode) : undefined;
  if (!existing || !type) return null;

  const hypothetical: ScheduleLeg[] = [
    { ...existing, legId: '__plan-out', origin: hub, dest: spoke },
    { ...existing, legId: '__plan-back', origin: spoke, dest: hub },
  ];
  const after = { ...state, schedule: [...state.schedule, ...hypothetical] };
  const { revenue, passengers } = connectionRevenueGain(state, after, hub, new Map([[spoke, 2 * Math.round(type.seats * LOAD_FACTOR)]]));
  const cost = 2 * legCost(existing.blockMinutes, type, state.fuelPriceIndex, state.fuelEfficiencyMultiplier);
  return { kind: 'frequency', spoke, gainPerDay: revenue - cost, extraConnecting: passengers };
}

/** What the hub wait at `hub` costs a day under `style`, priced at the lease cost of the planes arriving there. */
function hubWaitCostPerDay(state: SimState, hub: string, style: HubStyle): number {
  const wait = HUB_STYLES[style].hubWaitMinutes;
  if (wait === 0) return 0;
  let cost = 0;
  for (const leg of state.schedule) {
    if (leg.dest !== hub) continue;
    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (aircraft) cost += (wait * aircraft.leaseCostPerDay) / USABLE_DAY_MINUTES;
  }
  return cost;
}

export function planHub(state: SimState, hub: string): HubPlan {
  const style = hubStyleAt(state, hub);
  const spokeFlights = spokesOf(state, hub);
  const spokes = [...spokeFlights.entries()]
    .map(([iata, flightsPerDay]) => ({ iata, flightsPerDay }))
    .sort((a, b) => b.flightsPerDay - a.flightsPerDay || a.iata.localeCompare(b.iata));

  const grid: Record<string, number> = {};
  const order = new Map(spokes.map((s, i) => [s.iata, i]));
  for (const flow of connectingFlowsAt(state, hub)) {
    const [first, second] = (order.get(flow.a) ?? 0) < (order.get(flow.b) ?? 0) ? [flow.a, flow.b] : [flow.b, flow.a];
    grid[`${first}|${second}`] = flow.passengers;
  }

  const lateDays = new Set<HubStyle>();
  const styles: StylePreview[] = HUB_STYLE_ORDER.map((candidate) => {
    const after = { ...state, hubStyles: { ...state.hubStyles, [hub]: candidate } };
    const plan = candidate === style ? null : planHubStyleChange(state, hub, candidate);
    if (plan?.ok && latestArrival(plan.schedule) > USABLE_DAY_END_MINUTE - CURFEW_MARGIN_MINUTES) lateDays.add(candidate);
    return {
      style: candidate,
      connecting: connectingPassengersThrough(after, hub),
      load: airportLoad(after, hub),
      blockedReason: plan && !plan.ok ? plan.reason : null,
    };
  });

  const moves: HubMove[] = [];

  // Best style change, if any beats staying put.
  let bestStyle: HubMove | null = null;
  for (const preview of styles) {
    if (preview.style === style || preview.blockedReason) continue;
    if (preview.load > MAX_RECOMMENDED_LOAD && preview.load > airportLoad(state, hub)) continue;
    if (lateDays.has(preview.style) && latestArrival(state.schedule) <= USABLE_DAY_END_MINUTE - CURFEW_MARGIN_MINUTES) continue;
    const after = { ...state, hubStyles: { ...state.hubStyles, [hub]: preview.style } };
    const { revenue, passengers } = connectionRevenueGain(state, after, hub);
    // Going to a less-banked style loses connections too; value that loss the same capped way.
    const { revenue: lost } = connectionRevenueGain(after, state, hub);
    const waitSaving = hubWaitCostPerDay(state, hub, style) - hubWaitCostPerDay(state, hub, preview.style);
    const gainPerDay = revenue - lost + waitSaving;
    if (gainPerDay > 0 && (!bestStyle || gainPerDay > bestStyle.gainPerDay)) {
      bestStyle = { kind: 'style', style: preview.style, gainPerDay, extraConnecting: passengers };
    }
  }
  if (bestStyle) moves.push(bestStyle);

  // Best frequency addition.
  let bestFrequency: HubMove | null = null;
  if (spokes.length >= 2) {
    for (const { iata } of spokes) {
      const move = frequencyMove(state, hub, iata);
      if (move && move.gainPerDay > 0 && (!bestFrequency || move.gainPerDay > bestFrequency.gainPerDay)) bestFrequency = move;
    }
  }
  if (bestFrequency) moves.push(bestFrequency);

  const missedPerDay = moves.reduce((total, move) => total + move.gainPerDay, 0);

  for (const suggestion of suggestSpokes(state, hub, 2)) {
    moves.push({ kind: 'spoke', spoke: suggestion.spoke, gainPerDay: suggestion.revenuePerDay, extraConnecting: suggestion.passengers });
  }

  return {
    hub,
    style,
    connecting: connectingPassengersThrough(state, hub),
    spokes,
    grid,
    styles,
    moves: moves.sort((a, b) => (a.kind === 'spoke' ? 1 : 0) - (b.kind === 'spoke' ? 1 : 0) || b.gainPerDay - a.gainPerDay),
    missedPerDay,
    urgency: missedPerDay >= HUB_MISSED_ACT_PER_DAY ? 'act' : missedPerDay >= HUB_MISSED_WARN_PER_DAY ? 'warn' : 'none',
  };
}
