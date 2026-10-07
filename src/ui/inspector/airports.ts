import { airportLoad, dailyDeparturesAt, airportLevel } from '../../sim/airports';
import { hasCrewBase, hasHeavyBase, hasLineBase } from '../../sim/bases';
import { slotFeesPerDayAt, slotsHeld } from '../../sim/slots';
import { airportDemandSize, sizeRank, type Size } from '../../sim/marketSize';
import type { SimState } from '../../sim/state';
import { unmetDemandByAirport } from '../../sim/unmetDemand';
import { airports } from '../../render/airports';
import { select } from '../selection';
import { linkToMap } from '../mapLink';

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
  }));
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
      } else {
        td.textContent = column.format(row);
      }
      if (column.key === 'load' && row.load >= 1) td.classList.add('is-over');
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
