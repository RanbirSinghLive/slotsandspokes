import { cashRunway, CHECKS_AHEAD_DAYS, committedCostPerDay, freeCash, RESERVE_DAYS, RUNWAY_WINDOW_DAYS } from '../sim/forecast';
import { flownMarkets, routeWeek } from '../sim/networkMargin';
import type { SimState } from '../sim/state';
import { money } from './pnlBars';
import { shortMoney } from './format';

/**
 * The cash runway warning: how many days until Cash, less what is already
 * owed at checks, hits zero if the last week repeats (sim/forecast.ts). Running out ends the game on the spot
 * (sim/insolvency.ts), and at 100x a fortnight passes in under half a minute, so
 * the player needs to see it coming in three escalating ways:
 *
 *   - A "Runway" row under Cash, always visible: amber inside two months,
 *     red inside one.
 *   - A row in the alert strip (ui/alerts.ts) inside two months.
 *   - Once per dip, a pop-up that pauses the game when the runway first
 *     drops inside a month, naming the routes losing most after their
 *     share of leases and slots. It re-arms only after the runway recovers
 *     past two months, so a player hovering near a month isn't nagged.
 *
 * The bands are wide on purpose: turning a losing network round takes
 * weeks (a plane handed back still costs its return, a dropped route's
 * slots are paid until they go), so a month's notice is the least that
 * still leaves room to act.
 */

/** Inside this many days: amber row and an alert-strip row. */
export const RUNWAY_WARN_DAYS = 60;
/** Inside this many days: red row, and the pause-once pop-up. */
export const RUNWAY_CRITICAL_DAYS = 30;
/** Losing routes the pop-up names. */
const POPUP_ROUTES = 3;

const rowValueEl = document.querySelector<HTMLSpanElement>('#panel-runway')!;
const rowEl = rowValueEl.closest<HTMLElement>('.stat-card')!;
const freeEl = rowEl.querySelector<HTMLElement>('.stat-trend')!;
const modalEl = document.querySelector<HTMLElement>('#runway-modal')!;
const modalDaysEl = document.querySelector<HTMLElement>('#runway-modal-days')!;
const modalRateEl = document.querySelector<HTMLElement>('#runway-modal-rate')!;
const modalOwedEl = document.querySelector<HTMLElement>('#runway-modal-owed')!;
const modalRoutesEl = document.querySelector<HTMLElement>('#runway-modal-routes')!;
document.querySelector<HTMLButtonElement>('#runway-modal-close')!.addEventListener('click', () => {
  modalEl.hidden = true;
});

/** True from the moment the pop-up fires until the runway recovers past RUNWAY_WARN_DAYS. */
let warnedThisDip = false;

/** The alert-strip line, or null when cash isn't running out within a month. */
export function runwayAlertMessage(state: SimState): string | null {
  const daysLeft = cashRunway(state)?.daysLeft ?? null;
  if (daysLeft === null || daysLeft > RUNWAY_WARN_DAYS) return null;
  return `CASH · $0 in ~${daysLeft}d at this rate`;
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
    text = 'Stable';
    title = `Cash has not fallen over the last ${RUNWAY_WINDOW_DAYS} days, so it isn't running out.`;
  } else {
    text = `~${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    title =
      (runway.dailyDelta < 0 ? `Cash fell by an average of ${money(-runway.dailyDelta)} a day over the last ${RUNWAY_WINDOW_DAYS} days. ` : '') +
      `If that keeps up, it reaches $0 in about ${daysLeft} days, and at $0 the airline is finished.`;
  }
  if (runway !== null && runway.owed > 0.5) title += ` Counts ${money(runway.owed)} already owed at checks (planes' maintenance reserves, and contract hangars for checks due within ${CHECKS_AHEAD_DAYS} days).`;
  rowValueEl.textContent = text;
  rowEl.title = title;
  // Cash left after RESERVE_DAYS of what the airline owes whether or not it flies (sim/forecast.ts).
  const free = freeCash(state);
  freeEl.textContent = `FREE ${shortMoney(free)}`;
  freeEl.title =
    `Cash less ${RESERVE_DAYS} days of daily commitments (${money(committedCostPerDay(state))}/day: leases, bases, slots, overhead, salaries, programmes). ` +
    'What can go into growth without eating the reserve.';
  freeEl.classList.toggle('runway-critical', free < 0);
  rowValueEl.classList.toggle('runway-warn', daysLeft !== null && daysLeft <= RUNWAY_WARN_DAYS && daysLeft > RUNWAY_CRITICAL_DAYS);
  rowValueEl.classList.toggle('runway-critical', daysLeft !== null && daysLeft <= RUNWAY_CRITICAL_DAYS);

  if (daysLeft === null || daysLeft > RUNWAY_WARN_DAYS) warnedThisDip = false;

  if (runway !== null && daysLeft !== null && daysLeft <= RUNWAY_CRITICAL_DAYS && !warnedThisDip) {
    warnedThisDip = true;
    modalDaysEl.textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    modalRateEl.textContent = money(Math.max(0, -runway.dailyDelta));
    modalOwedEl.textContent = runway.owed > 0.5 ? ` That counts ${money(runway.owed)} already owed at upcoming checks.` : '';
    modalRoutesEl.replaceChildren(...worstRoutes(state));
    modalEl.hidden = false;
    return true;
  }
  return false;
}

/** The routes losing most a day after their share of leases, slots and overhead, for the pop-up; each kept on one line. */
function worstRoutes(state: SimState): (string | HTMLElement)[] {
  const losing = flownMarkets(state)
    .map((market) => ({ market, perDay: routeWeek(state, market.key).perDay }))
    .filter((row): row is { market: (typeof row)['market']; perDay: number } => row.perDay !== null && row.perDay < 0)
    .sort((x, y) => x.perDay - y.perDay)
    .slice(0, POPUP_ROUTES);
  if (losing.length === 0) return ['No route loses money after its lease and slots: the loss is in the upkeep (bases, executives, overhead, checks).'];
  const parts: (string | HTMLElement)[] = ['Losing most after lease and slots: '];
  losing.forEach(({ market, perDay }, i) => {
    const route = document.createElement('span');
    route.style.whiteSpace = 'nowrap';
    route.textContent = `${market.a}–${market.b} ${shortMoney(perDay)}/day`;
    parts.push(...(i > 0 ? [' · '] : []), route);
  });
  parts.push('.');
  return parts;
}
