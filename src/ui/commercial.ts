import { marketKey } from '../sim/schedule';
import { applyFarePolicy, policyFare, FARE_POLICY_MIN, FARE_POLICY_MAX } from '../sim/pricing';
import { summarizeMarket } from '../sim/marketSummary';
import type { SimState } from '../sim/state';

const tableBody = document.querySelector<HTMLTableSectionElement>('#commercial-rows')!;
const farePolicySlider = document.querySelector<HTMLInputElement>('#fare-policy-slider')!;
const farePolicyValue = document.querySelector<HTMLSpanElement>('#fare-policy-value')!;
const farePolicyStatus = document.querySelector<HTMLDivElement>('#fare-policy-status')!;

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

type FareControls = { slider: HTMLInputElement; value: HTMLSpanElement; reset: HTMLButtonElement };

const rowsByMarket = new Map<
  string,
  { origin: string; dest: string; row: HTMLTableRowElement; cells: RowCells; fare: FareControls }
>();

/**
 * Point one market's fare slider at whatever it should currently show:
 * range centred on the policy price, thumb at the market's actual fare,
 * and the reset button visible only when this market has been taken off
 * policy. Called both when the policy moves (every following market
 * re-prices) and when a single market is overridden.
 */
function syncFareControls(key: string, state: SimState): void {
  const entry = rowsByMarket.get(key);
  if (!entry) return;
  const settings = state.routeSettings[key];
  const base = policyFare(state, entry.origin, entry.dest);

  entry.fare.slider.min = String(roundToStep(base * FARE_MIN_FACTOR, FARE_STEP));
  entry.fare.slider.max = String(roundToStep(base * FARE_MAX_FACTOR, FARE_STEP));
  entry.fare.slider.value = String(settings.fare);
  entry.fare.value.textContent = `$${settings.fare}`;
  entry.fare.value.classList.toggle('lever-value--overridden', settings.fareIsOverridden);
  entry.fare.reset.hidden = !settings.fareIsOverridden;
}

/** How many markets are still following policy, for the status line. */
function refreshFarePolicyStatus(state: SimState): void {
  const pct = Math.round(state.farePolicyMultiplier * 100);
  farePolicyValue.textContent = `${pct}% of recommended`;

  const keys = [...rowsByMarket.keys()];
  const overridden = keys.filter((k) => state.routeSettings[k]?.fareIsOverridden).length;
  if (keys.length === 0) {
    farePolicyStatus.textContent = 'No markets yet.';
  } else if (overridden === 0) {
    farePolicyStatus.textContent = `All ${keys.length} market${keys.length === 1 ? '' : 's'} following policy.`;
  } else {
    farePolicyStatus.textContent = `${keys.length - overridden} of ${keys.length} following policy, ${overridden} overridden.`;
  }
}

function refreshRow(key: string, state: SimState): void {
  const row = rowsByMarket.get(key);
  if (!row) return;
  const routeSettings = state.routeSettings[key];
  const { freq, pax, revenue, cost, margin, seatCapped, share, totalSeats } = summarizeMarket(
    row.origin,
    row.dest,
    state,
    routeSettings,
  );
  const loadFactor = totalSeats > 0 ? pax / totalSeats : 0;

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
  const fareSlider = document.createElement('input');
  fareSlider.type = 'range';
  fareSlider.step = String(FARE_STEP);
  const fareValue = document.createElement('span');
  fareValue.className = 'lever-value';
  // Touching a market's own slider is what takes it off policy — an
  // explicit "override this market" checkbox would be a second click for
  // something the drag already unambiguously means.
  const fareReset = document.createElement('button');
  fareReset.type = 'button';
  fareReset.className = 'lever-reset';
  fareReset.textContent = 'Reset';
  fareReset.title = 'Put this market back on the airline-wide fare policy';
  fareSlider.addEventListener('input', () => {
    state.routeSettings[key].fare = Number(fareSlider.value);
    state.routeSettings[key].fareIsOverridden = true;
    state.routeSettings[key].fareStance = null;
    syncFareControls(key, state);
    refreshFarePolicyStatus(state);
    refreshRow(key, state);
  });
  fareReset.addEventListener('click', () => {
    state.routeSettings[key].fareIsOverridden = false;
    state.routeSettings[key].fareStance = null;
    state.routeSettings[key].fare = policyFare(state, origin, dest);
    syncFareControls(key, state);
    refreshFarePolicyStatus(state);
    refreshRow(key, state);
  });
  fareControl.append(fareSlider, fareValue, fareReset);
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
    fare: { slider: fareSlider, value: fareValue, reset: fareReset },
  });

  syncFareControls(key, state);
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

  farePolicySlider.min = String(Math.round(FARE_POLICY_MIN * 100));
  farePolicySlider.max = String(Math.round(FARE_POLICY_MAX * 100));
  farePolicySlider.addEventListener('input', () => {
    state.farePolicyMultiplier = Number(farePolicySlider.value) / 100;
    // Re-prices every market still following policy; overridden ones keep
    // whatever they were set to (sim/pricing.ts).
    applyFarePolicy(state);
    for (const key of rowsByMarket.keys()) {
      syncFareControls(key, state);
      refreshRow(key, state);
    }
    refreshFarePolicyStatus(state);
  });

  syncFarePolicyControls(state);
}

/**
 * Point the policy slider itself at `state` — needed on startup and again
 * whenever the panel is opened, since a loaded save carries its own
 * policy that the slider's markup default knows nothing about.
 */
function syncFarePolicyControls(state: SimState): void {
  farePolicySlider.value = String(Math.round(state.farePolicyMultiplier * 100));
  refreshFarePolicyStatus(state);
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
  syncFarePolicyControls(state);
  for (const key of rowsByMarket.keys()) {
    syncFareControls(key, state);
    refreshRow(key, state);
  }
}
