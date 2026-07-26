import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, LOAD_FACTOR, type EconomyAircraftType } from '../sim/economy';
import { marketKey, recommendedFare } from '../sim/schedule';
import { trafficShare } from '../sim/choiceModel';
import type { RouteSettings, SimState } from '../sim/state';

// Only one aircraft type exists so far — see the same note in
// sim/schedule.ts and sim/step.ts.
const aircraftType = (aircraftTypesData as EconomyAircraftType[])[0];

const tableBody = document.querySelector<HTMLTableSectionElement>('#commercial-rows')!;

const FARE_STEP = 5;
const FARE_MIN_FACTOR = 0.5;
const FARE_MAX_FACTOR = 1.5;
const MARKETING_STEP = 50;
const MARKETING_MAX = 1000;

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * A row's stable numeric cells — built once, then rewritten in place by
 * refreshRow() below whenever the market's inputs (fare, marketing spend)
 * or its schedule (frequency) might have changed. Kept as direct
 * references rather than re-querying the DOM, same "build once, mutate
 * via events" reasoning ui/panels.ts's schedule table already uses.
 */
type RowCells = {
  freq: HTMLTableCellElement;
  pax: HTMLTableCellElement;
  load: HTMLTableCellElement;
  share: HTMLTableCellElement;
  revenue: HTMLTableCellElement;
  cost: HTMLTableCellElement;
  margin: HTMLTableCellElement;
  status: HTMLTableCellElement;
};

const rowsByMarket = new Map<string, { origin: string; dest: string; row: HTMLTableRowElement; cells: RowCells }>();

/**
 * Every scheduled leg on `origin`-`dest`'s market, summed through the same
 * sim/economy.ts's flightResult() the real simulation uses — not a
 * reimplementation of the pax/revenue/cost formula, so this panel can
 * never drift from what step() actually does. `routeSettings` is passed
 * in explicitly (rather than read from state) so a slider mid-drag can
 * show the *hypothetical* result of a value not committed yet.
 */
function summarizeMarket(origin: string, dest: string, state: SimState, routeSettings: RouteSettings) {
  const legs = state.schedule.filter(
    (leg) => (leg.origin === origin && leg.dest === dest) || (leg.origin === dest && leg.dest === origin),
  );
  const freq = legs.length;

  let pax = 0;
  let revenue = 0;
  let cost = 0;
  let margin = 0;
  for (const leg of legs) {
    const result = flightResult({ origin: leg.origin, dest: leg.dest, blockMinutes: leg.blockMinutes }, aircraftType, freq, routeSettings);
    pax += result.pax;
    revenue += result.revenue;
    cost += result.cost;
    margin += result.margin;
  }

  // Marketing spend is a per-day, per-market cost (see step.ts's day-
  // rollover handling), not a per-flight one — added once here, same way,
  // so this panel's Cost/Margin match what the sim will actually charge
  // rather than looking like the marketing lever is free.
  cost += routeSettings.marketingSpend;
  margin -= routeSettings.marketingSpend;

  // A market is "seat-capped" when every one of its flights is pinned at
  // the load-factor ceiling — there's more demand than the fleet can carry
  // there, so raising fare trades away spare demand nobody could fly
  // anyway. Anything short of that ceiling is "demand-capped": every
  // remaining passenger is real, so raising fare will cost real pax.
  const seatCeilingPerFlight = Math.round(aircraftType.seats * LOAD_FACTOR);
  const seatCapped = freq > 0 && pax >= seatCeilingPerFlight * freq;

  // Market share (sim/choiceModel.ts's trafficShare()) is a property of
  // the market, not of any one leg on it — same fare/frequency/marketing
  // spend feed it as bookingShare, just excluding "stay home" from the
  // denominator, so it answers "of people who fly this market, what
  // fraction fly you" rather than "what fraction of the addressable
  // population books at all." Direct-competitor-driven only for now —
  // connecting itineraries aren't modeled (WEEK-TWO.md decision 1), so a
  // rival reachable only by connecting through a third city can't yet
  // pull share away here.
  const share = freq > 0 ? trafficShare(routeSettings.fare, freq, origin, dest, routeSettings.marketingSpend) : 1;

  return { freq, pax, revenue, cost, margin, seatCapped, share };
}

function refreshRow(key: string, state: SimState): void {
  const row = rowsByMarket.get(key);
  if (!row) return;
  const routeSettings = state.routeSettings[key];
  const { freq, pax, revenue, cost, margin, seatCapped, share } = summarizeMarket(
    row.origin,
    row.dest,
    state,
    routeSettings,
  );
  const loadFactor = freq > 0 ? pax / (aircraftType.seats * freq) : 0;

  row.cells.freq.textContent = String(freq);
  row.cells.pax.textContent = String(pax);
  row.cells.load.textContent = `${Math.round(loadFactor * 100)}%`;
  row.cells.share.textContent = `${Math.round(share * 100)}%`;
  row.cells.share.title = 'Share of direct travelers on this market, versus a direct competitor (connections not modeled)';
  row.cells.revenue.textContent = formatMoney(revenue);
  row.cells.revenue.title = formatMoney(revenue);
  row.cells.cost.textContent = formatMoney(cost);
  row.cells.cost.title = formatMoney(cost);
  row.cells.margin.textContent = formatMoney(margin);
  row.cells.margin.title = formatMoney(margin);
  const statusText = seatCapped ? 'Seat-capped' : 'Demand-capped';
  row.cells.status.textContent = statusText;
  row.cells.status.title = statusText;
  row.cells.status.classList.toggle('seat-capped', seatCapped);
  row.cells.status.classList.toggle('demand-capped', !seatCapped);
}

/**
 * Build one market's row: static Market/lever cells plus the numeric
 * cells refreshRow() will keep current. The Fare and Marketing sliders
 * are the only two levers this pass exposes — "for show" (fare) and the
 * new one (marketing spend); more can join this same row later without
 * changing the shape of RouteSettings again.
 */
function buildMarketRow(key: string, origin: string, dest: string, state: SimState): HTMLTableRowElement {
  const row = document.createElement('tr');

  const marketCell = document.createElement('td');
  marketCell.textContent = `${origin} ↔ ${dest}`;

  const freqCell = document.createElement('td');
  const paxCell = document.createElement('td');
  const loadCell = document.createElement('td');
  const shareCell = document.createElement('td');
  const revenueCell = document.createElement('td');
  const costCell = document.createElement('td');
  const marginCell = document.createElement('td');
  const statusCell = document.createElement('td');
  statusCell.className = 'commercial-status';

  const fareCell = document.createElement('td');
  const fareControl = document.createElement('div');
  fareControl.className = 'lever-control';
  const recommended = recommendedFare(origin, dest);
  const fareSlider = document.createElement('input');
  fareSlider.type = 'range';
  fareSlider.min = String(roundToStep(recommended * FARE_MIN_FACTOR, FARE_STEP));
  fareSlider.max = String(roundToStep(recommended * FARE_MAX_FACTOR, FARE_STEP));
  fareSlider.step = String(FARE_STEP);
  fareSlider.value = String(state.routeSettings[key].fare);
  const fareValue = document.createElement('span');
  fareValue.className = 'lever-value';
  fareValue.textContent = `$${state.routeSettings[key].fare}`;
  fareSlider.addEventListener('input', () => {
    state.routeSettings[key].fare = Number(fareSlider.value);
    fareValue.textContent = `$${state.routeSettings[key].fare}`;
    refreshRow(key, state);
  });
  fareControl.append(fareSlider, fareValue);
  fareCell.appendChild(fareControl);

  const marketingCell = document.createElement('td');
  const marketingControl = document.createElement('div');
  marketingControl.className = 'lever-control';
  const marketingSlider = document.createElement('input');
  marketingSlider.type = 'range';
  marketingSlider.min = '0';
  marketingSlider.max = String(MARKETING_MAX);
  marketingSlider.step = String(MARKETING_STEP);
  marketingSlider.value = String(state.routeSettings[key].marketingSpend);
  const marketingValue = document.createElement('span');
  marketingValue.className = 'lever-value';
  marketingValue.textContent = `$${state.routeSettings[key].marketingSpend}/day`;
  marketingSlider.addEventListener('input', () => {
    state.routeSettings[key].marketingSpend = Number(marketingSlider.value);
    marketingValue.textContent = `$${state.routeSettings[key].marketingSpend}/day`;
    refreshRow(key, state);
  });
  marketingControl.append(marketingSlider, marketingValue);
  marketingCell.appendChild(marketingControl);

  row.append(
    marketCell,
    freqCell,
    paxCell,
    loadCell,
    shareCell,
    revenueCell,
    costCell,
    marginCell,
    statusCell,
    fareCell,
    marketingCell,
  );

  rowsByMarket.set(key, {
    origin,
    dest,
    row,
    cells: {
      freq: freqCell,
      pax: paxCell,
      load: loadCell,
      share: shareCell,
      revenue: revenueCell,
      cost: costCell,
      margin: marginCell,
      status: statusCell,
    },
  });

  return row;
}

/**
 * Build the panel once at startup, one row per market already in
 * state.routeSettings. Same "build once, mutate via events" rule as
 * ui/panels.ts's schedule table — these rows hold live <input>s, so a
 * wholesale rebuild would steal focus from a slider mid-drag.
 */
export function setupCommercialPanel(state: SimState): void {
  for (const key of Object.keys(state.routeSettings)) {
    const leg = state.schedule.find((l) => marketKey(l.origin, l.dest) === key);
    if (!leg) continue;
    tableBody.appendChild(buildMarketRow(key, leg.origin, leg.dest, state));
  }
}

/**
 * Append one new row for a market the M10 route builder just created —
 * same reasoning as ui/panels.ts's addScheduleRow(): appending without
 * rebuilding the rest of the table.
 */
export function addCommercialRow(origin: string, dest: string, state: SimState): void {
  const key = marketKey(origin, dest);
  if (rowsByMarket.has(key)) return; // an added frequency on an existing market, not a new one
  tableBody.appendChild(buildMarketRow(key, origin, dest, state));
}

/**
 * Remove a market's row entirely — called by ui/panels.ts's schedule-row
 * delete button when it removes the last leg serving that market, since a
 * fare/marketing lever with nothing left to fly would otherwise linger.
 * A market that still has other legs left keeps its row (and its
 * settings) untouched; this is only for the "last leg on this market is
 * gone" case.
 */
export function removeCommercialRow(key: string): void {
  const entry = rowsByMarket.get(key);
  if (!entry) return;
  entry.row.remove();
  rowsByMarket.delete(key);
}

/**
 * Refresh every row's numeric cells — called when the Commercial view
 * becomes visible, in case a frequency changed (or a market was added)
 * while it wasn't. Sliders themselves are untouched, so a lever the
 * player already set stays exactly where they left it.
 */
export function updateCommercialPanel(state: SimState): void {
  for (const key of rowsByMarket.keys()) {
    refreshRow(key, state);
  }
}
