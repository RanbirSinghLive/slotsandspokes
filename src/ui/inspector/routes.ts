import { marketLoadFactor } from '../../sim/loadFactor';
import { formatNps, marketNps, RIVAL_NPS } from '../../sim/nps';
import { OTP_BASELINE, trailingMarketOtp } from '../../sim/routeOtp';
import { flightsByGauge, flightsEachWay, formatFrequency, gaugeFlightsText, marketPrasmCents, formatPrasm, perDayCount, sumGaugeFlights, type GaugeFlights } from '../../sim/routeYield';
import { fareClassPolicy, pricingSummary, seatPolicySummary } from '../../sim/pricing';
import { flownMarkets, marginBand, routeGroups, routeMarginShare, routeTags, routeWeek, type RouteGroup, type RouteGroupBy, type RouteTags, type RouteWeek, type Sector } from '../../sim/networkMargin';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import { select, type RouteSort } from '../selection';
import { priorityButton } from '../priority';
import { adopt, info, titleWithSwitch, viewSwitch } from './dom';
import { linkToMap } from '../mapLink';
import { glyph, type GlyphName } from '../glyphs';
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
  /** Flights a day the busier way, for subtotals. */
  flightsPerDay: number;
  gauges: GaugeFlights[];
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
      flightsPerDay: Math.max(...flightsEachWay(state, a, b)),
      gauges: flightsByGauge(state, a, b),
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
    if (saved === 'hub' || saved === 'sector' || saved === 'region' || saved === 'gauge' || saved === 'band') return saved;
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
  if (!tags.contract && !tags.event && !tags.new && tags.grounded.length === 0) return null;
  const wrap = document.createElement('span');
  wrap.className = 'route-tags';
  for (const plane of tags.grounded) {
    wrap.append(glyph('alert', `${plane.tail} grounded · ${plane.cabin ? 'attendants' : 'pilots'} short of the legal minimum · its flights here cancelled · hire on Crews`, 'is-bad'));
  }
  if (tags.contract) wrap.append(glyph('contract', 'Contract: pay is part of this margin'));
  if (tags.event) wrap.append(glyph('event', 'Event running: premiums are part of this margin'));
  if (tags.new) wrap.append(glyph('sprout', 'New: under 2 weeks of history, still settling'));
  return wrap;
}

/** The tip on a /day cell: the flights split by plane size, so a mixed route reads at a glance. */
function gaugeTip(gauges: GaugeFlights[], scope: string): string {
  return `${scope} · ${gauges.map(gaugeFlightsText).join(' · ')}`;
}

/** The /day cell; the dotted underline marks a route flown by more than one size of plane. */
function frequencyCell(text: string, gauges: GaugeFlights[], scope: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'routes-freq';
  td.textContent = text;
  if (gauges.length > 1) td.classList.add('is-mixed');
  if (gauges.length > 0) td.dataset.tip = gaugeTip(gauges, scope);
  return td;
}

/**
 * One cell per column summing up a set of routes: margin and revenue add
 * up, the other columns are plain averages of the routes. Shared by the
 * group headings and the total row so the two always read the same way.
 */
function subtotalCells(rows: RouteRow[], columns: (typeof COLUMNS)[number][]): HTMLTableCellElement[] {
  return columns.map((c) => {
    const td = document.createElement('td');
    if (c.sort === 'margin') {
      const known = rows.filter((r) => r.week.perDay !== null);
      const margin = known.reduce((sum, r) => sum + (r.week.perDay ?? 0), 0);
      const revenue = rows.reduce((sum, r) => sum + r.week.revenuePerDay, 0);
      td.textContent = known.length === 0 ? '—' : `${perDayText(margin)}${revenue > 0 ? ` · ${percentText(margin / revenue)}` : ''}`;
      td.classList.add('routes-margin');
      if (known.length > 0 && revenue > 0) td.classList.add(`is-${marginBand(margin / revenue)}`);
      td.dataset.tip = `Margin a day over the last 7 days, summed over ${known.length} routes with 3+ flown days · revenue ${shortMoney(revenue)}/day`;
    } else {
      const values = rows.map((r) => c.value(r)).filter((v): v is number => v !== null);
      const mean = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
      const probe = { ...rows[0], loadFactor: mean, onTime: mean, completion: mean, nps: mean ?? 0, prasmCents: mean };
      td.textContent = mean === null ? '—' : c.show(probe);
      const rating = mean === null ? null : c.rate(probe);
      if (rating) td.classList.add(`is-${rating}`);
      td.dataset.tip = 'Average of the routes, not weighted by passengers';
    }
    return td;
  });
}

/** The flights a day of a set of routes, the busier way summed, with its split by plane size. */
function subtotalFrequency(rows: RouteRow[], scope: string): HTMLTableCellElement {
  const total = rows.reduce((sum, r) => sum + r.flightsPerDay, 0);
  return frequencyCell(`${perDayCount(total)}/day`, sumGaugeFlights(rows.map((r) => r.gauges)), scope);
}

const GROUP_ICON: Record<RouteGroupBy, GlyphName> = { hub: 'hub', sector: 'flag', region: 'mapPin', gauge: 'plane', band: 'coin' };

function groupHeader(group: RouteGroup, by: RouteGroupBy, open: boolean, members: RouteRow[], columns: (typeof COLUMNS)[number][], onToggle: () => void): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'route-group-row';
  const name = document.createElement('td');
  const caret = document.createElement('span');
  caret.className = 'route-group-caret';
  caret.textContent = open ? '▾' : '▸';
  const icon = by === 'sector' && group.name === 'international' ? 'globe' : GROUP_ICON[by];
  const label = document.createElement('span');
  label.textContent = `${group.name} · ${group.keys.length}`;
  if (by === 'band') label.classList.add(`is-${{ losing: 'poor', thin: 'fair', healthy: 'good' }[group.name] ?? 'none'}`);
  name.append(caret, glyph(icon), label);
  tr.append(name, subtotalFrequency(members, group.name));
  const cells = subtotalCells(members, columns);
  const marginAt = columns.findIndex((c) => c.sort === 'margin');
  if (marginAt >= 0 && group.previousPerDay !== null) {
    const arrow = document.createElement('span');
    arrow.className = 'routes-trend';
    arrow.textContent = trendMark(group.perDay, group.previousPerDay);
    cells[marginAt].append(arrow);
    cells[marginAt].dataset.tip += ` · week before ${perDayText(group.previousPerDay)}/day`;
  }
  tr.append(...cells);
  tr.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.routes-freq') && window.matchMedia('(pointer: coarse)').matches) return;
    onToggle();
  });
  return tr;
}

/** Pinned bottom row: the same subtotals over every route. */
function totalFoot(rows: RouteRow[], columns: (typeof COLUMNS)[number][]): HTMLTableSectionElement {
  const foot = document.createElement('tfoot');
  const tr = document.createElement('tr');
  tr.className = 'routes-total';
  const name = document.createElement('td');
  name.textContent = `Σ ${rows.length}`;
  name.dataset.tip = `All ${rows.length} routes`;
  tr.append(name, subtotalFrequency(rows, 'All routes'), ...subtotalCells(rows, columns));
  foot.append(tr);
  return foot;
}

/** Whether the fare strip under the table is open; kept for the session. */
let pricesOpen = false;

/** The switch between the lenses: the sort the screen opens with picks one. */
function lensSwitch(lens: Lens): HTMLElement {
  return viewSwitch<Lens>(
    [
      { id: 'money', icon: glyph('coin'), tip: 'Money: margin, load, NPS, yield' },
      { id: 'reliability', icon: glyph('timer'), tip: 'Reliability: on-time and flown, with what delays and cancels flights' },
    ],
    lens,
    (next) => select({ kind: 'routes', sort: next === 'money' ? 'margin' : 'onTime' }),
  );
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
  root.append(titleWithSwitch('Routes', lensSwitch(lens)));

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
  intro.append(' ', info('The money lens is first; the stopwatch lens reads reliability. Margin is the average a day over the last 7 days, with the last 14 as a line (dashed = $0), the share of revenue in the tip, and an arrow against the week before. Tags: contract and event pay are inside it; a sprout is a route under 2 weeks old. On-time, flown, load and PRASM (profit per available seat-mile, in cents) are the last 7 days; flights are per direction (a dotted /day is flown by more than one size of plane: its tip splits it by size; on a phone tap it); NPS about the last month. Group by hub (the end with more routes), sector (domestic = both ends in your home country), region (where the far end is, by map position, so approximate), plane size (mixed = more than one size) or margin band; each group heading carries its subtotals and folds on a tap, and ▸ folds them all. Click a heading to sort by it, again to flip the order, or a route to open it. The bottom row and group headings total their routes: flights and margin add up, the rest are plain averages of the routes. The fare strip under the table opens the fare policy and seat split.'));
  root.append(intro);

  const chips = document.createElement('div');
  chips.className = 'routes-grouping';
  for (const [value, icon, tip] of [
    ['none', 'list', 'One list'],
    ['hub', 'hub', 'By hub: the airport each route hangs off'],
    ['sector', 'flag', 'By sector: domestic or international'],
    ['region', 'mapPin', 'By region: where the far end is (approximate)'],
    ['gauge', 'plane', 'By plane size: mixed when more than one size flies it'],
    ['band', 'coin', 'By margin: losing, thin, healthy, too new'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.append(glyph(icon));
    button.dataset.tip = tip;
    button.setAttribute('aria-label', tip);
    button.classList.toggle('is-active', grouping === value);
    button.addEventListener('click', () => {
      setGrouping(value);
      root.replaceWith(buildRoutesView(state, column.sort));
    });
    chips.append(button);
  }
  if (grouping !== 'none') {
    // One tap folds every group, or opens them all when they are all folded.
    const groupIds = routeGroups(state, grouping).map((group) => `${grouping}:${group.name}`);
    const anyOpen = groupIds.some((id) => groupOpen.get(id) ?? rows.length <= LONG_TABLE);
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'routes-fold-all';
    fold.textContent = anyOpen ? '▸' : '▾';
    fold.dataset.tip = anyOpen ? 'Fold every group' : 'Open every group';
    fold.setAttribute('aria-label', fold.dataset.tip);
    fold.addEventListener('click', () => {
      for (const id of groupIds) groupOpen.set(id, !anyOpen);
      root.replaceWith(buildRoutesView(state, column.sort));
    });
    chips.append(fold);
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
    tr.addEventListener('click', (event) => {
      // On a phone a tap on /day shows its split by plane size instead of opening the route.
      if (event.target instanceof Element && event.target.closest('.routes-freq') && window.matchMedia('(pointer: coarse)').matches) return;
      select({ kind: 'route', a: row.a, b: row.b });
    });
    const route = document.createElement('td');
    route.textContent = `${row.a} – ${row.b} `;
    route.append(priorityButton(state, row.a, row.b, () => {}));
    const tags = tagsFor(row);
    if (tags) route.append(tags);
    tr.append(route, frequencyCell(row.frequency, row.gauges, `${row.a} – ${row.b}`));
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
      const members = group.keys.map((key) => byKey.get(key)).filter((row): row is RouteRow => row !== undefined);
      tbody.append(
        groupHeader(group, grouping, open, members, columns, () => {
          groupOpen.set(id, !open);
          root.replaceWith(buildRoutesView(state, column.sort));
        }),
      );
      if (!open) continue;
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
