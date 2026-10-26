/**
 * The (i) marks' words. Hovering one with a mouse shows them in a floating
 * tip at once; tapping or clicking one opens them as a note in the panel
 * that stays until tapped again (see openNotes below). The mark is a real
 * `<button>` carrying `data-info`, so it is tappable and keyboard-focusable.
 *
 * One delegated set of listeners on the panel rather than one per mark:
 * several panels rebuild their DOM wholesale on every refresh, and
 * per-element listeners would either leak or vanish depending on which.
 */

const tooltip = document.querySelector<HTMLDivElement>('#info-tooltip')!;

const OFFSET_PX = 14;

const TOUCH_TIP_MS = 2200;
const TOUCH_TIP_MS_PER_CHAR = 40;
const TOUCH_TIP_MAX_MS = 8000;
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

/**
 * A tapped or clicked (i) opens its words as a note in the panel, under the
 * line it explains, and keeps it there until it is tapped again. A floating
 * tip that hides itself after two seconds can't be read on a phone, and
 * these are paragraphs. Panels rebuild their DOM on every refresh, so which
 * notes are open is kept by key and put back after each rebuild.
 */
const openNotes = new Set<string>();

/** The same explanation keeps its note open while its numbers change. */
function noteKey(mark: HTMLElement): string {
  return (mark.dataset.info ?? '').replace(/[−\-+$]?[\d.,]+[%kmMd]?/g, '#').slice(0, 80);
}

/** The block the mark sits in: the note goes right after it, or at the end of a table cell. */
function noteHost(mark: HTMLElement): { parent: Element; after: Element | null } {
  const cell = mark.closest('td, th');
  if (cell) return { parent: cell, after: null };
  const block = mark.closest('h2, h3, h4, p, li, .inspector-line') ?? mark.parentElement!;
  return { parent: block.parentElement ?? block, after: block };
}

function noteFor(mark: HTMLElement): HTMLElement | null {
  const { parent, after } = noteHost(mark);
  const next = after ? after.nextElementSibling : parent.lastElementChild;
  return next?.classList.contains('info-note') && (next as HTMLElement).dataset.key === noteKey(mark) ? (next as HTMLElement) : null;
}

function openNote(mark: HTMLElement): void {
  if (noteFor(mark)) return;
  const note = document.createElement('div');
  note.className = 'info-note';
  note.dataset.key = noteKey(mark);
  note.textContent = mark.dataset.info ?? '';
  const { parent, after } = noteHost(mark);
  if (after) after.after(note);
  else parent.append(note);
  mark.classList.add('is-open');
  mark.setAttribute('aria-expanded', 'true');
}

function closeNote(mark: HTMLElement): void {
  noteFor(mark)?.remove();
  mark.classList.remove('is-open');
  mark.setAttribute('aria-expanded', 'false');
}

function toggleNote(mark: HTMLElement): void {
  const key = noteKey(mark);
  if (openNotes.has(key)) {
    openNotes.delete(key);
    closeNote(mark);
  } else {
    openNotes.add(key);
    openNote(mark);
  }
}

/** After a panel rebuilds, the notes the player left open come back. */
function restoreNotes(panel: HTMLElement): void {
  if (openNotes.size === 0) return;
  for (const mark of panel.querySelectorAll<HTMLElement>('.info-mark[data-info]')) {
    if (openNotes.has(noteKey(mark))) openNote(mark);
  }
}

export function setupInfoTooltips(): void {
  const panel = document.querySelector<HTMLElement>('#panel');
  if (!panel) return;

  const markFrom = (target: EventTarget | null): HTMLElement | null => {
    // An Element, not an HTMLElement: an icon mark's svg is the event target.
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('.info-mark');
  };

  // A mouse still gets the quick look on hover; the note is for reading.
  panel.addEventListener('mouseover', (event) => {
    if (isTouch()) return;
    const mark = markFrom(event.target);
    if (mark && !mark.classList.contains('is-open')) show(mark);
  });
  panel.addEventListener('mouseout', (event) => {
    if (markFrom(event.target)) hide();
  });
  // Tabbing to a mark shows its words; Enter opens the note like a click.
  panel.addEventListener('focusin', (event) => {
    if (isTouch()) return;
    const mark = markFrom(event.target);
    if (mark && event.target instanceof HTMLElement && event.target.matches(':focus-visible')) show(mark);
  });
  panel.addEventListener('focusout', (event) => {
    if (markFrom(event.target)) hide();
  });
  panel.addEventListener('click', (event) => {
    const mark = markFrom(event.target);
    if (mark) {
      hide();
      toggleNote(mark);
      return;
    }
    // Tapping an open note puts it away.
    const note = event.target instanceof Element ? event.target.closest<HTMLElement>('.info-note') : null;
    if (note) {
      openNotes.delete(note.dataset.key ?? '');
      const owner = [...panel.querySelectorAll<HTMLElement>('.info-mark.is-open')].find((each) => noteKey(each) === note.dataset.key);
      if (owner) closeNote(owner);
      else note.remove();
      return;
    }
    // A [data-tip] icon shows its own tip on tap (ui/mapTools.ts); leave it up.
    if (!(event.target instanceof Element && event.target.closest('[data-tip]'))) hide();
  });

  let restoring = false;
  new MutationObserver(() => {
    if (restoring) return;
    restoring = true;
    requestAnimationFrame(() => {
      restoreNotes(panel);
      restoring = false;
    });
  }).observe(panel, { childList: true, subtree: true });

  // A native `title` never shows on touch. Tapping a bar, mark or row that
  // has one flashes it in the same box, for longer the more there is to read.
  // Buttons are left alone: tapping one does its job.
  let hideTimer = 0;
  document.addEventListener('click', (event) => {
    if (!isTouch() || !(event.target instanceof Element)) return;
    const holder = event.target.closest<HTMLElement>('[title]');
    if (!holder || holder.closest('button, a, input, select, tr, .info-mark')) return;
    window.clearTimeout(hideTimer);
    show(holder, holder.title);
    hideTimer = window.setTimeout(hide, Math.min(TOUCH_TIP_MAX_MS, TOUCH_TIP_MS + holder.title.length * TOUCH_TIP_MS_PER_CHAR));
  });
}
