import type { BaseChangePreview, BaseCandidate, BaseReadout, LevelledBaseReadout, Outcome } from '../../sim/playerActions';
import { costRows, showConfirm } from '../confirmModal';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { select } from '../selection';
import { glyph, pips, type GlyphName } from '../glyphs';
import { heading, line } from './dom';

/**
 * The bases list the Crews and Mtc screens share (sim/bases.ts): each base
 * with its planes and running cost, a Close button where it can close, and
 * a row to open one at any airport on the map.
 */
export function baseSection(options: {
  title: string;
  info: string;
  /** The department's glyph: crew room, line station or hangar. */
  icon: GlyphName;
  kind: string;
  bases: (BaseReadout | LevelledBaseReadout)[];
  candidates: BaseCandidate[];
  fee: number;
  perDay: number;
  /** Where bases have levels: the preview and the change for one step up or down. */
  level?: { preview: (iata: string, delta: 1 | -1) => BaseChangePreview; change: (iata: string, delta: 1 | -1) => Outcome<{ message: string }> };
  preview: (action: 'open' | 'close', iata: string) => BaseChangePreview;
  open: (iata: string) => Outcome<{ message: string }>;
  close: (iata: string) => Outcome<{ message: string }>;
  changed: () => void;
}): HTMLElement[] {
  const confirmChange = (action: 'open' | 'close', iata: string) => {
    const preview = options.preview(action, iata);
    showConfirm({
      title: `${action === 'open' ? 'Open' : 'Close'} ${options.kind} · ${iata}`,
      rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
      facts: preview.blocked ? [preview.blocked] : preview.facts,
      confirmLabel: action === 'open' ? `Open · ${money(preview.fee)}` : 'Close base',
      run: () => {
        (action === 'open' ? options.open : options.close)(iata);
        options.changed();
      },
    });
  };
  const sectionHead = heading(options.title, options.info);
  sectionHead.prepend(glyph(options.icon, undefined, 'base-head-glyph'), ' ');
  const nodes: HTMLElement[] = [sectionHead];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const base of options.bases) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: base.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'inspector-link';
    const code = document.createElement('b');
    code.className = 'iata-plate';
    code.textContent = base.iata;
    name.append(code, ` ${base.name}`);
    name.addEventListener('click', () => select({ kind: 'airport', iata: base.iata }));
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    const levelled = 'level' in base ? base : null;
    const fleetText = `${base.planes} plane${base.planes === 1 ? '' : 's'} based`;
    // A levelled base shows its level as slots, filled by tonight's use; a crew base has none.
    if (levelled) {
      const unit = levelled.unit.replace(' a night', '');
      const usage = pips(levelled.used, levelled.level, `L${levelled.level} · ${levelled.used}/${levelled.level} ${unit} tonight${levelled.overflow > 0 ? ` · ${levelled.overflow} over` : ''}`, levelled.overflow > 0 ? 'warn' : options.icon);
      detail.append(usage, ' ');
    }
    const fleet = glyph('plane', fleetText);
    detail.append(fleet, ` ${base.planes} · ${base.perDay > 0 ? `${money(base.perDay)}/day` : 'free'}`);
    if (levelled && levelled.overflow > 0) detail.classList.add('is-warn');
    row.append(name, detail);
    if (levelled && options.level) {
      const step = (delta: 1 | -1) => {
        const preview = options.level!.preview(base.iata, delta);
        showConfirm({
          title: `${delta === 1 ? 'Raise' : 'Lower'} ${options.kind} · ${base.iata}`,
          rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
          facts: preview.blocked ? [preview.blocked] : preview.facts,
          confirmLabel: delta === 1 ? `Raise · ${money(preview.fee)}` : 'Lower',
          run: () => {
            options.level!.change(base.iata, delta);
            options.changed();
          },
        });
      };
      for (const delta of [-1, 1] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'base-close';
        button.textContent = delta === 1 ? '+' : '−';
        const blocked = delta === 1 ? levelled.upBlocked : levelled.downBlocked;
        button.disabled = blocked !== null;
        button.title = blocked ?? (delta === 1 ? `Level up · ${money(levelled.upFee)}` : 'Level down');
        button.addEventListener('click', () => step(delta));
        row.append(button);
      }
    }
    if ('level' in base || base.perDay > 0) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'base-close';
      close.textContent = 'Close';
      close.disabled = base.closeBlocked !== null;
      if (base.closeBlocked) close.title = base.closeBlocked;
      close.addEventListener('click', () => confirmChange('close', base.iata));
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
  button.append(glyph('mapPin'), ` Open ${options.kind} · ${money(options.fee)} + ${money(options.perDay)}/day`);
  const refresh = () => {
    const blocked = options.candidates.find((c) => c.iata === select_.value)?.blocked ?? null;
    button.disabled = blocked !== null;
    button.title = blocked ?? '';
  };
  select_.addEventListener('change', refresh);
  refresh();
  button.addEventListener('click', () => confirmChange('open', select_.value));
  opener.append(select_, button);
  nodes.push(opener);
  return nodes;
}

/** A line for when there's nothing in a list. */
export function noneLine(text: string): HTMLElement {
  return line(text, 'inspector-line goal-ahead');
}
