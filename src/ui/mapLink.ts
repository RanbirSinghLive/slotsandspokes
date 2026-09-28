import type { Selection } from './selection';

/**
 * Rows in the panel that point at something on the map: hovering one
 * marks it there (main.ts's render() draws the mark the same way it draws
 * the selection), so the panel and the map point at each other. A row
 * opts in with linkToMap(); one delegated listener on the panel finds it,
 * since views rebuild their rows wholesale.
 */

const links = new WeakMap<Element, Selection>();
let hovered: Selection | null = null;

/** Mark `target` on the map while the pointer is over `el`. */
export function linkToMap<T extends HTMLElement>(el: T, target: Selection): T {
  links.set(el, target);
  return el;
}

/**
 * Forget the hovered row: for when rows go away without the pointer
 * leaving them (the panel hidden, a view rebuilt under it).
 */
export function clearMapHover(): void {
  hovered = null;
}

/** What the panel row under the pointer points at, or null. */
export function getMapHover(): Selection | null {
  return hovered;
}

function linkedFrom(node: EventTarget | null): Selection | null {
  for (let el = node instanceof Element ? node : null; el; el = el.parentElement) {
    const target = links.get(el);
    if (target) return target;
  }
  return null;
}

export function setupMapLinks(changed: () => void): void {
  const panel = document.querySelector('#panel')!;
  panel.addEventListener('mouseover', (event) => {
    const next = linkedFrom(event.target);
    if (next === hovered) return;
    hovered = next;
    changed();
  });
  panel.addEventListener('mouseleave', () => {
    if (hovered === null) return;
    hovered = null;
    changed();
  });
}
