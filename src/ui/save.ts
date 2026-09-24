import type { SimState } from '../sim/state';

// Bumped by hand whenever SimState's shape changes in a breaking way —
// bare-bones versioning, not a migration system. An old save under a
// retired key is simply never found again (loadSavedState() falls back
// to a fresh game) rather than crashing on a field that no longer
// matches what the current code expects.
const SAVE_KEY = 'airgame-save-v38';

/**
 * Read back whatever createInitialState()/step() last produced, if
 * anything was ever saved — week three's playtest-readiness fix (see
 * WEEK-THREE.md): without this, closing the tab mid-session threw away
 * every schedule edit, fare change, and marketing dollar spent. Returns
 * `null` on missing, corrupted, or unparseable data, so main.ts's
 * fallback to a fresh game is always safe to take.
 *
 * This works at all only because `SimState` is already required to
 * survive `JSON.parse(JSON.stringify(state))` unchanged (CLAUDE.md's
 * rule, true since M1) — a save is *exactly* that round trip, persisted
 * across page loads instead of happening in the same tick.
 */
export function loadSavedState(): SimState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SimState;
  } catch {
    return null;
  }
}

/**
 * Persist the current state. Called once per simulated day (see
 * main.ts's tick loop) rather than every minute — a day-old save is a
 * perfectly fine worst case to resume from, and writing to localStorage
 * 1440x less often than that is one less thing to think about
 * performance-wise. Swallows any error (e.g. localStorage disabled in
 * private browsing, or quota exceeded) rather than interrupting the
 * simulation over a save that didn't happen — losing this one save
 * attempt is a minor inconvenience, not a reason to crash play.
 */
export function saveState(state: SimState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Ignored deliberately — see the note above.
  }
}

/** Clears the save — used by the "New Game" button (main.ts). */
export function clearSavedState(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignored deliberately, same reasoning as saveState().
  }
}

/**
 * Whether a save actually exists right now — the Game tab's own "Load
 * Game" button (ui/gameControls.ts) reads this to disable itself rather
 * than silently doing the same thing "New Game" does (a reload with
 * nothing to load falls through to createNewGameState() just like New
 * Game would, which isn't what clicking "Load" should mean).
 */
export function hasSavedState(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}
