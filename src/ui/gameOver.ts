import { isInsolvent } from '../sim/insolvency';
import { money } from './format';
import { clearSavedState } from './save';
import { buildReportBody, feedbackLink } from './yearReport';
import type { SimState } from '../sim/state';

/**
 * The game-over screen: shown the moment Cash runs out (sim/insolvency.ts),
 * with the airline's report (ui/yearReport.ts), the feedback form, and
 * one way forward, a new game.
 */

const gameOverModal = document.querySelector<HTMLDivElement>('#game-over-modal')!;
const gameOverReasonEl = document.querySelector<HTMLParagraphElement>('#game-over-reason')!;
const gameOverNewGameButton = document.querySelector<HTMLButtonElement>('#game-over-new-game')!;
const gameOverReportEl = document.querySelector<HTMLDivElement>('#game-over-report')!;
const gameOverActionsEl = document.querySelector<HTMLDivElement>('#game-over-actions')!;
/** Whether the report has been filled in: once, as the game ends, since nothing changes after. */
let reported = false;

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
  if (insolvent) gameOverReasonEl.textContent = `Cash ${money(state.cash)} · the airline is finished`;
  if (insolvent && !reported) {
    reported = true;
    gameOverReportEl.replaceChildren(buildReportBody(state));
    gameOverActionsEl.prepend(feedbackLink(state, 'Tell us what happened'));
  }
  return insolvent;
}
