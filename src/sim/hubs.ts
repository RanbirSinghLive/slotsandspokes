import { marketDistanceNm } from './demand';
import { executiveConnectingMultiplier } from './executives';
import { connectingFeedMultiplier } from './innovations';
import { actualDailyDemand, currentPotentialDemand } from './marketDemand';
import { legsServingMarket, marketKey, recommendedFare } from './schedule';
import { HUB_STYLES, hubStyleAt, type HubStyle } from './hubStyle';
import { planRespace, applyRespace, workingCopy, type TurnBufferPlan } from './turnBuffer';
import { recessionFactor } from './shocks';
import type { SimState } from './state';
import aircraftTypesData from '../../data/aircraft-types.json';

const typesByCode = new Map(
  (aircraftTypesData as { code: string; rangeNm: number; seats: number }[]).map((t) => [t.code, t]),
);

/**
 * Connecting passengers: people travelling between two of your spokes, A
 * and B, by changing planes at a hub H you fly both of them to. This
 * replaces week six's flat "connectivity multiplier", which paid a hub
 * for its size whether or not anything connected through it.
 *
 * Worked out from how often routes fly, never from times — the player
 * never authors a schedule (WEEK-SEVEN.md), and a connection model that
 * needed them would drag a timeline back in. For each pair of spokes:
 *
 *   passengers = A–B city-pair potential   (the gravity model, sim/demand.ts)
 *              × CONNECT_SHARE             (the slice willing to change planes)
 *              × establishment             (how built-up both spoke routes are)
 *              × frequency chance          (more flights, more that line up)
 *              × hub style efficiency      (sim/hubStyle.ts)
 *              × circuity                  (nobody flies far out of their way)
 *              × nonstop discount          (fewer connect if anyone flies A–B direct)
 *
 * Aggregate flows per city pair, not individual passengers, so it stays
 * inside CLAUDE.md's "no individual passenger simulation" line. Connecting
 * passengers ride both legs, so each flow is added to the demand of both
 * routes it uses (connectingDemandOnMarket()), where they book seats and
 * pay fares like anyone else (sim/economy.ts).
 */

/** Share of an A–B city pair's latent demand that would connect through a hub rather than go another way. */
const CONNECT_SHARE = 0.03;
/**
 * How fast more frequency helps: the chance a passenger finds a workable
 * connection is 1 - e^(-flights / FREQUENCY_SCALE) on the thinner of the
 * two routes. One daily flight each way lines up about 40% of the time,
 * two about 63%, four about 86%.
 */
const FREQUENCY_SCALE = 2;
/** Routing via the hub at up to this multiple of the direct distance costs nothing... */
const CIRCUITY_FREE = 1.3;
/** ...and nobody connects beyond this multiple. */
const CIRCUITY_LIMIT = 2;
/** Fraction still connecting when anyone — the player or a rival — flies A–B nonstop. */
const NONSTOP_DISCOUNT = 0.2;
/**
 * Local passengers a day at which a spoke route counts as established and
 * feeds connections in full. Below it, connections ramp up in proportion:
 * a new route starts at the market floor (10 a day, sim/marketDemand.ts),
 * so a quarter. Measured against local traffic, not the market's full
 * potential, because a trunk route's potential is in the thousands and a
 * regional airline's capacity would never get it anywhere near "mature" —
 * connections through a big airport would simply never start.
 */
const ESTABLISHED_PASSENGERS = 40;

export type ConnectingFlow = {
  hub: string;
  a: string;
  b: string;
  /** Both directions together, per day. */
  passengers: number;
};

/** Every airport the player flies to from `hub`, with flights per day each way. */
export function spokesOf(state: SimState, hub: string): Map<string, number> {
  const spokes = new Map<string, number>();
  for (const leg of state.schedule) {
    const other = leg.origin === hub ? leg.dest : leg.dest === hub ? leg.origin : null;
    if (other) spokes.set(other, (spokes.get(other) ?? 0) + 0.5);
  }
  return spokes;
}

function circuityFactor(a: string, hub: string, b: string): number {
  const direct = marketDistanceNm(a, b);
  if (direct <= 0) return 0;
  const circuity = (marketDistanceNm(a, hub) + marketDistanceNm(hub, b)) / direct;
  return Math.min(1, Math.max(0, (CIRCUITY_LIMIT - circuity) / (CIRCUITY_LIMIT - CIRCUITY_FREE)));
}

/** How established a spoke route is, 0–1: its local traffic against ESTABLISHED_PASSENGERS (or its whole potential, if smaller). */
function establishment(state: SimState, a: string, b: string): number {
  const target = Math.min(ESTABLISHED_PASSENGERS, currentPotentialDemand(state, a, b));
  return target > 0 ? Math.min(1, actualDailyDemand(state, a, b) / target) : 0;
}

function flownNonstop(state: SimState, a: string, b: string): boolean {
  if (legsServingMarket(a, b, state.schedule) > 0) return true;
  return state.competitorRoutes.some((route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a));
}

function frequencyChance(flightsPerDay: number): number {
  return 1 - Math.exp(-flightsPerDay / FREQUENCY_SCALE);
}

/**
 * Connecting passengers between spokes `a` and `b` through `hub`, given
 * each spoke route's flights per day and establishment, and whether anyone
 * flies A–B nonstop. Split out so suggested new spokes can be valued with
 * the same formula as real ones.
 */
function flowBetween(
  state: SimState,
  hub: string,
  a: string,
  b: string,
  flightsA: number,
  flightsB: number,
  establishedA: number,
  establishedB: number,
  nonstopFlown: boolean,
): number {
  const nonstop = nonstopFlown ? NONSTOP_DISCOUNT : 1;
  return (
    currentPotentialDemand(state, a, b) *
    CONNECT_SHARE *
    Math.min(establishedA, establishedB) *
    frequencyChance(Math.min(flightsA, flightsB)) *
    HUB_STYLES[hubStyleAt(state, hub)].connectionEfficiency *
    circuityFactor(a, hub, b) *
    nonstop *
    // A codeshare partner (sim/innovations.ts) and a network CCO
    // (sim/executives.ts) sell the connection too.
    connectingFeedMultiplier(state) *
    executiveConnectingMultiplier(state)
  );
}

/**
 * The last flows worked out at each hub, with the inputs they came from.
 *
 * Why a cache: the flows feed every departure's demand (step.ts), the
 * daily AOG and rival-response rolls, and the map, so they're asked for
 * many times a simulated minute. Working them out is a pass over every
 * pair of spokes, which grows with the square of the hub's size: at
 * thirty spokes it was two-thirds of all simulation time. Yet the answer
 * only changes when one of its inputs does, and those are few: the
 * spokes and their flights, how built-up each spoke route is, demand
 * growth, the hub's style, and which spoke pairs anyone flies nonstop.
 *
 * So each call writes those inputs out as a string, which is cheap, and
 * reuses the last answer when the string matches. That makes it exact by
 * construction: a different input is a different string. It also doesn't
 * care which object it was handed, so a "what if" copy of the state (the
 * hub planner's, the radial menu's) gets the right answer too.
 *
 * Module-level, not in `SimState`: it holds nothing a save needs, and
 * a fresh page or run simply starts empty.
 */
const flowCache = new Map<string, { inputs: string; flows: ConnectingFlow[] }>();

/** Every connecting flow through `hub`, busiest first. Callers must not modify the result. */
export function connectingFlowsAt(state: SimState, hub: string): ConnectingFlow[] {
  const spokes = [...spokesOf(state, hub).entries()];
  const spokeSet = new Set(spokes.map(([spoke]) => spoke));

  // Spoke pairs flown nonstop, by the player or a rival: one pass over
  // each list instead of one per pair.
  const nonstop = new Set<string>();
  for (const leg of state.schedule) {
    if (spokeSet.has(leg.origin) && spokeSet.has(leg.dest)) nonstop.add(marketKey(leg.origin, leg.dest));
  }
  for (const route of state.competitorRoutes) {
    if (spokeSet.has(route.origin) && spokeSet.has(route.dest)) nonstop.add(marketKey(route.origin, route.dest));
  }
  const established = spokes.map(([spoke]) => establishment(state, spoke, hub));

  const inputs = [
    hubStyleAt(state, hub),
    connectingFeedMultiplier(state),
    executiveConnectingMultiplier(state),
    state.demandGrowthMultiplier,
    recessionFactor(state),
    spokes.map(([spoke, flights], i) => `${spoke}:${flights}:${established[i]}`).join(','),
    [...nonstop].sort().join(','),
  ].join('|');
  const cached = flowCache.get(hub);
  if (cached && cached.inputs === inputs) return cached.flows;

  const flows: ConnectingFlow[] = [];
  for (let i = 0; i < spokes.length; i++) {
    for (let j = i + 1; j < spokes.length; j++) {
      const [a, flightsA] = spokes[i];
      const [b, flightsB] = spokes[j];
      const passengers = flowBetween(state, hub, a, b, flightsA, flightsB, established[i], established[j], nonstop.has(marketKey(a, b)));
      if (passengers >= 0.5) flows.push({ hub, a, b, passengers });
    }
  }
  flows.sort((x, y) => y.passengers - x.passengers);
  flowCache.set(hub, { inputs, flows });
  return flows;
}

/**
 * Connecting flows that start or end at `airport` but change planes
 * somewhere else: its own passengers heading onward through another hub
 * (Toronto–St. Louis via O'Hare, seen from Toronto). Busiest first. Only
 * an airport it flies to can be that hub, so only those are searched.
 */
export function onwardFlowsFrom(state: SimState, airport: string): ConnectingFlow[] {
  const flows: ConnectingFlow[] = [];
  for (const hub of spokesOf(state, airport).keys()) {
    for (const flow of connectingFlowsAt(state, hub)) {
      if (flow.a === airport || flow.b === airport) flows.push(flow);
    }
  }
  return flows.sort((x, y) => y.passengers - x.passengers);
}

/** Connecting passengers a day changing planes at this airport. */
export function connectingPassengersThrough(state: SimState, hub: string): number {
  return connectingFlowsAt(state, hub).reduce((total, flow) => total + flow.passengers, 0);
}

/**
 * Connecting passengers a day riding this route, in either role: as the
 * leg into a hub at one end, or out of one. Added to the route's own
 * demand when its flights are booked (step.ts).
 */
export function connectingDemandOnMarket(state: SimState, origin: string, dest: string): number {
  let total = 0;
  for (const [hub, spoke] of [
    [origin, dest],
    [dest, origin],
  ]) {
    for (const flow of connectingFlowsAt(state, hub)) {
      if (flow.a === spoke || flow.b === spoke) total += flow.passengers;
    }
  }
  return total;
}

export type SpokeSuggestion = {
  spoke: string;
  /** Connecting passengers a day it would add once its route has grown. */
  passengers: number;
  /** What they'd pay a day, at recommended fares for both legs. */
  revenuePerDay: number;
};

/**
 * The airports that would add the most connecting traffic at `hub` if the
 * player flew there once a day, valued once that route is established
 * ("once grown") since a brand-new route feeds only a quarter at first.
 * Only airports the player can see (fog by reach) and that a plane based
 * at the hub can actually reach are considered, and each is capped at
 * what one daily round trip on that plane could carry. Drawn as dashed lines
 * when hovering a hub.
 */
export function suggestSpokes(state: SimState, hub: string, limit = 3): SpokeSuggestion[] {
  const spokes = spokesOf(state, hub);
  if (spokes.size === 0) return [];
  // The longest-legged plane based here decides what's reachable, and its
  // seats cap what one daily round trip could carry.
  const based = state.aircraft
    .filter((a) => a.baseAirport === hub)
    .map((a) => typesByCode.get(a.typeCode))
    .filter((t) => t !== undefined);
  if (based.length === 0) return [];
  const plane = based.reduce((best, t) => (t.rangeNm > best.rangeNm ? t : best));
  const suggestions: SpokeSuggestion[] = [];
  for (const candidate of state.knownAirports) {
    if (candidate === hub || spokes.has(candidate)) continue;
    if (marketDistanceNm(hub, candidate) > plane.rangeNm) continue;
    let passengers = 0;
    let revenuePerDay = 0;
    for (const [spoke, flights] of spokes) {
      const flow = flowBetween(state, hub, candidate, spoke, 1, flights, 1, establishment(state, hub, spoke), flownNonstop(state, candidate, spoke));
      passengers += flow;
      revenuePerDay += flow * (recommendedFare(candidate, hub) + recommendedFare(hub, spoke));
    }
    // One daily round trip can't carry more than its seats, both ways.
    const carried = Math.min(passengers, 2 * plane.seats);
    if (carried >= 1) suggestions.push({ spoke: candidate, passengers: carried, revenuePerDay: revenuePerDay * (carried / passengers) });
  }
  return suggestions.sort((x, y) => y.revenuePerDay - x.revenuePerDay).slice(0, limit);
}

/**
 * What switching `hub` to `style` would do to the schedule: every plane
 * flying into it gets the style's hub wait after each arrival there,
 * re-timed and re-pooled exactly like a turn-buffer change.
 */
export function planHubStyleChange(state: SimState, hub: string, style: HubStyle): TurnBufferPlan {
  const work = workingCopy(state, { hubStyles: { ...state.hubStyles, [hub]: style } });
  const affectedTails = [...new Set(state.schedule.filter((leg) => leg.dest === hub).map((leg) => leg.tail))];
  return planRespace(state, work, affectedTails);
}

export function applyHubStyleChange(
  state: SimState,
  hub: string,
  style: HubStyle,
): { ok: true; moved: number } | { ok: false; reason: string } {
  const plan = planHubStyleChange(state, hub, style);
  if (!plan.ok) return plan;
  applyRespace(state, plan);
  if (style === 'rolling') delete state.hubStyles[hub];
  else state.hubStyles[hub] = style;
  return { ok: true, moved: plan.moved };
}
