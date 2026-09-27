import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { playOne, type GameSpec, type RunResult } from './balanceGame';

/**
 * Many headless games at once (the balance report, the home ratings):
 * one worker thread per spare core (balanceWorker.ts), each handed the
 * next game as it finishes one. Every game is seeded and independent, so
 * the results are exactly those of playing them one at a time, only
 * sooner; they come back in the order asked for. `--workers 1` on the
 * command line plays them one at a time in this process instead.
 */

/** How long a player's year takes, roughly, so the long games go out first and the last to finish isn't a slow one. */
const PLAYER_WEIGHT: Record<string, number> = { bold: 5, steady: 5, sitter: 3, starter: 1, reckless: 1 };

/** Workers for this many games: `--workers N` from the command line, else one per spare core. */
export function workersFor(games: number, argv: string[]): number {
  const at = argv.indexOf('--workers');
  const asked = at === -1 ? null : Number(argv[at + 1]) || 1;
  return Math.max(1, Math.min(games, asked ?? availableParallelism() - 1));
}

function progress(done: number, total: number): void {
  // A progress line that rewrites itself, only where a terminal can show that.
  if (process.stdout.isTTY) process.stdout.write(`\r  ${done} of ${total} games   `);
  if (process.stdout.isTTY && done === total) process.stdout.write('\r' + ' '.repeat(40) + '\r');
}

const WORKER_URL = new URL('./balanceWorker.ts', import.meta.url).href;

export function playGames(specs: GameSpec[], workers: number): Promise<RunResult[]> {
  if (workers <= 1) {
    return Promise.resolve(
      specs.map((spec, i) => {
        const result = playOne(spec);
        progress(i + 1, specs.length);
        return result;
      }),
    );
  }
  // Longest first, by player and length of run.
  const order = specs.map((_, i) => i).sort((a, b) => (PLAYER_WEIGHT[specs[b].player] ?? 1) * specs[b].days - (PLAYER_WEIGHT[specs[a].player] ?? 1) * specs[a].days);
  return new Promise((resolve, reject) => {
    const results: RunResult[] = new Array(specs.length);
    let next = 0;
    let done = 0;
    let running = workers;
    for (let w = 0; w < workers; w++) {
      // A worker can't start from a .ts file directly, so it starts from
      // this one line: register tsx (as `npm run` does for this process),
      // then load the TypeScript worker.
      const worker = new Worker(
        `import('tsx/esm/api').then(({ register }) => { register(); return import(${JSON.stringify(WORKER_URL)}); });`,
        { eval: true },
      );
      const handOut = () => {
        if (next < order.length) {
          const index = order[next++];
          worker.postMessage({ index, spec: specs[index] });
        } else {
          void worker.terminate();
          if (--running === 0) resolve(results);
        }
      };
      worker.on('message', ({ index, result }: { index: number; result: RunResult }) => {
        results[index] = result;
        progress(++done, specs.length);
        handOut();
      });
      worker.on('error', reject);
      handOut();
    }
  });
}
