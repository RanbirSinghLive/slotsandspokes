import { executiveFareEstimateMultiplier } from './executives';
import { summarizeMarket } from './marketSummary';
import { EXPENSIVE_FARE_SHARE } from './rivalResponse';
import { marketKey, recommendedFare } from './schedule';
import type { SimState } from './state';

/**
 * The revenue hill (WEEK-FOURTEEN.md): what a market makes a day across a
 * range of fares, as the airline has *learned* it, not as the game knows
 * it. Markets are learned by flying (the game never prints a market's
 * demand), so the hill is an estimate:
 *
 *   - **Dots** are the days actually flown, in the last LEARN_DAYS: the
 *     fare that day and the margin it really made.
 *   - **The band** is how unsure the airline is at each fare: wide where
 *     it hasn't flown, narrowing with every day flown near it
 *     (KNOWN_FARE_SHARE of the going rate counts as near). Days older than
 *     LEARN_DAYS drop out, so when the market moves (a rival in or out,
 *     demand growing, a shock) what was known goes stale and the band
 *     widens again. A revenue-management CCO halves it.
 *   - **The estimate** in the band is the game's own forecast
 *     (sim/marketSummary.ts at SAMPLES fares, smoothed over neighbours)
 *     plus an error as big as the uncertainty there, a smooth wave fixed
 *     for each market: right where you've flown, wrong in a steady,
 *     plausible way where you haven't. So the top of the hill is a best
 *     guess with a range, and finding it is flying near it.
 *
 * A read-out: it changes nothing. Each point also says whether a fare
 * there would invite rivals in with capacity (full and priced over
 * EXPENSIVE_FARE_SHARE of the going rate, sim/rivalResponse.ts): that's a
 * known rule, not an estimate.
 */

export type HillPoint = {
  fare: number;
  /** The airline's estimate of the market's margin a day at this fare. */
  margin: number;
  /** How far either side of it the margin could be. */
  uncertainty: number;
  /** Full and expensive: rivals answer with flights. */
  invitesRivals: boolean;
};

export type RevenueHill = {
  points: HillPoint[];
  /** The fare the estimate peaks at. */
  peak: HillPoint;
  /** The fares the top is likely at: every fare whose estimate plus half its band beats the best fare's estimate less half of its. */
  peakRange: { low: number; high: number };
  goingRate: number;
  /** Days flown in the last LEARN_DAYS: the fare and the margin really made. */
  observations: { fare: number; margin: number }[];
  /** Rivals' fares on this market, cheapest first, by airline code. */
  rivals: { code: string; fare: number }[];
};

/** Fares sampled across the hill. */
const SAMPLES = 25;
/** Days of flying the hill learns from: older ones are stale. */
export const LEARN_DAYS = 14;
/** A day flown within this share of the going rate of a fare counts as knowing that fare. */
const KNOWN_FARE_SHARE = 0.06;
/** How unsure the airline is at a fare it has never flown, as a share of the forecast's range across the hill. */
const UNKNOWN_SPREAD = 0.35;
/** The least an unknown fare's band is, a day: even a flat hill isn't known exactly. */
const MIN_SPREAD = 400;

/** A number from a market's key, the same every time: where its estimate's error wave starts. */
function phaseOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100_003;
  return (hash / 100_003) * 2 * Math.PI;
}

/** The hill from `low` to `high`, at the market's current settings except the fare. */
export function revenueHill(state: SimState, a: string, b: string, low: number, high: number): RevenueHill | null {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings || high <= low) return null;
  const goingRate = recommendedFare(a, b);

  // What the game's own forecast says at each fare, smoothed: whole
  // passengers make a thin market's curve saw.
  const connectingByDirection = new Map<string, number>();
  const fares: number[] = [];
  const raw: number[] = [];
  const invites: boolean[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const fare = Math.round(low + ((high - low) * i) / (SAMPLES - 1));
    const summary = summarizeMarket(a, b, state, { ...settings, fare }, connectingByDirection);
    fares.push(fare);
    raw.push(summary.margin);
    invites.push(summary.seatCapped && fare / goingRate > EXPENSIVE_FARE_SHARE);
  }
  const forecast = raw.map((_, i) => {
    const near = raw.slice(Math.max(0, i - 1), i + 2);
    return near.reduce((sum, m) => sum + m, 0) / near.length;
  });

  // What's been flown lately.
  const fareHistory = state.fareHistoryByMarket?.[key] ?? [];
  const revenue = state.revenueHistoryByMarket[key] ?? [];
  const cost = state.costHistoryByMarket[key] ?? [];
  const observations: { fare: number; margin: number }[] = [];
  const from = Math.max(0, fareHistory.length - LEARN_DAYS);
  for (let i = from; i < fareHistory.length; i++) {
    const offset = fareHistory.length - 1 - i;
    const r = revenue[revenue.length - 1 - offset];
    const c = cost[cost.length - 1 - offset];
    if (fareHistory[i] > 0 && r !== undefined && c !== undefined) observations.push({ fare: fareHistory[i], margin: Math.round(r - c) });
  }

  // How unsure, and the estimate's error, at each fare.
  const span = Math.max(...forecast) - Math.min(...forecast);
  const spread = Math.max(MIN_SPREAD, UNKNOWN_SPREAD * span) * executiveFareEstimateMultiplier(state);
  const near = KNOWN_FARE_SHARE * goingRate;
  const phase = phaseOf(key);
  const points: HillPoint[] = fares.map((fare, i) => {
    const known = observations.reduce((sum, o) => sum + Math.exp(-(((fare - o.fare) / near) ** 2)), 0);
    const uncertainty = spread / Math.sqrt(1 + known);
    const wave = Math.sin(2 * Math.PI * 1.6 * (fare / goingRate) + phase);
    return { fare, margin: Math.round(forecast[i] + 0.8 * uncertainty * wave), uncertainty: Math.round(uncertainty), invitesRivals: invites[i] };
  });

  const peak = points.reduce((best, point) => (point.margin > best.margin ? point : best));
  // Likely, not merely possible: half the band each side.
  const worstAtPeak = peak.margin - peak.uncertainty / 2;
  const possible = points.filter((point) => point.margin + point.uncertainty / 2 >= worstAtPeak);
  const peakRange = { low: Math.min(...possible.map((p) => p.fare)), high: Math.max(...possible.map((p) => p.fare)) };

  const rivals = state.competitorRoutes
    .filter((route) => route.dailyFrequency > 0 && ((route.origin === a && route.dest === b) || (route.origin === b && route.dest === a)))
    .map((route) => ({ code: route.code, fare: route.fare }))
    .sort((x, y) => x.fare - y.fare);
  return { points, peak, peakRange, goingRate, observations, rivals };
}
