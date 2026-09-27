import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homeOptions, type HomeDifficulty } from '../sim/homes';
import type { GameSpec } from './balanceGame';
import { playGames, workersFor } from './parallel';

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

/**
 * How long each start is played. A new airline crosses the early valley,
 * or doesn't, within about this: Philadelphia's and Madrid's starters go
 * under between days 63 and 88. Later trouble (shocks, which start from
 * sim/shocks.ts's FIRST_SHOCK_DAY, and rivals) is the mid-game's, not the
 * start's, and would make a rating say more about luck than the city.
 */
const DAYS = 90;
const SEEDS = [1, 2];
const HARD_BUST_DAY = 60;
function rate(busts: (number | null)[]): HomeDifficulty {
  const failed = busts.filter((day): day is number => day !== null);
  if (failed.length === 0) return 'Standard';
  const averageDay = failed.reduce((sum, day) => sum + day, 0) / failed.length;
  if (failed.length < busts.length || averageDay >= HARD_BUST_DAY) return 'Hard';
  return 'Brutal';
}

// Every home on every seed, played side by side (headless/parallel.ts):
// the starter, the airline left to itself, for DAYS days.
const homes = homeOptions();
const specs: GameSpec[] = homes.flatMap((option) => SEEDS.map((seed) => ({ home: option.iata, seed, player: 'starter' as const, days: DAYS })));
const played = await playGames(specs, workersFor(specs.length, process.argv));
const output = homes.map((option, i) => {
  const busts = SEEDS.map((_, s) => played[i * SEEDS.length + s].bustDay);
  return { iata: option.iata, difficulty: rate(busts), bustDays: busts };
});

const outputPath = fileURLToPath(new URL('../../data/home-difficulty.json', import.meta.url));
writeFileSync(outputPath, '[\n' + output.map((entry) => '  ' + JSON.stringify(entry)).join(',\n') + '\n]\n');
const counts = (['Standard', 'Hard', 'Brutal'] as HomeDifficulty[]).map((d) => `${output.filter((e) => e.difficulty === d).length} ${d}`);
console.log(`Wrote ${output.length} home cities: ${counts.join(', ')}.`);
// The per-home list only when run on its own: the balance report runs this
// too, and wants just the totals.
const runDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) for (const entry of output) console.log(`  ${entry.iata}  ${entry.difficulty.padEnd(8)}  ${entry.bustDays.map((d) => (d === null ? 'lasted' : `bust d${d}`)).join(', ')}`);
