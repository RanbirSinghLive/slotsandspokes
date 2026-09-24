import type { SimState } from './state';

/**
 * Week five's runway forecast (see WEEK-FIVE.md): a rolling window of
 * recent daily closing-cash balances is enough to project the current
 * trend forward, no new simulation logic beyond keeping that window
 * around — the same "UI reads what the sim already computes" principle
 * the PDEW/CAP work and the On-Time panel both already follow, just with
 * one small new field (`SimState.cashHistory`) to read from.
 */
export const CASH_HISTORY_MAX_DAYS = 30;
export const FORECAST_DAYS_AHEAD = 14;

/**
 * Called once per simulated day, from step.ts's day-rollover — at the very
 * top of that block, before any of the new day's own charges (marketing,
 * lease, loan interest) touch `state.cash`. That timing is what makes this
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

export type CashForecast = {
  /** Recent daily closing balances, oldest first — a direct copy of `state.cashHistory`. */
  history: number[];
  /** Average day-over-day change across the whole history window. */
  dailyDelta: number;
  /** Projected cash for each of the next FORECAST_DAYS_AHEAD days, starting from *today's* live cash. */
  projected: number[];
  /**
   * Days until Cash reaches zero at the current trend — null if the trend
   * isn't heading toward zero at all (flat or rising) or if there isn't
   * enough history yet to trust a slope. Deliberately *not* trying to
   * account for loans a player might take along the way (sim/loans.ts) —
   * that's a real future decision the player makes interactively, not
   * something this forecast can know in advance, so this answers "if
   * nothing changes," not "when does the game actually end."
   */
  daysUntilZero: number | null;
};

/**
 * A straight-line projection from the history window's average daily
 * delta — deliberately the simplest model that could work, same
 * "deliberately crude" spirit as every other derived number in sim/.
 * Needs at least two history points to have a slope at all; with fewer,
 * `dailyDelta` is 0 and the projection is a flat line at today's cash.
 */
export function computeCashForecast(state: SimState): CashForecast {
  const history = state.cashHistory;

  let dailyDelta = 0;
  if (history.length >= 2) {
    dailyDelta = (history[history.length - 1] - history[0]) / (history.length - 1);
  }

  const projected: number[] = [];
  let running = state.cash;
  for (let i = 0; i < FORECAST_DAYS_AHEAD; i++) {
    running += dailyDelta;
    projected.push(running);
  }

  let daysUntilZero: number | null = null;
  if (history.length >= 2 && dailyDelta < 0 && state.cash > 0) {
    daysUntilZero = Math.ceil(state.cash / -dailyDelta);
  }

  return { history, dailyDelta, projected, daysUntilZero };
}

/**
 * How many days of the last week the always-visible runway warning looks
 * at. Shorter than the forecast's 30-day window on purpose: the warning's
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
 * "If the last week repeats, when does Cash run out?" — the same
 * straight-line idea as computeCashForecast(), over RUNWAY_WINDOW_DAYS.
 * Null until there are two closing balances to draw a line through.
 */
export function cashRunway(state: SimState): CashRunway | null {
  const recent = state.cashHistory.slice(-(RUNWAY_WINDOW_DAYS + 1));
  if (recent.length < 2) return null;
  const dailyDelta = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  const daysLeft = dailyDelta < 0 && state.cash > 0 ? Math.ceil(state.cash / -dailyDelta) : null;
  return { dailyDelta, daysLeft };
}
