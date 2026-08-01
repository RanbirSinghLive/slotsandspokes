import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, LOAD_FACTOR, type EconomyAircraftType } from '../sim/economy';
import { marketKey, type ScheduleLeg } from '../sim/schedule';
import { applyFarePolicy, policyFare, FARE_POLICY_MIN, FARE_POLICY_MAX } from '../sim/pricing';
import { trafficShare } from '../sim/choiceModel';
import { actualDailyDemand } from '../sim/marketDemand';
import type { RouteSettings, SimState } from '../sim/state';

// A market can be served by more than one gauge at once (week four's
// aircraft ladder, plus M13's ability to drag a leg onto a different
// tail) — so unlike before, this panel can't assume one type for a whole
// market. Looked up per leg instead, same "small local map, keyed by
// code" pattern step.ts already uses; `defaultAircraftType` only covers
// the defensive case of a leg whose tail somehow isn't in the fleet
// (shouldn't happen — validateSchedule() would already be flagging that
// tail as stranded or worse — but a market summary shouldn't throw over
// it).
const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);
const defaultAircraftType = (aircraftTypesData as EconomyAircraftType[])[0];

function aircraftTypeForLeg(leg: ScheduleLeg, state: SimState): EconomyAircraftType {
  const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  return type ?? defaultAircraftType;
}

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

/**
 * Every scheduled leg on `origin`-`dest`'s market, summed through the same
 * sim/economy.ts's flightResult() the real simulation uses — not a
 * reimplementation of the pax/revenue/cost formula, so this panel can
 * never drift from what step() actually does. `routeSettings` is passed
 * in explicitly (rather than read from state) so a slider mid-drag can
 * show the *hypothetical* result of a value not committed yet.
 */
function summarizeMarket(origin: string, dest: string, state: SimState, routeSettings: RouteSettings) {
  // Sorted by depart time to approximate the same chronological order
  // step.ts's arrivals actually process spill-and-recapture in — a
  // hypothetical full-day preview, not a live read of `state`'s own
  // mid-day pool (see `previewSpillover` below), so it needs its own
  // stand-in for "which flight happens first."
  const legs = state.schedule
    .filter((leg) => (leg.origin === origin && leg.dest === dest) || (leg.origin === dest && leg.dest === origin))
    .sort((a, b) => a.departMinute - b.departMinute);
  const freq = legs.length;

  let pax = 0;
  let revenue = 0;
  let cost = 0;
  let margin = 0;
  let totalSeats = 0;
  let totalSeatCeiling = 0;
  // Local to this preview, not `state.spilloverByMarket` — that pool
  // reflects wherever the real, currently-running day actually is, not
  // a clean full-day-from-scratch hypothetical.
  let previewSpillover = 0;
  for (const leg of legs) {
    const type = aircraftTypeForLeg(leg, state);
    const result = flightResult(
      { origin: leg.origin, dest: leg.dest, blockMinutes: leg.blockMinutes },
      type,
      state.fuelPriceIndex,
      state.fuelEfficiencyMultiplier,
      actualDailyDemand(state, leg.origin, leg.dest),
      freq,
      routeSettings,
      state.competitorRoutes,
      previewSpillover,
    );
    previewSpillover += result.spilloverDelta;
    pax += result.pax;
    revenue += result.revenue;
    cost += result.cost;
    margin += result.margin;
    totalSeats += type.seats;
    totalSeatCeiling += Math.round(type.seats * LOAD_FACTOR);
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
  // Summed per leg's own type rather than one type times frequency, since
  // a market can now be served by more than one gauge at once.
  const seatCapped = freq > 0 && pax >= totalSeatCeiling;

  // Market share (sim/choiceModel.ts's trafficShare()) is a property of
  // the market, not of any one leg on it — same fare/frequency/marketing
  // spend feed it as bookingShare, just excluding "stay home" from the
  // denominator, so it answers "of people who fly this market, what
  // fraction fly you" rather than "what fraction of the addressable
  // population books at all." Direct-competitor-driven only for now —
  // connecting itineraries aren't modeled (WEEK-TWO.md decision 1), so a
  // rival reachable only by connecting through a third city can't yet
  // pull share away here.
  const share = freq > 0 ? trafficShare(routeSettings.fare, freq, origin, dest, routeSettings.marketingSpend, state.competitorRoutes) : 1;

  return { freq, pax, revenue, cost, margin, seatCapped, share, totalSeats };
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
    syncFareControls(key, state);
    refreshFarePolicyStatus(state);
    refreshRow(key, state);
  });
  fareReset.addEventListener('click', () => {
    state.routeSettings[key].fareIsOverridden = false;
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
