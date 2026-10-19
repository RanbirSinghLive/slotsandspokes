import { marketKey } from './schedule';
import { PNL_HISTORY_MAX_DAYS } from './pnlHistory';
import type { SimState } from './state';

/**
 * 70% on-time is the neutral line: a route above it grows faster, one
 * below grows slower (reliabilityDemandFactor() below), and the on-time
 * map mode colours routes against it. An old fleet's own age delays cap
 * it at about 72% even with generous turn buffers, so a well-buffered
 * old fleet sits near neutral and a newer fleet earns a real bonus. Not
 * fit to any real study.
 */
export const OTP_BASELINE = 0.7;

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
 * reasoning as any small sample: two late
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
 *   OTP  70% → 1.0   normal growth (the neutral line)
 *   OTP  40% → 0     growth stalls
 *   OTP  20% → -0.25 the market shrinks at a quarter of the abandoned rate (MAX_DECAY)
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
/**
 * The fastest a market shrinks for unreliability, as a share of the slide
 * an abandoned market gets. A thin spoke on old planes runs at 10–30%
 * on-time with no buffer; at the full rate it fell to its floor before the
 * player could learn why, which made every spoke a trap and the trunks the
 * only place to build. A quarter keeps it a loud penalty (the market still
 * shrinks, and growth is lost) that a turn buffer or a newer plane can
 * still beat.
 */
const MAX_DECAY = 0.25;

export function reliabilityDemandFactor(otp: number | null): number {
  if (otp === null) return 1;
  if (otp >= OTP_BASELINE) return 1 + ((otp - OTP_BASELINE) / (1 - OTP_BASELINE)) * (FACTOR_AT_PERFECT - 1);
  if (otp >= STALL_OTP) return (otp - STALL_OTP) / (OTP_BASELINE - STALL_OTP);
  return Math.max(-MAX_DECAY, (-(STALL_OTP - otp) / (STALL_OTP - FULL_REVERSE_OTP)) * MAX_DECAY);
}

/** The share of flights flown at which cancellations stop costing bookings: an odd weather day is forgiven. */
const COMPLETION_NEUTRAL = 0.98;
/** Bookings lost per share of flights cancelled below that: each 1% cancelled costs about 1% of passengers. */
const BOOKINGS_LOST_PER_CANCELLED_SHARE = 1;
/** The most lateness alone costs, at none on time. */
const MAX_LATENESS_BOOKING_LOSS = 0.15;
/** However bad it gets, some passengers have no other way to go. */
const RELIABILITY_BOOKING_FLOOR = 0.5;

/**
 * How many of a market's passengers still book this airline, given how it
 * has flown the market over the same window: 1 when it flies what it sells
 * and mostly on time, down to RELIABILITY_BOOKING_FLOOR. Growth
 * (reliabilityDemandFactor, above) moves the market over weeks; this is
 * the booking that happens today. Without it a route nobody else flies
 * filled the same seats at the same fare however often it cancelled,
 * because the name (sim/nps.ts) only moves passengers between airlines.
 *
 * Cancellations count most: a traveller who was stranded last week books
 * elsewhere, connects through another hub or stays home. Lateness counts
 * less: people grumble about a late airline and still fly it.
 *
 *   all flown, 70%+ on time  → 1.0
 *   1 in 10 cancelled        → about 0.92
 *   half cancelled           → 0.5 (the floor)
 *   all flown, none on time  → 0.85
 *
 * Neutral (1) on too small a sample, as for growth.
 */
export function reliabilityBookingFactor(trailing: TrailingOtp): number {
  const flights = trailing.arrived + trailing.cancelled;
  if (flights < MIN_SAMPLE_ARRIVALS) return 1;
  const completion = trailing.arrived / flights;
  const completionFactor = 1 - Math.max(0, COMPLETION_NEUTRAL - completion) * BOOKINGS_LOST_PER_CANCELLED_SHARE;
  const punctuality = trailing.arrived > 0 ? trailing.onTime / trailing.arrived : OTP_BASELINE;
  const punctualityFactor = 1 - (Math.max(0, OTP_BASELINE - punctuality) / OTP_BASELINE) * MAX_LATENESS_BOOKING_LOSS;
  return Math.max(RELIABILITY_BOOKING_FLOOR, completionFactor * punctualityFactor);
}

/** The booking factor for one market (bookingPerks(), sim/innovations.ts). */
export function marketReliabilityBookingFactor(state: SimState, a: string, b: string): number {
  return reliabilityBookingFactor(trailingMarketOtp(state, a, b));
}
