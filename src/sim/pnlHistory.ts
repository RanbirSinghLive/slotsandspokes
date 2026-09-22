import type { SimState } from './state';

/**
 * A rolling window of each finished day's Revenue, Cost and Margin — same
 * "UI reads what the sim already computes" shape as sim/forecast.ts's
 * cashHistory, just three numbers per day instead of one. The sidebar's
 * "Today" figures answer "how did today go"; this is what answers "is the
 * network actually getting better," which one day's numbers can't — a
 * single bad day is noise, a bad week is a trend.
 */
export const PNL_HISTORY_MAX_DAYS = 30;

function pushCapped(history: number[], value: number): void {
  history.push(value);
  if (history.length > PNL_HISTORY_MAX_DAYS) history.shift();
}

/**
 * Called once per simulated day, from step.ts's day-rollover — right
 * beside recordDailyCashHistory(), before todayRevenue/todayCost/
 * todayMargin reset for the new day. That ordering is what makes each
 * entry a *finished* day's totals rather than a partial one still being
 * added to.
 */
export function recordDailyPnlHistory(state: SimState): void {
  pushCapped(state.revenueHistory, state.todayRevenue);
  pushCapped(state.costHistory, state.todayCost);
  pushCapped(state.marginHistory, state.todayMargin);
}
