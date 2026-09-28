import { marketLoadFactor } from '../../sim/loadFactor';
import { formatNps, marketNps, RIVAL_NPS } from '../../sim/nps';
import { OTP_BASELINE, trailingMarketOtp } from '../../sim/routeOtp';
import { marketKey } from '../../sim/schedule';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import { select, type RouteSort } from '../selection';
import { info } from './dom';
import { linkToMap } from '../mapLink';

/**
 * The Routes view (Network › Routes, opened from the On-time, Completion,
 * Load factor and NPS cards): every route the airline flies in one table,
 * sorted by the measure the card was about, worst first, so the routes
 * dragging a headline number down are at the top. Each cell is coloured
 * by how that route is doing on it; a column header re-sorts; a row opens
 * the route.
 */

type RouteRow = {
  a: string;
  b: string;
  flights: number;
  loadFactor: number | null;
  onTime: number | null;
  completion: number | null;
  nps: number;
  margin: number | null;
};

type Rating = 'good' | 'fair' | 'poor' | null;

const COLUMNS: { sort: RouteSort; name: string; value: (row: RouteRow) => number | null; show: (row: RouteRow) => string; rate: (row: RouteRow) => Rating }[] = [
  {
    sort: 'loadFactor',
    name: 'Load',
    value: (row) => row.loadFactor,
    show: (row) => percent(row.loadFactor),
    rate: (row) => (row.loadFactor === null ? null : row.loadFactor >= 0.7 ? 'good' : row.loadFactor >= 0.5 ? 'fair' : 'poor'),
  },
  {
    sort: 'onTime',
    name: 'On-time',
    value: (row) => row.onTime,
    show: (row) => percent(row.onTime),
    rate: (row) => (row.onTime === null ? null : row.onTime >= 0.85 ? 'good' : row.onTime >= OTP_BASELINE ? 'fair' : 'poor'),
  },
  {
    sort: 'completion',
    name: 'Flown',
    value: (row) => row.completion,
    show: (row) => percent(row.completion),
    rate: (row) => (row.completion === null ? null : row.completion >= 0.98 ? 'good' : row.completion >= 0.93 ? 'fair' : 'poor'),
  },
  {
    sort: 'nps',
    name: 'NPS',
    value: (row) => row.nps,
    show: (row) => formatNps(row.nps),
    rate: (row) => (row.nps >= RIVAL_NPS + 5 ? 'good' : row.nps >= RIVAL_NPS - 5 ? 'fair' : 'poor'),
  },
  {
    sort: 'margin',
    name: 'Yesterday',
    value: (row) => row.margin,
    show: (row) => (row.margin === null ? '—' : `${row.margin < 0 ? '−' : ''}$${Math.abs(Math.round(row.margin)).toLocaleString()}`),
    rate: (row) => (row.margin === null ? null : row.margin > 0 ? 'good' : 'poor'),
  },
];

function percent(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

function routeRows(state: SimState): RouteRow[] {
  const flights = new Map<string, { a: string; b: string; legs: number }>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    const entry = flights.get(key) ?? { a: leg.origin, b: leg.dest, legs: 0 };
    entry.legs += 1;
    flights.set(key, entry);
  }
  return [...flights.values()].map(({ a, b, legs }) => {
    const reliability = trailingMarketOtp(state, a, b);
    const operated = reliability.arrived + reliability.cancelled;
    const margins = ops.marketPnlHistory(state, a, b).margin;
    return {
      a,
      b,
      flights: legs,
      loadFactor: marketLoadFactor(state, a, b).factor,
      onTime: reliability.otp,
      completion: operated > 0 ? reliability.arrived / operated : null,
      nps: marketNps(state, a, b),
      margin: margins.length > 0 ? margins[margins.length - 1] : null,
    };
  });
}

export function buildRoutesView(state: SimState, sort: RouteSort): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Routes';
  root.append(title);

  const rows = routeRows(state);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspector-line';
    empty.textContent = 'No routes yet.';
    root.append(empty);
    return root;
  }

  const column = COLUMNS.find((c) => c.sort === sort) ?? COLUMNS[0];
  // Worst first; routes with nothing to judge yet go last.
  rows.sort((x, y) => {
    const vx = column.value(x);
    const vy = column.value(y);
    if (vx === null && vy === null) return 0;
    if (vx === null) return 1;
    if (vy === null) return -1;
    return vx - vy;
  });

  const intro = document.createElement('div');
  intro.className = 'inspector-line';
  intro.textContent = `Worst ${column.name.toLowerCase()} first`;
  intro.append(' ', info('On-time, flown and load are the last 7 days; NPS about the last month. Click a heading to sort by it, or a route to open it.'));
  root.append(intro);

  const table = document.createElement('table');
  table.className = 'routes-table';
  const head = document.createElement('tr');
  const routeHead = document.createElement('th');
  routeHead.textContent = 'Route';
  const flightsHead = document.createElement('th');
  flightsHead.textContent = '/day';
  head.append(routeHead, flightsHead);
  for (const c of COLUMNS) {
    const th = document.createElement('th');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'routes-sort';
    button.classList.toggle('is-active', c.sort === column.sort);
    button.textContent = c.name;
    button.addEventListener('click', () => select({ kind: 'routes', sort: c.sort }));
    th.append(button);
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = linkToMap(document.createElement('tr'), { kind: 'route', a: row.a, b: row.b });
    tr.className = 'routes-row';
    tr.addEventListener('click', () => select({ kind: 'route', a: row.a, b: row.b }));
    const route = document.createElement('td');
    route.textContent = `${row.a} – ${row.b}`;
    const count = document.createElement('td');
    count.textContent = String(row.flights);
    tr.append(route, count);
    for (const c of COLUMNS) {
      const td = document.createElement('td');
      td.textContent = c.show(row);
      const rating = c.rate(row);
      if (rating) td.classList.add(`is-${rating}`);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  root.append(table);
  return root;
}
