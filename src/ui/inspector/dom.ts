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
