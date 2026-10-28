import { glyph } from './glyphs';
import { viewSwitch, type ViewChoice } from './inspector/dom';
import { select, type Selection } from './selection';

/**
 * Screens that sit under another rail icon as one of its views: Goals
 * under Overview, Fuel under Money, Contracts under Office. Each keeps
 * its own selection kind, so search, the Overview cards and the
 * tutorial still open it by name; the rail lights its parent, and the
 * parent's icon opens whichever screen of its group showed last.
 */
const FOLDED_UNDER: Record<string, string> = { goals: 'network', fuel: 'money', contracts: 'headOffice' };

/** The rail icon a screen sits under: its parent when folded, else itself. */
export function railItemOf(screen: string): string {
  return FOLDED_UNDER[screen] ?? screen;
}

/** The screens folded under a rail icon. */
export function foldedUnder(parent: string): string[] {
  return Object.keys(FOLDED_UNDER).filter((screen) => FOLDED_UNDER[screen] === parent);
}

const LAST_KEY = 'slotsandspokes-rail-last';

function loadLast(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
    if (saved && typeof saved === 'object') return saved;
  } catch {
    // Storage can be blocked or the value garbled; every icon opens its own screen.
  }
  return {};
}

const lastShown: Record<string, string> = loadLast();

/** Remember the screen showing as its group's last, so the rail icon comes back to it. */
export function noteShown(screen: string): void {
  const parent = railItemOf(screen);
  if (parent === screen && foldedUnder(parent).length === 0) return;
  if (lastShown[parent] === screen) return;
  lastShown[parent] = screen;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(lastShown));
  } catch {
    // Not remembered; fine.
  }
}

/** The screen a rail icon opens: the last of its group shown, or itself. */
export function lastShownUnder(parent: string): string {
  const screen = lastShown[parent];
  return screen && (screen === parent || FOLDED_UNDER[screen] === parent) ? screen : parent;
}

export type Dot = 'bad' | 'warn' | 'good' | null;

const DOT_RANK: Record<string, number> = { bad: 3, warn: 2, good: 1 };

/** The more urgent of two dots. */
export function worstDot(a: Dot, b: Dot): Dot {
  return (DOT_RANK[b ?? ''] ?? 0) > (DOT_RANK[a ?? ''] ?? 0) ? b : a;
}

/** Every screen's own dot, as the rail last worked them out (ui/rail.ts), so a view switch can show them on its choices. */
let screenDots: Partial<Record<string, Dot>> = {};

export function setScreenDots(dots: Partial<Record<string, Dot>>): void {
  screenDots = dots;
}

export function screenDot(screen: string): Dot {
  return screenDots[screen] ?? null;
}

/** A two-screen group's switch: each choice selects its screen, and the one not showing carries its dot. */
function pairSwitch(choices: ViewChoice<string>[], current: string): HTMLElement {
  for (const choice of choices) if (choice.id !== current) choice.dot = screenDot(choice.id);
  return viewSwitch(choices, current, (id) => select({ kind: id } as Selection));
}

export function overviewSwitch(current: 'network' | 'goals'): HTMLElement {
  return pairSwitch(
    [
      { id: 'network', icon: glyph('overview'), tip: 'Overview: the cards and the last 7 days' },
      { id: 'goals', icon: glyph('trophy'), tip: 'Goals: the ladder and its milestones' },
    ],
    current,
  );
}

export function moneySwitch(current: 'money' | 'fuel'): HTMLElement {
  return pairSwitch(
    [
      { id: 'money', icon: glyph('dollar'), tip: 'Money: cash, runway and costs' },
      { id: 'fuel', icon: glyph('fuel'), tip: 'Fuel: price, hedge ladder, surcharge' },
    ],
    current,
  );
}
