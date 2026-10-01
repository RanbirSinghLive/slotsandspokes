import { summarizeMarket } from './marketSummary';
import { EXPENSIVE_FARE_SHARE } from './rivalResponse';
import { marketKey, recommendedFare } from './schedule';
import type { SimState } from './state';

/**
 * The revenue hill (WEEK-FOURTEEN.md, slice 1): what a market makes a day
 * across a range of fares, at today's demand, rivals and schedule, from
 * the game's own forecast (sim/marketSummary.ts, the same flightResult()
 * the day runs). Too cheap and the planes are full of passengers paying
 * little; too dear and they fly empty; in between is the top of the hill.
 * The route view draws it and the fare rides on it as a ball.
 *
 * A read-out: it changes nothing. Each point also says whether a fare
 * there would invite rivals in with capacity (full and priced over
 * EXPENSIVE_FARE_SHARE of the going rate, sim/rivalResponse.ts), so the
 * view can shade the part of the hill that won't last.
 */

export type HillPoint = {
  fare: number;
  /**
   * The market's margin a day at this fare, before its share of fixed
   * costs, smoothed over its neighbours: passengers are whole people, so
   * on a thin market each one lost or won as the fare moves is a step,
   * and the raw curve saws. The smoothed one is the trend the fare rides.
   */
  margin: number;
  /** The forecast's own margin at this fare, unsmoothed. */
  rawMargin: number;
  passengers: number;
  /** Seats, not demand, are the limit here. */
  full: boolean;
  /** Full and expensive: rivals answer with flights. */
  invitesRivals: boolean;
};

export type RevenueHill = {
  points: HillPoint[];
  /** The point with the best margin. */
  peak: HillPoint;
  goingRate: number;
  /** Rivals' fares on this market, cheapest first, by airline code. */
  rivals: { code: string; fare: number }[];
};

/** Fares sampled across the hill. */
const SAMPLES = 25;

/** The hill from `low` to `high`, at the market's current settings except the fare. */
export function revenueHill(state: SimState, a: string, b: string, low: number, high: number): RevenueHill | null {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings || high <= low) return null;
  const goingRate = recommendedFare(a, b);
  // Connecting passengers don't depend on this market's fare until they're booked, so they're asked for once.
  const connectingByDirection = new Map<string, number>();
  const points: HillPoint[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const fare = Math.round(low + ((high - low) * i) / (SAMPLES - 1));
    const summary = summarizeMarket(a, b, state, { ...settings, fare }, connectingByDirection);
    points.push({
      fare,
      margin: 0,
      rawMargin: Math.round(summary.margin),
      passengers: summary.pax,
      full: summary.seatCapped,
      invitesRivals: summary.seatCapped && fare / goingRate > EXPENSIVE_FARE_SHARE,
    });
  }
  points.forEach((point, i) => {
    const near = points.slice(Math.max(0, i - 1), i + 2);
    point.margin = Math.round(near.reduce((sum, p) => sum + p.rawMargin, 0) / near.length);
  });
  const peak = points.reduce((best, point) => (point.margin > best.margin ? point : best));
  const rivals = state.competitorRoutes
    .filter((route) => route.dailyFrequency > 0 && ((route.origin === a && route.dest === b) || (route.origin === b && route.dest === a)))
    .map((route) => ({ code: route.code, fare: route.fare }))
    .sort((x, y) => x.fare - y.fare);
  return { points, peak, goingRate, rivals };
}
