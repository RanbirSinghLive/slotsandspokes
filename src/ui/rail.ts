import type { SimState } from '../sim/state';
import { getSelection, select, type Selection } from './selection';

/**
 * The rail down the side panel's left edge: every screen one click away,
 * and still there with the panel hidden, when clicking an item slides the
 * panel open straight to it. Clicking the screen already showing hides
 * the panel, so the rail is also the panel's handle.
 */

const railEl = document.querySelector<HTMLElement>('#rail')!;
const items = [...railEl.querySelectorAll<HTMLButtonElement>('.rail-item[data-go]')];
const hideButton = railEl.querySelector<HTMLButtonElement>('#rail-hide')!;

type Screen = 'network' | 'routes' | 'airports' | 'fleet' | 'crews' | 'rivals' | 'money' | 'goals' | 'headOffice' | 'game';

/** Where each rail item goes. Routes opens worst margin first. */
function targetOf(screen: Screen): Selection {
  return screen === 'routes' ? { kind: 'routes', sort: 'margin' } : ({ kind: screen } as Selection);
}

/** The rail item a selection sits under, the one lit while it shows. */
function screenOf(selection: Selection): Screen {
  switch (selection.kind) {
    case 'route':
    case 'routes':
      return 'routes';
    case 'airport':
      return 'airports';
    case 'aircraft':
      return 'fleet';
    case 'rival':
      return 'rivals';
    default:
      return selection.kind;
  }
}

export function setupRail(panel: { isHidden: () => boolean; setHidden: (hidden: boolean) => void }): void {
  for (const item of items) {
    item.addEventListener('click', () => {
      const screen = item.dataset.go as Screen;
      if (!panel.isHidden() && screenOf(getSelection()) === screen) {
        panel.setHidden(true);
        return;
      }
      if (panel.isHidden()) panel.setHidden(false);
      select(targetOf(screen));
    });
  }
  hideButton.addEventListener('click', () => panel.setHidden(!panel.isHidden()));
}

/** Light the current screen's item, and say which way the hide button goes. Cheap: called every frame. */
export function updateRail(_state: SimState, panelHidden: boolean): void {
  const current = screenOf(getSelection());
  for (const item of items) item.classList.toggle('is-active', !panelHidden && item.dataset.go === current);
  hideButton.classList.toggle('is-active', panelHidden);
  const label = hideButton.querySelector('.rail-label')!;
  if (label.textContent !== (panelHidden ? 'Show' : 'Hide')) {
    label.textContent = panelHidden ? 'Show' : 'Hide';
    hideButton.title = panelHidden ? 'Show the side panel' : 'Hide the side panel (the map fills the screen)';
    hideButton.setAttribute('aria-label', panelHidden ? 'Show panel' : 'Hide panel');
  }
}
