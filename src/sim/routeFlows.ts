import { connectingFlowsAt } from './hubs';
import { summarizeMarket } from './marketSummary';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Who a route's passengers are, and what each group earns it.
 *
 * Connecting passengers book first and take the cheapest seats
 * (sim/fareClasses.ts), and each leg sells its own ticket (they're not
 * prorated across the trip). So a flow's share of the route is what the
 * route gains from it on its own leg: the market summed twice through the
 * same `summarizeMarket()` the route view and the sim use, once with the
 * hubs' feed and once without. Without is what the local passengers earn
 * alone; the difference is the feed, split between its flows by how many
 * passengers each one offers. The seats a flow takes from higher-paying
 * local passengers count against it, so a flow can come out negative.
 */

export type RouteFlow = {
  /** The airport the passengers start from, or end at, on the far side of `hub`. */
  from: string;
  /** The end of this route they change planes at. */
  hub: string;
  /** Passengers a day carried on this route, both directions. */
  passengers: number;
  /** What those passengers add to the route's daily margin. */
  margin: number;
};

export type RouteFlows = {
  local: { passengers: number; margin: number };
  flows: RouteFlow[];
  margin: number;
};

/** Null when the route isn't flown. */
export function routeFlows(state: SimState, a: string, b: string): RouteFlows | null {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings) return null;
  const withFeed = summarizeMarket(a, b, state, settings);
  if (withFeed.freq === 0) return null;
  const alone = summarizeMarket(a, b, state, settings, new Map(), false);

  const offered: Array<{ from: string; hub: string; offered: number }> = [];
  for (const [hub, spoke] of [
    [a, b],
    [b, a],
  ]) {
    for (const flow of connectingFlowsAt(state, hub)) {
      if (flow.a === spoke) offered.push({ from: flow.b, hub, offered: flow.passengers });
      else if (flow.b === spoke) offered.push({ from: flow.a, hub, offered: flow.passengers });
    }
  }
  const totalOffered = offered.reduce((sum, flow) => sum + flow.offered, 0);
  const feedPassengers = withFeed.pax - alone.pax;
  const feedMargin = withFeed.margin - alone.margin;

  const flows = offered
    .map((flow) => ({
      from: flow.from,
      hub: flow.hub,
      passengers: totalOffered > 0 ? (feedPassengers * flow.offered) / totalOffered : 0,
      margin: totalOffered > 0 ? (feedMargin * flow.offered) / totalOffered : 0,
    }))
    .sort((x, y) => y.margin - x.margin);
  return { local: { passengers: alone.pax, margin: alone.margin }, flows, margin: withFeed.margin };
}
