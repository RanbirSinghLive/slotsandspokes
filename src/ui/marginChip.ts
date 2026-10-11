import { marginBand, type NetworkMargin } from '../sim/networkMargin';
import type { MarginMovers } from '../sim/marginMovers';
import { shortMoney } from './format';

/** A share as a whole percent with a true minus: "8%", "−3%". */
export function percentText(share: number): string {
  const rounded = Math.round(share * 100);
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded)}%`;
}

/** ▲ ▼ or nothing for how a share moved against the week before (under a point is flat). */
export function trendMark(now: number, before: number | null): string {
  if (before === null || Math.abs(now - before) < 0.01) return '';
  return now > before ? '▲' : '▼';
}

/**
 * The network's flying margin as one coloured chip: "8% ▲". The tooltip
 * carries the rest (all-in, last week, how much was paid by buyers), so
 * the chip itself stays three characters.
 */
export function marginChip(margin: NetworkMargin | null, movers: MarginMovers | null = null): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'margin-chip';
  if (margin === null) {
    chip.textContent = '—';
    chip.dataset.tip = 'Margin: shown after 3 flown days';
    return chip;
  }
  chip.classList.add(`is-${marginBand(margin.flying)}`);
  chip.textContent = `${percentText(margin.flying)} ${trendMark(margin.flying, margin.previousFlying)}`.trim();
  chip.dataset.tip = marginTip(margin, movers);
  return chip;
}

/** How many movers the tip names. */
const MOVERS_SHOWN = 3;

/** "Profit −$22k/day vs week before: checks −$35k · leases −$8k · fares & loads +$8k" */
export function moversLine(movers: MarginMovers): string {
  const change = movers.now - movers.before;
  const signed = (amount: number) => `${amount < 0 ? '' : '+'}${shortMoney(amount)}`;
  const named = movers.movers.slice(0, MOVERS_SHOWN).map((mover) => `${mover.label} ${signed(mover.perDay)}`);
  return `Profit ${signed(change)}/day vs week before: ${named.join(' · ')}`;
}

export function marginTip(margin: NetworkMargin, movers: MarginMovers | null = null): string {
  const parts = [
    `Flying margin ${percentText(margin.flying)} · ${margin.days}d`,
    margin.previousFlying === null ? null : `week before ${percentText(margin.previousFlying)}`,
    `all-in ${percentText(margin.allIn)}`,
    margin.paidShare > 0.005 ? `${percentText(margin.paidShare)} paid by contracts and events` : null,
    movers === null || movers.movers.length === 0 ? null : moversLine(movers),
  ];
  return parts.filter(Boolean).join(' · ');
}
