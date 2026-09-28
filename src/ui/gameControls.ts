import { saveState, clearSavedState, hasSavedState, downloadText, importSaveText, saveFileText, SAVE_FORMAT } from './save';
import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { GAME_VERSION } from './version';

/**
 * The Game screen: Save, Load, the save as a file (export and import),
 * New Game, and About (the build and the credits). Saving also happens
 * automatically once per simulated day (ui/save.ts); these let the player
 * force one, step back to the last one, or move it between browsers.
 */

const exportSaveButton = document.querySelector<HTMLButtonElement>('#export-save-button')!;
const importSaveButton = document.querySelector<HTMLButtonElement>('#import-save-button')!;
const importSaveInput = document.querySelector<HTMLInputElement>('#import-save-input')!;
const saveFileStatus = document.querySelector<HTMLDivElement>('#save-file-status')!;
const aboutVersion = document.querySelector<HTMLDivElement>('#about-version')!;

const saveGameButton = document.querySelector<HTMLButtonElement>('#save-game-button')!;
const saveGameStatus = document.querySelector<HTMLDivElement>('#save-game-status')!;

const loadGameButton = document.querySelector<HTMLButtonElement>('#load-game-button')!;
const loadGameConfirmEl = document.querySelector<HTMLDivElement>('#load-game-confirm')!;
const loadGameConfirmYes = document.querySelector<HTMLButtonElement>('#load-game-confirm-yes')!;
const loadGameConfirmCancel = document.querySelector<HTMLButtonElement>('#load-game-confirm-cancel')!;

// Same "real inline confirmation, not window.confirm()" reasoning New
// Game's own confirm already documented — native dialogs are silently
// blocked in some embedded/preview browser contexts.
const newGameButton = document.querySelector<HTMLButtonElement>('#new-game-button')!;
const newGameConfirmEl = document.querySelector<HTMLDivElement>('#new-game-confirm')!;
const newGameConfirmYes = document.querySelector<HTMLButtonElement>('#new-game-confirm-yes')!;
const newGameConfirmCancel = document.querySelector<HTMLButtonElement>('#new-game-confirm-cancel')!;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClockTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Wire up all three controls. Called once at startup, same as every
 * other panel's setup function — `state` is captured once here rather
 * than threaded through each handler separately, since none of these
 * three actions need anything else from the running game.
 */
export function setupGameControls(state: SimState): void {
  saveGameButton.addEventListener('click', () => {
    saveState(state);
    saveGameStatus.textContent = `Saved at ${formatClockTime(new Date())}.`;
    updateGameControls(); // a save now just made Load meaningful, if it wasn't already
  });

  loadGameButton.addEventListener('click', () => {
    if (loadGameButton.disabled) return; // nothing saved yet — see updateGameControls()
    loadGameButton.hidden = true;
    loadGameConfirmEl.hidden = false;
  });

  loadGameConfirmYes.addEventListener('click', () => {
    // No explicit "read the save and apply it" step needed — main.ts's
    // own `loadSavedState() ?? createNewGameState()` runs fresh on any
    // page load, so reloading *is* how this game loads a save, the exact
    // same path a browser refresh already takes.
    window.location.reload();
  });

  loadGameConfirmCancel.addEventListener('click', () => {
    loadGameConfirmEl.hidden = true;
    loadGameButton.hidden = false;
  });

  // The save as a file: named for the home and the day, so a player with
  // several can tell them apart.
  exportSaveButton.addEventListener('click', () => {
    downloadText(`slotsandspokes-${state.homeAirport}-day${dayIndex(state)}.json`, saveFileText(state));
    saveFileStatus.textContent = 'Exported.';
  });
  importSaveButton.addEventListener('click', () => importSaveInput.click());
  importSaveInput.addEventListener('change', async () => {
    const file = importSaveInput.files?.[0];
    importSaveInput.value = '';
    if (!file) return;
    const result = importSaveText(await file.text());
    if (!result.ok) {
      saveFileStatus.textContent = result.reason;
      return;
    }
    // Like Load: the page reads the save afresh on load.
    window.location.reload();
  });

  aboutVersion.textContent = `Slots & Spokes ${GAME_VERSION} · alpha · save format ${SAVE_FORMAT}`;

  newGameButton.addEventListener('click', () => {
    newGameButton.hidden = true;
    newGameConfirmEl.hidden = false;
  });

  newGameConfirmYes.addEventListener('click', () => {
    clearSavedState();
    window.location.reload();
  });

  newGameConfirmCancel.addEventListener('click', () => {
    newGameConfirmEl.hidden = true;
    newGameButton.hidden = false;
  });

  updateGameControls();
}

/**
 * Refresh whatever depends on whether a save currently exists — called
 * once at startup and again whenever the Game tab becomes visible, in
 * case a day rolled over (an automatic save) or Save Game was clicked
 * while looking at a different tab.
 */
export function updateGameControls(): void {
  loadGameButton.disabled = !hasSavedState();
}
