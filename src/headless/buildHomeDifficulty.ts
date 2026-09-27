import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homeOptions, type HomeDifficulty } from '../sim/homes';
import { isInsolvent } from '../sim/loans';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer } from './player';

/**
 * Builds data/home-difficulty.json: how hard each home city is to start
 * from, measured rather than guessed.
 *
 *   npm run homes
 *
 * What makes a start hard is the valley every new airline crosses while
 * its first routes build demand (WEEK-NINE.md, threads 8 and 10), and
 * nothing on the map predicts it well: Philadelphia has some of the
 * biggest markets there are, but its best routes are short hops where a
 * fare barely covers a departure, and it goes under. So each home is
 * played by the starter player (headless/player.ts), the airline left to
 * itself, for DAYS days on each of SEEDS, and rated by how it fared:
 *
 *   Standard  it survived every game
 *   Hard      it went under in some, or not until HARD_BUST_DAY on average
 *   Brutal    it went under in every game, before HARD_BUST_DAY on average
 *
 * The ratings describe the game as it's balanced when this runs: re-run
 * it after a change to costs, fares or demand.
 */

const DAYS = 180;
const SEEDS = [1, 2];
const HARD_BUST_DAY = 60;
const MINUTES_PER_DAY = 1440;

/** The day the unattended airline went under, or null if it lasted DAYS. */
function bustDay(home: string, seed: number): number | null {
  const player = createPlayer('starter');
  const state = startHeadlessGame(home, seed, player);
  for (let day = 1; day <= DAYS; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      step(state);
      if (isInsolvent(state)) return day;
    }
    player.playDay(state);
  }
  return null;
}

function rate(busts: (number | null)[]): HomeDifficulty {
  const failed = busts.filter((day): day is number => day !== null);
  if (failed.length === 0) return 'Standard';
  const averageDay = failed.reduce((sum, day) => sum + day, 0) / failed.length;
  if (failed.length < busts.length || averageDay >= HARD_BUST_DAY) return 'Hard';
  return 'Brutal';
}

const output = homeOptions().map((option) => {
  const busts = SEEDS.map((seed) => bustDay(option.iata, seed));
  const difficulty = rate(busts);
  if (process.stdout.isTTY) process.stdout.write(`\r  ${option.iata} ${difficulty}      `);
  return { iata: option.iata, difficulty, bustDays: busts };
});
if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(30) + '\r');

const outputPath = fileURLToPath(new URL('../../data/home-difficulty.json', import.meta.url));
writeFileSync(outputPath, '[\n' + output.map((entry) => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n');
const counts = (['Standard', 'Hard', 'Brutal'] as HomeDifficulty[]).map((d) => `${output.filter((e) => e.difficulty === d).length} ${d}`);
console.log(`Wrote ${output.length} home cities: ${counts.join(', ')}.`);
for (const entry of output) console.log(`  ${entry.iata}  ${entry.difficulty.padEnd(8)}  ${entry.bustDays.map((d) => (d === null ? 'lasted' : `bust d${d}`)).join(', ')}`);
