import type { SimState } from '../sim/state';

/**
 * A development-only tab: a live decomposition of where today's money is
 * actually going, built to make the economy legible while it's being
 * tuned. Deliberately *not* a hand-authored diagram of the model —
 * every leaf here reads a real number out of `state`, so it can't drift
 * out of date the way a documentation panel describing the same formulas
 * would. The structure is the only hand-written part, and structure only
 * changes when a whole new cost category appears.
 *
 * Unlike every other sidebar tab, this refreshes every frame rather than
 * on tab-select: watching cost accumulate through a simulated day is the
 * entire point, and a snapshot frozen at the moment the tab opened would
 * defeat it.
 *
 * Temporary by intent. It's one file, one tab button, and one markup
 * block — deleting it later touches nothing else.
 */

const revenueEl = document.querySelector<HTMLDivElement>('#dev-revenue')!;
const costEl = document.querySelector<HTMLDivElement>('#dev-cost')!;
const marginEl = document.querySelector<HTMLDivElement>('#dev-margin')!;
const treeEl = document.querySelector<HTMLDivElement>('#dev-cost-tree')!;
const fuelDriversEl = document.querySelector<HTMLDivElement>('#dev-fuel-drivers')!;

/**
 * One row of the cost tree. `depth` drives indentation only — the tree is
 * shallow and fixed, so nesting is presentational rather than a real
 * recursive structure worth modelling.
 */
type CostRowSpec = {
  label: string;
  depth: number;
  /** Pulls this row's dollars out of state. Group rows sum their own children. */
  value: (state: SimState) => number;
  /** Short explanation shown as a native title tooltip. */
  hint: string;
};

const COST_ROWS: CostRowSpec[] = [
  {
    label: 'Flying',
    depth: 0,
    hint: 'Everything charged per flight, on arrival. Scales with how much you fly, not with how many passengers you carry.',
    value: (s) => s.todayCostByCategory.fuel + s.todayCostByCategory.blockNonFuel + s.todayCostByCategory.departure,
  },
  {
    label: 'Fuel',
    depth: 1,
    hint: 'The fuel-sensitive slice of block-hour cost (35% of it), multiplied by the current fuel price index and by any tech tree efficiency upgrades.',
    value: (s) => s.todayCostByCategory.fuel,
  },
  {
    label: 'Block, non-fuel',
    depth: 1,
    hint: 'The other 65% of block-hour cost — crew, maintenance and overhead, all still bundled into one flat per-type number. Nothing varies this yet.',
    value: (s) => s.todayCostByCategory.blockNonFuel,
  },
  {
    label: 'Departure',
    depth: 1,
    hint: "A flat charge per takeoff, independent of leg length. This is what makes very short legs proportionally expensive.",
    value: (s) => s.todayCostByCategory.departure,
  },
  {
    label: 'Fixed',
    depth: 0,
    hint: 'Charged once at day-rollover whether or not anything flew.',
    value: (s) => s.todayCostByCategory.marketing + s.todayCostByCategory.lease,
  },
  {
    label: 'Marketing',
    depth: 1,
    hint: 'Daily spend summed across every market. Buys booking share through the choice model, with diminishing returns.',
    value: (s) => s.todayCostByCategory.marketing,
  },
  {
    label: 'Lease',
    depth: 1,
    hint: 'Daily cost of every leased airframe. Owned aircraft contribute nothing here.',
    value: (s) => s.todayCostByCategory.lease,
  },
];

type RowRefs = { amount: HTMLSpanElement; share: HTMLSpanElement; bar: HTMLDivElement };
const rowRefs: RowRefs[] = [];

function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

function buildRow(spec: CostRowSpec): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `dev-row dev-row--depth${spec.depth}`;
  row.title = spec.hint;

  const label = document.createElement('span');
  label.className = 'dev-row-label';
  label.textContent = spec.label;

  const amount = document.createElement('span');
  amount.className = 'dev-row-amount';

  const share = document.createElement('span');
  share.className = 'dev-row-share';

  const barTrack = document.createElement('div');
  barTrack.className = 'dev-row-bar-track';
  const bar = document.createElement('div');
  bar.className = 'dev-row-bar';
  barTrack.appendChild(bar);

  row.append(label, amount, share, barTrack);
  rowRefs.push({ amount, share, bar });
  return row;
}

/** Build the fixed row structure once at startup — only the numbers change after this. */
export function setupDevPanel(): void {
  for (const spec of COST_ROWS) treeEl.appendChild(buildRow(spec));
}

export function updateDevPanel(state: SimState): void {
  revenueEl.textContent = money(state.todayRevenue);
  costEl.textContent = money(state.todayCost);
  marginEl.textContent = money(state.todayMargin);
  marginEl.classList.toggle('dev-negative', state.todayMargin < 0);

  const total = state.todayCost;
  COST_ROWS.forEach((spec, i) => {
    const value = spec.value(state);
    const refs = rowRefs[i];
    refs.amount.textContent = money(value);
    // Guard the 0/0 case at the very start of a simulated day, before
    // anything has been charged — every share is genuinely undefined
    // then, not zero.
    const share = total > 0 ? value / total : 0;
    refs.share.textContent = total > 0 ? `${Math.round(share * 100)}%` : '—';
    refs.bar.style.width = `${share * 100}%`;
  });

  // The two live multipliers sitting on top of the Fuel row above —
  // worth showing explicitly, since the fuel number alone can move for
  // either reason and they pull in opposite directions.
  const pricePct = Math.round((state.fuelPriceIndex - 1) * 100);
  const efficiencyPct = Math.round((1 - state.fuelEfficiencyMultiplier) * 100);
  const priceText = pricePct === 0 ? 'at baseline' : `${pricePct > 0 ? '+' : ''}${pricePct}% vs baseline`;
  const efficiencyText = efficiencyPct === 0 ? 'no upgrades' : `-${efficiencyPct}% from tech tree`;
  fuelDriversEl.textContent = `Fuel price ${priceText} · efficiency ${efficiencyText}`;
}
