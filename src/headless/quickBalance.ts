import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type GameSpec } from './balanceGame';
import { playGames, workersFor } from './parallel';

/**
 * The quick balance read: about five minutes, for checking a change
 * between full reports (balance.ts). The steady player for a year from
 * four homes (the north-east core, Montréal, Toronto and Philadelphia,
 * and the thin edge, Halifax), ten seeds each, on every spare core.
 *
 *   npm run quick                  # play, and compare with the saved reference
 *   npm run quick -- --save        # play, and make this the reference
 *   npm run quick -- --save-last   # make the last run the reference, without playing again
 *
 * Ten seeds is rougher than the full report: a home's median can move by
 * a third between seeds on the same rules, so read a change as real when
 * it's bigger than that, or shows in the busts. The reference is a file
 * in the repository (balance-reference.json), saved deliberately after a
 * read the owner accepts, so a quick read compares against a known game
 * rather than re-playing an old commit.
 */

const HOMES = ['YUL', 'YYZ', 'PHL', 'YHZ'];
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const DAYS = 365;

type HomeResult = { busts: number; games: number; median: number; planes: number };

const referencePath = fileURLToPath(new URL('../../balance-reference.json', import.meta.url));
/** Every run's results, so one can become the reference afterwards (not committed). */
const lastPath = fileURLToPath(new URL('../../balance-quick-last.json', import.meta.url));

if (process.argv.includes('--save-last')) {
  if (!existsSync(lastPath)) {
    console.log('  No quick run to save yet: run npm run quick first.');
    process.exit(1);
  }
  writeFileSync(referencePath, readFileSync(lastPath, 'utf8'));
  console.log(`  The last quick run is now the reference: ${referencePath}`);
  process.exit(0);
}

function money(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const size = Math.abs(amount);
  if (size >= 1_000_000) return `${sign}$${(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${sign}$${Math.round(size / 1_000)}k`;
  return `${sign}$${Math.round(size)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const specs: GameSpec[] = HOMES.flatMap((home) => SEEDS.map((seed) => ({ home, seed, player: 'steady' as const, days: DAYS })));
const workers = workersFor(specs.length, process.argv);
const started = Date.now();
const results = await playGames(specs, workers);

const now: Record<string, HomeResult> = {};
for (const home of HOMES) {
  const games = results.filter((r) => r.home === home);
  const flying = games.filter((r) => r.bustDay === null);
  now[home] = {
    busts: games.length - flying.length,
    games: games.length,
    median: Math.round(median(games.map((r) => r.cash))),
    planes: flying.length > 0 ? Math.round(flying.reduce((sum, r) => sum + r.planes, 0) / flying.length) : 0,
  };
}

const reference: Record<string, HomeResult> | null = existsSync(referencePath) ? JSON.parse(readFileSync(referencePath, 'utf8')).homes : null;
console.log('');
console.log(`  Quick balance · steady player · ${DAYS} days · ${SEEDS.length} seeds a home${reference ? ' · against the reference' : ''}`);
console.log('');
for (const home of HOMES) {
  const r = now[home];
  const was = reference?.[home];
  const versus = was ? `   was ${money(was.median)}, ${was.busts}/${was.games} bust` : '';
  console.log(`  ${home}  ${money(r.median).padStart(7)}  ${r.busts}/${r.games} bust  ${String(r.planes).padStart(2)} planes${versus}`);
}
console.log('');
console.log(`  ${results.length} games in ${Math.round((Date.now() - started) / 1000)} s, ${workers} at a time.`);

const record = JSON.stringify({ savedAt: new Date().toISOString(), days: DAYS, seeds: SEEDS.length, homes: now }, null, 2) + '\n';
writeFileSync(lastPath, record);
if (process.argv.includes('--save')) {
  writeFileSync(referencePath, record);
  console.log(`  Saved as the reference: ${referencePath}`);
}
console.log('');
