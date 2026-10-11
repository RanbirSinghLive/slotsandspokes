import { airportLoad, dailyDeparturesAt, airportLevel } from '../../sim/airports';
import { hasCrewBase, hasHeavyBase, hasLineBase } from '../../sim/bases';
import { slotFeesPerDayAt, slotsHeld } from '../../sim/slots';
import { airportDemandSize, sizeRank, type Size } from '../../sim/marketSize';
import type { SimState } from '../../sim/state';
import { unmetDemandByAirport } from '../../sim/unmetDemand';
import { airports } from '../../render/airports';
import { stationReadout, stationTier } from '../../sim/stations';
import { CAUSE_STYLE, TIER_GLYPH, minutesText } from './station';
import { select } from '../selection';
import { linkToMap } from '../mapLink';
import { glyph, pips } from '../glyphs';

/**
 * The inspector's list of airports (ui/inspector/inspector.ts): every
 * airport you can see, as a table you can sort, each row opening that
 * airport's view. What the map shows spread out (dot size, glow, the Demand lens),
 * lined up so you can compare: where you're strongest, which fields are
 * filling up, what slots cost, where passengers are waiting.
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
  { key: 'load', label: 'Load', title: 'How full the field is at peak, every airline counted', format: (row) => `${Math.round(row.load * 100)}%`, numeric: true },
  {
    key: 'slotFees',
    label: 'Slots',
    title: 'Slot pairs you hold here, and what they cost a day',
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

/** Build the list. `changed` rebuilds the inspector, for a new sort or filter. */
export function buildAirportsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';

  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Airports';
  root.append(title);

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
    return root;
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
      } else {
        td.textContent = column.format(row);
      }
      if (column.key === 'load' && row.load >= 1) td.classList.add('is-over');
      if (column.key === 'delay' || column.key === 'departures' || column.key === 'load' || column.key === 'bases') td.classList.add('is-nowrap');
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
  return root;
}
