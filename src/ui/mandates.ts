import { acceptMandate, clientKey, LATE_MINUTES, mandatedLeg, mandateIsActive, mandatesOf, MIN_TERM_SUCCESS, STORIES, type Mandate } from '../sim/mandates';
import { select } from './selection';
import { dayIndex, minuteOfDayToTimeString } from '../sim/clock';
import type { SimState } from '../sim/state';
import { callPolicy } from '../sim/priority';
import { standingOf, standingPips } from '../sim/standing';
import { showConfirm } from './confirmModal';
import { money, shortMoney } from './format';

/**
 * Requests (priority flights, sim/mandates.ts) on the page: an alert window
 * when an offer arrives, saying who is aboard; rows on the Contracts screen
 * (requestRows()) with Details on every offer still open and a tally on each
 * one running; and an amber star chip on the HUD counting the ones open or
 * running, which opens the Contracts screen.
 */

const chipEl = document.querySelector<HTMLButtonElement>('#events-chip')!;

/** Offers already put in front of the player this visit. Screen state, not saved: a reload lists them but doesn't pop them up again. */
const announced = new Set<number>();
let primed = false;
let signature: string | null = null;
/** Why the last Accept was refused, shown on the screen until the next rebuild. */
let refusal: string | null = null;

/** Days a lapsed offer stays in the list. */
const LAPSED_SHOWN_DAYS = 2;

function label(mandate: Mandate): string {
  return `${mandate.origin}→${mandate.dest} ${minuteOfDayToTimeString(mandate.departMinute)}`;
}

function termFlights(mandate: Mandate): number {
  return mandate.endDay - mandate.startDay;
}

function accept(state: SimState, mandate: Mandate, refresh: () => void): void {
  const result = acceptMandate(state, mandate.id);
  refusal = result.ok ? null : result.reason;
  refresh();
}

function showOffer(state: SimState, mandate: Mandate, refresh: () => void): void {
  const story = STORIES[mandate.story];
  const today = dayIndex(state);
  showConfirm({
    title: `REQUEST · ${label(mandate)}`,
    tone: 'priority',
    intro: [`Carrying ${story.who}. ${story.headline}.`],
    rows: [
      { label: 'Client standing', value: `${standingPips(standingOf(state, clientKey(mandate.story)))} ${Math.round(standingOf(state, clientKey(mandate.story)))}` },
      { label: 'First flight', value: `in ${mandate.startDay - today} days` },
      { label: 'Term', value: `${termFlights(mandate)} days, one flight a day` },
      { label: 'On time', value: `+${money(mandate.premium)} a flight` },
      { label: `Cancelled or ${LATE_MINUTES}+ min late`, value: `-${money(mandate.penalty)}` },
      { label: `${Math.round(MIN_TERM_SUCCESS * 100)}% kept`, value: `+${money(mandate.premium * 3)} bonus` },
    ],
    facts: ['Standing with this client builds with every flight kept and a term kept, drops with every failure, and fades slowly. It raises what they pay and brings them back. Crews go to this plane first. Weather and closed airspace are never charged. Not now costs nothing; the offer stays on the Contracts screen until it lapses.'],
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
  if (mandate.status === 'lapsed') {
    el.classList.add('is-lapsed');
    text.textContent = `${label(mandate)} · ✕ expired`;
    el.title = 'Offer expired: it was not accepted before its first flight';
    el.append(text);
  } else if (mandate.status === 'offered') {
    text.textContent = `${label(mandate)} · +${shortMoney(mandate.premium)}/flt · -${shortMoney(mandate.penalty)} fail · starts ${mandate.startDay - today}d · ${termFlights(mandate)}d term`;
    el.append(text);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Details';
    button.addEventListener('click', () => showOffer(state, mandate, refresh));
    el.append(button);
  } else {
    const net = `${mandate.netTotal >= 0 ? '+' : '-'}${shortMoney(Math.abs(mandate.netTotal))}`;
    const when = mandateIsActive(state, mandate) ? `${mandate.endDay - today}d left` : `starts ${mandate.startDay - today}d`;
    text.textContent = `${label(mandate)} · ${mandate.flown} flown · ${mandate.failed} failed · ${net} · ${when}`;
    el.append(text);
    // Opens the plane flying it, or the route when no flight matches any more.
    const open = () => {
      const tail = mandatedLeg(state, mandate)?.tail;
      select(tail ? { kind: 'aircraft', tail } : { kind: 'route', a: mandate.origin, b: mandate.dest });
    };
    el.classList.add('is-link');
    el.tabIndex = 0;
    el.title = 'Open the plane flying it';
    el.addEventListener('click', open);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') open();
    });
  }
  return el;
}

function chipTip(state: SimState, shown: Mandate[]): string {
  const today = dayIndex(state);
  return shown
    .map((m) => (m.status === 'offered' ? `${label(m)} · offer · starts ${m.startDay - today}d` : `${label(m)} · ${mandateIsActive(state, m) ? `${m.endDay - today}d left` : `starts ${m.startDay - today}d`}`))
    .join('\n');
}


/** Offers open or running, and offers lapsed in the last couple of days so a miss is visible. */
function listed(state: SimState): Mandate[] {
  const today = dayIndex(state);
  const shown = mandatesOf(state).filter((m) => m.status === 'offered' || m.status === 'accepted');
  const lapsed = mandatesOf(state).filter((m) => m.status === 'lapsed' && !m.declined && today - m.startDay <= LAPSED_SHOWN_DAYS);
  return [...shown, ...lapsed];
}

/** The rows for the Contracts screen's Requests section; `changed` rebuilds the screen. */
export function requestRows(state: SimState, changed: () => void): HTMLElement[] {
  const rows = listed(state).map((m) => row(state, m, changed));
  if (refusal) {
    const note = document.createElement('div');
    note.className = 'inspector-line goal-ahead';
    note.textContent = refusal;
    rows.unshift(note);
    refusal = null;
  }
  return rows;
}

/**
 * Keep the HUD chip current and raise any new offer. Called once per
 * rendered frame. Returns true on the frame a new offer is put in front of
 * the player, so the caller can pause the clock.
 */
export function updateMandates(state: SimState, choosingHome: boolean, openContracts: () => void): boolean {
  const shown = mandatesOf(state).filter((m) => m.status === 'offered' || m.status === 'accepted');
  const today = dayIndex(state);
  const next = shown.map((m) => `${m.id}:${m.status}:${m.startDay - today}:${m.endDay - today}`).join('|');
  if (next !== signature) {
    signature = next;
    chipEl.textContent = `★ ${shown.length}`;
    chipEl.title = chipTip(state, shown);
    chipEl.hidden = shown.length === 0;
  }
  chipEl.onclick = openContracts;

  if (!primed) {
    for (const m of mandatesOf(state)) announced.add(m.id);
    primed = true;
    return false;
  }
  if (choosingHome || document.querySelector('.modal-overlay:not([hidden])')) return false;
  const fresh = shown.find((m) => m.status === 'offered' && !announced.has(m.id));
  if (fresh) {
    announced.add(fresh.id);
    // With the priority policy offers wait behind the ★ chip (a keep route takes its own, sim/priority.ts) instead of stopping the game.
    if (callPolicy(state) !== 'ask') return false;
    showOffer(state, fresh, openContracts);
    return true;
  }
  return false;
}
