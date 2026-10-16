import { drawNetworkCard } from '../render/networkCard';
import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { wireDialogTips } from './mapTools';

/**
 * The share-card button on the map tools (index.html's #share-network): opens
 * the picture of the network (render/networkCard.ts) with icon buttons to
 * share it, save it, or copy it. A button only appears where the browser can
 * do that: sharing a file is mostly a phone's feature, copying an image
 * needs the clipboard's image support.
 */

const ICONS = {
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  save: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 19h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
};

let closeOpen: (() => void) | null = null;

export function setupNetworkCardButton(getState: () => SimState): void {
  const button = document.querySelector<HTMLButtonElement>('#share-network');
  button?.addEventListener('click', () => void openNetworkCard(getState()));
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image')), 'image/png')));
}

function iconButton(icon: keyof typeof ICONS, tip: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool';
  button.dataset.tip = tip;
  button.setAttribute('aria-label', tip);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return button;
}

/** Show a button's tick for a moment: the tip text can't be read on a phone while the finger covers it. */
function flashDone(button: HTMLButtonElement): void {
  button.classList.add('is-done');
  window.setTimeout(() => button.classList.remove('is-done'), 1400);
}

async function openNetworkCard(state: SimState): Promise<void> {
  closeOpen?.();
  const canvas = await drawNetworkCard(state);
  const blob = await canvasBlob(canvas);
  const fileName = `slots-and-spokes-${state.homeAirport}-day${dayIndex(state)}.png`;
  const file = new File([blob], fileName, { type: 'image/png' });
  const url = URL.createObjectURL(blob);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--card';
  const box = document.createElement('div');
  box.className = 'modal-box modal-box--card';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Network card');
  const image = document.createElement('img');
  image.className = 'network-card-image';
  image.src = url;
  image.alt = `Network map, ${state.homeAirport}, day ${dayIndex(state)}`;
  const actions = document.createElement('div');
  actions.className = 'network-card-actions';

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    const share = iconButton('share', 'Share');
    share.addEventListener('click', () => {
      // Cancelling the share sheet rejects; that is not an error worth showing.
      navigator.share({ files: [file], title: 'Slots & Spokes' }).catch(() => undefined);
    });
    actions.append(share);
  }
  const save = iconButton('save', 'Save image');
  save.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    flashDone(save);
  });
  actions.append(save);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const copy = iconButton('copy', 'Copy image');
    copy.addEventListener('click', () => {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(() => flashDone(copy))
        .catch(() => undefined);
    });
    actions.append(copy);
  }
  const close = iconButton('close', 'Close');
  actions.append(close);

  box.append(image, actions);
  overlay.append(box);
  document.body.append(overlay);
  wireDialogTips(box);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss();
  };
  const dismiss = (): void => {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey);
    closeOpen = null;
  };
  closeOpen = dismiss;
  document.addEventListener('keydown', onKey);
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dismiss();
  });
}
