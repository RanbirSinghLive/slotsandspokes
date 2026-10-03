import type { BaseCandidate, BaseReadout, Outcome } from '../../sim/playerActions';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { select } from '../selection';
import { heading, line } from './dom';

/**
 * The bases list the Crews and Mtc screens share (sim/bases.ts): each base
 * with its planes and running cost, a Close button where it can close, and
 * a row to open one at any airport on the map.
 */
export function baseSection(options: {
  title: string;
  info: string;
  kind: string;
  bases: BaseReadout[];
  candidates: BaseCandidate[];
  fee: number;
  perDay: number;
  open: (iata: string) => Outcome<{ message: string }>;
  close: (iata: string) => Outcome<{ message: string }>;
  changed: () => void;
}): HTMLElement[] {
  const nodes: HTMLElement[] = [heading(options.title, options.info)];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const base of options.bases) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: base.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'inspector-link';
    name.textContent = `${base.iata} · ${base.name}`;
    name.addEventListener('click', () => select({ kind: 'airport', iata: base.iata }));
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = [`${base.planes} plane${base.planes === 1 ? '' : 's'} based`, base.perDay > 0 ? `${money(base.perDay)}/day` : 'home'].join(' · ');
    row.append(name, detail);
    if (base.perDay > 0) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'base-close';
      close.textContent = 'Close';
      close.disabled = base.closeBlocked !== null;
      if (base.closeBlocked) close.title = base.closeBlocked;
      close.addEventListener('click', () => {
        options.close(base.iata);
        options.changed();
      });
      row.append(close);
    }
    list.append(row);
  }
  nodes.push(list);

  if (options.candidates.length === 0) return nodes;
  const opener = document.createElement('div');
  opener.className = 'base-open';
  const select_ = document.createElement('select');
  select_.className = 'base-open-select';
  for (const candidate of [...options.candidates].sort((a, b) => a.iata.localeCompare(b.iata))) {
    const option = document.createElement('option');
    option.value = candidate.iata;
    option.textContent = `${candidate.iata} · ${candidate.name}`;
    select_.append(option);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = `Open ${options.kind} · ${money(options.fee)} + ${money(options.perDay)}/day`;
  const refresh = () => {
    const blocked = options.candidates.find((c) => c.iata === select_.value)?.blocked ?? null;
    button.disabled = blocked !== null;
    button.title = blocked ?? '';
  };
  select_.addEventListener('change', refresh);
  refresh();
  button.addEventListener('click', () => {
    options.open(select_.value);
    options.changed();
  });
  opener.append(select_, button);
  nodes.push(opener);
  return nodes;
}

/** A line for when there's nothing in a list. */
export function noneLine(text: string): HTMLElement {
  return line(text, 'inspector-line goal-ahead');
}
