import { freeCash } from '../sim/forecast';
import type { SimState } from '../sim/state';
import { money } from './format';

/**
 * A confirm step for a commitment: a title, rows of label and value, plain
 * consequences, and Confirm / Cancel. Built on demand over the page with the
 * shared modal classes. Escape or a click on the backdrop cancels.
 */
export type ConfirmRow = { label: string; value: string };

export type ConfirmOptions = {
  title: string;
  rows: ConfirmRow[];
  facts?: string[];
  confirmLabel: string;
  run: (choice: number, count: number) => void;
  /**
   * A − n + stepper above the rows, for a hire or conversion of several at
   * once. `rowsFor` and `confirmLabelFor` rebuild the fee rows and the button
   * for each count; `run` receives the count. Words ride in `title`.
   */
  quantity?: { min: number; max: number; value: number; rowsFor: (count: number) => ConfirmRow[]; confirmLabelFor: (count: number) => string };
  /**
   * A row of chips to pick from above the rows, such as which airframe age
   * to lease. `rows` is replaced with `rowsFor(choice)` each time one is
   * picked, and `run` receives the picked index. Words ride in `title`.
   */
  choices?: { chips: { label: string; sub?: string; title?: string; meter?: number }[]; selected: number; rowsFor: (choice: number) => ConfirmRow[] };
  /** Paragraphs under the title, before the rows: flavour or a lead-in. */
  intro?: string[];
  /** Replaces "Cancel" on the dismissing button. */
  cancelLabel?: string;
  /** Adds a modifier class to the box, for a dialog styled as an alert. */
  tone?: 'priority';
};

let open: (() => void) | null = null;

export function showConfirm(options: ConfirmOptions): void {
  open?.();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--confirm';
  const box = document.createElement('div');
  box.className = 'modal-box modal-box--confirm';
  box.setAttribute('role', 'dialog');
  if (options.tone) box.classList.add(`modal-box--${options.tone}`);
  const title = document.createElement('h2');
  title.textContent = options.title;
  box.append(title);
  for (const text of options.intro ?? []) {
    const p = document.createElement('p');
    p.className = 'confirm-intro';
    p.textContent = text;
    box.append(p);
  }
  const table = document.createElement('div');
  table.className = 'confirm-rows';
  const fillRows = (rows: ConfirmRow[]) => {
    table.replaceChildren();
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'confirm-row';
      const label = document.createElement('span');
      label.textContent = row.label;
      const value = document.createElement('span');
      value.textContent = row.value;
      line.append(label, value);
      table.append(line);
    }
  };
  let picked = options.choices?.selected ?? 0;
  if (options.choices) {
    const { chips, rowsFor } = options.choices;
    const bar = document.createElement('div');
    bar.className = 'confirm-chips';
    const buttons = chips.map((chip, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'confirm-chip';
      if (chip.title) button.title = chip.title;
      const main = document.createElement('b');
      main.textContent = chip.label;
      button.append(main);
      if (chip.sub) {
        const sub = document.createElement('span');
        sub.textContent = chip.sub;
        button.append(sub);
      }
      if (chip.meter !== undefined) {
        const meter = document.createElement('i');
        meter.className = 'confirm-chip-meter';
        meter.style.setProperty('--fill', `${Math.round(Math.max(0, Math.min(1, chip.meter)) * 100)}%`);
        button.append(meter);
      }
      button.addEventListener('click', () => {
        picked = index;
        buttons.forEach((b, i) => b.classList.toggle('is-picked', i === picked));
        fillRows(rowsFor(picked));
      });
      return button;
    });
    buttons.forEach((b, i) => b.classList.toggle('is-picked', i === picked));
    bar.append(...buttons);
    box.append(bar);
    fillRows(rowsFor(picked));
  } else if (!options.quantity) {
    fillRows(options.rows);
  }
  box.append(table);
  for (const fact of options.facts ?? []) {
    const p = document.createElement('p');
    p.className = 'modal-subtle';
    p.textContent = fact;
    box.append(p);
  }
  let count = options.quantity?.value ?? 1;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'confirm-go';
  confirm.textContent = options.confirmLabel;
  if (options.quantity) {
    const { min, max, rowsFor, confirmLabelFor } = options.quantity;
    const stepper = document.createElement('div');
    stepper.className = 'confirm-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', 'One fewer');
    const value = document.createElement('b');
    value.setAttribute('aria-live', 'polite');
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'One more');
    const show = () => {
      value.textContent = String(count);
      minus.disabled = count <= min;
      plus.disabled = count >= max;
      fillRows(rowsFor(count));
      confirm.textContent = confirmLabelFor(count);
    };
    minus.addEventListener('click', () => {
      count = Math.max(min, count - 1);
      show();
    });
    plus.addEventListener('click', () => {
      count = Math.min(max, count + 1);
      show();
    });
    stepper.append(minus, value, plus);
    box.insertBefore(stepper, table);
    show();
  }
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = options.cancelLabel ?? 'Cancel';
  actions.append(cancel, confirm);
  box.append(actions);
  overlay.append(box);
  document.body.append(overlay);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    open = null;
  };
  open = close;
  document.addEventListener('keydown', onKey);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  confirm.addEventListener('click', () => {
    close();
    options.run(picked, count);
  });
  confirm.focus();
}

/** The rows for a base change: fee, running cost, cash after. */
export function costRows(fee: number, perDayBefore: number, perDayAfter: number, cashAfter: number): ConfirmRow[] {
  const rows: ConfirmRow[] = [];
  if (fee > 0) rows.push({ label: 'Fee now', value: money(fee) });
  rows.push({ label: 'Running cost', value: `${money(perDayBefore)}/day → ${money(perDayAfter)}/day` });
  if (fee > 0) rows.push({ label: 'Cash after', value: money(cashAfter) });
  return rows;
}

/** "Cash after", and how much of it is free to spend: cash less 14 days of daily commitments (sim/forecast.ts). */
export function cashAfterRows(state: SimState, spend: number): ConfirmRow[] {
  const rows: ConfirmRow[] = [{ label: 'Cash after', value: money(state.cash - spend) }];
  rows.push({ label: 'Free after', value: money(freeCash(state, spend)) });
  return rows;
}
