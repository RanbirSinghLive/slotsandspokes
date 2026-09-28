import { downloadText } from './save';
import { GAME_VERSION } from './version';

/**
 * When something goes wrong, say so and keep the player's game safe,
 * instead of a frozen map: a card over everything with what happened,
 * the build it happened on, a download of the save to keep or send with
 * a report, and what to do next. Used for a save this build can't read
 * (main.ts) and for a crash (setupCrashCatcher() below).
 */

type ProblemCard = {
  title: string;
  message: string;
  /** Technical detail for a report (the error), shown small and copyable. */
  detail?: string;
  /** The save to offer as a download, when there is one. */
  saveText?: () => string | null;
  /** The card's buttons besides the download, each closing it. */
  actions: { label: string; run: () => void }[];
};

let showing = false;

export function showProblemCard(card: ProblemCard): void {
  if (showing) return; // one at a time: a crash loop shouldn't stack cards
  showing = true;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay problem-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box problem-card';
  box.setAttribute('role', 'alertdialog');
  const title = document.createElement('h2');
  title.textContent = card.title;
  const message = document.createElement('p');
  message.textContent = card.message;
  box.append(title, message);
  if (card.detail) {
    const detail = document.createElement('pre');
    detail.className = 'problem-detail';
    detail.textContent = `Slots & Spokes ${GAME_VERSION}\n${card.detail}`;
    box.append(detail);
  }
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const close = () => {
    overlay.remove();
    showing = false;
  };
  const text = card.saveText?.();
  if (text) {
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = 'Download save';
    download.addEventListener('click', () => downloadText(`slotsandspokes-save-${GAME_VERSION}.json`, text));
    actions.append(download);
  }
  for (const action of card.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      close();
      action.run();
    });
    actions.append(button);
  }
  box.append(actions);
  overlay.append(box);
  document.body.append(overlay);
}

/**
 * Catch anything uncaught (an error in the frame loop, a promise that
 * rejects) and show it: `pause` stops the clock first, so nothing more
 * happens to the game while the player reads it, and the save offered is
 * the game as it stands.
 */
export function setupCrashCatcher(pause: () => void, currentSave: () => string | null): void {
  const report = (error: unknown) => {
    pause();
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}`.trim() : String(error);
    showProblemCard({
      title: 'Something broke',
      message:
        'The game hit an error and has paused. Download your save to keep it safe, then reload to carry on from your last save. If you can, send the save and the text below with what you were doing.',
      detail,
      saveText: currentSave,
      actions: [{ label: 'Reload', run: () => window.location.reload() }],
    });
  };
  window.addEventListener('error', (event) => report(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => report(event.reason));
}
