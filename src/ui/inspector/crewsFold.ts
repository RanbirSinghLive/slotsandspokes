/**
 * Folding sections on the Crews screen: crew bases on the Bases side,
 * aircraft types on the Pairings side. Which are folded is remembered in
 * the browser, so the screen opens the way it was left; a blocked
 * localStorage (private window) just means everything opens unfolded.
 */

const FOLD_KEY = 'slotsandspokes-crews-folded';

function readFolded(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Folded sections, keyed "base:YUL" on the Bases side and "type:PROP" on the Pairings side. */
const folded = readFolded();

export function isFolded(key: string): boolean {
  return folded.has(key);
}

function toggleFold(key: string): void {
  if (folded.has(key)) folded.delete(key);
  else folded.add(key);
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
  } catch {
    // Not remembered; the fold still works for this visit.
  }
}

/** A section header that folds what's under it: the chevron, then whatever the caller puts in. */
export function foldHeader(key: string, changed: () => void, ...content: (Node | string)[]): HTMLButtonElement {
  const shut = folded.has(key);
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'crew-fold';
  header.setAttribute('aria-expanded', String(!shut));
  header.append(`${shut ? '▸' : '▾'} `, ...content);
  header.addEventListener('click', () => {
    toggleFold(key);
    changed();
  });
  return header;
}
