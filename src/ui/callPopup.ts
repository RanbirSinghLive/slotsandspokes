import type { CallKind } from '../sim/controller';
import type { SimState } from '../sim/state';
import { setCallPulse } from '../render/callPulse';
import { CALL_TITLES, flashCallBlockFor } from './callAlert';
import { buildController } from './inspector/aircraft';
import { refreshInspectorForNewDay } from './inspector/inspector';
import { select } from './selection';

/**
 * The popup for a plane that needs a call (ui/callAlert.ts): the plane, where
 * it waits and why, with the same ✕ and ⇄ buttons as the plane page's
 * Needs a call block, so the decision is made without leaving the map. The
 * airport it waits at breathes amber on the map (render/callPulse.ts).
 * It sits below the confirm dialogs (45) and above the phone panel and rail.
 */
const KIND_SYMBOL: Record<CallKind, string> = { curfew: '☾', event: '★', late: '⏱' };

let popup: HTMLElement | null = null;
let onKey: ((event: KeyboardEvent) => void) | null = null;

export function closeCallPopup(): void {
  popup?.remove();
  popup = null;
  setCallPulse(null);
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = null;
}

export function openCallPopup(state: SimState, tail: string, kind: CallKind): void {
  closeCallPopup();
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return;
  const where = aircraft.atAirport ?? aircraft.baseAirport;
  setCallPulse(where);

  const box = document.createElement('div');
  box.className = 'call-popup';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `${tail} needs a call`);
  popup = box;

  const header = document.createElement('div');
  header.className = 'call-popup-head';
  const title = document.createElement('span');
  title.className = 'call-popup-title';
  title.textContent = `✋ ${tail} · ${where} · ${KIND_SYMBOL[kind]}`;
  title.title = CALL_TITLES[kind];
  title.dataset.tip = CALL_TITLES[kind];
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = '↗';
  open.title = 'Open the plane';
  open.setAttribute('aria-label', 'Open the plane');
  open.addEventListener('click', () => {
    flashCallBlockFor(tail);
    select({ kind: 'aircraft', tail });
    closeCallPopup();
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeCallPopup);
  header.append(title, open, close);

  const body = document.createElement('div');
  body.className = 'call-popup-body';
  const fill = (): void => {
    const block = buildController(state, tail, changed);
    if (!block) {
      closeCallPopup();
      return;
    }
    body.replaceChildren(block);
  };
  // An action here changes the plane's page too, if it is the one open.
  const changed = (): void => {
    refreshInspectorForNewDay(state);
    fill();
  };
  fill();
  if (popup !== box) return;

  box.append(header, body);
  document.body.append(box);
  onKey = (event) => {
    if (event.key === 'Escape' && !document.querySelector('.modal-overlay:not([hidden])')) closeCallPopup();
  };
  document.addEventListener('keydown', onKey);
}
