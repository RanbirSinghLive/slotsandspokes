import { isInsolvent } from '../sim/insolvency';
import { clearSavedState } from './save';
import type { SimState } from '../sim/state';

/**
 * The game-over screen: shown the moment Cash runs out (sim/insolvency.ts),
 * with one way forward, a new game.
 */

const gameOverModal = document.querySelector<HTMLDivElement>('#game-over-modal')!;
const gameOverReasonEl = document.querySelector<HTMLParagraphElement>('#game-over-reason')!;
const gameOverNewGameButton = document.querySelector<HTMLButtonElement>('#game-over-new-game')!;

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/** Wire the new-game button. Called once at startup. */
export function setupGameOver(): void {
  // No separate confirmation: reaching this screen means the game is over.
  gameOverNewGameButton.addEventListener('click', () => {
    clearSavedState();
    window.location.reload();
  });
}

/**
 * Show or hide the screen, every frame. Returns whether the game is over,
 * so main.ts can stop the clock the moment it is.
 */
export function updateGameOver(state: SimState): boolean {
  const insolvent = isInsolvent(state);
  gameOverModal.hidden = !insolvent;
  if (insolvent) gameOverReasonEl.textContent = `Cash has run out (${formatMoney(state.cash)}). This airline is finished.`;
  return insolvent;
}
