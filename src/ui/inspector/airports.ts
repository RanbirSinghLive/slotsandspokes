import { airportLoad, dailyDeparturesAt, airportLevel } from '../../sim/airports';
import { hasCrewBase, hasHeavyBase, hasLineBase } from '../../sim/bases';
import { heritagePairs, slotFeesPerDayAt, slotsHeld } from '../../sim/slots';
import { airportDemandSize, sizeRank, type Size } from '../../sim/marketSize';
import type { SimState } from '../../sim/state';
import { unmetDemandByAirport } from '../../sim/unmetDemand';
import { airports } from '../../render/airports';
import { stationReadout, stationTier } from '../../sim/stations';
import { CAUSE_STYLE, TIER_GLYPH, minutesText, stationUpgradeButton } from './station';
import { select } from '../selection';
import { linkToMap } from '../mapLink';
import { glyph, pips, type GlyphName } from '../glyphs';
import { airportWatch, movementShareAt, shareTrend, type WatchItem } from '../../sim/airportWatch';
import { airportHours } from '../../sim/hours';
import { planHub, MAX_RECOMMENDED_LOAD } from '../../sim/hubPlanner';
import { spokesOf } from '../../sim/hubs';
import { HUB_STYLES } from '../../sim/hubStyle';
import { MOAT_RAMP_DAYS, moatDays } from '../../sim/stations';
import { dayIndex } from '../../sim/clock';
import { shortMoney } from '../format';
import { openHubPlanner } from '../hubPlanner';
import { armRouteBuilderAt } from '../routeBuilder';
import { confirmHubStyle } from '../hubStyleConfirm';
import { hourStrip, planHubButton } from './airport';
import { line, titleWithSwitch, viewSwitch } from './dom';

/**
 * The Airports screen (ui/inspector/inspector.ts), in three views on one
 * switch:
 *   - Watch: only the fields that want a call now (sim/airportWatch.ts),
 *     each with its one problem and, where there is one, the button that
 *     fixes it. Its count lights the rail.
 *   - Hubs: every field with two routes or more, its day by the hour and
 *     the three hub styles side by side, each with what it gains in
 *     connections and costs in peak load and ground time.
 *   - Share: every airport you can see, as a table you can sort: your
 *     share of the field and which way it is going, slots and tenure,
 *     delays, where passengers are waiting.
 * Every row opens that airport's view.
 */

type Row = {
  iata: string;
  name: string;
  departures: number;
  load: number;
  slotPairs: number;
  slotFees: number;
  waiting: number;
  /** Bases here (sim/bases.ts): 2 for a maintenance base, 1 for a crew base, both added. */
  bases: number;
  /** Minutes a departure from here is delayed, on average (sim/stations.ts); -1 before any departure so it sorts last. */
  delay: number;
  /** The handler glyph and the leading cause, shown beside the delay. */
  delayText: string;
  /** Your share of the field's movements, 0 to 1; -1 where nobody flies, so it sorts last. */
  share: number;
  /** Points of share gained over the last week; null before there are two days. */
  trend: number | null;
  heritage: number;
};

type Column = { key: keyof Row; label: string; title: string; format: (row: Row) => string; numeric: boolean };

const COLUMNS: Column[] = [
  { key: 'iata', label: 'Airport', title: 'Airport code', format: (row) => row.iata, numeric: false },
  {
    key: 'departures',
    label: 'Dep/day',
    title: 'Your departures a day, and the level that makes you here',
    format: (row) => (row.departures > 0 ? `${row.departures} ${airportLevel(row.departures)}` : '—'),
    numeric: true,
  },
  {
    key: 'share',
    label: 'Share',
    title: 'Your share of every airline\'s takeoffs and landings here, and which way it went this week',
    format: (row) => (row.share < 0 ? '—' : `${Math.round(row.share * 100)}%`),
    numeric: true,
  },
  { key: 'load', label: 'Load', title: 'How full the field is at peak, every airline counted', format: (row) => `${Math.round(row.load * 100)}%`, numeric: true },
  {
    key: 'slotFees',
    label: 'Slots',
    title: 'Slot pairs you hold here (★ heritage: held long enough to be cheaper, and to make rivals\' slots here dearer), and what they cost a day',
    format: (row) => (row.slotPairs > 0 ? `${row.slotPairs} · $${row.slotFees.toLocaleString()}` : '—'),
    numeric: true,
  },
  {
    key: 'bases',
    label: 'Base',
    title: 'Your bases here: crew (where planes are based) and mtc (where a night is a line check)',
    format: (row) => [row.bases & 1 ? 'crew' : '', row.bases & 2 ? 'mtc' : ''].filter(Boolean).join(' · ') || '—',
    numeric: true,
  },
  {
    key: 'delay',
    label: 'Delay',
    title: 'Minutes a departure from here is delayed, on average over the last week, with the biggest cause. The circle is who handles the ground work: open for a contract handler, half for your own staff, full for hub-grade',
    format: (row) => row.delayText,
    numeric: true,
  },
  {
    key: 'waiting',
    label: 'Waiting',
    title: 'How many people want to fly from here that you are not carrying, in words',
    format: (row) => SIZE_BY_RANK[row.waiting],
    numeric: true,
  },
];

const namesByIata = new Map(airports.map((airport) => [airport.iata, airport.name]));
const SIZE_BY_RANK: Size[] = ['Tiny', 'Small', 'Medium', 'Large', 'Huge'];

// How the table is sorted and filtered: the player's choice, kept while
// they move around the inspector, not saved.
let sortKey: keyof Row = 'departures';
let sortDescending = true;
let servedOnly = true;

function buildRows(state: SimState): Row[] {
  const unmet = unmetDemandByAirport(state);
  return state.knownAirports.map((iata) => ({
    iata,
    name: namesByIata.get(iata) ?? iata,
    departures: dailyDeparturesAt(state, iata),
    load: airportLoad(state, iata),
    slotPairs: slotsHeld(state, iata),
    slotFees: slotFeesPerDayAt(state, iata),
    // Sorted by size, not by the hidden number (sim/marketSize.ts).
    waiting: sizeRank(airportDemandSize(unmet.get(iata)?.latent ?? 0)),
    bases: (hasCrewBase(state, iata) ? 1 : 0) + (hasLineBase(state, iata) || hasHeavyBase(state, iata) ? 2 : 0),
    ...delayCells(state, iata),
    share: movementShareAt(state, iata) ?? -1,
    trend: shareTrend(state, iata),
    heritage: heritagePairs(state, iata),
  }));
}

function delayCells(state: SimState, iata: string): Pick<Row, 'delay' | 'delayText'> {
  const readout = stationReadout(state, iata);
  const glyph = TIER_GLYPH[stationTier(state, iata)];
  if (!readout) return { delay: -1, delayText: '—' };
  const cause = readout.topCause ? ` ${CAUSE_STYLE[readout.topCause].code}` : '';
  return { delay: readout.totalPerDeparture, delayText: `${glyph} ${minutesText(readout.totalPerDeparture)}${cause}` };
}

const LEVEL_PIPS: Record<string, number> = { Outstation: 1, 'Focus city': 2, Base: 3, Hub: 4 };

/** Departures a day, then pips for the field's level: outstation, focus city, base, hub. */
function departureCell(row: Row): (Node | string)[] {
  if (row.departures === 0) return ['—'];
  const level = airportLevel(row.departures);
  return [`${row.departures} `, pips(LEVEL_PIPS[level] ?? 1, 4, level, 'level')];
}

/** The peak load as a fill bar that goes red once the field is full. */
function loadCell(row: Row): (Node | string)[] {
  const bar = document.createElement('span');
  bar.className = 'load-bar';
  bar.classList.toggle('is-over', row.load >= 1);
  bar.dataset.tip = `${Math.round(row.load * 100)}% of the field's peak room used, every airline counted`;
  const fill = document.createElement('i');
  fill.style.width = `${Math.min(100, Math.round(row.load * 100))}%`;
  bar.append(fill);
  return [`${Math.round(row.load * 100)}% `, bar];
}

/** A people glyph for a crew base, a wrench for a maintenance base. */
function baseCell(row: Row): (Node | string)[] {
  const marks: Node[] = [];
  if (row.bases & 1) marks.push(glyph('people', 'Crew base: crews live here and planes can be based here', 'is-crew'));
  if (row.bases & 2) marks.push(glyph('wrench', 'Maintenance base: a night here is a line check', 'is-mtc'));
  return marks.length > 0 ? marks : ['—'];
}

/** Points of share a week has to move before it gets an arrow: smaller is noise from one flight more or less. */
const TREND_MIN = 0.02;

/** Your share as a split bar (yours teal, rivals' grey), with ▲/▼ for the week's move. */
function shareCell(row: Row): (Node | string)[] {
  if (row.share < 0) return ['—'];
  const pct = Math.round(row.share * 100);
  const bar = document.createElement('span');
  bar.className = 'load-bar share-bar';
  bar.dataset.tip = `${pct}% of the field's movements are yours, ${100 - pct}% rivals'`;
  const fill = document.createElement('i');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  const cell: (Node | string)[] = [`${pct}% `, bar];
  if (row.trend !== null && Math.abs(row.trend) >= TREND_MIN) {
    const arrow = document.createElement('span');
    arrow.className = row.trend > 0 ? 'share-trend is-up' : 'share-trend is-down';
    const points = Math.round(Math.abs(row.trend) * 100);
    arrow.textContent = row.trend > 0 ? ` ▲${points}` : ` ▼${points}`;
    arrow.dataset.tip = `${row.trend > 0 ? '+' : '−'}${points} pts of the field this week`;
    cell.push(arrow);
  }
  return cell;
}

/** Slot pairs and their cost a day, heritage pairs as ★N. */
function slotCell(row: Row): (Node | string)[] {
  if (row.slotPairs === 0) return ['—'];
  const cell: (Node | string)[] = [`${row.slotPairs} · $${row.slotFees.toLocaleString()}`];
  if (row.heritage > 0) {
    const star = document.createElement('span');
    star.className = 'slot-heritage';
    star.textContent = ` ★${row.heritage}`;
    star.dataset.tip = `${row.heritage} heritage pair${row.heritage === 1 ? '' : 's'}: cheaper, and they make rivals' slots here dearer. A pair given back starts its clock again`;
    cell.push(star);
  }
  return cell;
}

/** Unserved demand as five pips, Tiny to Huge. */
function waitingCell(row: Row): (Node | string)[] {
  return [pips(row.waiting + 1, 5, `${SIZE_BY_RANK[row.waiting]} · people here that you are not carrying`, 'waiting')];
}

function compare(a: Row, b: Row): number {
  const x = a[sortKey];
  const y = b[sortKey];
  const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  // Ties fall back to the code, so the order never depends on anything else.
  return (sortDescending ? -order : order) || a.iata.localeCompare(b.iata);
}

type AirportsView = 'watch' | 'hubs' | 'share';
const VIEW_KEY = 'slotsandspokes-airports-view';

// Remembered in the browser so the screen opens the way it was left; a
// blocked localStorage (private window) just means the default each time.
function readView(): AirportsView {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === 'hubs' || stored === 'share' ? stored : 'watch';
  } catch {
    return 'watch';
  }
}

let view = readView();

function setView(next: AirportsView): void {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}

/**
 * The watch list, worked out again only when something it reads has
 * moved: the day (the station ledger and the shares roll at midnight),
 * the schedule, the rivals, a station or a hub style. The rail asks for
 * it twice a second, and valuing every hub is too slow for that.
 */
let watchCache: { key: string; items: WatchItem[] } | null = null;

export function watchItems(state: SimState): WatchItem[] {
  const key = [
    dayIndex(state),
    state.schedule.length,
    state.schedule.reduce((sum, leg) => sum + leg.departMinute, 0),
    state.competitorRoutes.length,
    JSON.stringify(state.stationTiers ?? {}),
    JSON.stringify(state.stationUpgrades ?? {}),
    JSON.stringify(state.hubStyles),
    state.knownAirports.length,
  ].join('|');
  if (watchCache?.key !== key) watchCache = { key, items: airportWatch(state) };
  return watchCache.items;
}

/** Build the screen. `changed` rebuilds the inspector, for a new view, sort or filter, or after an action. */
export function buildAirportsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const watch = watchItems(state);
  const views = viewSwitch<AirportsView>(
    [
      { id: 'watch', icon: glyph('alert'), tip: 'Watch: fields that want a call now, with the fix', badge: watch.length || undefined },
      { id: 'hubs', icon: glyph('hub'), tip: 'Hubs: each hub\'s day by the hour, and what each hub style gains and costs' },
      { id: 'share', icon: glyph('pie'), tip: 'Share: every field, your share and its trend, slots, delays, waiting passengers' },
    ],
    view,
    (next) => {
      setView(next);
      changed();
    },
  );
  root.append(titleWithSwitch('Airports', views));
  if (view === 'watch') root.append(...watchView(state, watch, changed));
  else if (view === 'hubs') root.append(...hubsView(state, changed));
  else root.append(...shareView(state, changed));
  return root;
}

const WATCH_GLYPH: Record<WatchItem['kind'], GlyphName> = { peak: 'timer', hub: 'hub', ground: 'bags', moat: 'shield', rival: 'flag', feed: 'sprout' };

const WATCH_TIP: Record<WatchItem['kind'], string> = {
  peak: 'Busiest hour nearly full, every airline counted: congestion delays grow and a new flight may not fit. Move a departure in the Gantt, or bank fewer waves here',
  hub: 'The hub planner finds this much a day in hub style or one more frequency here',
  ground: 'Ground handling costs each departure here this many minutes. A better station cuts it',
  moat: 'Your station here is under its departures floor, so its hub moat (extra room before congestion) is draining. Add flights or it lapses',
  rival: `Rival routes opened here this week`,
  feed: 'A route from here that your other routes here would feed, connecting passengers a day once grown',
};

function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function watchText(item: WatchItem): string {
  switch (item.kind) {
    case 'peak':
      return `Peak ${Math.round(item.load * 100)}% · ${hourText(item.hour)}`;
    case 'hub':
      return `~${shortMoney(item.missedPerDay)}/day missed`;
    case 'ground':
      return `GND ${item.minutes.toFixed(1)} min/dep`;
    case 'moat':
      return `Moat ${item.departures}/${item.floor} dep · ${item.daysLeft}d left`;
    case 'rival':
      return `${item.airlines.join(' ')} · +${item.routes} new`;
    case 'feed':
      return `→ ${item.other} +${Math.round(item.connecting)} cnx/day`;
  }
}

function smallButton(text: string, tip: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = text;
  button.dataset.tip = tip;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** The button that acts on a watch item, where the screen has one; the row itself always opens the airport. */
function watchAction(state: SimState, item: WatchItem, changed: () => void): HTMLButtonElement | null {
  switch (item.kind) {
    case 'ground': {
      const button = stationUpgradeButton(state, item.iata, changed);
      button?.addEventListener('click', (event) => event.stopPropagation());
      return button;
    }
    case 'hub':
      return smallButton('Plan ›', 'Open the hub planner: hub style and the frequency worth adding', () => openHubPlanner(state, item.iata, changed));
    case 'peak':
      return smallButton('Gantt ›', 'Open the Gantt to move a departure out of the peak', () => select({ kind: 'fleet' }));
    case 'rival':
      return smallButton('Rival ›', `Open ${item.airlines[0]}`, () => select({ kind: 'rival', code: item.airlines[0] }));
    case 'feed': {
      const hub = airports.find((airport) => airport.iata === item.iata);
      return hub ? smallButton('+ Route', `Draw a route from ${item.iata}: tap ${item.other} on the map`, () => armRouteBuilderAt(hub)) : null;
    }
    case 'moat':
      return null;
  }
}

function watchView(state: SimState, items: WatchItem[], changed: () => void): HTMLElement[] {
  if (state.schedule.length === 0) return [line('None served · tap an airport on the map to start')];
  if (items.length === 0) return [line('All fields steady', 'inspector-line goal-ahead')];
  const list = document.createElement('div');
  list.className = 'inspector-rows watch-list';
  for (const item of items) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: item.iata });
    row.className = 'watch-row';
    row.classList.toggle('is-bad', item.severity === 'bad');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.title = namesByIata.get(item.iata) ?? item.iata;
    const mark = glyph(WATCH_GLYPH[item.kind], WATCH_TIP[item.kind], `watch-${item.kind}`);
    const code = document.createElement('span');
    code.className = 'watch-code';
    code.textContent = item.iata;
    const text = document.createElement('span');
    text.className = 'watch-text';
    text.textContent = watchText(item);
    row.append(mark, code, text);
    const action = watchAction(state, item, changed);
    if (action) {
      action.classList.add('watch-action');
      row.append(action);
    }
    row.addEventListener('click', () => select({ kind: 'airport', iata: item.iata }));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') select({ kind: 'airport', iata: item.iata });
    });
    list.append(row);
  }
  return [list];
}

/** Every field with two routes or more, most connecting passengers first. */
function hubsView(state: SimState, changed: () => void): HTMLElement[] {
  const hubs = [...new Set(state.schedule.flatMap((leg) => [leg.origin, leg.dest]))]
    .filter((iata) => spokesOf(state, iata).size >= 2)
    .map((iata) => planHub(state, iata))
    .sort((a, b) => b.connecting - a.connecting || a.hub.localeCompare(b.hub));
  if (hubs.length === 0) return [line('No hub yet · fly two routes from one field')];
  return hubs.map((plan) => {
    const card = document.createElement('div');
    card.className = 'hub-card';
    const head = linkToMap(document.createElement('button'), { kind: 'airport', iata: plan.hub });
    head.type = 'button';
    head.className = 'inspector-row hub-card-head';
    const name = document.createElement('span');
    name.textContent = plan.hub;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = `${HUB_STYLES[plan.style].name} · ${Math.round(plan.connecting)} cnx/day · ${plan.spokes.length} spokes`;
    head.append(name, detail);
    head.addEventListener('click', () => select({ kind: 'airport', iata: plan.hub }));
    card.append(head);

    const tier = stationTier(state, plan.hub);
    if (tier !== 'contract') {
      const days = moatDays(state, plan.hub);
      const moat = document.createElement('div');
      moat.className = 'inspector-line hub-moat';
      moat.append(`${TIER_GLYPH[tier]} moat `, pips(Math.round((days / MOAT_RAMP_DAYS) * 6), 6, `Hub moat ${days}/${MOAT_RAMP_DAYS} days: extra room before congestion, earned by holding the station's departures floor`, 'moat'));
      card.append(moat);
    }
    card.append(hourStrip(airportHours(state, plan.hub)));

    // The styles side by side: what each would connect, how full it would make the peak, and the ground time it asks of every arrival.
    const styles = document.createElement('div');
    styles.className = 'hub-style-row';
    const current = plan.styles.find((preview) => preview.style === plan.style);
    for (const preview of plan.styles) {
      const spec = HUB_STYLES[preview.style];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hub-style-chip';
      const isCurrent = preview.style === plan.style;
      button.classList.toggle('is-active', isCurrent);
      const title = document.createElement('b');
      title.textContent = spec.name.replace(' banks', '');
      const gain = document.createElement('span');
      const delta = Math.round(preview.connecting - (current?.connecting ?? 0));
      gain.className = delta > 0 ? 'is-gain' : delta < 0 ? 'is-cost' : '';
      gain.textContent = isCurrent ? `${Math.round(preview.connecting)} cnx` : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} cnx`;
      const peak = document.createElement('span');
      peak.className = preview.load > MAX_RECOMMENDED_LOAD ? 'is-cost' : '';
      peak.textContent = `pk ${Math.round(preview.load * 100)}%`;
      const wait = document.createElement('span');
      wait.className = spec.hubWaitMinutes > 0 ? 'is-cost' : '';
      wait.textContent = spec.hubWaitMinutes > 0 ? `+${spec.hubWaitMinutes}m/arr` : 'no wait';
      if (preview.blockedReason) {
        gain.className = 'is-cost';
        gain.textContent = '✕ no fit';
      }
      button.append(title, gain, peak, wait);
      button.dataset.tip = preview.blockedReason ?? `${spec.name}: ${spec.description}`;
      if (isCurrent) button.disabled = true;
      else if (preview.blockedReason) button.disabled = true;
      else button.addEventListener('click', () => confirmHubStyle(state, plan.hub, preview.style, () => changed()));
      styles.append(button);
    }
    card.append(styles);
    const planner = planHubButton(state, plan.hub, changed);
    if (planner) card.append(planner);
    return card;
  });
}

function shareView(state: SimState, changed: () => void): HTMLElement[] {
  const root = document.createElement('div');

  const allRows = buildRows(state);
  // A base counts as served: it's yours even before its first flight.
  const served = allRows.filter((row) => row.departures > 0 || row.bases > 0);
  const totalFees = allRows.reduce((sum, row) => sum + row.slotFees, 0);
  const summary = document.createElement('div');
  summary.className = 'inspector-line';
  summary.textContent =
    `${served.length} served · ${allRows.length} known` + (totalFees > 0 ? ` · slots $${totalFees.toLocaleString()}/day` : '');
  root.append(summary);

  // Served only, or every airport you can see.
  const filter = document.createElement('div');
  filter.className = 'inspector-filter';
  for (const [label, value] of [['Served', true], ['All known', false]] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.classList.toggle('is-active', servedOnly === value);
    button.addEventListener('click', () => {
      servedOnly = value;
      changed();
    });
    filter.append(button);
  }
  root.append(filter);

  const rows = (servedOnly ? served : allRows).sort(compare);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspector-line';
    empty.textContent = 'None served · tap an airport on the map to start';
    root.append(empty);
    return [root];
  }

  const table = document.createElement('table');
  table.className = 'panel-table inspector-table';
  const headRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-sort';
    button.title = `${column.title}. Click to sort.`;
    button.textContent = column.label + (sortKey === column.key ? (sortDescending ? ' ▾' : ' ▴') : '');
    button.addEventListener('click', () => {
      // A new column starts with the biggest first (or A to Z for names);
      // clicking the same one again flips it.
      if (sortKey === column.key) sortDescending = !sortDescending;
      else {
        sortKey = column.key;
        sortDescending = column.numeric;
      }
      changed();
    });
    th.append(button);
    headRow.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = linkToMap(document.createElement('tr'), { kind: 'airport', iata: row.iata });
    tr.className = 'inspector-table-row';
    tr.title = row.name;
    for (const column of COLUMNS) {
      const td = document.createElement('td');
      if (column.key === 'iata') {
        // A real button, so the row can be reached from the keyboard; the
        // whole row is clickable too.
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'inspector-link';
        link.textContent = row.iata;
        td.append(link);
      } else if (column.key === 'departures') {
        td.append(...departureCell(row));
      } else if (column.key === 'load') {
        td.append(...loadCell(row));
      } else if (column.key === 'bases') {
        td.append(...baseCell(row));
      } else if (column.key === 'waiting') {
        td.append(...waitingCell(row));
      } else if (column.key === 'share') {
        td.append(...shareCell(row));
      } else if (column.key === 'slotFees') {
        td.append(...slotCell(row));
      } else {
        td.textContent = column.format(row);
      }
      if (column.key === 'load' && row.load >= 1) td.classList.add('is-over');
      if (column.key === 'delay' || column.key === 'departures' || column.key === 'load' || column.key === 'bases' || column.key === 'share' || column.key === 'slotFees') td.classList.add('is-nowrap');
      tr.append(td);
    }
    tr.addEventListener('click', () => select({ kind: 'airport', iata: row.iata }));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  // On a narrow screen the columns scroll sideways inside the panel instead of being cut off.
  const scroller = document.createElement('div');
  scroller.className = 'inspector-table-scroll';
  scroller.append(table);
  root.append(scroller);
  return [root];
}
