/**
 * The ⓘ explanation tooltip.
 *
 * Phase two of the menu-condensing pass folded thirteen paragraphs of
 * explanatory prose into `title` attributes. That was the wrong choice
 * and it showed immediately in testing: a native `title` needs roughly a
 * second of *stationary* hover before the browser deigns to show it,
 * can't be styled to match anything else on screen, and does nothing at
 * all on touch. Text nobody can find is text that may as well have been
 * deleted.
 *
 * This replaces it with the same custom-tooltip pattern the map already
 * uses three times over (route hover, competition, rotation bars):
 * appears instantly, styled like everything else, positioned off the
 * pointer. The mark itself is a real `<button>` carrying `data-info`, so
 * it's tappable, keyboard-focusable, and shows the same text on focus —
 * which is what actually makes the content reachable rather than merely
 * present.
 *
 * One delegated pair of listeners on the sidebar rather than one per
 * mark: several panels rebuild their DOM wholesale on every refresh, and
 * per-element listeners would either leak or vanish depending on which.
 */

const tooltip = document.querySelector<HTMLDivElement>('#info-tooltip')!;

const OFFSET_PX = 14;

const TOUCH_TIP_MS = 2200;
const isTouch = (): boolean => window.matchMedia('(pointer: coarse)').matches;

function show(mark: HTMLElement, text: string | undefined = mark.dataset.info): void {
  if (!text) return;

  tooltip.textContent = text;
  tooltip.hidden = false;

  // Anchor to the mark itself rather than the pointer, so a keyboard
  // focus (which has no pointer position) lands somewhere sensible too.
  const rect = mark.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + OFFSET_PX / 2}px`;

  // Nudge back inside the viewport if the box would overflow — the
  // sidebar's marks sit close to the right edge, so this fires often.
  const box = tooltip.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) {
    tooltip.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
  }
  if (box.bottom > window.innerHeight - 8) {
    tooltip.style.top = `${Math.max(8, rect.top - box.height - OFFSET_PX / 2)}px`;
  }
}

function hide(): void {
  tooltip.hidden = true;
}

export function setupInfoTooltips(): void {
  const panel = document.querySelector<HTMLElement>('#panel');
  if (!panel) return;

  const markFrom = (target: EventTarget | null): HTMLElement | null => {
    // An Element, not an HTMLElement: an icon mark's svg is the event target.
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('.info-mark');
  };

  panel.addEventListener('mouseover', (event) => {
    const mark = markFrom(event.target);
    if (mark) show(mark);
  });
  panel.addEventListener('mouseout', (event) => {
    // A touch screen sends a mouseout right after a tap's click, which would put the tip away before it is read.
    if (isTouch()) return;
    if (markFrom(event.target)) hide();
  });
  // Focus/blur rather than click: tabbing to the mark should reveal it,
  // and a click would need a second click to dismiss.
  panel.addEventListener('focusin', (event) => {
    const mark = markFrom(event.target);
    if (mark) show(mark);
  });
  panel.addEventListener('focusout', (event) => {
    if (markFrom(event.target)) hide();
  });
  // Tapping a mark on touch focuses it, which shows the tooltip; tapping
  // anywhere else should put it away again.
  panel.addEventListener('click', (event) => {
    // A [data-tip] icon shows its own tip on tap (ui/mapTools.ts); leave it up.
    if (!markFrom(event.target) && !(event.target instanceof Element && event.target.closest('[data-tip]'))) hide();
  });

  // A native `title` never shows on touch. Tapping a bar, mark or row that
  // has one flashes it in the same box for a couple of seconds. Buttons are
  // left alone: tapping one does its job, and the ⓘ beside it explains it.
  let hideTimer = 0;
  document.addEventListener('click', (event) => {
    if (!isTouch() || !(event.target instanceof Element)) return;
    const holder = event.target.closest<HTMLElement>('[title]');
    if (!holder || holder.closest('button, a, input, select, tr, .info-mark')) return;
    window.clearTimeout(hideTimer);
    show(holder, holder.title);
    hideTimer = window.setTimeout(hide, TOUCH_TIP_MS);
  });
}
