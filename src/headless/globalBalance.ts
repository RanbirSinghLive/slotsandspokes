import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { StartSeason } from '../sim/clock';
import { type GameSpec, type RunResult } from './balanceGame';
import { playGames, workersFor } from './parallel';

/**
 * The global balance read: the steady player on Medium for a year from
 * homes on every continent, a strong and a weak pair each, three seeds a
 * home. It asks "does the game work everywhere?" rather than "did this
 * change move the numbers?", which is the quick read's job (quickBalance.ts),
 * so it has no reference to compare against. About half an hour on four
 * cores: strong homes play long, busy games.
 *
 *   npm run global                 # play every home
 *   npm run global -- --winter     # start every game on 1 November instead of 1 May
 *   npm run global -- --only EU    # one continent (NA, EU, AS, AF, SA, OC)
 *
 * Strong homes are big cities with many first routes in a propeller's
 * range; weak ones are small or isolated, with the minimum of three.
 */

type Continent = 'NA' | 'EU' | 'AS' | 'AF' | 'SA' | 'OC';
type Strength = 'strong' | 'weak';

const HOMES: { home: string; continent: Continent; strength: Strength }[] = [
  { home: 'YYZ', continent: 'NA', strength: 'strong' },
  { home: 'ORD', continent: 'NA', strength: 'strong' },
  { home: 'YHZ', continent: 'NA', strength: 'weak' },
  { home: 'ELP', continent: 'NA', strength: 'weak' },
  { home: 'LHR', continent: 'EU', strength: 'strong' },
  { home: 'DUS', continent: 'EU', strength: 'strong' },
  { home: 'HEL', continent: 'EU', strength: 'weak' },
  { home: 'BGO', continent: 'EU', strength: 'weak' },
  { home: 'PVG', continent: 'AS', strength: 'strong' },
  { home: 'HND', continent: 'AS', strength: 'strong' },
  { home: 'CEB', continent: 'AS', strength: 'weak' },
  { home: 'AKU', continent: 'AS', strength: 'weak' },
  { home: 'LOS', continent: 'AF', strength: 'strong' },
  { home: 'CAI', continent: 'AF', strength: 'strong' },
  { home: 'DSS', continent: 'AF', strength: 'weak' },
  { home: 'ASW', continent: 'AF', strength: 'weak' },
  { home: 'GRU', continent: 'SA', strength: 'strong' },
  { home: 'BOG', continent: 'SA', strength: 'strong' },
  { home: 'ASU', continent: 'SA', strength: 'weak' },
  { home: 'BRM', continent: 'SA', strength: 'weak' },
  { home: 'SYD', continent: 'OC', strength: 'strong' },
  { home: 'BNE', continent: 'OC', strength: 'strong' },
  { home: 'CBR', continent: 'OC', strength: 'weak' },
  { home: 'TRG', continent: 'OC', strength: 'weak' },
];
const SEEDS = [1, 2, 3];
const DAYS = 365;
const SEASON: StartSeason = process.argv.includes('--winter') ? 'winter' : 'summer';
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt === -1 ? null : process.argv[onlyAt + 1]?.toUpperCase();

/** Every run's results, game by game (not committed). */
const lastPath = fileURLToPath(new URL('../../balance-global-last.json', import.meta.url));

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

const homes = HOMES.filter((h) => ONLY === null || h.continent === ONLY);
const specs: GameSpec[] = homes.flatMap(({ home }) => SEEDS.map((seed) => ({ home, seed, player: 'steady' as const, days: DAYS, season: SEASON })));
const workers = workersFor(specs.length, process.argv);
const started = Date.now();
const results = await playGames(specs, workers);

console.log('');
console.log(`  Global balance · steady player · Medium · ${SEASON} start · ${DAYS} days · ${SEEDS.length} seeds a home`);
console.log('');
console.log('  home         median    range               bust (day)       planes  mkts  tiers');
let continent: Continent | null = null;
for (const { home, continent: c, strength } of homes) {
  if (c !== continent) {
    continent = c;
    console.log(`  ${c}`);
  }
  const games = results.filter((r) => r.home === home);
  const busts = games.filter((r) => r.bustDay !== null);
  const flying = games.filter((r) => r.bustDay === null);
  const cash = games.map((r) => r.cash);
  const average = (pick: (r: RunResult) => number) => (flying.length > 0 ? Math.round(flying.reduce((sum, r) => sum + pick(r), 0) / flying.length) : 0);
  const bustText = `${busts.length}/${games.length}${busts.length > 0 ? ` (${busts.map((r) => r.bustDay).join(',')})` : ''}`;
  console.log(
    `  ${home} ${strength.padEnd(6)}  ${money(median(cash)).padStart(7)}  ${`${money(Math.min(...cash))} to ${money(Math.max(...cash))}`.padEnd(18)}  ${bustText.padEnd(15)}  ${String(average((r) => r.planes)).padStart(6)}  ${String(average((r) => r.markets)).padStart(4)}  ${String(average((r) => r.tiers)).padStart(5)}`,
  );
}
console.log('');
console.log('  planes, markets and tiers are averages over the airlines still flying at the end.');
console.log(`  ${results.length} games in ${Math.round((Date.now() - started) / 1000)} s, ${workers} at a time.`);
console.log('');

writeFileSync(lastPath, JSON.stringify({ savedAt: new Date().toISOString(), season: SEASON, days: DAYS, homes, results }, null, 2) + '\n');
