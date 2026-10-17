import { marketLoadFactor } from '../../sim/loadFactor';
import { formatNps, marketNps, RIVAL_NPS } from '../../sim/nps';
import { OTP_BASELINE, trailingMarketOtp } from '../../sim/routeOtp';
import { formatFrequency, marketPrasmCents, formatPrasm } from '../../sim/routeYield';
import { fareClassPolicy, pricingSummary, seatPolicySummary } from '../../sim/pricing';
import { flownMarkets, marginBand, routeGroups, routeMarginShare, routeTags, routeWeek, type RouteGroup, type RouteGroupBy, type RouteTags, type RouteWeek, type Sector } from '../../sim/networkMargin';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import { select, type RouteSort } from '../selection';
import { priorityButton } from '../priority';
import { adopt, info } from './dom';
import { linkToMap } from '../mapLink';
import { glyph } from '../glyphs';
import { onTimeColor } from '../../render/mapmodes';
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
  prasmCents: number | null;
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
    sort: 'prasm',
    name: 'PRASM',
    value: (row) => row.prasmCents,
    show: (row) => formatPrasm(row.prasmCents),
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

/**
 * Two lenses on the same routes. Money reads what the routes earn, with
 * margin leading since it is the column the page is read for; Reliability
 * reads how they run. The sort the screen was opened with picks the lens, so
 * the On-time and Completion cards on the HUD land in Reliability.
 */
type Lens = 'money' | 'reliability';
const LENS_SORTS: Record<Lens, RouteSort[]> = {
  money: ['margin', 'loadFactor', 'nps', 'prasm'],
  reliability: ['onTime', 'completion'],
};

function lensOf(sort: RouteSort): Lens {
  return LENS_SORTS.reliability.includes(sort) ? 'reliability' : 'money';
}

function columnsOf(lens: Lens) {
  return LENS_SORTS[lens].map((sort) => COLUMNS.find((c) => c.sort === sort)!);
}

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
      prasmCents: marketPrasmCents(state, a, b),
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
    if (saved === 'hub' || saved === 'sector' || saved === 'region') return saved;
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

/** True once the player flips the active column to best first; kept for the session. */
let bestFirst = false;

/** Worst first (or best first); routes with nothing to judge yet always go last. */
function byColumn(column: (typeof COLUMNS)[number]) {
  return (x: RouteRow, y: RouteRow): number => {
    const vx = column.value(x);
    const vy = column.value(y);
    if (vx === null && vy === null) return 0;
    if (vx === null) return 1;
    if (vy === null) return -1;
    return bestFirst ? vy - vx : vx - vy;
  };
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
    week.previousRevenuePerDay === null || week.previousCostPerDay === null
      ? null
      : `vs week before: revenue ${perDayText(week.revenuePerDay - week.previousRevenuePerDay)} · cost ${perDayText(-(week.costPerDay - week.previousCostPerDay))}`,
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

function groupHeader(group: RouteGroup, by: RouteGroupBy, open: boolean, lens: Lens, columnCount: number, onToggle: () => void): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'route-group-row';
  const name = document.createElement('td');
  name.colSpan = 2;
  const caret = document.createElement('span');
  caret.className = 'route-group-caret';
  caret.textContent = open ? '▾' : '▸';
  name.append(caret, by === 'hub' ? glyph('hub') : by === 'region' ? glyph('mapPin') : glyph(group.name === 'domestic' ? 'flag' : 'globe'), `${group.name} · ${group.keys.length}`);
  if (lens === 'money') {
    const margin = document.createElement('td');
    const trend = group.previousPerDay === null ? '' : trendMark(group.perDay, group.previousPerDay);
    margin.textContent = `${perDayText(group.perDay)}${group.share === null ? '' : ` · ${percentText(group.share)}`} ${trend}`.trim();
    if (group.share !== null) margin.classList.add(`is-${marginBand(group.share)}`);
    margin.dataset.tip = `${group.name}: ${perDayText(group.perDay)}/day over the last 7 days, summed over its routes`;
    tr.append(name, margin);
    const rest = document.createElement('td');
    rest.colSpan = Math.max(1, columnCount - 1);
    tr.append(rest);
  } else {
    const rest = document.createElement('td');
    rest.colSpan = columnCount;
    tr.append(name, rest);
  }
  tr.addEventListener('click', onToggle);
  return tr;
}

/** Pinned bottom row: margin and revenue add up over every route; the other columns are plain averages. */
function totalFoot(rows: RouteRow[], columns: (typeof COLUMNS)[number][]): HTMLTableSectionElement {
  const foot = document.createElement('tfoot');
  const tr = document.createElement('tr');
  tr.className = 'routes-total';
  const name = document.createElement('td');
  name.textContent = `Σ ${rows.length}`;
  name.dataset.tip = `All ${rows.length} routes`;
  tr.append(name, document.createElement('td'));
  for (const c of columns) {
    const td = document.createElement('td');
    if (c.sort === 'margin') {
      const known = rows.filter((r) => r.week.perDay !== null);
      const margin = known.reduce((sum, r) => sum + (r.week.perDay ?? 0), 0);
      const revenue = rows.reduce((sum, r) => sum + r.week.revenuePerDay, 0);
      td.textContent = known.length === 0 ? '—' : `${perDayText(margin)}${revenue > 0 ? ` · ${percentText(margin / revenue)}` : ''}`;
      td.classList.add('routes-margin');
      td.dataset.tip = `Margin a day over the last 7 days, summed over ${known.length} routes with 3+ flown days · revenue ${shortMoney(revenue)}/day`;
    } else {
      const values = rows.map((r) => c.value(r)).filter((v): v is number => v !== null);
      const mean = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
      const probe = { ...rows[0], loadFactor: mean, onTime: mean, completion: mean, nps: mean ?? 0, prasmCents: mean };
      td.textContent = mean === null ? '—' : c.show(probe);
      td.dataset.tip = 'Average of the routes, not weighted by passengers';
    }
    tr.append(td);
  }
  foot.append(tr);
  return foot;
}

/** Whether the fare strip under the table is open; kept for the session. */
let pricesOpen = false;

/** The two-button switch between the lenses: icons only, names in tips. */
function lensSwitch(lens: Lens): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'routes-lens';
  for (const [value, icon, tip, sort] of [
    ['money', 'coin', 'Money: margin, load, NPS, yield', 'margin'],
    ['reliability', 'timer', 'Reliability: on-time and flown, with what delays and cancels flights', 'onTime'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tip = tip;
    button.setAttribute('aria-label', tip);
    button.classList.toggle('is-active', lens === value);
    button.append(glyph(icon));
    button.addEventListener('click', () => {
      if (lens !== value) select({ kind: 'routes', sort });
    });
    wrap.append(button);
  }
  return wrap;
}

/** Last 7 days across every route: arrivals on time, flights flown, flights cancelled. */
function reliabilityTiles(state: SimState, rows: RouteRow[]): HTMLElement {
  let arrived = 0;
  let onTime = 0;
  let cancelled = 0;
  for (const row of rows) {
    const week = trailingMarketOtp(state, row.a, row.b);
    arrived += week.arrived;
    onTime += week.onTime;
    cancelled += week.cancelled;
  }
  const tiles = document.createElement('div');
  tiles.className = 'reliability-tiles';
  const tile = (label: string, value: string, colour: string | null, tip: string) => {
    const el = document.createElement('div');
    el.className = 'reliability-tile';
    el.dataset.tip = tip;
    const name = document.createElement('small');
    name.textContent = label;
    const number = document.createElement('strong');
    number.textContent = value;
    if (colour) number.style.color = colour;
    el.append(name, number);
    return el;
  };
  const otp = arrived > 0 ? onTime / arrived : null;
  const flown = arrived + cancelled > 0 ? arrived / (arrived + cancelled) : null;
  tiles.append(
    tile('ON-TIME', percent(otp), otp === null ? null : onTimeColor(otp), 'Arrivals on time, last 7 days, all routes'),
    tile('FLOWN', percent(flown), null, 'Scheduled flights that operated, last 7 days'),
    tile('CNX', String(cancelled), cancelled > 0 ? '#ff8080' : null, 'Flights cancelled, last 7 days'),
  );
  return tiles;
}

/**
 * Fare policy and seat policy, folded under the table to one line: level,
 * the seat split as a mini bar, and how many routes are off policy. Tapping
 * it opens the hill and the seat bar in place.
 */
function pricesStrip(state: SimState, rebuild: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'prices-strip';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'prices-strip-head';
  head.dataset.tip = 'Fare policy and seat split for every route not priced by hand';
  const { stance, hand } = pricingSummary(state);
  const split = fareClassPolicy(state);
  const mini = document.createElement('span');
  mini.className = 'seat-mini';
  for (const [share, colour] of [
    [split.saverShare, '#5ed6c8'],
    [split.flexShare, '#8a93a6'],
    [Math.max(0, 1 - split.saverShare - split.flexShare), '#ffd166'],
  ] as const) {
    const piece = document.createElement('i');
    piece.style.width = `${Math.round(share * 100)}%`;
    piece.style.background = colour;
    mini.append(piece);
  }
  const off = stance + hand;
  head.append(glyph('coin'), ` ${Math.round(state.farePolicyMultiplier * 100)}%`, mini);
  if (off > 0 || seatPolicySummary(state).byHand > 0) {
    const note = document.createElement('span');
    note.className = 'routes-trend';
    note.textContent = `${off} off policy`;
    head.append(note);
  }
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = pricesOpen ? '⌃' : '⌄';
  head.append(caret);
  head.addEventListener('click', () => {
    pricesOpen = !pricesOpen;
    rebuild();
  });
  wrap.append(head);
  if (pricesOpen) {
    const body = document.createElement('div');
    body.className = 'prices-strip-body';
    body.append(adopt('fare-policy-section'));
    wrap.append(body);
  }
  return wrap;
}

export function buildRoutesView(state: SimState, sort: RouteSort): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const lens = lensOf(sort);
  const title = document.createElement('h3');
  title.className = 'inspector-title routes-title';
  title.append('Routes', lensSwitch(lens));
  root.append(title);

  const rows = routeRows(state);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspector-line';
    empty.textContent = 'No routes yet.';
    root.append(empty);
    return root;
  }

  const columns = columnsOf(lens);
  const column = columns.find((c) => c.sort === sort) ?? columns[0];
  rows.sort(byColumn(column));

  if (lens === 'reliability') root.append(reliabilityTiles(state, rows), adopt('reliability-section'));

  const intro = document.createElement('div');
  intro.className = 'inspector-line';
  intro.textContent = `${bestFirst ? 'Best' : 'Worst'} ${column.name.toLowerCase()} first`;
  intro.append(' ', info('The money lens is first; the stopwatch lens reads reliability. Margin is the average a day over the last 7 days, with the last 14 as a line (dashed = $0), the share of revenue in the tip, and an arrow against the week before. Tags: contract and event pay are inside it; a sprout is a route under 2 weeks old. On-time, flown, load and PRASM (profit per available seat-mile, in cents) are the last 7 days; flights are per direction; NPS about the last month. Group by hub (the end with more routes), by sector (domestic = both ends in your home country) or by region (where the far end is, by map position, so approximate). Click a heading to sort by it, again to flip the order, or a route to open it. The bottom row totals the routes: margin and revenue add up, the rest are plain averages of the routes. The fare strip under the table opens the fare policy and seat split.'));
  root.append(intro);

  const chips = document.createElement('div');
  chips.className = 'routes-grouping';
  for (const [value, label, tip] of [
    ['none', 'All', 'One list'],
    ['hub', 'Hub', 'Grouped by the airport each route hangs off'],
    ['sector', 'Sector', 'Domestic or international'],
    ['region', 'Region', "Where the far end is, by map position (approximate)"],
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
  routeHead.dataset.tip = '● route priority: tap the dot to cycle ● normal, ★ keep, ▽ expendable';
  const flightsHead = document.createElement('th');
  flightsHead.textContent = '/day';
  head.append(routeHead, flightsHead);
  for (const c of columns) {
    const th = document.createElement('th');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'routes-sort';
    button.classList.toggle('is-active', c.sort === column.sort);
    button.textContent = c.sort === column.sort ? `${c.name} ${bestFirst ? '▼' : '▲'}` : c.name;
    button.addEventListener('click', () => {
      if (c.sort === column.sort) {
        bestFirst = !bestFirst;
        root.replaceWith(buildRoutesView(state, column.sort));
      } else {
        bestFirst = false;
        select({ kind: 'routes', sort: c.sort });
      }
    });
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
    for (const c of columns) {
      if (c.sort === 'margin') {
        const cell = marginCell(row);
        const rating = c.rate(row);
        if (rating) cell.classList.add(`is-${rating}`);
        tr.append(cell);
        continue;
      }
      const td = document.createElement('td');
      const rating = c.rate(row);
      if (c.sort === 'onTime' && row.onTime !== null) {
        const mark = document.createElement('i');
        mark.className = 'routes-bar';
        mark.style.width = `${Math.max(2, Math.round(row.onTime * 30))}px`;
        td.append(mark);
      }
      td.append(c.show(row));
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
        groupHeader(group, grouping, open, lens, columns.length, () => {
          groupOpen.set(id, !open);
          root.replaceWith(buildRoutesView(state, column.sort));
        }),
      );
      if (!open) continue;
      const members = group.keys.map((key) => byKey.get(key)).filter((row): row is RouteRow => row !== undefined);
      members.sort(byColumn(column));
      for (const row of members) renderRow(row);
    }
  }
  table.append(thead, tbody, totalFoot(rows, columns));
  const scroller = document.createElement('div');
  scroller.className = 'routes-scroll';
  scroller.append(table);
  root.append(scroller);
  if (lens === 'money') root.append(pricesStrip(state, () => root.replaceWith(buildRoutesView(state, column.sort))));
  return root;
}
