import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { shortMoney } from './format';
import { buildPnlCharts } from './pnlHistory';
import { marginChip } from './marginChip';
import { networkMargin, smoothedMarginHistory } from '../sim/networkMargin';
import { marginMovers } from '../sim/marginMovers';
import { select } from './selection';
import { networkPassengersWeekOnWeek } from '../sim/loadFactor';

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
const STRIP_DAYS = 7;

const cardEl = document.createElement('div');
cardEl.id = 'hud-pnl-card';
cardEl.hidden = true;
document.body.append(cardEl);

let shown = '';
let latest: SimState | null = null;

function signature(state: SimState): string {
  return `${dayIndex(state)}:${Math.round(state.todayMargin)}:${Math.round(state.todayRevenue)}:${state.routeRevenueHistory?.length ?? 0}`;
}

export function updateHudPnl(state: SimState): void {
  latest = state;
  const next = signature(state);
  if (next === shown) return;
  shown = next;

  const days = smoothedMarginHistory(state).slice(-STRIP_DAYS);
  const biggest = Math.max(1, ...days.map((margin) => Math.abs(margin)));
  const bars = document.createElement('span');
  bars.className = 'hud-pnl-bars';
  bars.dataset.tip = 'Daily profit with checks and repairs spread over a week; today as it runs';
  for (const margin of days) {
    const bar = document.createElement('span');
    bar.className = margin >= 0 ? 'is-profit' : 'is-loss';
    bar.style.height = `${Math.max(12, (Math.abs(margin) / biggest) * 100)}%`;
    bars.append(bar);
  }
  const today = document.createElement('span');
  today.className = 'hud-pnl-today';
  today.dataset.tip = 'Margin so far today';
  today.textContent = `${state.todayMargin >= 0 ? '+' : ''}${shortMoney(state.todayMargin)}`;
  // The week's flying margin: the steady figure beside the day's noisy one.
  const chip = marginChip(networkMargin(state), marginMovers(state));
  chip.classList.add('hud-pnl-margin');
  chip.addEventListener('click', () => select({ kind: 'money' }));
  stripEl.replaceChildren(bars, today, chip, passengerChip(state));
  if (!cardEl.hidden) cardEl.replaceChildren(...buildPnlCharts(state));
}

/** "4.2k pax ▲12%": passengers over the last 7 days and how that moved against the 7 before, so growth shows between milestone pops. */
function passengerChip(state: SimState): HTMLElement {
  const { now: exact, before } = networkPassengersWeekOnWeek(state);
  const now = Math.round(exact);
  const chip = document.createElement('span');
  chip.className = 'hud-pax';
  const count = now >= 1000 ? `${(now / 1000).toFixed(now >= 10000 ? 0 : 1)}k` : String(now);
  const change = before && before > 0 ? (now - before) / before : null;
  const moved = change !== null && Math.abs(change) >= 0.01;
  if (moved) chip.classList.add(change! > 0 ? 'is-up' : 'is-down');
  chip.textContent = moved ? `${count} pax ${change! > 0 ? '▲' : '▼'}${Math.round(Math.abs(change!) * 100)}%` : `${count} pax`;
  chip.dataset.tip = before === null ? 'Passengers flown · last 7 days' : `Passengers flown · last 7 days · ${Math.round(before).toLocaleString('en-US')} the 7 before`;
  return chip;
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
