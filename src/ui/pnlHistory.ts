import type { SimState } from '../sim/state';

/**
 * "Last 7 Days" bar charts under the sidebar's Today figures (see
 * ui/panels.ts) — three small vertical-bar charts, Revenue/Cost/Margin,
 * one bar per finished day, reading straight from
 * SimState.revenueHistory/costHistory/marginHistory
 * (sim/pnlHistory.ts's recordDailyPnlHistory()). The Today rows above
 * answer "how did today go"; one day's numbers can't say whether the
 * network is actually improving — this is the trend a single day hides.
 *
 * Revenue and Cost are never negative, so they're a plain histogram: bars
 * grow up from a zero baseline, same shape as the dev tools' delay
 * histograms (ui/devTools.ts). Margin can go either way, so its chart
 * splits each day's cell into a profit half and a loss half around a
 * shared zero line, sized (once, from the whole window) so a network
 * that's always been profitable isn't wasting half the chart on a loss
 * zone it never uses.
 *
 * Rebuilt only when a new day has actually landed — this data changes
 * once a day (at step.ts's rollover), not every rendered frame, and
 * `updatePanel()` (ui/panels.ts) calls in here every frame same as the
 * rest of the sidebar.
 */

const WINDOW_DAYS = 7;

const containerEl = document.querySelector<HTMLDivElement>('#pnl-history')!;

function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/** "Yesterday" for the most recent entry, "N days ago" further back — the window has no "today" in it, since today isn't finished yet. */
function dayLabel(indexFromEnd: number): string {
  return indexFromEnd === 1 ? 'Yesterday' : `${indexFromEnd} days ago`;
}

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

/** Revenue and Cost: plain bars from a zero baseline, tallest day at full height. */
function buildUnipolarChart(label: string, history: number[]): HTMLDivElement {
  const shown = history.slice(-WINDOW_DAYS);
  const block = document.createElement('div');
  block.className = 'pnl-chart';
  block.append(buildHeader(label, shown[shown.length - 1]));

  const bars = document.createElement('div');
  bars.className = 'pnl-chart-bars';
  const max = Math.max(1, ...shown);
  shown.forEach((value, i) => {
    const bar = document.createElement('div');
    bar.className = 'pnl-chart-bar';
    bar.style.height = `${(value / max) * 100}%`;
    bar.title = `${dayLabel(shown.length - i)}: ${money(value)}`;
    bars.appendChild(bar);
  });

  block.appendChild(bars);
  return block;
}

/** Margin: a profit half and a loss half sharing one zero line, colored to say which without reading the axis. */
function buildMarginChart(history: number[]): HTMLDivElement {
  const shown = history.slice(-WINDOW_DAYS);
  const block = document.createElement('div');
  block.className = 'pnl-chart';
  block.append(buildHeader('Margin', shown[shown.length - 1]));

  const bars = document.createElement('div');
  bars.className = 'pnl-chart-bars pnl-chart-bars--bipolar';

  const maxPos = Math.max(0, ...shown);
  const maxNeg = Math.max(0, ...shown.map((v) => -v));
  // Every cell splits its height the same way, so the zero line lands at
  // the same spot in every one and reads as a single straight line across
  // the chart rather than a jagged one.
  const profitShare = maxPos + maxNeg > 0 ? maxPos / (maxPos + maxNeg) : 0.5;

  shown.forEach((value, i) => {
    const cell = document.createElement('div');
    cell.className = 'pnl-chart-cell';

    const profitHalf = document.createElement('div');
    profitHalf.className = 'pnl-chart-cell-half pnl-chart-cell-half--profit';
    profitHalf.style.flex = `${profitShare} 0 0`;
    const profitBar = document.createElement('div');
    profitBar.className = 'pnl-chart-bar pnl-chart-bar--positive';
    profitBar.style.height = `${value > 0 && maxPos > 0 ? (value / maxPos) * 100 : 0}%`;
    profitHalf.appendChild(profitBar);

    const lossHalf = document.createElement('div');
    lossHalf.className = 'pnl-chart-cell-half pnl-chart-cell-half--loss';
    lossHalf.style.flex = `${1 - profitShare} 0 0`;
    const lossBar = document.createElement('div');
    lossBar.className = 'pnl-chart-bar pnl-chart-bar--negative';
    lossBar.style.height = `${value < 0 && maxNeg > 0 ? (-value / maxNeg) * 100 : 0}%`;
    lossHalf.appendChild(lossBar);

    cell.title = `${dayLabel(shown.length - i)}: ${money(value)}`;
    cell.append(profitHalf, lossHalf);
    bars.appendChild(cell);
  });

  block.appendChild(bars);
  return block;
}

let lastRenderedDay = -1;

/**
 * Rebuilds the three charts if (and only if) a new day has landed since
 * the last call. Safe to call every frame — the day check makes repeat
 * calls within the same day free.
 */
export function updatePnlHistoryPanel(state: SimState): void {
  const day = Math.floor(state.simMinute / 1440);
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
    buildUnipolarChart('Revenue', state.revenueHistory),
    buildUnipolarChart('Cost', state.costHistory),
    buildMarginChart(state.marginHistory),
  );
}
