import { marketLoadFactor } from '../../sim/loadFactor';
import { formatNps, marketNps, RIVAL_NPS } from '../../sim/nps';
import { OTP_BASELINE, trailingMarketOtp } from '../../sim/routeOtp';
import { formatFrequency, marketYieldCents, formatYield } from '../../sim/routeYield';
import { flownMarkets, marginBand, routeGroups, routeMarginShare, routeTags, routeWeek, type RouteGroup, type RouteGroupBy, type RouteTags, type RouteWeek, type Sector } from '../../sim/networkMargin';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import { select, type RouteSort } from '../selection';
import { priorityButton } from '../priority';
import { info } from './dom';
import { linkToMap } from '../mapLink';
import { glyph } from '../glyphs';
import { percentText, trendMark } from '../marginChip';
import { shortMoney } from '../format';
import { sparkline } from '../sparkline';

/**
 * The Routes view (Network › Routes, opened from the On-time, Completion,
 * Load factor and NPS cards): every route the airline flies in one table,
 * sorted by the measure the card was about, worst first, so the routes
 * dragging a headline number down are at the top. Each cell is coloured
 * by how that route is doing on it; a column header re-sorts; a row opens
 * the route.
 */

type RouteRow = {
  key: string;
  a: string;
  b: string;
  hub: string;
  sector: Sector;
  week: RouteWeek;
  tags: RouteTags;
  frequency: string;
  yieldCents: number | null;
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
    sort: 'yield',
    name: 'Yield',
    value: (row) => row.yieldCents,
    show: (row) => formatYield(row.yieldCents),
    rate: () => null,
  },
  {
    sort: 'margin',
    name: 'Margin',
    value: (row) => row.week.perDay,
    show: (row) => (row.week.perDay === null ? '—' : shortMoney(row.week.perDay)),
    rate: (row) => {
      const share = routeMarginShare(row.week);
      return share === null ? null : marginBand(share);
    },
  },
];

/** Margin leads the table: it is the column the page is read for. */
const ORDERED_COLUMNS = [COLUMNS[COLUMNS.length - 1], ...COLUMNS.slice(0, -1)];

function percent(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

function routeRows(state: SimState): RouteRow[] {
  return flownMarkets(state).map(({ key, a, b, hub, sector }) => {
    const reliability = trailingMarketOtp(state, a, b);
    const operated = reliability.arrived + reliability.cancelled;
    return {
      key,
      a,
      b,
      hub,
      sector,
      week: routeWeek(state, key),
      tags: routeTags(state, a, b),
      frequency: formatFrequency(state, a, b),
      yieldCents: marketYieldCents(state, a, b),
      loadFactor: marketLoadFactor(state, a, b).factor,
      onTime: reliability.otp,
      completion: operated > 0 ? reliability.arrived / operated : null,
      nps: marketNps(state, a, b),
      margin: ops.marketPnlHistory(state, a, b).margin.at(-1) ?? null,
    };
  });
}

export type Grouping = 'none' | RouteGroupBy;
const GROUPING_KEY = 'airgame.routesGrouping';
/** Groups the player opened or closed by hand; the rest follow the default (closed once the table is long). */
const groupOpen = new Map<string, boolean>();
const LONG_TABLE = 12;

function loadGrouping(): Grouping {
  try {
    const saved = localStorage.getItem(GROUPING_KEY);
    if (saved === 'hub' || saved === 'sector') return saved;
  } catch {
    // Storage can be blocked; the table still works ungrouped.
  }
  return 'none';
}

let grouping: Grouping = loadGrouping();

export function setGrouping(next: Grouping): void {
  grouping = next;
  try {
    localStorage.setItem(GROUPING_KEY, next);
  } catch {
    // Not remembered; fine.
  }
}

function perDayText(perDay: number | null): string {
  return perDay === null ? '—' : `${perDay < 0 ? '' : '+'}${shortMoney(perDay)}`;
}

function marginCell(row: RouteRow): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'routes-margin';
  const { week } = row;
  const share = routeMarginShare(week);
  const tip = [
    week.perDay === null ? 'Under 3 flown days' : `${perDayText(week.perDay)}/day over the last 7 days`,
    share === null ? null : `${percentText(share)} of revenue`,
    week.previousPerDay === null ? null : `week before ${perDayText(week.previousPerDay)}/day`,
    row.margin === null ? null : `yesterday ${perDayText(row.margin)}`,
    week.paidPerDay > 0.5 ? `${shortMoney(week.paidPerDay)}/day of it paid by contracts and events` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const text = document.createElement('span');
  text.textContent = week.perDay === null ? '—' : shortMoney(week.perDay);
  if (share !== null) text.classList.add(`is-${marginBand(share)}`);
  td.append(sparkline(week.series, tip), ' ', text);
  if (week.perDay !== null && week.previousPerDay !== null) {
    const mark = trendMark(week.perDay, week.previousPerDay);
    const arrow = document.createElement('span');
    arrow.className = 'routes-trend';
    arrow.textContent = mark;
    td.append(arrow);
  }
  td.dataset.tip = tip;
  return td;
}

function tagsFor(row: RouteRow): HTMLElement | null {
  const { tags } = row;
  if (!tags.contract && !tags.event && !tags.new) return null;
  const wrap = document.createElement('span');
  wrap.className = 'route-tags';
  if (tags.contract) wrap.append(glyph('contract', 'Contract: pay is part of this margin'));
  if (tags.event) wrap.append(glyph('event', 'Event running: premiums are part of this margin'));
  if (tags.new) wrap.append(glyph('sprout', 'New: under 2 weeks of history, still settling'));
  return wrap;
}

function groupHeader(group: RouteGroup, by: RouteGroupBy, open: boolean, onToggle: () => void): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'route-group-row';
  const name = document.createElement('td');
  name.colSpan = 2;
  const caret = document.createElement('span');
  caret.className = 'route-group-caret';
  caret.textContent = open ? '▾' : '▸';
  name.append(caret, by === 'hub' ? glyph('hub') : glyph(group.name === 'domestic' ? 'flag' : 'globe'), `${group.name} · ${group.keys.length}`);
  const margin = document.createElement('td');
  const trend = group.previousPerDay === null ? '' : trendMark(group.perDay, group.previousPerDay);
  margin.textContent = `${perDayText(group.perDay)}${group.share === null ? '' : ` · ${percentText(group.share)}`} ${trend}`.trim();
  if (group.share !== null) margin.classList.add(`is-${marginBand(group.share)}`);
  margin.dataset.tip = `${group.name}: ${perDayText(group.perDay)}/day over the last 7 days, summed over its routes`;
  const rest = document.createElement('td');
  rest.colSpan = ORDERED_COLUMNS.length - 1;
  tr.append(name, margin, rest);
  tr.addEventListener('click', onToggle);
  return tr;
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
  intro.append(' ', info('Margin is the average a day over the last 7 days, with the last 14 as a line (dashed = $0), the share of revenue in the tip, and an arrow against the week before. Tags: contract and event pay are inside it; a sprout is a route under 2 weeks old. On-time, flown, load and yield (cents per passenger nautical mile) are the last 7 days; flights are per direction; NPS about the last month. Group by hub (the end with more routes) or by sector (domestic = both ends in your home country). Click a heading to sort by it, or a route to open it.'));
  root.append(intro);

  const chips = document.createElement('div');
  chips.className = 'routes-grouping';
  for (const [value, label, tip] of [
    ['none', 'All', 'One list'],
    ['hub', 'Hub', 'Grouped by the airport each route hangs off'],
    ['sector', 'Sector', 'Domestic or international'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.tip = tip;
    button.classList.toggle('is-active', grouping === value);
    button.addEventListener('click', () => {
      setGrouping(value);
      root.replaceWith(buildRoutesView(state, column.sort));
    });
    chips.append(button);
  }
  root.append(chips);

  const table = document.createElement('table');
  table.className = 'routes-table';
  const head = document.createElement('tr');
  const routeHead = document.createElement('th');
  routeHead.textContent = 'Route';
  const flightsHead = document.createElement('th');
  flightsHead.textContent = '/day';
  head.append(routeHead, flightsHead);
  for (const c of ORDERED_COLUMNS) {
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

  const renderRow = (row: RouteRow) => {
    const tr = linkToMap(document.createElement('tr'), { kind: 'route', a: row.a, b: row.b });
    tr.className = 'routes-row';
    tr.addEventListener('click', () => select({ kind: 'route', a: row.a, b: row.b }));
    const route = document.createElement('td');
    route.textContent = `${row.a} – ${row.b} `;
    route.append(priorityButton(state, row.a, row.b, () => {}));
    const tags = tagsFor(row);
    if (tags) route.append(tags);
    const count = document.createElement('td');
    count.textContent = row.frequency;
    tr.append(route, count);
    for (const c of ORDERED_COLUMNS) {
      if (c.sort === 'margin') {
        const cell = marginCell(row);
        const rating = c.rate(row);
        if (rating) cell.classList.add(`is-${rating}`);
        tr.append(cell);
        continue;
      }
      const td = document.createElement('td');
      td.textContent = c.show(row);
      const rating = c.rate(row);
      if (rating) td.classList.add(`is-${rating}`);
      tr.append(td);
    }
    tbody.append(tr);
  };

  if (grouping === 'none') {
    for (const row of rows) renderRow(row);
  } else {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const group of routeGroups(state, grouping)) {
      const id = `${grouping}:${group.name}`;
      const open = groupOpen.get(id) ?? rows.length <= LONG_TABLE;
      tbody.append(
        groupHeader(group, grouping, open, () => {
          groupOpen.set(id, !open);
          root.replaceWith(buildRoutesView(state, column.sort));
        }),
      );
      if (!open) continue;
      const members = group.keys.map((key) => byKey.get(key)).filter((row): row is RouteRow => row !== undefined);
      members.sort((x, y) => {
        const vx = column.value(x);
        const vy = column.value(y);
        if (vx === null && vy === null) return 0;
        if (vx === null) return 1;
        if (vy === null) return -1;
        return vx - vy;
      });
      for (const row of members) renderRow(row);
    }
  }
  table.append(thead, tbody);
  const scroller = document.createElement('div');
  scroller.className = 'routes-scroll';
  scroller.append(table);
  root.append(scroller);
  return root;
}
