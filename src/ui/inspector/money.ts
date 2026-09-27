import { cashRunway, RUNWAY_WINDOW_DAYS } from '../../sim/forecast';
import type { SimState } from '../../sim/state';

/**
 * The Money view (Network › Money, opened from the Cash and Runway
 * cards): cash over the last month, how long it lasts at this week's
 * rate, a week's average day, and today's costs by kind. What the Cash
 * card's colour is summing up.
 */

function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}

function money(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

const SVG = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 300;
const CHART_HEIGHT = 90;

/** Closing cash for each day on record, with $0 drawn in when the line comes near it. */
function cashChart(history: number[]): SVGSVGElement {
  const low = Math.min(0, ...history);
  const high = Math.max(...history, 1);
  const x = (i: number) => (history.length > 1 ? (i / (history.length - 1)) * CHART_WIDTH : 0);
  const y = (value: number) => CHART_HEIGHT - ((value - low) / (high - low)) * CHART_HEIGHT;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('class', 'fuel-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Cash over the last ${history.length} days`);
  const zero = document.createElementNS(SVG, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(CHART_WIDTH));
  zero.setAttribute('y1', String(y(0)));
  zero.setAttribute('y2', String(y(0)));
  zero.setAttribute('class', 'fuel-chart-usual');
  svg.append(zero);
  if (history.length > 1) {
    const path = document.createElementNS(SVG, 'polyline');
    path.setAttribute('points', history.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' '));
    path.setAttribute('class', 'money-chart-cash');
    svg.append(path);
  }
  return svg;
}

const COST_NAMES: Record<string, string> = {
  fuel: 'Fuel',
  blockNonFuel: 'Flying (crews, maintenance)',
  departure: 'Departure charges',
  lease: 'Leases',
  crew: 'Crews on standby',
  slots: 'Slot fees',
  maintenance: 'Expedited repairs',
  overhead: 'Network overhead',
  innovations: 'Innovations',
  executives: 'Executives',
};

export function buildMoneyView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Money';
  root.append(title);

  const runway = cashRunway(state);
  const runwayText =
    runway === null
      ? 'How long it lasts shows once a full day has been flown.'
      : runway.daysLeft === null
        ? `It hasn't fallen over the last ${RUNWAY_WINDOW_DAYS} days, so it isn't running out.`
        : `At the last ${RUNWAY_WINDOW_DAYS} days' rate (${money(runway.dailyDelta)} a day) it runs out in about ${runway.daysLeft} days, and at $0 the airline is finished.`;
  root.append(line(`Cash: ${money(state.cash)}. ${runwayText}`, runway?.daysLeft ? 'inspector-line is-over' : 'inspector-line'));

  const history = state.cashHistory;
  if (history.length > 1) root.append(cashChart(history), line(`Closing cash, the last ${history.length} days. Dashed: $0.`, 'inspector-line goal-ahead'));

  const week = (values: number[]) => {
    const recent = values.slice(-7);
    return recent.length > 0 ? recent.reduce((sum, n) => sum + n, 0) / recent.length : null;
  };
  const revenue = week(state.revenueHistory);
  const cost = week(state.costHistory);
  if (revenue !== null && cost !== null) {
    root.append(
      heading('A day, on average this week'),
      line(`Revenue ${money(revenue)} · costs ${money(cost)} · margin ${money(revenue - cost)}`, revenue - cost < 0 ? 'inspector-line is-over' : 'inspector-line is-good'),
    );
  }

  const costs = Object.entries(state.todayCostByCategory)
    .filter(([, amount]) => (amount ?? 0) > 0.5)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  root.append(heading('Today so far, by kind of cost'));
  const rows = document.createElement('div');
  rows.className = 'inspector-rows';
  for (const [kind, amount] of costs) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.textContent = COST_NAMES[kind] ?? kind;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = money(amount ?? 0);
    row.append(name, detail);
    rows.append(row);
  }
  root.append(costs.length > 0 ? rows : line('Nothing spent yet today.'));
  return root;
}
