import { writeFileSync } from 'node:fs';
import { WINGLET_FUEL_FACTOR } from '../sim/innovations';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOME_AIRPORT, type FareStance, type SimState } from '../sim/state';
import { setFareStance } from '../sim/pricing';
import { crewRequirement } from '../sim/crew';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer, playerFromArgs, type PlayerKind } from './player';

/**
 * Balance-tuning sweep: run the same simulated network many times over,
 * changing exactly one lever each time, and print what it did to the
 * economy. CLAUDE.md says the headless runner "is how this project's
 * economy gets tuned" — run.ts answers "how does one configuration do
 * over N days," which is a different and much weaker question than "does
 * moving this number make things better or worse, and where does it peak."
 * That second question is what actually governs balance decisions, and
 * it's what this file exists to answer.
 *
 *   npm run sweep -- fare
 *   npm run sweep -- fare 120 YYZ --player starter
 *
 * Each run is played by a headless player (headless/player.ts), steady
 * unless `--player` says otherwise. A lever is applied once, to the
 * markets the player opens on the first morning; markets it opens later
 * start from the game's defaults.
 *
 * Every run in a sweep uses the *same* RNG seed on purpose (see
 * SWEEP_SEED). Different seeds would mean different weather, different
 * competitor route openings and a different fuel price history in every
 * row, so the differences between rows would be mostly noise rather than
 * the lever being swept. Holding the seed fixed makes each row a genuine
 * like-for-like comparison — the one thing that differs is the lever.
 */

const MINUTES_PER_DAY = 1440;
const SWEEP_SEED = 1;
const DEFAULT_DAYS = 120;

/**
 * One thing worth sweeping. `apply` mutates a freshly created state
 * before any time is simulated, so a lever can only set up starting
 * conditions — it can't reach into the middle of a run.
 *
 * Every lever here is deliberately something that already lives on
 * `SimState`, which is why this file needs no changes to sim/ at all.
 * Module-level constants (economy.ts's LOAD_FACTOR and RECAPTURE_RATE,
 * fuel.ts's FUEL_SHARE_OF_BLOCK_HOUR_COST) are *not* sweepable this way
 * — they'd need a tunables layer that lets something outside the sim
 * override them, which is a real design decision worth making on its own
 * rather than smuggling in here.
 */
type Lever = {
  name: string;
  description: string;
  values: number[];
  apply: (state: SimState, value: number) => void;
  /** How a value appears in the results table — a raw number is rarely the clearest form. */
  format: (value: number) => string;
};

const STANCES: FareStance[] = ['undercut', 'match', 'premium'];

const LEVERS: Lever[] = [
  {
    // The one lever that changes headcount as well as a number: staffing
    // has to be re-derived after setting the depth, or every row would
    // run the same crew against different targets and measure nothing.
    name: 'reserve',
    description: 'Crew carried above the bare operating minimum',
    values: [1, 1.05, 1.15, 1.25, 1.4],
    apply: (state, depth) => {
      state.reserveDepth = depth;
      const requirement = crewRequirement(state);
      state.crew.pilotsByTier = [...requirement.targetPilotsByTier] as [number, number, number];
      state.crew.cabinCrew = requirement.targetCabinCrew;
      state.crew.mechanics = requirement.targetMechanics;
    },
    format: (v) => `${v.toFixed(2)}x`,
  },
  {
    name: 'fare',
    description: "Multiplier on every market's recommended fare",
    // Deliberately spans far past anything a player would plausibly
    // charge (up to 5x the recommended fare). A sweep range that stops
    // before the curve turns over tells you nothing about where the
    // optimum is — and this one has to go a long way out before it does.
    values: [0.6, 0.8, 1.0, 1.5, 2, 2.5, 3, 4, 5],
    apply: (state, multiplier) => {
      for (const settings of Object.values(state.routeSettings)) {
        settings.fare = Math.round(settings.fare * multiplier);
        // What a player's own fare edit does, so the price policy leaves it alone.
        settings.fareIsOverridden = true;
        settings.fareStance = null;
      }
    },
    format: (v) => `${v.toFixed(2)}x`,
  },
  {
    // Every market the starter player opens, priced by one stance
    // (sim/pricing.ts). Each stance only differs from policy once a rival
    // shares a market, so this compares the three price-war choices over
    // a run.
    name: 'stance',
    description: 'Fare stance on every market: 0 undercut, 1 match, 2 premium',
    values: [0, 1, 2],
    apply: (state, index) => {
      for (const leg of state.schedule) setFareStance(state, leg.origin, leg.dest, STANCES[index]);
    },
    format: (v) => STANCES[v],
  },
  {
    // Without and with winglet retrofits (sim/innovations.ts), the only
    // thing in the game that moves fuel burn: what they're worth over a run.
    name: 'fuel-efficiency',
    description: 'Fuel burn, without and with winglet retrofits',
    values: [1, WINGLET_FUEL_FACTOR],
    apply: (state, multiplier) => {
      state.fuelEfficiencyMultiplier = multiplier;
    },
    format: (v) => (v === 1 ? 'none' : `-${Math.round((1 - v) * 100)}%`),
  },
];

type SweepRow = {
  value: number;
  finalCash: number;
  avgDailyRevenue: number;
  avgDailyCost: number;
  avgDailyMargin: number;
  legsFlown: number;
};

/**
 * One full run at one lever value. Totals are read once per day, right
 * after that day's final minute — at that exact point `state.simMinute`
 * is `day * 1440` and minute 0 of the *next* day hasn't been processed,
 * so step()'s day-rollover reset hasn't fired yet and todayRevenue/Cost
 * still hold the day that just finished. run.ts relies on the same
 * timing for the same reason.
 */
function runOne(lever: Lever, value: number, days: number): SweepRow {
  // A real new game (see newGame.ts), with the lever applied once its
  // starter routes exist, so the fare lever has markets to touch.
  const player = createPlayer(playerKind);
  const state = startHeadlessGame(home, SWEEP_SEED, player);
  const startingCash = state.cash;
  lever.apply(state, value);

  let totalRevenue = 0;
  let totalCost = 0;
  let legsFlown = 0;

  for (let day = 1; day <= days; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      step(state);
    }
    totalRevenue += state.todayRevenue;
    totalCost += state.todayCost;
    legsFlown += state.completedToday.length;
    player.playDay(state);
  }

  return {
    value,
    // Profit over the run: a real new game starts with cash in the bank.
    finalCash: state.cash - startingCash,
    avgDailyRevenue: totalRevenue / days,
    avgDailyCost: totalCost / days,
    avgDailyMargin: (totalRevenue - totalCost) / days,
    legsFlown,
  };
}

function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

function printTable(lever: Lever, rows: SweepRow[]): void {
  const header = [lever.name, 'Revenue/day', 'Cost/day', 'Margin/day', 'Cumulative', 'Legs'];
  const body = rows.map((row) => [
    lever.format(row.value),
    money(row.avgDailyRevenue),
    money(row.avgDailyCost),
    money(row.avgDailyMargin),
    money(row.finalCash),
    String(row.legsFlown),
  ]);

  // The whole point of the sweep is spotting where the curve peaks, so
  // mark it rather than making the reader scan the column by eye.
  const bestIndex = rows.reduce((best, row, i) => (row.avgDailyMargin > rows[best].avgDailyMargin ? i : best), 0);

  const widths = header.map((_, col) => Math.max(header[col].length, ...body.map((r) => r[col].length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padStart(widths[i])).join('  ');

  console.log('');
  console.log(`  ${lever.description}`);
  console.log('');
  console.log(`  ${line(header)}`);
  console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  body.forEach((cells, i) => {
    console.log(`  ${line(cells)}${i === bestIndex ? '   <- best margin' : ''}`);
  });
  console.log('');
}

const { kind: playerKind, rest: args }: { kind: PlayerKind; rest: string[] } = playerFromArgs(process.argv.slice(2));
const leverName = args[0];
const lever = LEVERS.find((l) => l.name === leverName);

if (!lever) {
  console.log('');
  console.log('  Usage: npm run sweep -- <lever> [days] [home IATA] [--player starter|steady]');
  console.log('');
  console.log('  Levers:');
  for (const l of LEVERS) {
    console.log(`    ${l.name.padEnd(16)} ${l.description}`);
  }
  console.log('');
  process.exit(leverName ? 1 : 0);
}

const days = Number(args[1]) || DEFAULT_DAYS;
const home = args[2] || DEFAULT_HOME_AIRPORT;

console.log(`Sweeping "${lever.name}" across ${lever.values.length} values, ${days} days each, from ${home}, seed ${SWEEP_SEED}, ${playerKind} player...`);
const rows = lever.values.map((value) => runOne(lever, value, days));

printTable(lever, rows);

const csv = [
  `${lever.name},revenuePerDay,costPerDay,marginPerDay,cumulativeCash,legsFlown`,
  ...rows.map((r) =>
    [
      r.value,
      Math.round(r.avgDailyRevenue),
      Math.round(r.avgDailyCost),
      Math.round(r.avgDailyMargin),
      Math.round(r.finalCash),
      r.legsFlown,
    ].join(','),
  ),
].join('\n');

const outputPath = fileURLToPath(new URL(`../../sweep-${lever.name}.csv`, import.meta.url));
writeFileSync(outputPath, csv + '\n');
console.log(`  Wrote ${outputPath}`);
console.log('');
