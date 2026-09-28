import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { shortMoney } from './format';
import { buildPnlCharts } from './pnlHistory';

/**
 * The P&L strip in the map's top-left corner: the last days as small bars,
 * green for a day that made money and red for one that lost it, tallest
 * for the biggest day either way, then today's running margin as a number
 * (grey until the day closes, since leases land at midnight and revenue
 * as flights land). Hovering it opens the full Revenue, Cost and Margin
 * chart, the same one the Overview shows.
 */

const stripEl = document.querySelector<HTMLDivElement>('#hud-pnl')!;

/** How many finished days the strip shows. */
const STRIP_DAYS = 10;

const cardEl = document.createElement('div');
cardEl.id = 'hud-pnl-card';
cardEl.hidden = true;
document.body.append(cardEl);

let shown = '';
let latest: SimState | null = null;

function signature(state: SimState): string {
  return `${dayIndex(state)}:${Math.round(state.todayMargin)}:${Math.round(state.todayRevenue)}`;
}

export function updateHudPnl(state: SimState): void {
  latest = state;
  const next = signature(state);
  if (next === shown) return;
  shown = next;

  const days = state.marginHistory.slice(-STRIP_DAYS);
  const biggest = Math.max(1, ...days.map((margin) => Math.abs(margin)));
  const bars = document.createElement('span');
  bars.className = 'hud-pnl-bars';
  for (const margin of days) {
    const bar = document.createElement('span');
    bar.className = margin >= 0 ? 'is-profit' : 'is-loss';
    bar.style.height = `${Math.max(12, (Math.abs(margin) / biggest) * 100)}%`;
    bars.append(bar);
  }
  const label = document.createElement('span');
  label.className = 'ops-code';
  label.textContent = 'P&L';
  const today = document.createElement('span');
  today.className = 'hud-pnl-today';
  today.textContent = `${state.todayMargin >= 0 ? '+' : ''}${shortMoney(state.todayMargin)} today`;
  stripEl.replaceChildren(label, bars, today);
  if (!cardEl.hidden) cardEl.replaceChildren(...buildPnlCharts(state));
}

stripEl.addEventListener('mouseenter', () => {
  if (!latest) return;
  cardEl.replaceChildren(...buildPnlCharts(latest));
  const rect = stripEl.getBoundingClientRect();
  cardEl.style.left = `${rect.left}px`;
  cardEl.style.top = `${rect.bottom + 8}px`;
  cardEl.hidden = false;
});
stripEl.addEventListener('mouseleave', () => {
  cardEl.hidden = true;
});
