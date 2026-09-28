/** The small DOM pieces every inspector view is built from. */

/** A line of text in a view, styled as `className`. */
export function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * The (i) mark: how a mechanic works lives here, one hover away, so the
 * view itself only says what *is* (ui/infoTooltip.ts shows it).
 */
export function info(text: string): HTMLButtonElement {
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.className = 'info-mark';
  mark.setAttribute('aria-label', 'What this means');
  mark.dataset.info = text;
  mark.textContent = 'i';
  return mark;
}

/** A section heading in a view, with an (i) explaining it when given one. */
export function heading(text: string, explanation?: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  if (explanation) el.append(' ', info(explanation));
  return el;
}

/** A line with an (i) after it. */
export function lineWithInfo(text: string, explanation: string, className = 'inspector-line'): HTMLElement {
  const el = line(text, className);
  el.append(' ', info(explanation));
  return el;
}

/**
 * A section that lives in index.html and is kept up to date by its own
 * module (the Lessor, the rotations timeline, Fare policy, Reliability,
 * Game), taken from the hidden #panel-parts to sit in a view. Moving a
 * node keeps its state (a slider's position, a half-confirmed button), and
 * its module goes on updating it by id wherever it is.
 */
export function adopt(id: string): HTMLElement {
  // Remembered from the first lookup: once a view that held it is
  // replaced, the section is detached from the page, where getElementById
  // can no longer find it.
  let el = adopted.get(id);
  if (!el) {
    el = document.getElementById(id)!;
    adopted.set(id, el);
  }
  el.hidden = false;
  return el;
}

const adopted = new Map<string, HTMLElement>();
