import { dayIndex } from '../../sim/clock';
import {
  contractsOf,
  counterRenewal,
  counterTakeover,
  faceOf,
  graduation,
  paymentShare,
  performanceFactor,
  renewalTerms,
  RENEWAL_WINDOW_DAYS,
  satisfactionOf,
  SNAP_BACK_SHARE,
  takeoverOpen,
  type Contract,
  type Face,
} from '../../sim/contracts';
import type { SimState } from '../../sim/state';
import { eligibleRivals, frequencyOf, minAskPerDay, placeBid, referencePerDay, reservePerDay } from '../../sim/tenders';
import { money, shortMoney } from '../format';
import { select } from '../selection';
import { heading, line } from './dom';

/**
 * The Contracts screen (Network › Contracts): tenders to bid on, the
 * contracts running with the buyer's face and a ring to the renewal, and
 * the last few finished. The rules live in sim/contracts.ts and
 * sim/tenders.ts; this is only the gesture and the cards. Icons carry the
 * state and the words are in the tips.
 */

const FACES: Record<Face, string> = { happy: '😀', neutral: '😐', sad: '☹' };
const FACE_TIPS: Record<Face, string> = {
  happy: 'Buyer happy · renews at a higher rate',
  neutral: 'Buyer neutral · renews on the same terms',
  sad: 'Buyer sad · renews for less, and a rival may take it',
};

type Draft = { ask: number; frequency: 1 | 2 };
/** The bid being set on each open tender, kept while the screen rebuilds. */
const drafts = new Map<number, Draft>();
/** What the last bid or counter on a contract answered. */
const answers = new Map<number, string>();

/**
 * Something that only carries a tip is still a button: on a phone a tap on a
 * small non-button snaps to the nearest button (the route name), so the tip
 * would never show.
 */
function tipper(className: string, text: string, label: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  tip(el, label);
  return el;
}

function tip(el: HTMLElement, text: string): void {
  el.dataset.tip = text;
  el.setAttribute('aria-label', text);
}

/** A small round button; `text` is the glyph, `label` its tip. */
function glyphButton(text: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'contract-glyph-button';
  button.textContent = text;
  button.disabled = disabled;
  tip(button, label);
  button.addEventListener('click', onClick);
  return button;
}

/** A ring filled `share` (0 to 1) of the way round. */
function ring(share: number, label: string): HTMLElement {
  const el = tipper('contract-ring', '', label);
  el.style.setProperty('--p', String(Math.round(Math.min(1, Math.max(0, share)) * 100)));
  return el;
}

function nameButton(contract: Contract): HTMLButtonElement {
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'inspector-link office-card-name';
  name.textContent = `${contract.a}–${contract.b}`;
  name.addEventListener('click', () => select({ kind: 'airport', iata: contract.b }));
  return name;
}

function stepOf(reference: number): number {
  return Math.max(100, Math.round((reference * 0.05) / 100) * 100);
}

function draftFor(contract: Contract): Draft {
  let draft = drafts.get(contract.id);
  if (!draft) {
    const frequency = contract.bid?.frequency ?? 1;
    draft = { ask: contract.bid?.askPerDay ?? Math.round(referencePerDay(contract, frequency) / 100) * 100, frequency };
    drafts.set(contract.id, draft);
  }
  return draft;
}

function clampAsk(contract: Contract, draft: Draft): void {
  draft.ask = Math.min(reservePerDay(contract, draft.frequency), Math.max(minAskPerDay(contract, draft.frequency), draft.ask));
}

function tenderCard(state: SimState, contract: Contract, changed: () => void): HTMLElement {
  const today = dayIndex(state);
  const awarded = contract.awardedDay !== undefined;
  const draft = draftFor(contract);
  const card = document.createElement('div');
  card.className = 'office-card contract-card';
  card.classList.toggle('is-adopted', awarded);

  const rivals = eligibleRivals(state, contract);
  const rivalChip = tipper(
    'contract-chip',
    rivals.length === 0 ? '◌' : `⚔ ${rivals.length}`,
    rivals.length === 0 ? 'No rival can bid · a bid is awarded at once' : `${rivals.length} rival${rivals.length === 1 ? '' : 's'} may bid · decided day ${contract.tenderEndsDay ?? contract.offerEndsDay}`,
  );
  const head = document.createElement('div');
  head.className = 'contract-head';
  head.append(nameButton(contract), rivalChip);
  const closes = awarded ? contract.offerEndsDay : (contract.tenderEndsDay ?? contract.offerEndsDay);
  const clock = tipper('contract-chip', `⏱ ${Math.max(0, closes - today)}d`, awarded ? `Fly it both ways by day ${contract.offerEndsDay} or it lapses` : `Bids close day ${closes}`);
  head.append(clock);
  card.append(head);

  const reference = referencePerDay(contract, draft.frequency);
  const riders = Math.round(contract.ridersPerDay * (draft.frequency === 2 ? 1.5 : 1));
  card.append(line(`${shortMoney(awarded ? contract.paymentPerDay : reference)}/day · ${awarded ? contract.ridersPerDay : riders} riders · ${contract.termDays}d`, 'inspector-line office-card-price'));

  if (awarded) {
    card.append(line(`✓ Won · ${frequencyOf(contract)}× daily each way`, 'inspector-line contract-won'));
    return card;
  }

  const controls = document.createElement('div');
  controls.className = 'contract-controls';
  const step = stepOf(reference);
  const ask = tipper(
    'contract-ask',
    `${money(draft.ask)}/day`,
    `Your ask · the buyer's reserve is ${money(reservePerDay(contract, draft.frequency))}/day, the lowest is ${money(minAskPerDay(contract, draft.frequency))}`,
  );
  const move = (delta: number) => {
    draft.ask += delta;
    clampAsk(contract, draft);
    changed();
  };
  const frequency = glyphButton(`${draft.frequency}×`, 'Flights a day each way · 2× pays more and sends more riders but needs four flights', () => {
    const ratio = draft.ask / referencePerDay(contract, draft.frequency);
    draft.frequency = draft.frequency === 1 ? 2 : 1;
    draft.ask = Math.round((referencePerDay(contract, draft.frequency) * ratio) / 100) * 100;
    clampAsk(contract, draft);
    changed();
  });
  const bid = glyphButton(contract.bid ? '↻' : '✋', contract.bid ? 'Change your bid' : 'Bid', () => {
    const outcome = placeBid(state, contract.id, draft.ask, draft.frequency);
    answers.set(contract.id, outcome.ok ? outcome.message : outcome.reason);
    drafts.delete(contract.id);
    changed();
  });
  bid.classList.add('is-bid');
  controls.append(glyphButton('−', `Ask ${money(step)} less`, () => move(-step)), ask, glyphButton('+', `Ask ${money(step)} more`, () => move(step)), frequency, bid);
  card.append(controls);

  if (contract.bid) {
    card.append(line(`Bid in · ${money(contract.bid.askPerDay)}/day · ${contract.bid.frequency}×`, 'inspector-line contract-won'));
  }
  const answer = answers.get(contract.id);
  if (answer) card.append(line(answer, 'inspector-line office-card-price'));
  return card;
}

function runningCard(state: SimState, contract: Contract, changed: () => void): HTMLElement {
  const today = dayIndex(state);
  const card = document.createElement('div');
  card.className = 'office-card contract-card is-adopted';
  const face = faceOf(contract);
  const mood = tipper('contract-face', FACES[face], `${FACE_TIPS[face]} · mood ${Math.round(satisfactionOf(contract))}/100`);
  const left = (contract.endsDay ?? today) - today;
  const termShare = 1 - left / contract.termDays;
  const term = ring(termShare, `Term · ${left}d left, ends day ${contract.endsDay}${(contract.renewals ?? 0) > 0 ? ` · renewed ${contract.renewals}×` : ''}`);
  const head = document.createElement('div');
  head.className = 'contract-head';
  head.append(mood, nameButton(contract), term);
  head.append(tipper('contract-chip', `${left}d`, `Ends day ${contract.endsDay}`));
  card.append(head);

  const performance = performanceFactor(state, contract);
  card.append(
    line(
      `Pay ${Math.round(paymentShare(performance) * 100)}% of ${shortMoney(contract.paymentPerDay)} · riders ${Math.round(contract.ridersPerDay * performance)}/${contract.ridersPerDay} · ${frequencyOf(contract)}×`,
      performance < 0.5 ? 'inspector-line is-over' : 'inspector-line',
    ),
  );

  const built = 1 - graduation(state, contract);
  const bar = document.createElement('div');
  bar.className = 'contract-grad';
  const fill = document.createElement('div');
  fill.style.width = `${Math.round(built * 100)}%`;
  bar.append(fill);
  tip(bar, `Market ${Math.round(built * 100)}% of the way to standing on its own · the subsidy shrinks as it builds and the contract ends near 75%`);
  card.append(bar);

  if (takeoverOpen(contract)) card.append(...takeoverControls(state, contract, changed));
  else if (left <= RENEWAL_WINDOW_DAYS) card.append(...renewalControls(state, contract, changed));
  const answer = answers.get(contract.id);
  if (answer) card.append(line(answer, 'inspector-line office-card-price'));
  card.append(line(`Paid ${money(contract.paidTotal)}`, 'inspector-line office-card-price'));
  return card;
}

/** A rival circling a sad buyer: days left, and a price cut that keeps the contract. */
function takeoverControls(state: SimState, contract: Contract, changed: () => void): HTMLElement[] {
  const days = (contract.takeoverEndsDay ?? 0) - dayIndex(state);
  const row = document.createElement('div');
  row.className = 'contract-controls';
  const pay = contract.paymentPerDay;
  const cuts = [0.9, 0.8, 0.7].map((share) => Math.floor((pay * share) / 100) * 100);
  row.append(
    tipper(
      'contract-chip is-over',
      `⚔ ${contract.takeoverBy ?? ''} ${days}d`,
      `${contract.takeoverBy ?? 'A rival'} takes this contract at the full rate in ${days}d unless the buyer is won back above sad, or you cut the price`,
    ),
  );
  for (const [i, ask] of cuts.entries()) {
    row.append(
      glyphButton(`−${(i + 1) * 10}%`, `Keep it at ${money(ask)}/day · the cut stays through renewals and the sad count starts over`, () => {
        const outcome = counterTakeover(state, contract.id, ask);
        answers.set(contract.id, outcome.ok ? outcome.message : outcome.reason);
        changed();
      }),
    );
  }
  return [row];
}

/** The renewal terms once the window opens, with a counter when the buyer will take one. */
function renewalControls(state: SimState, contract: Contract, changed: () => void): HTMLElement[] {
  const terms = renewalTerms(state, contract);
  if (terms.outcome === 'graduated') return [line('🎓 Market stands on its own · ends', 'inspector-line contract-won')];
  if (terms.outcome === 'retender') return [line(`☹ Buyer too unhappy · ends, demand −${Math.round(SNAP_BACK_SHARE * 100)}%, back to tender`, 'inspector-line is-over')];
  const current = contract.renewalAsk ?? terms.paymentPerDay;
  const row = document.createElement('div');
  row.className = 'contract-controls';
  const ask = tipper(
    'contract-ask',
    `↻ ${money(current)}/day`,
    `Renews on these terms · ${terms.ridersPerDay} riders/day · you may ask between ${money(terms.minAsk)} and ${money(terms.maxAsk)}`,
  );
  const step = stepOf(terms.paymentPerDay);
  const counter = (delta: number) => {
    const outcome = counterRenewal(state, contract.id, current + delta);
    answers.set(contract.id, outcome.ok ? outcome.message : outcome.reason);
    changed();
  };
  row.append(ask, glyphButton('−', `Ask ${money(step)} less`, () => counter(-step), current <= terms.minAsk), glyphButton('+', `Ask ${money(step)} more`, () => counter(step), current >= terms.maxAsk));
  return [row];
}

function pastCard(contract: Contract): HTMLElement {
  const card = document.createElement('div');
  card.className = 'office-card is-locked';
  card.append(nameButton(contract));
  card.append(
    line(
      contract.status === 'ended' ? (contract.lostTo ? `Taken by ${contract.lostTo} · paid ${money(contract.paidTotal)}` : `Ended · paid ${money(contract.paidTotal)}`) : contract.lostTo ? `Lost to ${contract.lostTo}` : 'Lapsed, not taken up',
      'inspector-line goal-ahead',
    ),
  );
  return card;
}

export function buildContractsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  const all = contractsOf(state);
  const tenders = all.filter((c) => c.status === 'offered').sort((x, y) => x.id - y.id);
  const running = all.filter((c) => c.status === 'active').sort((x, y) => x.id - y.id);
  const past = all.filter((c) => c.status === 'ended' || c.status === 'lapsed').sort((x, y) => y.id - x.id);

  root.append(
    heading(
      'Tenders',
      `Route contracts for small, underserved communities. Name a price a day and how often you fly it each way; with no rival able to bid you win at once, otherwise it is decided on the closing day against the rivals' bids, mostly on price. Then fly the market both ways to start it. The riders and half the pay depend on the route's on-time, completion and NPS against stricter bars than ordinary passengers hold it to. The buyer's mood follows that, and moves what it pays when the term renews. A market that has built up enough to stand on its own ends the contract. A buyer left too unhappy ends it, the market's built-up demand drops ${Math.round(SNAP_BACK_SHARE * 100)}% and the route goes out to tender again.`,
    ),
  );
  if (tenders.length === 0) root.append(line('None open', 'inspector-line goal-ahead'));
  for (const contract of tenders) root.append(tenderCard(state, contract, changed));

  root.append(heading('Running'));
  if (running.length === 0) root.append(line('None running', 'inspector-line goal-ahead'));
  for (const contract of running) root.append(runningCard(state, contract, changed));

  if (past.length > 0) {
    root.append(heading('Past'));
    for (const contract of past) root.append(pastCard(contract));
  }
  return root;
}
