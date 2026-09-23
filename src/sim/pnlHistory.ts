import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * A rolling window of each finished day's Revenue, Cost and Margin — same
 * "UI reads what the sim already computes" shape as sim/forecast.ts's
 * cashHistory, just three numbers per day instead of one. The sidebar's
 * "Today" figures answer "how did today go"; this is what answers "is the
 * network actually getting better," which one day's numbers can't — a
 * single bad day is noise, a bad week is a trend. The same window is also
 * kept per market (see the per-market section below), so a route's own
 * card can answer the same question about just that route.
 */
export const PNL_HISTORY_MAX_DAYS = 30;

function pushCapped(history: number[], value: number): void {
  history.push(value);
  if (history.length > PNL_HISTORY_MAX_DAYS) history.shift();
}

/**
 * Called once per simulated day, from step.ts's day-rollover — right
 * beside recordDailyCashHistory(), before todayRevenue/todayCost/
 * todayMargin (and their per-market equivalents) reset for the new day.
 * That ordering is what makes each entry a *finished* day's totals rather
 * than a partial one still being added to.
 */
export function recordDailyPnlHistory(state: SimState): void {
  pushCapped(state.revenueHistory, state.todayRevenue);
  pushCapped(state.costHistory, state.todayCost);
  pushCapped(state.marginHistory, state.todayMargin);

  // Every market currently in the schedule gets an entry, even a zero
  // one — a route that flew nothing today (every flight cancelled, or it
  // was only just added) still needs "yesterday" to mean yesterday, not
  // "the last day this route actually flew."
  const activeMarkets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const key of activeMarkets) {
    state.revenueHistoryByMarket[key] ??= [];
    state.costHistoryByMarket[key] ??= [];
    pushCapped(state.revenueHistoryByMarket[key], state.todayRevenueByMarket[key] ?? 0);
    pushCapped(state.costHistoryByMarket[key], state.todayCostByMarket[key] ?? 0);
  }
}
