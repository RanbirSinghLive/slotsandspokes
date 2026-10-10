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
  run: () => void;
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
  for (const row of options.rows) {
    const line = document.createElement('div');
    line.className = 'confirm-row';
    const label = document.createElement('span');
    label.textContent = row.label;
    const value = document.createElement('span');
    value.textContent = row.value;
    line.append(label, value);
    table.append(line);
  }
  box.append(table);
  for (const fact of options.facts ?? []) {
    const p = document.createElement('p');
    p.className = 'modal-subtle';
    p.textContent = fact;
    box.append(p);
  }
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = options.cancelLabel ?? 'Cancel';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'confirm-go';
  confirm.textContent = options.confirmLabel;
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
    options.run();
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
