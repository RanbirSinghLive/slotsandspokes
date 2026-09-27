import {
  appointExecutive,
  appointedCandidate,
  candidatesForRole,
  nextPayoutAmount,
  EXECUTIVE_ROLES,
  ROLE_LABELS,
  type ExecutiveCandidate,
  type ExecutiveEffect,
  type ExecutiveRole,
} from '../sim/executives';
import type { SimState } from '../sim/state';

/**
 * The C-suite half of the Executive tab, above the financial runway.
 *
 * Rebuilt wholesale on every refresh rather than mutating in place: there
 * are no live inputs here to lose focus on, only buttons, so the simpler
 * approach is the right one.
 */

const MINUTES_PER_DAY = 1440;

const slotsEl = document.querySelector<HTMLDivElement>('#executive-slots')!;
const effectsEl = document.querySelector<HTMLDivElement>('#executive-effects')!;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/** One line describing what an effect actually does, in the player's terms rather than the model's. */
function describeEffect(effect: ExecutiveEffect): string {
  switch (effect.kind) {
    case 'annual-bonus':
      return `Delivers ${money(effect.amount)} a year, growing ${Math.round((effect.escalation - 1) * 100)}% with each payout.`;
    case 'monthly-bonus':
      return `Delivers ${money(effect.amount)} a month, growing ${Math.round((effect.escalation - 1) * 100)}% with each payout.`;
    case 'free-marketing':
      return `Covers the first ${money(effect.dailyAllowance)}/day of marketing spend — the promotion still counts in full.`;
    case 'flight-ops':
      return `Cuts every flight's delay by ${Math.round((1 - effect.delayMultiplier) * 100)}%.`;
    case 'inflight':
      return `Adds ${effect.npsBonus} NPS to every departure.`;
    case 'maintenance':
      return `Airframes behave a further ${Math.round((1 - effect.ageFactorMultiplier) * 100)}% younger for reliability.`;
  }
}

function candidateCard(state: SimState, candidate: ExecutiveCandidate, isIncumbent: boolean): HTMLDivElement {
  const card = document.createElement('div');
  card.className = `exec-candidate${isIncumbent ? ' exec-candidate--appointed' : ''}`;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'exec-candidate-header expandable-header';
  const name = document.createElement('span');
  name.className = 'exec-candidate-name';
  name.textContent = candidate.name;
  const background = document.createElement('span');
  background.className = 'exec-candidate-background';
  background.textContent = candidate.background;
  const chevron = document.createElement('span');
  chevron.className = 'expand-chevron';
  header.append(name, chevron, background);

  const flavor = document.createElement('p');
  flavor.className = 'exec-candidate-flavor';
  flavor.textContent = candidate.flavor;
  flavor.hidden = true;
  header.addEventListener('click', () => {
    flavor.hidden = !flavor.hidden;
    header.classList.toggle('expanded', !flavor.hidden);
  });

  const effect = document.createElement('div');
  effect.className = 'exec-candidate-effect';
  effect.textContent = describeEffect(candidate.effect);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'exec-appoint-button';
  if (isIncumbent) {
    action.textContent = 'Appointed';
    action.disabled = true;
  } else {
    action.textContent = `Appoint — ${candidate.reputationCost} Reputation`;
    action.disabled = state.reputation < candidate.reputationCost;
    action.addEventListener('click', () => {
      if (state.reputation < candidate.reputationCost) return; // disabled; stale-click guard
      appointExecutive(state, candidate);
      updateExecutivesPanel(state);
    });
  }

  card.append(header, flavor, effect, action);

  if (!isIncumbent && state.reputation < candidate.reputationCost) {
    const shortfall = document.createElement('div');
    shortfall.className = 'exec-candidate-shortfall';
    shortfall.textContent = `Need ${Math.ceil(candidate.reputationCost - state.reputation)} more Reputation.`;
    card.appendChild(shortfall);
  }

  return card;
}

function slotBlock(state: SimState, role: ExecutiveRole): HTMLDivElement {
  const block = document.createElement('div');
  block.className = 'exec-slot';

  const incumbent = appointedCandidate(state, role);

  const heading = document.createElement('div');
  heading.className = 'exec-slot-heading';
  const title = document.createElement('span');
  title.className = 'exec-slot-title';
  title.textContent = ROLE_LABELS[role];
  const status = document.createElement('span');
  status.className = incumbent ? 'exec-slot-status exec-slot-status--filled' : 'exec-slot-status';
  status.textContent = incumbent ? incumbent.name : 'Vacant';
  heading.append(title, status);
  block.appendChild(heading);

  // Once a slot is filled, only show the incumbent plus whatever else
  // could replace them — a COO's three backgrounds stay listed so the
  // alternative is visible, but the panel doesn't pretend an occupied
  // chair is still an open search.
  const candidates = candidatesForRole(role);
  for (const candidate of candidates) {
    block.appendChild(candidateCard(state, candidate, incumbent?.id === candidate.id));
  }

  const appointment = state.executives[role];
  if (appointment) {
    const next = nextPayoutAmount(state, role);
    if (next !== null) {
      const days = Math.max(0, Math.ceil((appointment.nextPayoutMinute - state.simMinute) / MINUTES_PER_DAY));
      const note = document.createElement('div');
      note.className = 'exec-slot-note';
      note.textContent = `Next payout ${money(next)} in ${days} day${days === 1 ? '' : 's'} · ${appointment.payoutsMade} paid so far.`;
      block.appendChild(note);
    }
  }

  return block;
}

/** Nothing to build once — see the module comment on why this rebuilds wholesale. */
export function setupExecutivesPanel(): void {}

export function updateExecutivesPanel(state: SimState): void {
  slotsEl.innerHTML = '';
  for (const role of EXECUTIVE_ROLES) slotsEl.appendChild(slotBlock(state, role));

  const filled = EXECUTIVE_ROLES.filter((role) => state.executives[role] !== null).length;
  effectsEl.textContent =
    filled === 0
      ? 'No appointments yet. Reputation is what buys them, so the C-suite stays out of reach until the airline has been good at something.'
      : `${filled} of ${EXECUTIVE_ROLES.length} slots filled.`;
}
