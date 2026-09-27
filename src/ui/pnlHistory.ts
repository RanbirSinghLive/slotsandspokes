import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { WINDOW_DAYS, buildBipolarBars, buildUnipolarBars, dayLabel, money } from './pnlBars';

/**
 * The sidebar's "Last 7 days" bar charts (see ui/panels.ts): three small
 * vertical-bar charts, Revenue/Cost/Margin, one bar per day. The six
 * before today come from SimState.revenueHistory/costHistory/marginHistory
 * (sim/pnlHistory.ts's recordDailyPnlHistory()); the rightmost is today,
 * live, drawn lighter and growing as flights land, and each header shows
 * today's figure. So one glance gives both how today is going and whether
 * the network is improving. The bars themselves (ui/pnlBars.ts) are shared
 * with a route view's own mini history chart (ui/mapMenu.ts).
 *
 * Rebuilt only when a figure a player could see has changed (a new day,
 * or a flight landing), not every frame, though `updatePanel()`
 * (ui/panels.ts) calls in here every frame.
 */

const containerEl = document.querySelector<HTMLDivElement>('#pnl-history')!;

function buildHeader(label: string, today: number): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  statEl.textContent = `${money(today)} today`;
  header.append(labelEl, statEl);
  return header;
}

function buildChart(label: string, history: number[], today: number, bipolar: boolean): HTMLDivElement {
  const shown = [...history.slice(-(WINDOW_DAYS - 1)), today];
  const block = document.createElement('div');
  block.className = 'pnl-chart';
  block.append(buildHeader(label, today));

  // The last bar is today; the others count back from yesterday.
  const tooltipFor = (value: number, indexFromEnd: number) =>
    indexFromEnd === 1 ? `Today so far: ${money(value)}` : `${dayLabel(indexFromEnd - 1)}: ${money(value)}`;
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
