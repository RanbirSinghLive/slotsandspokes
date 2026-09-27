import { money } from './format';

/**
 * The bar-building guts shared by the sidebar's "Last 7 Days" charts
 * (ui/pnlHistory.ts) and a route view's own mini history chart
 * (ui/mapMenu.ts) — same rolling-window numbers (sim/pnlHistory.ts), two
 * different places that want to show them at two different sizes with
 * two different headers, so only the bars themselves are shared here.
 *
 * Two shapes, matching the two kinds of number these charts ever show:
 * Revenue and Cost can't go negative, so `buildUnipolarBars` is a plain
 * histogram growing up from zero. Margin can go either way, so
 * `buildBipolarBars` splits each day into a profit half and a loss half
 * around one shared zero line — see its own comment for why the split is
 * computed once for the whole window rather than per day.
 */

export const WINDOW_DAYS = 7;

/** "Yesterday" for the most recent entry, "N days ago" further back — the window has no "today" in it, since today isn't finished yet. */
export function dayLabel(indexFromEnd: number): string {
  return indexFromEnd === 1 ? 'Yesterday' : `${indexFromEnd} days ago`;
}

/** Plain bars from a zero baseline, the tallest day in `shown` at full height. */
export function buildUnipolarBars(
  shown: number[],
  tooltipFor: (value: number, indexFromEnd: number) => string,
  /** The last value is today's, still running: its bar is drawn lighter. */
  lastIsLive = false,
): HTMLDivElement {
  const bars = document.createElement('div');
  bars.className = 'pnl-chart-bars';
  const max = Math.max(1, ...shown);
  shown.forEach((value, i) => {
    const bar = document.createElement('div');
    bar.className = 'pnl-chart-bar';
    if (lastIsLive && i === shown.length - 1) bar.classList.add('is-live');
    bar.style.height = `${(value / max) * 100}%`;
    bar.title = tooltipFor(value, shown.length - i);
    bars.appendChild(bar);
  });
  return bars;
}

/** A profit half and a loss half sharing one zero line, colored to say which without reading an axis. */
export function buildBipolarBars(
  shown: number[],
  tooltipFor: (value: number, indexFromEnd: number) => string,
  /** The last value is today's, still running: its bar is drawn lighter. */
  lastIsLive = false,
): HTMLDivElement {
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
    if (lastIsLive && i === shown.length - 1) cell.classList.add('is-live');

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

    cell.title = tooltipFor(value, shown.length - i);
    cell.append(profitHalf, lossHalf);
    bars.appendChild(cell);
  });

  return bars;
}

export { money };
