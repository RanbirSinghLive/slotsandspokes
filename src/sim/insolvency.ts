import type { SimState } from './state';

/**
 * The game's failure state: Cash has hit zero, and the airline is
 * finished. The browser checks it every frame (ui/gameOver.ts shows the
 * game-over screen, and main.ts stops the clock), and the headless runners
 * check it every simulated minute, so a run stops exactly where a real
 * game would. There's no borrowing: the runway warning (ui/runway.ts)
 * gives notice before this, and what the player does with it is the game.
 */
export function isInsolvent(state: SimState): boolean {
  return state.cash <= 0;
}
