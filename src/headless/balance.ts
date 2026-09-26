import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isInsolvent } from '../sim/loans';
import { marketKey } from '../sim/schedule';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer, PLAYER_KINDS, playerFromArgs, type PlayerKind } from './player';

/**
 * The balance report: every home in HOMES, over every seed in SEEDS,
 * played by each headless player (headless/player.ts), for a year.
 *
 *   npm run balance                   # both players, a year
 *   npm run balance -- 180            # a different horizon, in days
 *   npm run balance -- --player steady
 *
 * One seed can mislead: rival openings, weather and breakdowns differ
 * from seed to seed, and one run from London survived by $325k where
 * another made $104M. So each row is six seeds, and the busts are
 * counted rather than averaged away. Where run.ts answers "what happened
 * in this game", this answers "how does the game go from here, usually".
 *
 * The homes span the map: the dense north-east core (YUL, YYZ, BOS,
 * PHL), a thin edge (YHZ) and a world hub (LHR).
 */

const MINUTES_PER_DAY = 1440;
const HOMES = ['YUL', 'YYZ', 'BOS', 'PHL', 'YHZ', 'LHR'];
const SEEDS = [1, 2, 3, 4, 5, 6];

type RunResult = {
  home: string;
  seed: number;
  player: PlayerKind;
  cash: number;
  /** The day cash reached $0, or null if the airline lasted the run. */
  bustDay: number | null;
  planes: number;
  markets: number;
  flightsPerDay: number;
};

/** One game, the same way run.ts plays it: stop at $0, checked every minute, as the browser does. */
function playOne(home: string, seed: number, kind: PlayerKind, days: number): RunResult {
  const player = createPlayer(kind);
  const state = startHeadlessGame(home, seed, player);
  let bustDay: number | null = null;
  for (let day = 1; day <= days && bustDay === null; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      step(state);
      if (isInsolvent(state)) {
        bustDay = day;
        break;
      }
    }
    if (bustDay === null) player.playDay(state);
  }
  return {
    home,
    seed,
    player: kind,
    cash: state.cash,
    bustDay,
    planes: state.aircraft.length,
    markets: new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest))).size,
    flightsPerDay: state.schedule.length,
  };
}

function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const size = Math.abs(amount);
  if (size >= 1_000_000) return `${sign}$${(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${sign}$${Math.round(size / 1_000)}k`;
  return `${sign}$${Math.round(size)}`;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One row per home: the six seeds summed up. Planes and markets are averaged over the airlines still flying. */
function printTable(kind: PlayerKind, results: RunResult[], days: number): void {
  const header = ['Home', 'Busts', 'Median cash', 'Mean cash', 'Worst', 'Best', 'Planes', 'Markets', 'Flights/day'];
  const body = HOMES.map((home) => {
    const runs = results.filter((r) => r.home === home);
    const survivors = runs.filter((r) => r.bustDay === null);
    const busts = runs.filter((r) => r.bustDay !== null);
    const cash = runs.map((r) => r.cash);
    const average = (pick: (r: RunResult) => number) => (survivors.length > 0 ? mean(survivors.map(pick)).toFixed(1) : '—');
    return [
      home,
      busts.length > 0 ? `${busts.length}/${runs.length} (day ${Math.round(mean(busts.map((r) => r.bustDay!)))})` : `0/${runs.length}`,
      money(median(cash)),
      money(mean(cash)),
      money(Math.min(...cash)),
      money(Math.max(...cash)),
      average((r) => r.planes),
      average((r) => r.markets),
      average((r) => r.flightsPerDay),
    ];
  });

  const widths = header.map((_, i) => Math.max(header[i].length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');
  console.log('');
  console.log(`  ${kind} player, day ${days}, seeds ${SEEDS.join(', ')}. Busts show the average day they happened.`);
  console.log(`  ${line(header)}`);
  console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  for (const row of body) console.log(`  ${line(row)}`);
}

// Without --player, both; with it, just that one.
const passedPlayer = process.argv.includes('--player');
const { kind, rest: args } = playerFromArgs(process.argv.slice(2));
const players = passedPlayer ? [kind] : PLAYER_KINDS;
const days = Number(args[0]) || 365;

const results: RunResult[] = [];
const started = Date.now();
for (const player of players) {
  for (const home of HOMES) {
    for (const seed of SEEDS) {
      results.push(playOne(home, seed, player, days));
      // A progress line that rewrites itself, only where a terminal can show that.
      if (process.stdout.isTTY) process.stdout.write(`\r  ${player}: ${home} seed ${seed}   `);
    }
  }
}
if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(40) + '\r');

for (const player of players) printTable(player, results.filter((r) => r.player === player), days);
console.log('');
console.log(`  ${results.length} games in ${Math.round((Date.now() - started) / 1000)} s.`);

const csv = [
  'player,home,seed,cash,bustDay,planes,markets,flightsPerDay',
  ...results.map((r) => [r.player, r.home, r.seed, Math.round(r.cash), r.bustDay ?? '', r.planes, r.markets, r.flightsPerDay].join(',')),
].join('\n');
const outputPath = fileURLToPath(new URL('../../balance-output.csv', import.meta.url));
writeFileSync(outputPath, csv + '\n');
console.log(`  Wrote ${outputPath}`);
console.log('');
