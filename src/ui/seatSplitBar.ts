import { CLASS_ORDER } from '../sim/fareClasses';
import type { FareClassSettings } from '../sim/fareClasses';

/**
 * The seat-map bar with two handles (sim/fareClasses.ts): drag the lines to
 * move the Saver-Flex and Flex-Full split. Used for one route's split
 * (ui/inspector/route.ts) and for the airline-wide one (ui/farePolicy.ts);
 * the caller decides what a move changes.
 */
export function buildSeatSplitBar(options: {
  split: () => FareClassSettings;
  /** Called on every move with the Saver and Flex shares the pointer asks for. */
  move: (saverShare: number, flexShare: number) => void;
  /** Called when the pointer is released after a move. */
  done: () => void;
}): { bar: HTMLElement; redraw: () => void } {
  const bar = document.createElement('div');
  bar.className = 'seat-split';
  const parts = CLASS_ORDER.map((fareClass) => {
    const part = document.createElement('span');
    part.className = `seat-split-${fareClass}`;
    bar.append(part);
    return part;
  });
  const handles = [0, 1].map((i) => {
    const handle = document.createElement('span');
    handle.className = 'seat-split-handle';
    handle.dataset.handle = String(i);
    bar.append(handle);
    return handle;
  });

  const redraw = () => {
    const { saverShare, flexShare } = options.split();
    const shares = [saverShare, flexShare, Math.max(0, 1 - saverShare - flexShare)];
    parts.forEach((part, i) => (part.style.width = `${shares[i] * 100}%`));
    handles[0].style.left = `${saverShare * 100}%`;
    handles[1].style.left = `${(saverShare + flexShare) * 100}%`;
  };

  let dragging: number | null = null;
  const shareFromPointer = (event: PointerEvent) => {
    const rect = bar.getBoundingClientRect();
    return (event.clientX - rect.left) / Math.max(1, rect.width);
  };
  bar.addEventListener('pointerdown', (event) => {
    const at = shareFromPointer(event);
    const { saverShare, flexShare } = options.split();
    // The nearer line is the one being moved.
    dragging = Math.abs(at - saverShare) <= Math.abs(at - (saverShare + flexShare)) ? 0 : 1;
    try {
      bar.setPointerCapture(event.pointerId);
    } catch {
      // Moves still arrive while the pointer stays over the bar.
    }
  });
  bar.addEventListener('pointermove', (event) => {
    if (dragging === null) return;
    const at = Math.max(0, Math.min(1, shareFromPointer(event)));
    const { saverShare, flexShare } = options.split();
    const flexEnd = saverShare + flexShare;
    if (dragging === 0) options.move(Math.min(at, flexEnd), flexEnd - Math.min(at, flexEnd));
    else options.move(saverShare, Math.max(0, at - saverShare));
    redraw();
  });
  const finish = () => {
    if (dragging === null) return;
    dragging = null;
    options.done();
  };
  bar.addEventListener('pointerup', finish);
  bar.addEventListener('pointercancel', finish);
  redraw();
  return { bar, redraw };
}
