import { basesCostPerDay, contractCost, heavyRated } from './bases';
import { executiveSalariesPerDay } from './executives';
import { runningCostForDay } from './innovations';
import { dCheckContractCost, dCheckDueIn, heavyCheckDueIn, heavyCheckWorkMinutes, maintenanceReserve } from './mxChecks';
import { networkOverheadPerDay } from './overhead';
import { slotFeesPerDayAt } from './slots';
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
  /** Average change a day in closing cash across the window, with maintenance counted the day it is flown. */
  dailyDelta: number;
  /** Cash already owed at checks coming up (checksOwed), set against Cash. */
  owed: number;
  /** Days until Cash less what is owed hits zero if that average holds; null when cash isn't falling and covers what is owed. */
  daysLeft: number | null;
};

/** How far ahead the runway looks for checks that will charge a contract hangar. */
export const CHECKS_AHEAD_DAYS = 30;

/**
 * Cash the airline holds but already owes to maintenance: every plane's
 * reserve (each flight's maintenance slice is held back in cash and paid in
 * one go at the plane's next check, sim/mxChecks.ts), plus the contract
 * hangar fee for each C or D check due inside CHECKS_AHEAD_DAYS at a base
 * with no hangar of its own for the type. Without it the runway reads a
 * check as a surprise: cash looks fine until the day a large one lands.
 */
export function checksOwed(state: SimState): number {
  let owed = 0;
  for (const aircraft of state.aircraft) {
    owed += maintenanceReserve(aircraft);
    if (heavyRated(state, aircraft.baseAirport ?? state.homeAirport, aircraft.typeCode)) continue;
    if (heavyCheckDueIn(aircraft) <= CHECKS_AHEAD_DAYS) owed += contractCost(heavyCheckWorkMinutes(aircraft.typeCode));
    if (dCheckDueIn(aircraft) <= CHECKS_AHEAD_DAYS) owed += dCheckContractCost(aircraft.typeCode);
  }
  return owed;
}

/**
 * "If the last week repeats, when does Cash run out?" A straight line
 * through the closing balances over RUNWAY_WINDOW_DAYS, starting from Cash
 * less what is owed at checks (checksOwed). The week's slope counts
 * maintenance as it is flown, not as it is paid (sim/unitEconomics.ts), so
 * a reserve paid this week isn't counted twice, once in the slope and once
 * in what is owed.
 * Null until there are two closing balances to draw a line through.
 */
export function cashRunway(state: SimState): CashRunway | null {
  const recent = state.cashHistory.slice(-(RUNWAY_WINDOW_DAYS + 1));
  if (recent.length < 2) return null;
  const days = recent.length - 1;
  const heldBack = (state.maintenanceAccrualHistory ?? []).slice(-days).reduce((sum, amount) => sum + amount, 0);
  const dailyDelta = (recent[recent.length - 1] - recent[0] - heldBack) / days;
  const owed = checksOwed(state);
  const cover = state.cash - owed;
  const daysLeft = state.cash <= 0 ? null : cover <= 0 ? 0 : dailyDelta < 0 ? Math.ceil(cover / -dailyDelta) : null;
  return { dailyDelta, owed, daysLeft };
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

/** Days of committed cost cash is kept back for before it counts as free to spend: the Runway card's red line (ui/runway.ts), two weeks with no income. */
export const RESERVE_DAYS = 14;

/**
 * What the airline owes every day whether or not a plane flies: leases,
 * bases, slot fees, network overhead, executives' salaries and adopted
 * programmes' running costs. Standby crews are left out: they follow the
 * fleet and are small beside the rest.
 */
export function committedCostPerDay(state: SimState): number {
  const leases = state.aircraft.reduce((total, aircraft) => total + aircraft.leaseCostPerDay, 0);
  const bases = basesCostPerDay(state);
  const slots = Object.keys(state.slotsHeld).reduce((total, iata) => total + slotFeesPerDayAt(state, iata), 0);
  const programmes = runningCostForDay(state, state.revenueHistory[state.revenueHistory.length - 1] ?? 0);
  return leases + bases.crew + bases.maintenance + slots + networkOverheadPerDay(state) + executiveSalariesPerDay(state) + programmes;
}

/** Cash less RESERVE_DAYS of committed cost: what can go into growth without eating the reserve. Negative once the reserve is spent. */
export function freeCash(state: SimState, spend = 0): number {
  return state.cash - spend - RESERVE_DAYS * committedCostPerDay(state);
}
