import { marketKey } from '../sim/schedule';

/**
 * What the side panel is showing: the inspector (ui/inspector/). Map
 * clicks, links in the panel and its breadcrumb all change it through
 * select(), so there is one answer to "what is the player looking at",
 * which the panel and the map's highlight both read.
 *
 * UI state only. It never goes in SimState: it isn't part of the game,
 * isn't saved, and the simulation never reads it.
 */
export type Selection =
  | { kind: 'network' }
  | { kind: 'airports' }
  | { kind: 'airport'; iata: string }
  /** A route, `a` first: the airport the breadcrumb leads through (its base, when opened from the map). */
  | { kind: 'route'; a: string; b: string };

export const NETWORK: Selection = { kind: 'network' };

/** How many earlier selections Back remembers. */
const HISTORY_LIMIT = 50;

let current: Selection = NETWORK;
let history: Selection[] = [];
const listeners: (() => void)[] = [];

export function getSelection(): Selection {
  return current;
}

function sameSelection(x: Selection, y: Selection): boolean {
  if (x.kind === 'route' && y.kind === 'route') return marketKey(x.a, x.b) === marketKey(y.a, y.b);
  if (x.kind === 'airport' && y.kind === 'airport') return x.iata === y.iata;
  return x.kind === y.kind;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Show `next`, remembering what was showing for Back. Selecting Network starts the history over. */
export function select(next: Selection): void {
  if (sameSelection(next, current)) return;
  history = next.kind === 'network' ? [] : [...history, current].slice(-HISTORY_LIMIT);
  current = next;
  notify();
}

/** Show `next` in place of the current selection without adding to the history: for a selection that has stopped existing. */
export function replaceSelection(next: Selection): void {
  if (sameSelection(next, current)) return;
  current = next;
  notify();
}

/** Step back to the previous selection, or to Network. False when already at Network with nothing to go back to. */
export function back(): boolean {
  if (current.kind === 'network' && history.length === 0) return false;
  current = history.pop() ?? NETWORK;
  notify();
  return true;
}

export function onSelectionChange(listener: () => void): void {
  listeners.push(listener);
}
