import { cashRunway, RUNWAY_WINDOW_DAYS } from '../../sim/forecast';
import { line, heading, lineWithInfo } from './dom';
import { money, shortMoney } from '../format';
import { chartLegend } from '../chartLegend';
import { unitEconomicsHistory } from '../../sim/unitEconomics';
import type { SimState } from '../../sim/state';
import { costWeek, flownMarkets, marginBand, marginTrend, networkMargin, routeGroups, routeMarginShare, routeWeek, type RouteGroupBy } from '../../sim/networkMargin';
import { moversLine, percentText, trendMark } from '../marginChip';
import { marginMovers } from '../../sim/marginMovers';
import { sparkline } from '../sparkline';
import { select } from '../selection';
import { setGrouping } from './routes';

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


/** The week's flying margin as a line over the last weeks, a dashed line at 0%. */
function marginChart(history: number[]): SVGSVGElement {
  const low = Math.min(0, ...history);
  const high = Math.max(0, ...history);
  const span = high - low || 1;
  const x = (i: number) => (history.length > 1 ? (i / (history.length - 1)) * CHART_WIDTH : 0);
  const y = (value: number) => CHART_HEIGHT - 4 - ((value - low) / span) * (CHART_HEIGHT - 8);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('class', 'fuel-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Flying margin, 7-day, over the last ${history.length} days`);
  const zero = document.createElementNS(SVG, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(CHART_WIDTH));
  zero.setAttribute('y1', String(y(0)));
  zero.setAttribute('y2', String(y(0)));
  zero.setAttribute('class', 'fuel-chart-usual');
  const path = document.createElementNS(SVG, 'polyline');
  path.setAttribute('points', history.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' '));
  path.setAttribute('class', 'money-chart-cash');
  svg.append(zero, path);
  return svg;
}

/** Hub, sector and region tables: each group's week, summed over its routes. */
function groupTable(state: SimState, by: RouteGroupBy): HTMLElement {
  const table = document.createElement('table');
  table.className = 'money-group-table';
  const head = document.createElement('tr');
  for (const text of [by === 'hub' ? 'Hub' : by === 'region' ? 'Region' : 'Sector', 'Routes', '$/day', 'Net', '']) {
    const th = document.createElement('th');
    th.textContent = text;
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const body = document.createElement('tbody');
  for (const group of routeGroups(state, by)) {
    const tr = document.createElement('tr');
    tr.className = 'routes-row';
    const cells = [group.name, String(group.keys.length), shortMoney(group.perDay), group.share === null ? '—' : percentText(group.share), group.previousPerDay === null ? '' : trendMark(group.perDay, group.previousPerDay)];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 3 && group.share !== null) td.classList.add(`is-${marginBand(group.share)}`);
      tr.append(td);
    });
    tr.dataset.tip = `Open ${group.name} in Routes`;
    tr.addEventListener('click', () => {
      setGrouping(by);
      select({ kind: 'routes', sort: 'margin' });
    });
    body.append(tr);
  }
  table.append(thead, body);
  return table;
}

/** The three best and three worst routes of the week, each with its line. */
function extremes(state: SimState): HTMLElement | null {
  const rows = flownMarkets(state)
    .map((market) => ({ market, week: routeWeek(state, market.key) }))
    .filter((row) => row.week.perDay !== null)
    .sort((x, y) => (y.week.perDay ?? 0) - (x.week.perDay ?? 0));
  if (rows.length < 2) return null;
  const picked = rows.length <= 6 ? rows : [...rows.slice(0, 3), ...rows.slice(-3)];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const { market, week } of picked) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const share = routeMarginShare(week);
    const name = document.createElement('span');
    name.textContent = `${market.a} – ${market.b}`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.append(sparkline(week.series, `${market.a} – ${market.b} · last 14 days`), ` ${shortMoney(week.perDay ?? 0)}/d${share === null ? '' : ` · ${percentText(share)}`}`);
    if (share !== null) detail.classList.add(`is-${marginBand(share)}`);
    row.append(name, detail);
    row.addEventListener('click', () => select({ kind: 'route', a: market.a, b: market.b }));
    list.append(row);
  }
  return list;
}

/** Cost kinds as rows with a share bar behind each; `span` is how the tooltip names the period. */
function costRows(costs: [string, number][], span: string, perDay = false): HTMLElement {
  const rows = document.createElement('div');
  rows.className = 'inspector-rows';
  const total = costs.reduce((sum, [, amount]) => sum + amount, 0);
  for (const [kind, amount] of costs) {
    const row = document.createElement('div');
    row.className = 'inspector-row cost-row';
    // Each row's share of the period's costs, drawn behind it so the shape reads at a glance.
    const share = Math.round((amount / total) * 100);
    row.style.setProperty('--share', `${share}%`);
    row.title = `${share}% of ${span}'s costs`;
    const name = document.createElement('span');
    name.textContent = COST_NAMES[kind] ?? kind;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = `${money(amount)}${perDay ? '/d' : ''}`;
    row.append(name, detail);
    rows.append(row);
  }
  return rows;
}

const COST_NAMES: Record<string, string> = {
  fuel: 'Fuel',
  blockNonFuel: 'Flying (crews, maintenance)',
  departure: 'Departure charges',
  lease: 'Leases',
  crew: 'Crews on standby',
  slots: 'Slot fees',
  maintenance: 'Checks and repairs',
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

  const margin = networkMargin(state);
  if (margin) {
    const trend = trendMark(margin.flying, margin.previousFlying);
    root.append(
      heading('Margin · 7d'),
      lineWithInfo(
        `Flying ${percentText(margin.flying)}${trend ? ` ${trend}` : ''} · all-in ${percentText(margin.allIn)} · ${shortMoney(margin.revenuePerDay)}/day revenue`,
        'Flying margin is what the routes keep of their revenue over the last 7 days: revenue less what the flights cost. All-in also takes leases, overhead and checks. The week smooths out which flights landed before midnight and when a check fell due, so two weeks compare fairly and a small airline reads like a large one. Below 0% loses money, 0–10% is thin, above is healthy.',
        `inspector-line is-${marginBand(margin.flying) === 'poor' ? 'over' : 'good'}`,
      ),
      line(
        `Upkeep ${margin.upkeepPerDay >= 0 ? '−' : '+'}${shortMoney(Math.abs(margin.upkeepPerDay))}/day · leases, overhead, checks${margin.paidShare > 0.005 ? ` · ${percentText(margin.paidShare)} paid by contracts and events` : ''}`,
        'inspector-line goal-ahead',
      ),
    );
    const movers = marginMovers(state);
    if (movers && movers.movers.length > 0) {
      root.append(
        lineWithInfo(
          moversLine(movers),
          'Profit a day over the last 7 days against the 7 before, split into the biggest movers. Flying is more or fewer seats flown at last week\'s margins; fares & loads is what each seat-mile earned; fuel rate and cost per flight are what each flight cost beyond the change in flying. Leases, slots, overhead and checks are shown as they changed. The movers add up to the full change.',
          'inspector-line goal-ahead',
        ),
      );
    }
    const costs = costWeek(state);
    if (costs) {
      root.append(
        lineWithInfo(
          `Checks and repairs ${shortMoney(costs.checksPerDay)}/day${costs.spikeDays > 0 ? ` · ${costs.spikeDays} spike day${costs.spikeDays === 1 ? '' : 's'}` : ''}`,
          'Contracted checks, engine shop visits and expedited repairs land on the day they happen, so one day can lose $10–28k that the other days do not. They are inside all-in margin and the daily bars, and kept out of the routes\' flying margin and each route\'s margin. A spike day here is one that cost more than three times the week\'s daily average.',
          'inspector-line goal-ahead',
        ),
      );
    }
    const trendLine = marginTrend(state);
    if (trendLine.length > 1) root.append(marginChart(trendLine), line(`7-day flying margin · ${trendLine.length}d · dashed 0%`, 'inspector-line goal-ahead'));
    root.append(heading('By hub'), groupTable(state, 'hub'), heading('By sector'), groupTable(state, 'sector'), heading('By region'), groupTable(state, 'region'));
    const best = extremes(state);
    if (best) root.append(heading('Best and worst routes · 7d'), best);
  }

  const units = unitEconomicsHistory(state);
  if (units.length > 1) {
    const latest = units[units.length - 1];
    root.append(
      heading('RASM / CASM'),
      lineWithInfo(
        `RASM ${latest.rasm.toFixed(2)}¢ · CASM ${latest.casm.toFixed(2)}¢ · ${units.length}d`,
        'Revenue and cost per available seat nautical mile, for each finished day. Capacity counts every seat flown, sold or not, so RASM falls when planes fly empty. CASM counts maintenance on the day it was flown, not the day a check pays it. The gap between the lines is the margin per seat nm.',
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
  if ((state.cargoRevenueTotal ?? 0) > 0) {
    root.append(
      lineWithInfo(
        `Cargo ${money(state.yesterdayCargoRevenue ?? 0)}/day · ${(state.yesterdayCargoTonnes ?? 0).toFixed(1)} t · total ${shortMoney(state.cargoRevenueTotal ?? 0)}`,
        'Freight carried in the hold the passengers\' bags leave free, paid net of handling and already inside revenue above. It earns where a flight\'s origin makes what its destination needs; the airport view lists the best matches.',
      ),
    );
  }
  if ((state.ancillaryRevenueTotal ?? 0) > 0) {
    root.append(
      lineWithInfo(
        `Fees ${money(state.yesterdayAncillaryRevenue ?? 0)}/day · total ${shortMoney(state.ancillaryRevenueTotal ?? 0)}`,
        'Bag and seat fees, already inside revenue above. Set the level on Product; they cost NPS, and rivals copy a fee over time.',
      ),
    );
  }

  const costs = Object.entries(state.todayCostByCategory)
    .filter(([, amount]) => (amount ?? 0) > 0.5)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [string, number][];
  const costsWeek = costWeek(state);
  if (costsWeek) {
    root.append(
      heading(`Costs · ${costsWeek.days}d average a day`),
      costRows(
        costsWeek.perDay.map((row) => [row.kind, row.amount] as [string, number]),
        `the last ${costsWeek.days} days`,
        true,
      ),
    );
  }
  root.append(heading('Costs today'));
  root.append(costs.length > 0 ? costRows(costs, 'today') : line('None yet'));
  return root;
}
