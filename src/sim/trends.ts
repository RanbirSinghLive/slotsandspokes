import type { SimState } from './state';

/**
 * Which way the airline's headline numbers are going (WEEK-TEN.md, thread
 * 11): each over the last TREND_WINDOW_DAYS finished days against the
 * window before, for the Network panel's cards. A pure read of the daily
 * histories step.ts already keeps.
 *
 * Each measure has a dead band (`STEADY_BAND`) inside which it counts as
 * holding: a point of on-time either way is noise, not news.
 */

export const TREND_WINDOW_DAYS = 7;

export type TrendDirection = 'better' | 'steady' | 'worse';

export type Measure = {
  /** This window's value, or null with no flying to judge. */
  now: number | null;
  /** The window before, or null with too little history to compare. */
  before: number | null;
  /** Null when there's nothing to compare yet. */
  direction: TrendDirection | null;
};

export type NetworkTrends = {
  /** Closing cash: today's against TREND_WINDOW_DAYS ago. */
  cash: Measure;
  /** Share of arrivals on time. */
  onTime: Measure;
  /** Share of scheduled flights that operated. */
  completion: Measure;
  /** Passengers over seats. */
  loadFactor: Measure;
  /** The trailing NPS (sim/nps.ts). */
  nps: Measure;
};

/** How far a measure must move, either way, to count as better or worse. */
const STEADY_BAND = { cashShare: 0.01, onTime: 0.02, completion: 0.01, loadFactor: 0.02, nps: 1 };

function direction(now: number | null, before: number | null, band: number): TrendDirection | null {
  if (now === null || before === null) return null;
  if (now - before > band) return 'better';
  if (before - now > band) return 'worse';
  return 'steady';
}

/** Sum of the `back`-th window from the end of `values` (0 = the latest). */
function windowSum(values: number[], back: number): number | null {
  const end = values.length - back * TREND_WINDOW_DAYS;
  const start = end - TREND_WINDOW_DAYS;
  if (start < 0) return null;
  return values.slice(start, end).reduce((sum, n) => sum + n, 0);
}

function ratio(top: number | null, bottom: number | null): number | null {
  return top === null || bottom === null || bottom <= 0 ? null : top / bottom;
}

/** On-time and completion over one window, summed across every market's history. */
function reliability(state: SimState, back: number): { onTime: number | null; completion: number | null } {
  let arrived = 0;
  let onTime = 0;
  let cancelled = 0;
  let any = false;
  for (const history of Object.values(state.onTimeHistoryByMarket)) {
    const a = windowSum(history.arrived, back);
    if (a === null) continue;
    any = true;
    arrived += a;
    onTime += windowSum(history.onTime, back) ?? 0;
    cancelled += windowSum(history.cancelled, back) ?? 0;
  }
  if (!any) return { onTime: null, completion: null };
  return { onTime: ratio(onTime, arrived), completion: ratio(arrived, arrived + cancelled) };
}

export function networkTrends(state: SimState): NetworkTrends {
  const cashNow = state.cash;
  const cashBefore = state.cashHistory.length > TREND_WINDOW_DAYS ? state.cashHistory[state.cashHistory.length - 1 - TREND_WINDOW_DAYS] : null;
  const cashBand = Math.abs(cashBefore ?? 0) * STEADY_BAND.cashShare;

  const reliabilityNow = reliability(state, 0);
  const reliabilityBefore = reliability(state, 1);

  const load = state.loadHistory;
  const loadNow = load ? ratio(windowSum(load.passengers, 0), windowSum(load.seats, 0)) : null;
  const loadBefore = load ? ratio(windowSum(load.passengers, 1), windowSum(load.seats, 1)) : null;

  const npsHistory = state.npsHistory ?? [];
  const npsNow = npsHistory.length > 0 ? npsHistory[npsHistory.length - 1] : null;
  const npsBefore = npsHistory.length > TREND_WINDOW_DAYS ? npsHistory[npsHistory.length - 1 - TREND_WINDOW_DAYS] : null;

  return {
    cash: { now: cashNow, before: cashBefore, direction: direction(cashNow, cashBefore, cashBand) },
    onTime: { now: reliabilityNow.onTime, before: reliabilityBefore.onTime, direction: direction(reliabilityNow.onTime, reliabilityBefore.onTime, STEADY_BAND.onTime) },
    completion: {
      now: reliabilityNow.completion,
      before: reliabilityBefore.completion,
      direction: direction(reliabilityNow.completion, reliabilityBefore.completion, STEADY_BAND.completion),
    },
    loadFactor: { now: loadNow, before: loadBefore, direction: direction(loadNow, loadBefore, STEADY_BAND.loadFactor) },
    nps: { now: npsNow, before: npsBefore, direction: direction(npsNow, npsBefore, STEADY_BAND.nps) },
  };
}
