import type { SimState } from './state';

/**
 * The cash runway: daily closing balances (`SimState.cashHistory`, the
 * last CASH_HISTORY_MAX_DAYS) projected forward in a straight line, for
 * the Runway card and warning (ui/runway.ts) and the Money view's chart.
 */
export const CASH_HISTORY_MAX_DAYS = 30;

/**
 * Called once per simulated day, from step.ts's day-rollover — at the very
 * top of that block, before any of the new day's own charges (leases,
 * slots, overhead) touch `state.cash`. That timing is what makes this
 * "yesterday's closing balance," not "today's opening one": nothing else
 * changes `state.cash` between the last minute of the day that just ended
 * and this call.
 */
export function recordDailyCashHistory(state: SimState): void {
  state.cashHistory.push(state.cash);
  if (state.cashHistory.length > CASH_HISTORY_MAX_DAYS) {
    state.cashHistory.shift();
  }
}

/**
 * How many days of the last week the always-visible runway warning looks
 * at. Shorter than the 30 days of history on purpose: the warning's
 * job is to react to what the player just changed. Averaged over a month,
 * a route cut last Tuesday would keep the alarm ringing for weeks after
 * the bleeding stopped.
 */
export const RUNWAY_WINDOW_DAYS = 7;

export type CashRunway = {
  /** Average day-over-day change in closing cash across the window. */
  dailyDelta: number;
  /** Days until Cash hits zero if that average holds — null when cash isn't falling. */
  daysLeft: number | null;
};

/**
 * "If the last week repeats, when does Cash run out?" A straight line
 * through the closing balances over RUNWAY_WINDOW_DAYS.
 * Null until there are two closing balances to draw a line through.
 */
export function cashRunway(state: SimState): CashRunway | null {
  const recent = state.cashHistory.slice(-(RUNWAY_WINDOW_DAYS + 1));
  if (recent.length < 2) return null;
  const dailyDelta = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  const daysLeft = dailyDelta < 0 && state.cash > 0 ? Math.ceil(state.cash / -dailyDelta) : null;
  return { dailyDelta, daysLeft };
}

/**
 * The airline's average daily margin over its last `days` finished days,
 * or null before the first day is done. Shown where a player commits
 * cash, so a lease is read against the trend it is added to.
 */
export function trailingDailyMargin(state: SimState, days = RUNWAY_WINDOW_DAYS): number | null {
  const recent = state.marginHistory.slice(-days);
  if (recent.length === 0) return null;
  return recent.reduce((sum, margin) => sum + margin, 0) / recent.length;
}
