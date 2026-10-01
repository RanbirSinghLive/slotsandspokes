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

  // The running totals the year one report reads (sim/yearReport.ts):
  // every market that earned, cost or carried anything today.
  const totals = (state.marketTotals ??= {});
  const touched = new Set([...Object.keys(state.todayRevenueByMarket), ...Object.keys(state.todayCostByMarket), ...Object.keys(state.todayLoadByMarket ?? {})]);
  for (const key of touched) {
    const total = (totals[key] ??= { revenue: 0, cost: 0, passengers: 0 });
    total.revenue += state.todayRevenueByMarket[key] ?? 0;
    total.cost += state.todayCostByMarket[key] ?? 0;
    total.passengers += state.todayLoadByMarket?.[key]?.passengers ?? 0;
  }
}

/** A market's own margin a day over the last week, or null with less than a week flown. */
export function lastWeekMargin(state: SimState, key: string): number | null {
  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-7);
  const cost = (state.costHistoryByMarket[key] ?? []).slice(-7);
  if (revenue.length < 7) return null;
  return revenue.reduce((sum, r, i) => sum + r - cost[i], 0) / 7;
}
