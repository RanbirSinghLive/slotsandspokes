// The "?" card: every keyboard shortcut the page has, in one place.
// Keep SHORTCUT_GROUPS in step with the key handlers it describes
// (main.ts, jumpBox.ts, routeBuilder.ts, hubPlanner.ts, mapMenu.ts, hillChart.ts).

interface ShortcutGroup {
  title: string;
  rows: Array<[keys: string, what: string]>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Clock',
    rows: [['Space', 'pause / resume']],
  },
  {
    title: 'Map',
    rows: [
      ['1 2 3 4 5', 'lens Network · Profit · On-time · Demand · Rivals'],
      ['O', 'Ops view on / off'],
      ['Esc', 'back one level in the inspector'],
      ['?', 'this card'],
    ],
  },
  {
    title: 'Route builder',
    rows: [
      ['Enter', 'add the pending rotation'],
      ['Esc', 'cancel the route · close the ring or hub planner'],
    ],
  },
  {
    title: 'Jump box',
    rows: [
      ['/ · ⌘K · Ctrl+K', 'open / close'],
      ['↑ ↓', 'move through results'],
      ['Enter', 'go to result'],
      ['Esc', 'close'],
    ],
  },
  {
    title: 'Sliders',
    rows: [['← →', 'step the focused slider']],
  },
];

let overlay: HTMLDivElement | null = null;

function buildCard(): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  root.hidden = true;
  const box = document.createElement('div');
  box.className = 'modal-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Keyboard shortcuts');
  const heading = document.createElement('h2');
  heading.textContent = 'Shortcuts';
  box.appendChild(heading);
  for (const group of SHORTCUT_GROUPS) {
    const title = document.createElement('p');
    title.className = 'modal-subtle';
    title.textContent = group.title;
    box.appendChild(title);
    const list = document.createElement('table');
    for (const [keys, what] of group.rows) {
      const row = list.insertRow();
      row.insertCell().textContent = keys;
      row.insertCell().textContent = what;
      row.cells[0].style.paddingRight = '16px';
      row.cells[0].style.color = '#fff';
      row.cells[0].style.whiteSpace = 'nowrap';
    }
    box.appendChild(list);
  }
  root.appendChild(box);
  // A click on the backdrop closes it, as it would on any card.
  root.addEventListener('mousedown', (event) => {
    if (event.target === root) root.hidden = true;
  });
  document.body.appendChild(root);
  return root;
}

export function isShortcutsCardOpen(): boolean {
  return overlay !== null && !overlay.hidden;
}

/** `isBlocked` is true while something else owns the keyboard, such as the home picker. */
export function setupShortcutsCard(isBlocked: () => boolean): void {
  // Capture phase, registered before main.ts's Esc handler, so Esc closes
  // the card and stops there instead of also stepping the inspector back.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isShortcutsCardOpen()) {
        overlay!.hidden = true;
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener('keydown', (event) => {
    if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || isBlocked()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    event.preventDefault();
    overlay ??= buildCard();
    overlay.hidden = !overlay.hidden;
  });
}
