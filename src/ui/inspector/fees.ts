import {
  ANCILLARY_FEE,
  ANCILLARY_LEVELS,
  ANCILLARY_NAMES,
  ancillaryBlockedReason,
  EXTRA_IDS,
  EXTRAS,
  extraBlockedReason,
  extraOn,
  ancillaryLevel,
} from '../../sim/ancillaries';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { glyph, type GlyphName } from '../glyphs';
import * as ops from '../routeActions';
import { heading, line } from './dom';

/** The glyphs in front of a fee button: a bag, a seat, a boarding arrow. */
function feeIcons(names: GlyphName[]): HTMLElement[] {
  return names.map((name) => glyph(name, undefined, 'fee-glyph'));
}

/** Ancillary fees (sim/ancillaries.ts): one button per level, the current one marked. */
export function feesSection(state: SimState, changed: () => void): HTMLElement[] {
  const current = ancillaryLevel(state);
  const rows: HTMLElement[] = [
    heading(
      'Fees',
      'What a ticket does not include. A fee earns on every passenger, most from leisure and VFR travellers and least from business ones, and costs NPS in the same proportion. Half of that cost fades as rivals copy the fee over about four months, so a fee is a head start, not a lasting edge. The dial moves once a month.',
    ),
  ];
  for (const level of ANCILLARY_LEVELS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    if (level === current) button.classList.add('is-current');
    button.append(...feeIcons(level === 0 ? ['bagOff'] : level === 1 ? ['bag'] : ['bags', 'seat']), level === 0 ? ANCILLARY_NAMES[0] : ` ${ANCILLARY_NAMES[level]} · $${ANCILLARY_FEE[level]}`);
    button.classList.add('fee-button');
    const blocked = ancillaryBlockedReason(state, level);
    button.disabled = blocked !== null;
    if (blocked && level !== current) button.title = blocked;
    button.addEventListener('click', () => {
      ops.setAncillaryFees(state, level);
      changed();
    });
    rows.push(button);
  }
  for (const id of EXTRA_IDS) {
    const on = extraOn(state, id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    if (on) button.classList.add('is-current');
    button.append(...feeIcons([id === 'seats' ? 'seat' : 'boarding']), ` ${EXTRAS[id].name} · $${EXTRAS[id].fee}${on ? ' · on' : ''}`);
    button.classList.add('fee-button');
    const blocked = extraBlockedReason(state, id);
    button.disabled = blocked !== null;
    button.title = blocked ?? (id === 'seats' ? 'Earns nothing on a route at the $20 level, which already includes seat choice.' : 'Business travellers pay; leisure ones mind.');
    button.addEventListener('click', () => {
      ops.setFeeExtra(state, id, !on);
      changed();
    });
    rows.push(button);
  }
  const earned = state.yesterdayAncillaryRevenue ?? 0;
  if (current > 0 || (state.extras?.length ?? 0) > 0 || (state.ancillaryRevenueTotal ?? 0) > 0) {
    rows.push(line(`Fees ${money(earned)}/day · total ${money(state.ancillaryRevenueTotal ?? 0)} · rivals at ${(state.rivalFeeLevel ?? 0).toFixed(1)} of ${current}`));
  }
  return rows;
}
