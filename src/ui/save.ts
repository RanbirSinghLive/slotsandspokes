import type { SimState } from '../sim/state';
import { ensureCrewBases } from '../sim/crews';
import { GAME_VERSION } from './version';

/**
 * Saves, and keeping them across builds. A player's game must survive an
 * update, so a save is never orphaned by a change to SimState's shape:
 *
 * - Every save sits under one key, SAVE_KEY, wrapped with its **format**
 *   (SAVE_FORMAT when written) and the game version that wrote it.
 * - Loading an older format runs each **migration** after it in order,
 *   bringing the state up to today's shape. So a change to SimState that
 *   an old save can't simply load bumps SAVE_FORMAT and adds a migration
 *   for it here, rather than starting everyone over.
 * - Fields added as optional (`?`, read with `??`) need no migration:
 *   an old save just lacks them.
 * - A save this build can't read (newer than it, or a migration that
 *   fails) is left where it is, not overwritten, and can be downloaded
 *   (ui/gameControls.ts), so nothing is lost.
 *
 * Saves from before this scheme, under the retired LEGACY_KEY, are
 * picked up once and carried over as format 1.
 *
 * This works because `SimState` survives `JSON.parse(JSON.stringify(state))`
 * unchanged (CLAUDE.md's rule): a save is exactly that round trip.
 */
const SAVE_KEY = 'slotsandspokes-save';
const LEGACY_KEY = 'airgame-save-v46';

/** The shape of SimState this build writes. Bump it with a migration below. */
export const SAVE_FORMAT = 1;

type SaveFile = { format: number; gameVersion: string; savedAt?: string; state: SimState };

/**
 * One step per format after the first: `MIGRATIONS[n]` turns a format
 * n − 1 state into format n. Each is plain code over the parsed JSON.
 */
const MIGRATIONS: Record<number, (state: SimState) => void> = {};

/**
 * Upgrades every load gets, whatever its format: fixes for older shapes
 * that predate formats, safe to run again on a current save.
 */
function normalise(state: SimState): void {
  // The map reads crews on the very first frame, before any rollover would (sim/crews.ts).
  ensureCrewBases(state);
}

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'loaded'; state: SimState; from: number }
  | { kind: 'unreadable'; reason: string; raw: string };

/** Bring a parsed save file up to SAVE_FORMAT, or say why it can't be. */
export function upgradeSave(file: SaveFile): { ok: true; state: SimState } | { ok: false; reason: string } {
  if (typeof file?.format !== 'number' || typeof file.state !== 'object' || file.state === null) {
    return { ok: false, reason: 'Not a Slots & Spokes save.' };
  }
  if (file.format > SAVE_FORMAT) {
    return { ok: false, reason: `This save is from a newer build (${file.gameVersion}). Reload to get the latest.` };
  }
  const state = file.state;
  if (typeof state.simMinute !== 'number' || !Array.isArray(state.aircraft) || !Array.isArray(state.schedule)) {
    return { ok: false, reason: 'This save is damaged: its game is missing.' };
  }
  try {
    for (let format = file.format + 1; format <= SAVE_FORMAT; format++) MIGRATIONS[format]?.(state);
    normalise(state);
  } catch (error) {
    return { ok: false, reason: `This save couldn't be upgraded (${error instanceof Error ? error.message : String(error)}).` };
  }
  return { ok: true, state };
}

/** Read the save text under a key as a save file: the current wrapper, or a legacy bare state. */
function asSaveFile(raw: string, legacy: boolean): SaveFile {
  const parsed = JSON.parse(raw);
  return legacy ? { format: 1, gameVersion: 'airgame', state: parsed as SimState } : (parsed as SaveFile);
}

/**
 * Read back the saved game. `none` when there isn't one (a fresh game
 * follows); `unreadable` when there is one this build can't load, which
 * main.ts reports and leaves in place.
 */
export function loadSavedState(): LoadResult {
  let raw: string | null = null;
  let legacy = false;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (raw === null) {
      raw = localStorage.getItem(LEGACY_KEY);
      legacy = raw !== null;
    }
  } catch {
    return { kind: 'none' };
  }
  if (raw === null) return { kind: 'none' };
  let file: SaveFile;
  try {
    file = asSaveFile(raw, legacy);
  } catch {
    return { kind: 'unreadable', reason: 'This save is damaged and can\'t be read.', raw };
  }
  const upgraded = upgradeSave(file);
  return upgraded.ok ? { kind: 'loaded', state: upgraded.state, from: file.format } : { kind: 'unreadable', reason: upgraded.reason, raw };
}

/** The save file for a state, as written to storage and to an exported file. */
export function saveFileText(state: SimState): string {
  const file: SaveFile = { format: SAVE_FORMAT, gameVersion: GAME_VERSION, savedAt: new Date().toISOString(), state };
  return JSON.stringify(file);
}

/**
 * Whether saving is held back: set when the stored save couldn't be read,
 * so a fresh game doesn't overwrite it before the player has downloaded it.
 */
let savingHeld = false;

export function holdSaving(held: boolean): void {
  savingHeld = held;
}

/**
 * Persist the current state. Called once per simulated day (main.ts's
 * tick loop): a day-old save is a fine worst case, and writing
 * localStorage 1440× less often than every minute is one less thing to
 * think about. Swallows any error (localStorage disabled in private
 * browsing, quota exceeded): losing one save attempt is an inconvenience,
 * not a reason to stop play. The legacy save, once carried over, goes.
 */
export function saveState(state: SimState): void {
  if (savingHeld) return;
  try {
    localStorage.setItem(SAVE_KEY, saveFileText(state));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignored deliberately — see the note above.
  }
}

/** Clears the save — used by the "New Game" button (ui/gameControls.ts). */
export function clearSavedState(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignored deliberately, same reasoning as saveState().
  }
  savingHeld = false;
}

/** Whether a save exists, for the Game screen's Load button (ui/gameControls.ts). */
export function hasSavedState(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null || localStorage.getItem(LEGACY_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Store an imported save file's text as the save, if it reads: the caller
 * reloads the page to play it. Returns why not, when it doesn't.
 */
export function importSaveText(text: string): { ok: true } | { ok: false; reason: string } {
  let file: SaveFile;
  try {
    file = JSON.parse(text) as SaveFile;
  } catch {
    return { ok: false, reason: 'That file isn\'t a save: it can\'t be read.' };
  }
  const upgraded = upgradeSave(file);
  if (!upgraded.ok) return upgraded;
  try {
    localStorage.setItem(SAVE_KEY, text);
  } catch {
    return { ok: false, reason: 'This browser won\'t store the save (private browsing, or storage full).' };
  }
  savingHeld = false;
  return { ok: true };
}

/** The stored save's raw text, for downloading one this build can't read. */
export function storedSaveText(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

/** Offer `text` as a file download named `name`. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
