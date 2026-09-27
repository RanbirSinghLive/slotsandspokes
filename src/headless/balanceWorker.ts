import { parentPort } from 'node:worker_threads';
import { playOne, type GameSpec } from './balanceGame';

/**
 * A balance-report worker thread (src/headless/balance.ts): plays each
 * game it's handed and sends the result back.
 */
parentPort!.on('message', ({ index, spec }: { index: number; spec: GameSpec }) => {
  parentPort!.postMessage({ index, result: playOne(spec) });
});
