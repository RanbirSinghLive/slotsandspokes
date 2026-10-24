import { PNL_HISTORY_MAX_DAYS } from './pnlHistory';
import { legDistanceNm } from './schedule';
import type { SimState } from './state';

/**
 * RASM and CASM: revenue and cost per available seat nautical mile, the
 * airline's unit economics. Capacity is seats times distance for every
 * flight that landed, whether or not the seats sold, so RASM falls when
 * planes fly empty and CASM falls when they fly farther or fuller sectors
 * for the same cost. The Money view charts them (ui/inspector/money.ts).
 *
 * Recorded beside the P&L history: each landing adds to today's total, and
 * each finished day is copied into a history capped at PNL_HISTORY_MAX_DAYS.
 *
 * CASM counts maintenance as it is earned, not as it is paid. The cash P&L
 * holds each flight's maintenance slice in the plane's reserve and pays it
 * in one go at its next check (sim/mxChecks.ts), which would put a plane's
 * fortnight of maintenance on one day's CASM. So the slice held back is
 * added to the day it was flown and the settled reserve is taken off the
 * day it was paid, the way an airline accrues it.
 */

/** Called when a flight lands, with the seats it had. */
export function recordFlightSeatNm(state: SimState, origin: string, dest: string, seats: number): void {
  state.todaySeatNm = (state.todaySeatNm ?? 0) + seats * legDistanceNm(origin, dest);
}

/** Maintenance held back from today's cost (positive) or a reserve paid today (negative), for CASM's accrued cost. */
export function recordMaintenanceAccrual(state: SimState, amount: number): void {
  state.todayMaintenanceAccrual = (state.todayMaintenanceAccrual ?? 0) + amount;
}

/** Called once per day from step.ts's rollover, before today's totals reset. */
export function recordDailySeatNmHistory(state: SimState): void {
  const history = (state.seatNmHistory ??= []);
  history.push(state.todaySeatNm ?? 0);
  if (history.length > PNL_HISTORY_MAX_DAYS) history.shift();
  state.todaySeatNm = 0;
  const accruals = (state.maintenanceAccrualHistory ??= []);
  accruals.push(state.todayMaintenanceAccrual ?? 0);
  if (accruals.length > PNL_HISTORY_MAX_DAYS) accruals.shift();
  state.todayMaintenanceAccrual = 0;
}

export type UnitEconomicsDay = { rasm: number; casm: number };

/**
 * Each recorded day's RASM and CASM in cents per seat nm, oldest first. The
 * seat-nm history is as long as the days since it was first kept, so it is
 * lined up with the end of the revenue and cost histories, and so is the
 * accrual history (a day from before it was kept counts as cost as paid).
 * A day nothing flew has no unit figure and is left out.
 */
export function unitEconomicsHistory(state: SimState): UnitEconomicsDay[] {
  const seatNm = state.seatNmHistory ?? [];
  const accruals = state.maintenanceAccrualHistory ?? [];
  const offset = state.revenueHistory.length - seatNm.length;
  const accrualOffset = seatNm.length - accruals.length;
  const days: UnitEconomicsDay[] = [];
  seatNm.forEach((capacity, i) => {
    const revenue = state.revenueHistory[offset + i];
    const paid = state.costHistory[offset + i];
    const cost = paid === undefined ? undefined : paid + (accruals[i - accrualOffset] ?? 0);
    if (capacity <= 0 || revenue === undefined || cost === undefined) return;
    days.push({ rasm: (revenue / capacity) * 100, casm: (cost / capacity) * 100 });
  });
  return days;
}
