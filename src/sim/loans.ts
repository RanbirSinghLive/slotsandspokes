import type { SimState } from './state';

export type Loan = {
  id: string;
  /**
   * What's currently owed on this loan — starts at LOAN_PRINCIPAL the
   * instant it's taken, then grows on its own every simulated day
   * (applyDailyLoanInterest() below) until it's paid off in full.
   */
  balance: number;
  takenAtMinute: number;
};

/**
 * Flat cash credited every time a loan is taken — deliberately crude, same
 * "flat constant, not fit to any real study" spirit as economy.ts's
 * LOAD_FACTOR/RECAPTURE_RATE. Scaled to be a meaningful but not
 * game-breaking injection: a fifth of STARTING_CASH, roughly the price of
 * the cheapest Fleet Market listing.
 */
export const LOAN_PRINCIPAL = 100_000;

/**
 * Compounded onto every outstanding loan's balance once per simulated day
 * (step.ts's day-rollover calls applyDailyLoanInterest() below) — not
 * charged out of Cash directly. This is the "drag" asked for: ignoring a
 * loan doesn't cost anything today, but the balance owed keeps growing on
 * its own, so the longer one sits unpaid the harder it gets to ever clear
 * it. 0.5%/day is deliberately harsh (roughly an 8x balance over a year of
 * neglect) — the whole point of this mechanic is that mismanagement should
 * be able to compound into real ruin, not just sit around as an ignorable
 * line item.
 */
export const LOAN_DAILY_INTEREST_RATE = 0.005;

/**
 * How many loans can be outstanding at once. This is a *concurrent* count,
 * not a lifetime one — repayLoan() below removes a loan entirely once its
 * balance is cleared, freeing up room under this cap for another one
 * later. Needing a 21st loan (see isInsolvent() below) is this game's
 * actual failure state: the point where mismanagement has genuinely run
 * out of runway, rather than an open-ended debt spiral with no defined
 * end.
 */
export const MAX_LOANS = 20;

/**
 * Same "scan existing IDs, take the highest number, add one" approach
 * sim/schedule.ts's nextLegId() already uses for
 * every other player-triggered ID in this codebase — no separate counter
 * to keep in sync with `state`, and taking a loan isn't part of step(), so
 * it doesn't need to be seeded-RNG-deterministic the way a delay roll does.
 */
function nextLoanId(loans: Loan[]): string {
  const existingNumbers = loans.map((loan) => Number(loan.id.split('-').pop())).filter((n) => !Number.isNaN(n));
  const nextNumber = (existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0) + 1;
  return `loan-${nextNumber}`;
}

/**
 * Draw one new loan. Whether this is actually allowed right now (under
 * MAX_LOANS) is the caller's job to check first — ui/loans.ts only shows
 * the "Take loan" button while under the cap, the same "let the UI gate
 * it, keep the sim function itself simple" shape ui/fleetMarket.ts's
 * purchase buttons already use.
 */
export function takeLoan(state: SimState): void {
  state.loans.push({
    id: nextLoanId(state.loans),
    balance: LOAN_PRINCIPAL,
    takenAtMinute: state.simMinute,
  });
  state.cash += LOAN_PRINCIPAL;
}

/**
 * Pay one loan off in full and remove it, freeing a slot under MAX_LOANS.
 * No partial repayment — keeps both the mechanic and its UI (a single
 * "Repay" button per loan) simple. Silently does nothing if `loanId`
 * doesn't exist or Cash can't cover the balance; ui/loans.ts already
 * disables the button in that second case, so this is just a defensive
 * guard against a stale click, not the real gate.
 */
export function repayLoan(state: SimState, loanId: string): void {
  const loan = state.loans.find((l) => l.id === loanId);
  if (!loan || state.cash < loan.balance) return;
  state.cash -= loan.balance;
  state.loans = state.loans.filter((l) => l.id !== loanId);
}

/**
 * Called once per simulated day from step.ts's day-rollover, same cadence
 * as weather and the competitor AI. Grows every outstanding loan's balance
 * by LOAN_DAILY_INTEREST_RATE — compounding, since interest applies to
 * whatever's already been added by every previous day, not just the
 * original principal.
 */
export function applyDailyLoanInterest(state: SimState): void {
  for (const loan of state.loans) {
    loan.balance *= 1 + LOAN_DAILY_INTEREST_RATE;
  }
}

/**
 * How far negative Cash can go before the game ends regardless of how
 * many loans have been taken — the total credit line, negated. Below
 * this, drawing every remaining loan slot still wouldn't get Cash back
 * to zero, so no sequence of borrowing could rescue the airline.
 *
 * This exists because the loan-count condition alone had a hole (found
 * in testing, see WEEK-SIX.md): declining the offer sets ui/loans.ts's
 * `dismissedForThisDip`, which only resets once Cash climbs back above
 * zero — and for an airline that's losing money, it never does. So the
 * offer stopped reappearing, the loan count stayed at 0, `isInsolvent()`
 * never fired, and Cash fell without limit; a test game reached nearly
 * -$4M with zero loans outstanding. That made *declining* strictly
 * better than accepting: unlimited free credit at 0% versus $100k at
 * 0.5%/day compounding. A floor closes it without touching the offer
 * flow itself.
 */
export const CASH_FLOOR = -(LOAN_PRINCIPAL * MAX_LOANS);

/**
 * The game's actual failure state, either way it can be reached: Cash
 * has fallen past the whole credit line (CASH_FLOOR above — nothing
 * could bring it back), or Cash has hit zero with every MAX_LOANS slot
 * already spoken for. ui/loans.ts checks this every frame to decide
 * whether to show the loan offer (still room to borrow, still above the
 * floor) or the game-over screen.
 */
export function isInsolvent(state: SimState): boolean {
  if (state.cash <= CASH_FLOOR) return true;
  return state.cash <= 0 && state.loans.length >= MAX_LOANS;
}
