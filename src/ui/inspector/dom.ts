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

/** One choice on a view switch: its glyph, its name (said in the tip and to screen readers), and an optional count badge or rail-style dot. */
export type ViewChoice<T extends string> = { id: T; icon: HTMLElement; tip: string; badge?: number; dot?: 'bad' | 'warn' | 'good' | null };

/**
 * The switch between a screen's views: icon buttons, the chosen one lit,
 * put on the right of the screen's title by `titleWithSwitch()`. Every
 * screen with views uses this one, so they all look and work alike. The
 * screen keeps which view is on and redraws when `pick` runs.
 */
export function viewSwitch<T extends string>(choices: ViewChoice<T>[], current: T, pick: (id: T) => void): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'view-switch';
  bar.setAttribute('role', 'tablist');
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(choice.id === current));
    button.classList.toggle('is-active', choice.id === current);
    button.append(choice.icon);
    if (choice.badge) {
      const badge = document.createElement('span');
      badge.className = 'view-switch-badge';
      badge.textContent = String(choice.badge);
      button.append(badge);
    } else if (choice.dot) {
      const dot = document.createElement('span');
      dot.className = `view-switch-dot is-${choice.dot}`;
      button.append(dot);
    }
    button.dataset.tip = choice.tip;
    button.setAttribute('aria-label', choice.tip);
    button.addEventListener('click', () => {
      if (choice.id !== current) pick(choice.id);
    });
    bar.append(button);
  }
  return bar;
}

/** A screen's title with its view switch on the right: the title's text, then anything else (a nudge), then the switch. */
export function titleWithSwitch(text: string, viewSwitchEl: HTMLElement, ...extra: (Node | null)[]): HTMLElement {
  const title = document.createElement('h3');
  title.className = 'inspector-title has-view-switch';
  title.append(text);
  for (const node of extra) if (node) title.append(node);
  title.append(viewSwitchEl);
  return title;
}
