import type { SimState } from './state';

/**
 * Week five's second resource besides Cash (see WEEK-FIVE.md's
 * "Reputation" design): a running, unbounded score — same "accumulating
 * stock" shape as Cash itself, not a bounded percentage like On-Time or a
 * -100..100 score like NPS. Those two are quality *signals*; Reputation is
 * what they're spent building (or spend down, on a bad day) — the thing a
 * future tech tree will actually cost to unlock from.
 *
 * On-Time performance is a *rate* and NPS is a *score* — neither
 * accumulates on its own, so neither can be "spent." Reputation is the
 * stock they feed: every day with at least one departure, this reads how
 * that one day went (not the lifetime average either of those two HUD
 * stats shows) and moves Reputation up or down accordingly.
 */

// 80% on-time is this model's "neutral" day — better swings Reputation up,
// worse swings it down. Picked as a round, plausible "this is a
// respectable regional carrier" benchmark, same "not fit to any real
// study, just a reasonable anchor" spirit as every other constant here.
const OTP_BASELINE = 0.8;
const OTP_WEIGHT = 50;

// NPS is already zero-centered (a bad day is negative, a good day
// positive), so it needs no baseline of its own — just scaled down to a
// sane daily point value.
const NPS_WEIGHT = 0.2;

/**
 * Week six's third term: Completion Factor, the fraction of scheduled
 * departures that actually operated. Real carriers cancel a small
 * percentage of flights even in a good month, so the neutral point sits
 * just below 1 rather than at it.
 *
 * Weighted harder than on-time (120 against 50) on purpose. A cancelled
 * flight isn't a very late one — it's a different, worse failure, and an
 * airline that cancels 10% of its schedule should be punished more than
 * one that runs 10 percentage points later than average. Without a term
 * of its own, cancellations would vanish from this formula entirely: a
 * cancelled flight never departs, so it can't appear in the
 * onTime/departed ratio above.
 */
const COMPLETION_FACTOR_BASELINE = 0.98;
const COMPLETION_FACTOR_WEIGHT = 120;

/**
 * Found in playtesting: a one-plane, few-flights-a-day operation has a
 * tiny, noisy daily sample — with 2 departures, "today's on-time %" can
 * only ever be 0%, 50%, or 100%, nothing in between. Reacting to that raw
 * number at full strength meant a single delayed flight (routine at this
 * fleet size) could swing a whole day's Reputation by -40 or more, and a
 * handful of ordinary bad days over two real weeks drove Reputation to
 * -100 even though the *lifetime* On-Time/NPS stats shown in the HUD
 * looked only mildly rough. The fix isn't the weights — a large,
 * established carrier's daily numbers are a real signal — it's that a
 * small carrier's aren't yet. REPUTATION_MIN_SAMPLE_FLIGHTS is the
 * departure count at which a day's delta counts at full strength; below
 * it, the whole day's swing is scaled down proportionally, same
 * "deliberately crude, not fit to any real study" spirit as every other
 * constant here.
 */
const REPUTATION_MIN_SAMPLE_FLIGHTS = 10;

/**
 * Reputation can't go below zero.
 *
 * Measured after the C-suite landed: below roughly 78% on-time the daily
 * delta is negative, so a struggling airline didn't just fail to accrue —
 * it banked an ever-deepening deficit. A hundred rough days left it around
 * -1000, and even a genuinely excellent airline (+13/day at 90% on-time)
 * then needed seventy-odd days of climbing just to reach zero before it
 * could save toward anything. Past failure permanently taxed future
 * success, and it compounded without limit.
 *
 * That mattered much more once Reputation started gating three separate
 * systems — the tech tree, the C-suite and service targets. The tools
 * that would help an airline dig out were exactly the ones its deficit
 * locked it out of.
 *
 * A floor at zero fixes the compounding without softening the standard:
 * a mediocre airline still accrues nothing, which is the intended
 * message, but the moment it improves it starts building immediately.
 * Negative Reputation had no mechanic attached to it anyway — nothing
 * cost more or behaved worse for being in deficit — so it was pure
 * unbounded punishment.
 */
export const REPUTATION_FLOOR = 0;

/**
 * Called once per simulated day, from step.ts's day-rollover — but
 * *before* the today-scoped counters it reads (`todayFlightsDeparted`,
 * `todayFlightsOnTime`, `todayNpsPoints`) get reset to zero for the new
 * day, the same "read yesterday's real totals before they're cleared"
 * ordering `todayRevenue`/`todayCost`/`todayMargin` already rely on
 * elsewhere in that same rollover block.
 *
 * A day with zero departures (no aircraft yet, or a fleet grounded for
 * some other reason) has nothing to judge Reputation against, so it's
 * left untouched rather than guessing.
 */
export function applyDailyReputationChange(state: SimState): void {
  if (state.todayFlightsDeparted === 0 && state.todayFlightsScheduled === 0) return;

  const otpPct = state.todayFlightsDeparted > 0 ? state.todayFlightsOnTime / state.todayFlightsDeparted : 0;
  // NPS is scored over departures *and* cancellations, so it needs its own
  // denominator — see SimState.npsScoredFlightsTotal.
  const avgNps = state.todayNpsScoredFlights > 0 ? state.todayNpsPoints / state.todayNpsScoredFlights : 0;
  const completionFactor =
    state.todayFlightsScheduled > 0
      ? (state.todayFlightsScheduled - state.todayFlightsCancelled) / state.todayFlightsScheduled
      : 1;

  const rawDelta =
    (otpPct - OTP_BASELINE) * OTP_WEIGHT +
    (completionFactor - COMPLETION_FACTOR_BASELINE) * COMPLETION_FACTOR_WEIGHT +
    avgNps * NPS_WEIGHT;
  // The same small-sample dampening applies to the completion term for
  // exactly the reason it applies to on-time: one cancelled flight out of
  // two scheduled shouldn't read as a 50% collapse for a one-plane
  // operation. Scheduled rather than departed as the sample size here,
  // since a day where everything cancelled has zero departures but is
  // very much a real result.
  const sample = Math.max(state.todayFlightsDeparted, state.todayFlightsScheduled);
  const confidence = Math.min(1, sample / REPUTATION_MIN_SAMPLE_FLIGHTS);
  state.reputation += rawDelta * confidence;
}
