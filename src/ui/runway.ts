import { cashRunway, RUNWAY_WINDOW_DAYS } from '../sim/forecast';
import type { SimState } from '../sim/state';
import { money } from './pnlBars';

/**
 * The cash runway warning: how many days until Cash hits zero if the last
 * week repeats. Running out ends the game on the spot
 * (sim/insolvency.ts), and at 100x a fortnight passes in under half a minute, so
 * the player needs to see it coming in three escalating ways:
 *
 *   - A "Runway" row under Cash, always visible: amber inside a month,
 *     red inside two weeks.
 *   - A row in the alert strip (ui/alerts.ts) inside a month.
 *   - Once per dip, a pop-up that pauses the game when the runway first
 *     drops inside two weeks. It re-arms only after the runway recovers
 *     past a month, so a player hovering around 14 days isn't nagged.
 */

/** Inside this many days: amber row and an alert-strip row. */
export const RUNWAY_WARN_DAYS = 30;
/** Inside this many days: red row, and the pause-once pop-up. */
export const RUNWAY_CRITICAL_DAYS = 14;

const rowValueEl = document.querySelector<HTMLSpanElement>('#panel-runway')!;
const rowEl = rowValueEl.closest<HTMLElement>('.stat-card')!;
const modalEl = document.querySelector<HTMLElement>('#runway-modal')!;
const modalDaysEl = document.querySelector<HTMLElement>('#runway-modal-days')!;
const modalRateEl = document.querySelector<HTMLElement>('#runway-modal-rate')!;
document.querySelector<HTMLButtonElement>('#runway-modal-close')!.addEventListener('click', () => {
  modalEl.hidden = true;
});

/** True from the moment the pop-up fires until the runway recovers past RUNWAY_WARN_DAYS. */
let warnedThisDip = false;

/** The alert-strip line, or null when cash isn't running out within a month. */
export function runwayAlertMessage(state: SimState): string | null {
  const daysLeft = cashRunway(state)?.daysLeft ?? null;
  if (daysLeft === null || daysLeft > RUNWAY_WARN_DAYS) return null;
  return `Cash runs out in about ${daysLeft} day${daysLeft === 1 ? '' : 's'} at this rate`;
}

/**
 * Refresh the Runway row from `state`, once per rendered frame like the
 * rest of the summary. Returns true on the one frame the pop-up opens, so
 * main.ts — which owns the speed controls — knows to pause.
 */
export function updateRunway(state: SimState): boolean {
  const runway = cashRunway(state);
  const daysLeft = runway?.daysLeft ?? null;

  let text: string;
  let title: string;
  if (runway === null) {
    text = '—';
    title = 'How long your cash lasts at the current rate. Shows once a full day has been flown.';
  } else if (daysLeft === null) {
    text = 'Not shrinking';
    title = `Cash has not fallen over the last ${RUNWAY_WINDOW_DAYS} days, so it isn't running out.`;
  } else {
    text = `about ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    title =
      `Cash fell by an average of ${money(-runway.dailyDelta)} a day over the last ${RUNWAY_WINDOW_DAYS} days. ` +
      `If that keeps up, it reaches $0 in about ${daysLeft} days — and at $0 the airline is finished.`;
  }
  rowValueEl.textContent = text;
  rowEl.title = title;
  rowValueEl.classList.toggle('runway-warn', daysLeft !== null && daysLeft <= RUNWAY_WARN_DAYS && daysLeft > RUNWAY_CRITICAL_DAYS);
  rowValueEl.classList.toggle('runway-critical', daysLeft !== null && daysLeft <= RUNWAY_CRITICAL_DAYS);

  if (daysLeft === null || daysLeft > RUNWAY_WARN_DAYS) warnedThisDip = false;

  if (runway !== null && daysLeft !== null && daysLeft <= RUNWAY_CRITICAL_DAYS && !warnedThisDip) {
    warnedThisDip = true;
    modalDaysEl.textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    modalRateEl.textContent = money(-runway.dailyDelta);
    modalEl.hidden = false;
    return true;
  }
  return false;
}
