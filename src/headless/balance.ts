import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type GameSpec, type RunResult } from './balanceGame';
import { playGames, workersFor } from './parallel';
import { PLAYER_KINDS, playerFromArgs, type PlayerKind } from './player';

/**
 * The balance report: every home in HOMES, over every seed in SEEDS,
 * played by each headless player (headless/player.ts), for a year.
 *
 *   npm run balance                   # every player, a year
 *   npm run balance -- 180            # a different horizon, in days
 *   npm run balance -- --player steady   # one player, and no re-rating of homes
 *   npm run balance -- --workers 1       # one game at a time (default: a game per spare core)
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

const HOMES = ['YUL', 'YYZ', 'BOS', 'PHL', 'YHZ', 'LHR'];
const SEEDS = [1, 2, 3, 4, 5, 6];

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
  const header = ['Home', 'Busts', 'Median cash', 'Mean cash', 'Worst', 'Best', 'Planes', 'Markets', 'Flights/day', 'Tiers'];
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
      // Busts included: how far up the ladder airlines from here get.
      String(median(runs.map((r) => r.tiers))),
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

// Without --player, all of them; with it, just that one.
const passedPlayer = process.argv.includes('--player');
const { kind, rest: args } = playerFromArgs(process.argv.slice(2));
const players = passedPlayer ? [kind] : PLAYER_KINDS;
const days = Number(args[0]) || 365;

const specs: GameSpec[] = players.flatMap((player) => HOMES.flatMap((home) => SEEDS.map((seed) => ({ home, seed, player, days }))));
const workerCount = workersFor(specs.length, process.argv);
const started = Date.now();
const results = await playGames(specs, workerCount);
if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(40) + '\r');

for (const player of players) printTable(player, results.filter((r) => r.player === player), days);
console.log('');
console.log(`  ${results.length} games in ${Math.round((Date.now() - started) / 1000)} s, ${workerCount} at a time.`);


const csv = [
  'player,home,seed,cash,bustDay,planes,markets,flightsPerDay,tiers',
  ...results.map((r) => [r.player, r.home, r.seed, Math.round(r.cash), r.bustDay ?? '', r.planes, r.markets, r.flightsPerDay, r.tiers].join(',')),
].join('\n');
const outputPath = fileURLToPath(new URL('../../balance-output.csv', import.meta.url));
writeFileSync(outputPath, csv + '\n');
console.log(`  Wrote ${outputPath}`);
console.log('');

// The full report also re-rates every home (npm run homes), so the
// ratings the home picker shows can't go stale after a tuning change.
if (!passedPlayer) {
  console.log('');
  console.log('  Re-rating the homes (npm run homes):');
  await import('./buildHomeDifficulty');
}
