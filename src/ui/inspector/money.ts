import { cashRunway, RUNWAY_WINDOW_DAYS } from '../../sim/forecast';
import { line, heading, lineWithInfo } from './dom';
import { money } from '../format';
import { chartLegend } from '../chartLegend';
import { unitEconomicsHistory } from '../../sim/unitEconomics';
import type { SimState } from '../../sim/state';

/**
 * The Money view (Network › Money, opened from the Cash and Runway
 * cards): cash over the last month, how long it lasts at this week's
 * rate, a week's average day, and today's costs by kind. What the Cash
 * card's colour is summing up.
 */

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

const RASM_COLOR = '#7ed6a8';
const CASM_COLOR = '#ff9f6b';

/** RASM and CASM on one scale, so the gap between the lines is the margin per seat nm. */
function unitChart(days: { rasm: number; casm: number }[]): SVGSVGElement {
  const all = days.flatMap((day) => [day.rasm, day.casm]);
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = high - low || 1;
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * CHART_WIDTH : 0);
  const y = (value: number) => CHART_HEIGHT - ((value - low) / span) * (CHART_HEIGHT - 8) - 4;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('class', 'fuel-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `RASM and CASM over the last ${days.length} days`);
  for (const [key, color] of [['rasm', RASM_COLOR], ['casm', CASM_COLOR]] as const) {
    const path = document.createElementNS(SVG, 'polyline');
    path.setAttribute('points', days.map((day, i) => `${x(i).toFixed(1)},${y(day[key]).toFixed(1)}`).join(' '));
    path.setAttribute('class', 'money-chart-unit');
    path.setAttribute('stroke', color);
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
    runway === null ? '' : runway.daysLeft === null ? ' · runway stable' : ` · ${money(runway.dailyDelta)}/day · $0 in ~${runway.daysLeft}d`;
  root.append(
    lineWithInfo(
      `Cash ${money(state.cash)}${runwayText}`,
      `Runway: how long cash lasts at the last ${RUNWAY_WINDOW_DAYS} days' rate, shown once a full day has been flown. At $0 the airline is finished.`,
      runway?.daysLeft ? 'inspector-line is-over' : 'inspector-line',
    ),
  );

  const history = state.cashHistory;
  if (history.length > 1) root.append(cashChart(history), line(`Closing cash · ${history.length}d · dashed $0`, 'inspector-line goal-ahead'));

  const units = unitEconomicsHistory(state);
  if (units.length > 1) {
    const latest = units[units.length - 1];
    root.append(
      heading('RASM / CASM'),
      lineWithInfo(
        `RASM ${latest.rasm.toFixed(2)}¢ · CASM ${latest.casm.toFixed(2)}¢ · ${units.length}d`,
        'Revenue and cost per available seat nautical mile, for each finished day. Capacity counts every seat flown, sold or not, so RASM falls when planes fly empty. The gap between the lines is the margin per seat nm.',
        latest.rasm < latest.casm ? 'inspector-line is-over' : 'inspector-line is-good',
      ),
      unitChart(units),
      chartLegend([
        { mark: 'line', color: RASM_COLOR, label: 'RASM' },
        { mark: 'line', color: CASM_COLOR, label: 'CASM' },
      ]),
    );
  }

  const week = (values: number[]) => {
    const recent = values.slice(-7);
    return recent.length > 0 ? recent.reduce((sum, n) => sum + n, 0) / recent.length : null;
  };
  const revenue = week(state.revenueHistory);
  const cost = week(state.costHistory);
  if (revenue !== null && cost !== null) {
    root.append(
      heading('Daily average · 7d'),
      line(`Rev ${money(revenue)} · cost ${money(cost)} · margin ${money(revenue - cost)}`, revenue - cost < 0 ? 'inspector-line is-over' : 'inspector-line is-good'),
    );
  }

  const costs = Object.entries(state.todayCostByCategory)
    .filter(([, amount]) => (amount ?? 0) > 0.5)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  root.append(heading('Costs today'));
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
  root.append(costs.length > 0 ? rows : line('None yet'));
  return root;
}
