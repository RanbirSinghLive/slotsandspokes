import { acceptMandate, LATE_MINUTES, mandateIsActive, mandatesOf, MIN_TERM_SUCCESS, STORIES, type Mandate } from '../sim/mandates';
import { dayIndex, minuteOfDayToTimeString } from '../sim/clock';
import type { SimState } from '../sim/state';
import { showConfirm } from './confirmModal';
import { money, shortMoney } from './format';

/**
 * Events (priority flights, sim/mandates.ts) on the page: an alert window when
 * an offer arrives, saying who is aboard; a list in the Schedule panel with
 * Accept on every offer still open and a tally on each one running; and an
 * amber star chip on the HUD counting the ones open or running.
 */

const listEl = document.querySelector<HTMLDivElement>('#mandates-list')!;
const chipEl = document.querySelector<HTMLButtonElement>('#events-chip')!;

/** Offers already put in front of the player this visit. Screen state, not saved: a reload lists them but doesn't pop them up again. */
const announced = new Set<number>();
let primed = false;
let signature: string | null = null;

function label(mandate: Mandate): string {
  return `${mandate.origin}→${mandate.dest} ${minuteOfDayToTimeString(mandate.departMinute)}`;
}

function termFlights(mandate: Mandate): number {
  return mandate.endDay - mandate.startDay;
}

function accept(state: SimState, mandate: Mandate, refresh: () => void): void {
  const result = acceptMandate(state, mandate.id);
  if (!result.ok) {
    listEl.title = result.reason;
    return;
  }
  refresh();
}

function showOffer(state: SimState, mandate: Mandate, refresh: () => void): void {
  const story = STORIES[mandate.story];
  const today = dayIndex(state);
  showConfirm({
    title: `EVENT · ${label(mandate)}`,
    tone: 'priority',
    intro: [`Carrying ${story.who}. ${story.headline}.`],
    rows: [
      { label: 'First flight', value: `in ${mandate.startDay - today} days` },
      { label: 'Term', value: `${termFlights(mandate)} days, one flight a day` },
      { label: 'On time', value: `+${money(mandate.premium)} a flight` },
      { label: `Cancelled or ${LATE_MINUTES}+ min late`, value: `-${money(mandate.penalty)}` },
      { label: `${Math.round(MIN_TERM_SUCCESS * 100)}% kept`, value: `+${money(mandate.premium * 3)} bonus` },
    ],
    facts: ['Crews go to this plane first. Weather and closed airspace are never charged. Decline costs nothing; the offer stays in the Schedule until it lapses.'],
    confirmLabel: 'Accept',
    cancelLabel: 'Not now',
    run: () => accept(state, mandate, refresh),
  });
}

function row(state: SimState, mandate: Mandate, refresh: () => void): HTMLElement {
  const today = dayIndex(state);
  const el = document.createElement('div');
  el.className = 'mandate-row';
  const text = document.createElement('span');
  if (mandate.status === 'offered') {
    text.textContent = `EVENT ${label(mandate)} · +${shortMoney(mandate.premium)}/flt · -${shortMoney(mandate.penalty)} fail · starts ${mandate.startDay - today}d · ${termFlights(mandate)}d term`;
    el.append(text);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Details';
    button.addEventListener('click', () => showOffer(state, mandate, refresh));
    el.append(button);
  } else {
    const net = `${mandate.netTotal >= 0 ? '+' : '-'}${shortMoney(Math.abs(mandate.netTotal))}`;
    const when = mandateIsActive(state, mandate) ? `${mandate.endDay - today}d left` : `starts ${mandate.startDay - today}d`;
    text.textContent = `EVENT ${label(mandate)} · ${mandate.flown} flown · ${mandate.failed} failed · ${net} · ${when}`;
    el.append(text);
  }
  return el;
}

function chipTip(state: SimState, shown: Mandate[]): string {
  const today = dayIndex(state);
  return shown
    .map((m) => (m.status === 'offered' ? `${label(m)} · offer · starts ${m.startDay - today}d` : `${label(m)} · ${mandateIsActive(state, m) ? `${m.endDay - today}d left` : `starts ${m.startDay - today}d`}`))
    .join('\n');
}


/**
 * Refresh the list and raise any new offer. Called once per rendered frame;
 * rebuilds the DOM only when a row changes. Returns true on the frame a new
 * offer is put in front of the player, so the caller can pause the clock.
 */
export function updateMandates(state: SimState, choosingHome: boolean, openSchedule: () => void): boolean {
  const shown = mandatesOf(state).filter((m) => m.status === 'offered' || m.status === 'accepted');
  const today = dayIndex(state);
  const next = shown.map((m) => `${m.id}:${m.status}:${m.flown}:${m.failed}:${m.netTotal}:${m.startDay - today}`).join('|');
  const refresh = () => {
    signature = null;
    updateMandates(state, choosingHome, openSchedule);
  };
  if (next !== signature) {
    signature = next;
    listEl.replaceChildren(...shown.map((m) => row(state, m, refresh)));
    chipEl.textContent = `★ ${shown.length}`;
    chipEl.title = chipTip(state, shown);
    chipEl.hidden = shown.length === 0;
  }
  chipEl.onclick = openSchedule;
  listEl.hidden = shown.length === 0;

  if (!primed) {
    for (const m of mandatesOf(state)) announced.add(m.id);
    primed = true;
    return false;
  }
  if (choosingHome || document.querySelector('.modal-overlay:not([hidden])')) return false;
  const fresh = shown.find((m) => m.status === 'offered' && !announced.has(m.id));
  if (fresh) {
    announced.add(fresh.id);
    showOffer(state, fresh, refresh);
    return true;
  }
  return false;
}
