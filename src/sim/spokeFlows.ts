import { allAirports } from './airports';
import { marketDistanceNm } from './demand';
import { grownConnectingFlow, nonstopMarkets, spokesOf } from './hubs';
import { currentPotentialDemand } from './marketDemand';
import { AIRCRAFT_CLASSES, classRank } from './aircraftClasses';
import { rangeNmFor } from './range';
import { bestRangeNm } from './reach';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * How a thin airport's passengers could reach your network: for each of
 * its biggest city pairs, whether you fly it nonstop, whether it could
 * change planes at one of your airports, or whether it needs a trunk you
 * don't fly yet. Answers "is this spoke worth adding, and what would make
 * it worth more" for the Demand lens, the airport view and the route
 * builder.
 *
 * Every number is the hub model's (sim/hubs.ts) once the spoke routes are
 * grown and well timed (grownConnectingFlow()), so it's what a spoke could
 * feed, not what it feeds today. Read-only: nothing here changes a booking.
 */

/**
 * - `nonstop`: you fly this pair direct.
 * - `viaHub`: you fly `hub`–other, so this flow could connect at `hub`
 *   (today, if you also fly this airport–`hub`).
 * - `needsTrunk`: it would connect at `hub`, an airport you fly two
 *   routes or more from, if you flew `hub`–other: a trunk within one
 *   class up of your biggest plane (trunkRangeNm()).
 * - `open`: none of your airports is on the way.
 */
export type SpokeFlowKind = 'nonstop' | 'viaHub' | 'needsTrunk' | 'open';

export type SpokeFlow = {
  other: string;
  /** People who'd fly this city pair a day, both ways (the gravity model, with growth). */
  potential: number;
  kind: SpokeFlowKind;
  /** Where it would change planes, for `viaHub` and `needsTrunk`. */
  hub?: string;
  /** Whether you already fly this airport–`hub`. */
  spokeFlown?: boolean;
  /** Connecting passengers a day once grown, for `viaHub` and `needsTrunk`. */
  connecting: number;
  /** For `needsTrunk`: the class the trunk needs, when it's past your planes' range. */
  trunkClass?: string;
};

/** Below this a connection isn't worth a line or a row. */
const MIN_CONNECTING = 0.5;

function flownMarkets(state: SimState): Set<string> {
  return new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
}

/**
 * How far a trunk idea may go: the range of one class up from your
 * biggest plane. A spoke airline on 25-seat propellers usually can't
 * reach the trunk that would make its spokes pay, and that's the reason
 * to lease the next size; two sizes up is too far ahead to plan around.
 */
function trunkRangeNm(state: SimState): number {
  const biggest = Math.max(0, ...state.aircraft.map((aircraft) => classRank(aircraft.typeCode)));
  const next = AIRCRAFT_CLASSES[Math.min(AIRCRAFT_CLASSES.length - 1, biggest + 1)];
  return Math.max(bestRangeNm(state), rangeNmFor(state, next.code));
}

/** The smallest class that reaches `distanceNm`, when your planes don't; undefined when they do. */
function classNeededFor(state: SimState, distanceNm: number): string | undefined {
  if (distanceNm <= bestRangeNm(state)) return undefined;
  return AIRCRAFT_CLASSES.find((aircraftClass) => rangeNmFor(state, aircraftClass.code) >= distanceNm)?.name;
}

/** Every airport you fly to. */
function networkAirports(state: SimState): string[] {
  const airports = new Set<string>();
  for (const leg of state.schedule) {
    airports.add(leg.origin);
    airports.add(leg.dest);
  }
  return [...airports];
}

/**
 * The `limit` biggest city pairs from `airport` to airports `include`
 * allows, each with how it could reach your network. The map passes the
 * airports it can draw.
 */
export function spokeFlowsFrom(state: SimState, airport: string, limit: number, include: (iata: string) => boolean = () => true): SpokeFlow[] {
  const markets = allAirports()
    .filter((other) => other.iata !== airport && include(other.iata))
    .map((other) => ({ other: other.iata, potential: currentPotentialDemand(state, airport, other.iata) }))
    .filter((market) => market.potential > 0)
    .sort((x, y) => y.potential - x.potential)
    .slice(0, limit);
  const flown = flownMarkets(state);
  const nonstop = nonstopMarkets(state);
  const network = networkAirports(state);
  const rangeNm = trunkRangeNm(state);

  return markets.map(({ other, potential }): SpokeFlow => {
    if (flown.has(marketKey(airport, other))) return { other, potential, kind: 'nonstop', connecting: 0 };
    let best: SpokeFlow | null = null;
    for (const hub of network) {
      if (hub === airport || hub === other) continue;
      const connecting = grownConnectingFlow(state, airport, hub, other, nonstop);
      if (connecting < MIN_CONNECTING) continue;
      const kind: SpokeFlowKind = flown.has(marketKey(hub, other)) ? 'viaHub' : 'needsTrunk';
      // A trunk is an idea only at a hub, where it would feed more than this one flow, and within reach.
      if (kind === 'needsTrunk' && (spokesOf(state, hub).size < 2 || marketDistanceNm(hub, other) > rangeNm)) continue;
      // A hub you already fly on to the far end beats one that needs a new trunk, whatever the numbers.
      const better = !best || (kind === 'viaHub' && best.kind === 'needsTrunk') || (kind === best.kind && connecting > best.connecting);
      if (better) {
        const trunkClass: string | undefined = kind === 'needsTrunk' ? classNeededFor(state, marketDistanceNm(hub, other)) : undefined;
        best = { other, potential, kind, hub, spokeFlown: flown.has(marketKey(airport, hub)), connecting, trunkClass };
      }
    }
    return best ?? { other, potential, kind: 'open', connecting: 0 };
  });
}

export type HubFeed = {
  hub: string;
  /** Connecting passengers a day once grown. */
  total: number;
  /** The far ends, biggest first. */
  parts: { other: string; passengers: number }[];
};

/**
 * What a new spoke from `airport` to each airport of yours would feed onto
 * the routes you already fly from there, biggest first. Airports it's
 * already flown to are left out: their connections are real, and shown
 * as such.
 */
export function feedViaHubs(state: SimState, airport: string): HubFeed[] {
  const nonstop = nonstopMarkets(state);
  const feeds: HubFeed[] = [];
  for (const hub of networkAirports(state)) {
    if (hub === airport) continue;
    const spokes = spokesOf(state, hub);
    if (spokes.has(airport)) continue;
    const parts = [...spokes.keys()]
      .map((other) => ({ other, passengers: grownConnectingFlow(state, airport, hub, other, nonstop) }))
      .filter((part) => part.passengers >= MIN_CONNECTING)
      .sort((x, y) => y.passengers - x.passengers);
    const total = parts.reduce((sum, part) => sum + part.passengers, 0);
    if (total >= 1) feeds.push({ hub, total, parts });
  }
  return feeds.sort((x, y) => y.total - x.total);
}

export type RouteIdea = {
  other: string;
  /** Connecting passengers a day your routes here would send on it, once grown. */
  connecting: number;
  /** The class it needs, when it's past your planes' range. */
  trunkClass?: string;
};

/**
 * Routes you don't fly from `hub` that its other routes would feed, at
 * an airport you fly two routes or more from, biggest first, to airports
 * `include` allows within trunkRangeNm(). For a hub of trunks that's the next spoke worth adding (Boston and Québec
 * City people onward to Moncton); for a hub with spokes, the trunk that
 * makes every one of them worth more (Moncton and Sydney people onward to
 * LaGuardia). Counts only the connections; the route's own local market
 * is on top.
 */
export function routesFedAt(state: SimState, hub: string, limit: number, include: (iata: string) => boolean = () => true): RouteIdea[] {
  const spokes = [...spokesOf(state, hub).keys()];
  // With one route, the only feed is its far end's people doubling back through here: no hub to build on.
  if (spokes.length < 2) return [];
  const nonstop = nonstopMarkets(state);
  const rangeNm = trunkRangeNm(state);
  const ideas: RouteIdea[] = [];
  for (const { iata: other } of allAirports()) {
    if (other === hub || spokes.includes(other) || !include(other) || marketDistanceNm(hub, other) > rangeNm) continue;
    let connecting = 0;
    for (const spoke of spokes) connecting += grownConnectingFlow(state, spoke, hub, other, nonstop);
    if (connecting >= 1) ideas.push({ other, connecting, trunkClass: classNeededFor(state, marketDistanceNm(hub, other)) });
  }
  return ideas.sort((x, y) => y.connecting - x.connecting).slice(0, limit);
}

/**
 * Connecting passengers a day a new `a`–`b` route would carry once grown:
 * `a`'s people onward from `b` to the airports you fly from there, and
 * `b`'s onward from `a`. Zero for a pair you already fly.
 */
export function newRouteConnecting(state: SimState, a: string, b: string): number {
  if (flownMarkets(state).has(marketKey(a, b))) return 0;
  const nonstop = nonstopMarkets(state);
  let total = 0;
  for (const other of spokesOf(state, b).keys()) total += grownConnectingFlow(state, a, b, other, nonstop);
  for (const other of spokesOf(state, a).keys()) total += grownConnectingFlow(state, b, a, other, nonstop);
  return total;
}
