import { marketDistanceNm } from './demand';
import { executiveConnectingMultiplier } from './executives';
import { connectingFeedMultiplier } from './innovations';
import { actualDailyDemand, currentPotentialDemand } from './marketDemand';
import { flowRights, grantedCountries, homeCountry } from './rights';
import { marketKey } from './schedule';
import { hubStyleAt, type HubStyle } from './hubStyle';
import { planRespace, applyRespace, workingCopy, type TurnBufferPlan } from './turnBuffer';
import { recessionFactor } from './shocks';
import type { SimState } from './state';

/**
 * Connecting passengers: people travelling between two of your spokes, A
 * and B, by changing planes at a hub H you fly both of them to. This
 * replaces the flat "connectivity multiplier", which paid a hub
 * for its size whether or not anything connected through it.
 *
 * Worked out from the schedule's real times (WEEK-THIRTEEN.md, thread 5):
 * a passenger from A connects to B only where a flight in from A lands at
 * the hub between MIN_CONNECT_MINUTES and MAX_CONNECT_MINUTES before one
 * out to B leaves, or the same plane flies on to B (a through flight). How a hub is run (sim/hubStyle.ts) is how the planner
 * times its rotations, and so how well they meet. For each pair of spokes:
 *
 *   passengers = A–B city-pair potential   (the gravity model, sim/demand.ts)
 *              × CONNECT_SHARE             (the slice willing to change planes)
 *              × establishment             (how built-up both spoke routes are)
 *              × frequency × timing        (how many could connect, and how many flights meet, connectingChance())
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
/** How fast more flights make a connection possible (connectingChance()). */
const FREQUENCY_SCALE = 2;
/**
 * How well timed a spoke pair's flights are, one way: 1 - e^(-connections
 * / CONNECTION_SCALE), where each arrival from A counts as much as its
 * best onward departure to B is good (1 for a wait up to
 * GOOD_CONNECT_MINUTES, falling to POOR_CONNECT_QUALITY at the longest).
 * One good connection a day is about 86% timed.
 */
const CONNECTION_SCALE = 0.5;
/**
 * The share of possible connections made even when no times meet. Set so
 * a Rolling hub, whose flights meet only by chance (about 40% timed),
 * connects about as the flat Rolling style (0.5) did, and perfect timing
 * as Tight banks (1.0) did: with 18 seeds a home, the steady player's
 * year matched before timed connections at Montréal ($13.8M, 2 busts),
 * Toronto ($38M) and Halifax (12 busts); at 0.5 Toronto made $70M.
 */
const TIMING_FLOOR = 0.3;
/** The shortest wait at the hub a passenger and their bag can make. */
export const MIN_CONNECT_MINUTES = 40;
/** A wait up to this long is a good connection... */
const GOOD_CONNECT_MINUTES = 75;
/** ...falling to this much of one at the longest wait anyone takes... */
const POOR_CONNECT_QUALITY = 0.25;
/** ...which is this. */
export const MAX_CONNECT_MINUTES = 180;
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

/** How good a connection with this wait at the hub is, 0–1; 0 outside the connecting window. */
export function connectionQuality(waitMinutes: number): number {
  if (waitMinutes < MIN_CONNECT_MINUTES || waitMinutes > MAX_CONNECT_MINUTES) return 0;
  if (waitMinutes <= GOOD_CONNECT_MINUTES) return 1;
  return 1 - ((1 - POOR_CONNECT_QUALITY) * (waitMinutes - GOOD_CONNECT_MINUTES)) / (MAX_CONNECT_MINUTES - GOOD_CONNECT_MINUTES);
}

/**
 * Every arrival counted by its best onward departure: the connections a
 * day one way. Onward on the same plane is a through flight: passengers
 * stay aboard, so it's a good connection at any wait, the turn included.
 */
function connectionsOneWay(arrivals: HubTime[], departures: HubTime[]): number {
  let total = 0;
  for (const arrival of arrivals) {
    let best = 0;
    for (const departure of departures) {
      const wait = departure.minute - arrival.minute;
      const quality = departure.tail === arrival.tail && wait >= 0 && wait <= MAX_CONNECT_MINUTES ? 1 : connectionQuality(wait);
      if (quality > best) best = quality;
    }
    total += best;
  }
  return total;
}

/**
 * The chance a passenger between A and B finds a connection at the hub.
 * Frequency sets how many could (1 - e^(-flights / FREQUENCY_SCALE) on the
 * thinner spoke: about 40% at one daily flight, 63% at two, 86% at four),
 * and timing how many of those do: TIMING_FLOOR of them with times that
 * never meet (they take a long wait, or an overnight), all of them when
 * every flight in meets a good one out (the timed share, both directions
 * averaged). A frequency base keeps a small, early network connecting
 * about as it always did, where a purely timed chance left it next to
 * nothing (measured: the steady player went bust at Montréal 3 games in
 * 6 against 0 in 6); timing is what a hub's style and the Schedule earn.
 */
function connectingChance(times: SpokeTimes, a: string, b: string): number {
  const timed = (share: number) => 1 - Math.exp(-share / CONNECTION_SCALE);
  const ab = timed(connectionsOneWay(times.arrivalsFrom.get(a) ?? [], times.departuresTo.get(b) ?? []));
  const ba = timed(connectionsOneWay(times.arrivalsFrom.get(b) ?? [], times.departuresTo.get(a) ?? []));
  const flights = (spoke: string) => ((times.arrivalsFrom.get(spoke)?.length ?? 0) + (times.departuresTo.get(spoke)?.length ?? 0)) / 2;
  const frequency = 1 - Math.exp(-Math.min(flights(a), flights(b)) / FREQUENCY_SCALE);
  return frequency * (TIMING_FLOOR + (1 - TIMING_FLOOR) * (ab + ba) / 2);
}

/** A flight at the hub: when it lands or leaves (schedule minutes, home clock) and on which plane. */
type HubTime = { minute: number; tail: string };

/** When your flights land at the hub from each spoke, and leave it for each. */
type SpokeTimes = { arrivalsFrom: Map<string, HubTime[]>; departuresTo: Map<string, HubTime[]> };

function spokeTimes(state: SimState, hub: string): SpokeTimes {
  const arrivalsFrom = new Map<string, HubTime[]>();
  const departuresTo = new Map<string, HubTime[]>();
  const add = (map: Map<string, HubTime[]>, spoke: string, time: HubTime) => {
    const list = map.get(spoke);
    if (list) list.push(time);
    else map.set(spoke, [time]);
  };
  for (const leg of state.schedule) {
    if (leg.dest === hub) add(arrivalsFrom, leg.origin, { minute: leg.departMinute + leg.blockMinutes, tail: leg.tail });
    if (leg.origin === hub) add(departuresTo, leg.dest, { minute: leg.departMinute, tail: leg.tail });
  }
  for (const list of [...arrivalsFrom.values(), ...departuresTo.values()]) list.sort((x, y) => x.minute - y.minute);
  return { arrivalsFrom, departuresTo };
}

/**
 * Connecting passengers between spokes `a` and `b` through `hub`, given
 * when each spoke's flights meet at the hub, each spoke route's
 * establishment, and whether anyone flies A–B nonstop.
 */
function flowBetween(
  state: SimState,
  hub: string,
  a: string,
  b: string,
  times: SpokeTimes,
  establishedA: number,
  establishedB: number,
  nonstopFlown: boolean,
): number {
  const nonstop = nonstopFlown ? NONSTOP_DISCOUNT : 1;
  return (
    currentPotentialDemand(state, a, b) *
    CONNECT_SHARE *
    Math.min(establishedA, establishedB) *
    connectingChance(times, a, b) *
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
 * spokes and when their flights meet at the hub, how built-up each spoke
 * route is, demand growth, and which spoke pairs anyone flies nonstop.
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
  const home = homeCountry(state);
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
  const times = spokeTimes(state, hub);
  const timeKey = spokes
    .map(([spoke]) => {
      const list = (entries: HubTime[] | undefined) => (entries ?? []).map((t) => `${t.minute}${t.tail}`).join('.');
      return `${spoke}<${list(times.arrivalsFrom.get(spoke))}>${list(times.departuresTo.get(spoke))}`;
    })
    .join(',');

  const inputs = [
    timeKey,
    connectingFeedMultiplier(state),
    executiveConnectingMultiplier(state),
    state.demandGrowthMultiplier,
    recessionFactor(state),
    spokes.map(([spoke, flights], i) => `${spoke}:${flights}:${established[i]}`).join(','),
    [...nonstop].sort().join(','),
    home,
    grantedCountries(state).join(','),
  ].join('|');
  const cached = flowCache.get(hub);
  if (cached && cached.inputs === inputs) return cached.flows;

  const flows: ConnectingFlow[] = [];
  for (let i = 0; i < spokes.length; i++) {
    for (let j = i + 1; j < spokes.length; j++) {
      const [a] = spokes[i];
      const [b] = spokes[j];
      // Air rights (sim/rights.ts): two airports in one foreign country can't be joined through any hub.
      if (!flowRights(home, a, hub, b, grantedCountries(state)).ok) continue;
      const passengers = flowBetween(state, hub, a, b, times, established[i], established[j], nonstop.has(marketKey(a, b)));
      if (passengers >= 0.5) flows.push({ hub, a, b, passengers });
    }
  }
  flows.sort((x, y) => y.passengers - x.passengers);
  flowCache.set(hub, { inputs, flows });
  return flows;
}

/** How many pairs of this hub's spokes air rights bar from connecting (sim/rights.ts): the hub inspector says so, so a missing connection has a reason. */
export function barredSpokePairsAt(state: SimState, hub: string): number {
  const home = homeCountry(state);
  const spokes = [...spokesOf(state, hub).keys()];
  let barred = 0;
  for (let i = 0; i < spokes.length; i++) {
    for (let j = i + 1; j < spokes.length; j++) {
      if (!flowRights(home, spokes[i], hub, spokes[j], grantedCountries(state)).ok) barred++;
    }
  }
  return barred;
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

/**
 * What switching `hub` to `style` would do to the schedule: every plane
 * flying into it gets the style's hub wait after each arrival there, and
 * every plane based there starts its rotations on the style's waves,
 * re-timed and re-pooled exactly like a turn-buffer change.
 */
export function planHubStyleChange(state: SimState, hub: string, style: HubStyle): TurnBufferPlan {
  const work = workingCopy(state, { hubStyles: { ...state.hubStyles, [hub]: style } });
  const basedHere = new Set(state.aircraft.filter((aircraft) => aircraft.baseAirport === hub).map((aircraft) => aircraft.tail));
  const affectedTails = [...new Set(state.schedule.filter((leg) => leg.dest === hub || basedHere.has(leg.tail)).map((leg) => leg.tail))];
  return planRespace(state, work, affectedTails);
}

/** Connecting passengers a day through `hub` if it were run as `style`, its flights re-timed to match. */
export function connectingUnderStyle(state: SimState, hub: string, style: HubStyle): number {
  if (style === hubStyleAt(state, hub)) return connectingPassengersThrough(state, hub);
  const plan = planHubStyleChange(state, hub, style);
  if (!plan.ok) return connectingPassengersThrough(state, hub);
  return connectingPassengersThrough({ ...state, hubStyles: { ...state.hubStyles, [hub]: style }, schedule: plan.schedule }, hub);
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
