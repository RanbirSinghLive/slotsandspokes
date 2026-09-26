import { marketKey } from './schedule';
import { PNL_HISTORY_MAX_DAYS } from './pnlHistory';
import { OTP_BASELINE } from './reputation';
import type { SimState } from './state';

/**
 * Reliability per route, as a daily history rather than one lifetime
 * ratio: the share of the route's scheduled flights that operated *and*
 * arrived on time. A cancelled flight counts as a failure here — its
 * passengers were let down at least as badly as a late one's — which is
 * the "double impact" of a delay that runs into the 22:00 curfew
 * (sim/curfew.ts): it costs on-time performance, then it costs the flights
 * it cancels. The network-wide HUD On-Time stat keeps the industry
 * definition (arrivals only); Completion covers cancellations there.
 *
 * Why a history rather than one lifetime ratio? A lifetime ratio barely
 * moves once a route has flown a few hundred times, so it can't tell the
 * player whether the buffer they added last Tuesday worked. A day-by-day history can, and the same window
 * is what reliability's pull on demand (reliabilityDemandFactor, below)
 * is judged on.
 */

/** How many finished days reliability is judged over, for both the route view and demand growth. */
export const ROUTE_OTP_WINDOW_DAYS = 7;

/**
 * Fewer arrivals than this in the window and the route is treated as
 * neutral rather than judged. Same "a tiny sample is noise, not a signal"
 * reasoning as Reputation's REPUTATION_MIN_SAMPLE_FLIGHTS: two late
 * flights out of three on a route opened yesterday shouldn't start
 * shrinking its market.
 */
const MIN_SAMPLE_ARRIVALS = 5;

function pushCapped(history: number[], value: number): void {
  history.push(value);
  if (history.length > PNL_HISTORY_MAX_DAYS) history.shift();
}

/**
 * Called once per simulated day from step.ts's rollover, beside
 * recordDailyPnlHistory() and for the same reason at the same moment:
 * `todayOnTimeByMarket` still holds the finished day. Every market on the
 * schedule gets an entry, even an empty one, so "yesterday" always means
 * yesterday.
 */
export function recordDailyOnTimeHistory(state: SimState): void {
  const activeMarkets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const key of activeMarkets) {
    const today = state.todayOnTimeByMarket[key] ?? { arrived: 0, onTime: 0, cancelled: 0 };
    const history = (state.onTimeHistoryByMarket[key] ??= { arrived: [], onTime: [], cancelled: [] });
    pushCapped(history.arrived, today.arrived);
    pushCapped(history.onTime, today.onTime);
    pushCapped(history.cancelled, today.cancelled);
  }
}

export type TrailingOtp = {
  arrived: number;
  onTime: number;
  cancelled: number;
  /** onTime / (arrived + cancelled), or null when the sample is too small to judge. */
  otp: number | null;
};

/** Reliability over the last `days` finished days on this market. */
export function trailingMarketOtp(state: SimState, a: string, b: string, days = ROUTE_OTP_WINDOW_DAYS): TrailingOtp {
  const history = state.onTimeHistoryByMarket[marketKey(a, b)];
  const sum = (values: number[] | undefined) => (values ?? []).slice(-days).reduce((total, n) => total + n, 0);
  const arrived = sum(history?.arrived);
  const onTime = sum(history?.onTime);
  const cancelled = sum(history?.cancelled);
  const flights = arrived + cancelled;
  return { arrived, onTime, cancelled, otp: flights >= MIN_SAMPLE_ARRIVALS ? onTime / flights : null };
}

/**
 * How reliability scales a market's demand growth (sim/marketDemand.ts).
 * Passengers who keep getting delayed stop booking you, and word gets
 * around; passengers who don't, come back and bring friends.
 *
 *   OTP 100% → 1.5   growth runs half again as fast
 *   OTP  70% → 1.0   normal growth (Reputation's own neutral line)
 *   OTP  40% → 0     growth stalls
 *   OTP  20% → -1    the market shrinks as fast as if you'd abandoned it
 *
 * Straight lines between those points. The stall point sits well below
 * the neutral one on purpose: the starting fleet of 20-year-old aircraft
 * (sim/leasing.ts) runs at roughly 45% on-time with zero buffer, and that
 * should *slow* a new player's markets enough to notice, not start
 * shrinking them before they've learned what a turn buffer is. Negative values are applied as decay toward the
 * market's floor rather than as negative growth, so they can't overshoot.
 *
 * `null` (too few arrivals to judge) is neutral.
 */
const FACTOR_AT_PERFECT = 1.5;
const STALL_OTP = 0.4;
const FULL_REVERSE_OTP = 0.2;

export function reliabilityDemandFactor(otp: number | null): number {
  if (otp === null) return 1;
  if (otp >= OTP_BASELINE) return 1 + ((otp - OTP_BASELINE) / (1 - OTP_BASELINE)) * (FACTOR_AT_PERFECT - 1);
  if (otp >= STALL_OTP) return (otp - STALL_OTP) / (OTP_BASELINE - STALL_OTP);
  return Math.max(-1, -(STALL_OTP - otp) / (STALL_OTP - FULL_REVERSE_OTP));
}
