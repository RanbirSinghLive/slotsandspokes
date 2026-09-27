/** The small DOM pieces every inspector view is built from. */

/** A line of text in a view, styled as `className`. */
export function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

/** A section heading in a view. */
export function heading(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}
