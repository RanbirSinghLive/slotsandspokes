import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { WINDOW_DAYS, buildBipolarBars, buildUnipolarBars, dayLabel, money } from './pnlBars';

/**
 * "Last 7 Days" bar charts under the sidebar's Today figures (see
 * ui/panels.ts) — three small vertical-bar charts, Revenue/Cost/Margin,
 * one bar per finished day, reading straight from
 * SimState.revenueHistory/costHistory/marginHistory
 * (sim/pnlHistory.ts's recordDailyPnlHistory()). The Today rows above
 * answer "how did today go"; one day's numbers can't say whether the
 * network is actually improving — this is the trend a single day hides.
 * The bars themselves (ui/pnlBars.ts) are shared with a route card's own
 * mini history chart (ui/mapMenu.ts), which asks the same question about
 * one market instead of the whole network.
 *
 * Rebuilt only when a new day has actually landed — this data changes
 * once a day (at step.ts's rollover), not every rendered frame, and
 * `updatePanel()` (ui/panels.ts) calls in here every frame same as the
 * rest of the sidebar.
 */

const containerEl = document.querySelector<HTMLDivElement>('#pnl-history')!;

function buildHeader(label: string, latest: number | undefined): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  statEl.textContent = latest === undefined ? '' : money(latest);
  header.append(labelEl, statEl);
  return header;
}

function buildChart(label: string, history: number[], bipolar: boolean): HTMLDivElement {
  const shown = history.slice(-WINDOW_DAYS);
  const block = document.createElement('div');
  block.className = 'pnl-chart';
  block.append(buildHeader(label, shown[shown.length - 1]));

  const tooltipFor = (value: number, indexFromEnd: number) => `${dayLabel(indexFromEnd)}: ${money(value)}`;
  block.appendChild(bipolar ? buildBipolarBars(shown, tooltipFor) : buildUnipolarBars(shown, tooltipFor));
  return block;
}

let lastRenderedDay = -1;

/**
 * Rebuilds the three charts if (and only if) a new day has landed since
 * the last call. Safe to call every frame — the day check makes repeat
 * calls within the same day free.
 */
export function updatePnlHistoryPanel(state: SimState): void {
  const day = dayIndex(state);
  if (day === lastRenderedDay) return;
  lastRenderedDay = day;

  if (state.revenueHistory.length === 0) {
    const note = document.createElement('div');
    note.className = 'pnl-chart-note';
    note.textContent = 'Not enough history yet — check back after your first full day.';
    containerEl.replaceChildren(note);
    return;
  }

  containerEl.replaceChildren(
    buildChart('Revenue', state.revenueHistory, false),
    buildChart('Cost', state.costHistory, false),
    buildChart('Margin', state.marginHistory, true),
  );
}
