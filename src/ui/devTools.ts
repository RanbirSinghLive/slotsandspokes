import { rollAgeDelay, rollWeatherDelay, ageDelayParameters } from '../sim/delays';
import { WEATHER_ON_TIME_PROBABILITY, WEATHER_MAX_DELAY_MINUTES } from '../sim/weather';
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

// ---------------------------------------------------------------------
// Delay distributions
//
// Rather than *describing* what the delay model does ("the severity roll
// is squared, which skews toward the low end"), this samples the real
// functions from sim/delays.ts many thousands of times and draws what
// actually comes out. Two reasons that's better than a written
// explanation: it can't fall out of date when a constant changes, and a
// shape is far easier to read off a histogram than off a sentence.
//
// Computed once at startup, not per frame — these distributions
// characterize the model itself, not the running game, so nothing about
// them changes as a game plays out.
// ---------------------------------------------------------------------

const DELAY_SAMPLE_COUNT = 40_000;
const DELAY_BUCKET_COUNT = 14;

const histogramsEl = document.querySelector<HTMLDivElement>('#dev-delay-histograms')!;

type DelayScenario = {
  label: string;
  hint: string;
  /** Draws one sample, threading the seed the same way the sim itself does. */
  roll: (seed: number) => [delayMinutes: number, nextSeed: number];
  onTimeProbability: number;
  maxDelayMinutes: number;
};

const DELAY_SCENARIOS: DelayScenario[] = [
  ...[0, 10, 20].map((ageYears) => {
    const { onTimeProbability, maxDelayMinutes } = ageDelayParameters(ageYears);
    return {
      label: `Age ${ageYears} yr`,
      hint: `An airframe ${ageYears} years old. On-time odds fall 1 percentage point per year (floored at 35%) and the worst case grows 2 minutes per year.`,
      roll: (seed: number) => rollAgeDelay(seed, ageYears),
      onTimeProbability,
      maxDelayMinutes,
    };
  }),
  {
    label: 'Weather',
    hint: 'A departure from an airport with an active storm. Independent of aircraft age, and rolled on top of the age delay rather than instead of it.',
    roll: (seed: number) => rollWeatherDelay(seed, true),
    onTimeProbability: WEATHER_ON_TIME_PROBABILITY,
    maxDelayMinutes: WEATHER_MAX_DELAY_MINUTES,
  },
];

type DelaySample = {
  onTimeShare: number;
  meanWhenDelayed: number;
  /** Share of *delayed* flights falling in each equal-width bucket of [1, maxDelayMinutes]. */
  buckets: number[];
};

/**
 * Sample one scenario. Seeds run sequentially from a fixed start, the
 * same way `state.rngSeed` advances through a real game — so this shows
 * the distribution the sim actually draws from, not an idealized one.
 *
 * Zero-delay results are counted separately rather than binned: they'd
 * otherwise dominate the first bucket (most flights *are* on time) and
 * flatten the severity shape into invisibility. The on-time share is
 * reported as its own number, and the histogram shows the shape of the
 * delays that do happen.
 */
function sampleDelayScenario(scenario: DelayScenario): DelaySample {
  const buckets = new Array(DELAY_BUCKET_COUNT).fill(0);
  let seed = 1;
  let onTimeCount = 0;
  let delayedCount = 0;
  let delayedTotal = 0;

  for (let i = 0; i < DELAY_SAMPLE_COUNT; i++) {
    const [delayMinutes, nextSeed] = scenario.roll(seed);
    seed = nextSeed;

    if (delayMinutes === 0) {
      onTimeCount++;
      continue;
    }
    delayedCount++;
    delayedTotal += delayMinutes;

    const t = (delayMinutes - 1) / Math.max(1, scenario.maxDelayMinutes - 1);
    buckets[Math.min(DELAY_BUCKET_COUNT - 1, Math.floor(t * DELAY_BUCKET_COUNT))]++;
  }

  return {
    onTimeShare: onTimeCount / DELAY_SAMPLE_COUNT,
    meanWhenDelayed: delayedCount > 0 ? delayedTotal / delayedCount : 0,
    buckets: buckets.map((count) => (delayedCount > 0 ? count / delayedCount : 0)),
  };
}

function buildHistogram(scenario: DelayScenario): HTMLDivElement {
  const sample = sampleDelayScenario(scenario);

  const block = document.createElement('div');
  block.className = 'dev-histogram';
  block.title = scenario.hint;

  const header = document.createElement('div');
  header.className = 'dev-histogram-header';
  const label = document.createElement('span');
  label.className = 'dev-histogram-label';
  label.textContent = scenario.label;
  const stat = document.createElement('span');
  stat.className = 'dev-histogram-stat';
  stat.textContent = `${(sample.onTimeShare * 100).toFixed(1)}% on time · avg ${Math.round(sample.meanWhenDelayed)} min when late`;
  header.append(label, stat);

  const chart = document.createElement('div');
  chart.className = 'dev-histogram-bars';
  const tallest = Math.max(...sample.buckets);
  sample.buckets.forEach((share, i) => {
    const bar = document.createElement('div');
    bar.className = 'dev-histogram-bar';
    // Heights are relative to this scenario's own tallest bucket, so the
    // shape is readable even when one scenario is far rarer than another.
    bar.style.height = `${tallest > 0 ? (share / tallest) * 100 : 0}%`;
    const from = Math.round(1 + (i / DELAY_BUCKET_COUNT) * (scenario.maxDelayMinutes - 1));
    const to = Math.round(1 + ((i + 1) / DELAY_BUCKET_COUNT) * (scenario.maxDelayMinutes - 1));
    bar.title = `${from}-${to} min: ${(share * 100).toFixed(1)}% of delays`;
    chart.appendChild(bar);
  });

  const axis = document.createElement('div');
  axis.className = 'dev-histogram-axis';
  const min = document.createElement('span');
  min.textContent = '1 min';
  const max = document.createElement('span');
  max.textContent = `${scenario.maxDelayMinutes} min`;
  axis.append(min, max);

  block.append(header, chart, axis);
  return block;
}

/** Build the fixed row structure once at startup — only the numbers change after this. */
export function setupDevPanel(): void {
  for (const spec of COST_ROWS) treeEl.appendChild(buildRow(spec));
  for (const scenario of DELAY_SCENARIOS) histogramsEl.appendChild(buildHistogram(scenario));
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
