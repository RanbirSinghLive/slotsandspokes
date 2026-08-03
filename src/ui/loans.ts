import { takeLoan, repayLoan, isInsolvent, MAX_LOANS, LOAN_PRINCIPAL, CASH_FLOOR } from '../sim/loans';
import { clearSavedState } from './save';
import type { SimState } from '../sim/state';

const loansSectionEl = document.querySelector<HTMLElement>('#loans-section')!;
const loansBody = document.querySelector<HTMLTableSectionElement>('#loans-rows')!;
const loansCountEl = document.querySelector<HTMLSpanElement>('#loans-count')!;

const loanOfferModal = document.querySelector<HTMLDivElement>('#loan-offer-modal')!;
const loanOfferAmountEl = document.querySelector<HTMLSpanElement>('#loan-offer-amount')!;
const loanOfferCashEl = document.querySelector<HTMLSpanElement>('#loan-offer-cash')!;
const loanOfferCountEl = document.querySelector<HTMLSpanElement>('#loan-offer-count')!;
const loanOfferFloorEl = document.querySelector<HTMLParagraphElement>('#loan-offer-floor')!;
const takeLoanButton = document.querySelector<HTMLButtonElement>('#loan-offer-take')!;
const dismissLoanButton = document.querySelector<HTMLButtonElement>('#loan-offer-dismiss')!;

const gameOverModal = document.querySelector<HTMLDivElement>('#game-over-modal')!;
const gameOverReasonEl = document.querySelector<HTMLParagraphElement>('#game-over-reason')!;
const gameOverNewGameButton = document.querySelector<HTMLButtonElement>('#game-over-new-game')!;

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * Once Cash dips to zero or below, the loan-offer pop-up (see
 * updateLoans() below) shows every frame until the player either takes a
 * loan or dismisses it — but a dismissal shouldn't mean "never ask again
 * this entire game," just "not for this particular dip." Reset the
 * instant Cash climbs back above zero, so a *later* dip prompts again.
 * Plain module-level UI state, not part of `state` — the same category of
 * transient, render-layer-only bookkeeping as ui/routeBuilder.ts's
 * builder state or render/competition.ts's flash timestamps, never written to
 * SimState because it isn't part of the simulation, just of how this one
 * browser tab is currently choosing to nag the player about it.
 */
let dismissedForThisDip = false;

/**
 * Rebuild the sidebar's loan list from scratch every call — the same
 * "no live inputs to lose focus on, just rebuild it" shape ui/panels.ts's
 * fleet table already uses, since a Repay button has no state of its own
 * worth preserving across a rebuild.
 */
function renderLoansTable(state: SimState): void {
  loansSectionEl.hidden = state.loans.length === 0;
  loansCountEl.textContent = `${state.loans.length}/${MAX_LOANS}`;

  loansBody.innerHTML = '';
  for (const loan of state.loans) {
    const row = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.textContent = loan.id;

    const balanceCell = document.createElement('td');
    balanceCell.textContent = formatMoney(loan.balance);

    const actionCell = document.createElement('td');
    const repayButton = document.createElement('button');
    repayButton.type = 'button';
    repayButton.className = 'loan-repay-button';
    repayButton.textContent = 'Repay';
    // Can't afford to clear this one yet — same "disable rather than let
    // it fail silently" approach the Fleet Market's buy buttons already
    // use for an unaffordable listing.
    repayButton.disabled = state.cash < loan.balance;
    repayButton.addEventListener('click', () => {
      repayLoan(state, loan.id);
      renderLoansTable(state);
    });
    actionCell.appendChild(repayButton);

    row.append(idCell, balanceCell, actionCell);
    loansBody.appendChild(row);
  }
}

/**
 * Wire the loan-offer and game-over pop-ups' buttons. Called once at
 * startup, same as every other panel's setup function.
 */
export function setupLoans(state: SimState): void {
  // The offer amount never changes mid-game, so it's set once here rather
  // than every frame in updateLoans() below — reading LOAN_PRINCIPAL
  // straight from sim/loans.ts instead of a second hand-typed number in
  // index.html, so the two can never drift apart.
  loanOfferAmountEl.textContent = formatMoney(LOAN_PRINCIPAL);

  takeLoanButton.addEventListener('click', () => {
    takeLoan(state);
    // A fresh loan may or may not have brought Cash back above zero
    // (a deep enough hole needs more than one) — leave dismissedForThisDip
    // alone either way, so the very next frame's updateLoans() re-evaluates
    // honestly instead of this click hard-coding an assumption about it.
    renderLoansTable(state);
  });

  dismissLoanButton.addEventListener('click', () => {
    dismissedForThisDip = true;
  });

  // Same irreversible reset ui/panels.ts's own #new-game-button uses
  // elsewhere in the HUD — no separate confirmation needed here, since
  // reaching this screen at all already means the current game is over.
  gameOverNewGameButton.addEventListener('click', () => {
    clearSavedState();
    window.location.reload();
  });
}

/**
 * Refresh both pop-ups and the loans table from `state` — called every
 * rendered frame, same as ui/panels.ts's updatePanel(). Returns whether
 * the game is currently in its insolvent/game-over state, so main.ts's
 * loop knows to pause the simulation the moment that first becomes true.
 */
export function updateLoans(state: SimState): boolean {
  const insolvent = isInsolvent(state);
  gameOverModal.hidden = !insolvent;
  if (insolvent) {
    // Two different ways to get here (see sim/loans.ts's isInsolvent()),
    // and which one it was is genuinely useful to know — "you ran past
    // the floor without borrowing" and "you borrowed everything and
    // still ran out" are different mistakes.
    gameOverReasonEl.textContent =
      state.cash <= CASH_FLOOR
        ? `Cash has fallen to ${formatMoney(state.cash)}, past the ${formatMoney(CASH_FLOOR)} total credit line — even drawing every remaining loan couldn't bring it back to zero. This airline is finished.`
        : `Cash is gone and every one of the ${MAX_LOANS} loan slots is already spoken for — there's no more credit left to draw on. This airline is finished.`;
  }

  if (state.cash > 0) dismissedForThisDip = false;

  const shouldOfferLoan = !insolvent && state.cash <= 0 && !dismissedForThisDip;
  loanOfferModal.hidden = !shouldOfferLoan;
  if (shouldOfferLoan) {
    loanOfferCashEl.textContent = formatMoney(state.cash);
    loanOfferCountEl.textContent = `${state.loans.length}/${MAX_LOANS}`;
    // Declining used to be free — Cash could fall forever. Now there's a
    // floor, so the player needs to see it coming rather than being
    // game-overed without warning.
    loanOfferFloorEl.textContent = `Below ${formatMoney(CASH_FLOOR)} the airline is finished — ${formatMoney(state.cash - CASH_FLOOR)} of room left.`;
  }

  renderLoansTable(state);

  return insolvent;
}
