import type { SimState } from '../sim/state';
import { candidateById, executiveNetPerDay, ROLE_LABELS, seatToFit } from '../sim/executives';
import { money } from './format';
import { portraitElement } from './portraits';
import { select } from './selection';
import { openExecutiveSeat } from './inspector/headOffice';

/**
 * A small greyed portrait beside a screen's title when someone whose line
 * of work that screen shows would clearly fit an executive seat now
 * (sim/executives.ts's seatToFit()): the line maintenance chief on Mtc,
 * the chief pilot on Crews, the inflight director on Fleet. Hovering says
 * who and what they'd net; a tap opens their seat in the Office, where
 * the same reads in full. Nothing
 * shows when nobody fits, so it never nags.
 */
export function execNudge(state: SimState, candidateIds: string[]): HTMLElement | null {
  for (const id of candidateIds) {
    const seat = seatToFit(state, id);
    const candidate = candidateById(id);
    if (!seat || !candidate) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'exec-nudge';
    const tip = `${candidate.name} · ${candidate.background} · est. +${money(executiveNetPerDay(state, candidate))}/day · ${ROLE_LABELS[seat]}`;
    button.title = tip;
    button.setAttribute('aria-label', tip);
    button.append(portraitElement(id, candidate.role, 22));
    button.addEventListener('click', () => {
      openExecutiveSeat(seat);
      select({ kind: 'headOffice' });
    });
    return button;
  }
  return null;
}
