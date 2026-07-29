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
  if (state.todayFlightsDeparted === 0) return;

  const otpPct = state.todayFlightsOnTime / state.todayFlightsDeparted;
  const avgNps = state.todayNpsPoints / state.todayFlightsDeparted;

  const rawDelta = (otpPct - OTP_BASELINE) * OTP_WEIGHT + avgNps * NPS_WEIGHT;
  const confidence = Math.min(1, state.todayFlightsDeparted / REPUTATION_MIN_SAMPLE_FLIGHTS);
  state.reputation += rawDelta * confidence;
}
