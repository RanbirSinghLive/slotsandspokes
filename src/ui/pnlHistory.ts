import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { WINDOW_DAYS, buildBipolarBars, buildUnipolarBars, dayLabel, money } from './pnlBars';

/**
 * The sidebar's "Last 7 days" bar charts (see ui/panels.ts): three small
 * vertical-bar charts, Revenue/Cost/Margin, one bar per day. The six
 * before today come from SimState.revenueHistory/costHistory/marginHistory
 * (sim/pnlHistory.ts's recordDailyPnlHistory()); the rightmost is today,
 * live, hatched and growing as flights land. Each header shows yesterday's
 * figure, the last finished day: today's is lopsided until it closes
 * (costs like leases land at midnight, revenue as flights land), so
 * heading with it made every morning read as a loss. Today's running
 * figure is in the header's and the bar's tooltips. The bars themselves (ui/pnlBars.ts) are shared
 * with a route view's own mini history chart (ui/mapMenu.ts).
 *
 * Rebuilt only when a figure a player could see has changed (a new day,
 * or a flight landing), not every frame, though `updatePanel()`
 * (ui/panels.ts) calls in here every frame.
 */

const containerEl = document.querySelector<HTMLDivElement>('#pnl-history')!;

function buildHeader(label: string, yesterday: number | undefined, today: number): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  // Before the first day has closed there's no yesterday, so today it is.
  statEl.textContent = yesterday === undefined ? `${money(today)} today` : `${money(yesterday)} yday`;
  statEl.title = `Today so far: ${money(today)}`;
  header.append(labelEl, statEl);
  return header;
}

function buildChart(label: string, history: number[], today: number, bipolar: boolean): HTMLDivElement {
  const shown = [...history.slice(-(WINDOW_DAYS - 1)), today];
  const block = document.createElement('div');
  block.className = 'pnl-chart';
  block.append(buildHeader(label, history[history.length - 1], today));

  // The last bar is today; the others count back from yesterday.
  const tooltipFor = (value: number, indexFromEnd: number) =>
    indexFromEnd === 1 ? `Today so far: ${money(value)} · still running` : `${dayLabel(indexFromEnd - 1)}: ${money(value)}`;
  block.appendChild(bipolar ? buildBipolarBars(shown, tooltipFor, true) : buildUnipolarBars(shown, tooltipFor, true));
  return block;
}

let lastSignature = '';

/** Rebuilds the three charts when today's figures or the day have changed. Safe to call every frame. */
export function updatePnlHistoryPanel(state: SimState): void {
  const signature = `${dayIndex(state)}:${Math.round(state.todayRevenue)}:${Math.round(state.todayCost)}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  containerEl.replaceChildren(
    buildChart('Revenue', state.revenueHistory, state.todayRevenue, false),
    buildChart('Cost', state.costHistory, state.todayCost, false),
    buildChart('Margin', state.marginHistory, state.todayMargin, true),
  );
}
