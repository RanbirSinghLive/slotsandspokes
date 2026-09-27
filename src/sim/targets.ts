import type { SimState } from './state';
import { OTP_BASELINE } from './reputation';

/**
 * Week six's targets: the player's half of the goal system. Where a
 * mission (sim/missions.ts) is the game telling you what's worth doing, a
 * target is you publicly committing to a standard and being held to it.
 *
 * You name an on-time percentage and an average NPS you intend to hit,
 * the commitment runs for a fixed window, and at the end it's judged on
 * what you actually delivered over that window. Reward scales with how
 * ambitious the promise was — and so does the penalty for missing, which
 * is the part that makes the choice real. Without a downside, the
 * dominant strategy would be to promise the maximum every time and
 * pocket whatever happened to land; staking Reputation on the claim is
 * what turns "pick the biggest number" into a judgement about what your
 * operation can actually sustain.
 *
 * Paid in Reputation rather than Cash on purpose: this is reputational by
 * nature — an airline announcing a service standard and then missing it
 * damages exactly the thing Reputation represents, and there's now a real
 * spender for it (the tech tree) so the currency has somewhere to go.
 */

/**
 * The window a commitment is judged over. Long enough that a single bad
 * weather day can't decide it, short enough to be a decision you revisit
 * rather than set once a game.
 */
export const TARGET_WINDOW_DAYS = 30;

/**
 * Below this many departures inside the window, the commitment expires
 * with no reward *and* no penalty. Same reasoning as
 * `REPUTATION_MIN_SAMPLE_FLIGHTS` (sim/reputation.ts): with a handful of
 * flights, on-time percentage can only take a few discrete values and
 * says more about luck than about the operation. Judging a promise on
 * that would be arbitrary in both directions.
 *
 * This can't be exploited by deliberately flying less — an unjudged
 * commitment pays nothing either.
 */
export const TARGET_MIN_SAMPLE_FLIGHTS = 20;

// The neutral standards a promise is measured as ambitious *against*.
// The on-time figure *is* sim/reputation.ts's OTP_BASELINE: "a respectable
// regional carrier" should mean the same thing to both systems. NPS is
// already zero-centred, so it needs no baseline of its own.
export const TARGET_OTP_BASELINE = OTP_BASELINE;
export const TARGET_OTP_MAX = 0.99;
export const TARGET_NPS_MAX = 60;

// Reputation per point of ambition above those baselines. Scaled so the
// most extreme promise available is worth roughly one mid-tier tech node
// (~166), and a modest one is worth a useful fraction of a cheap one.
const OTP_REPUTATION_PER_PERCENTAGE_POINT = 4;
const NPS_REPUTATION_PER_POINT = 1.5;

/**
 * Missing costs half of what hitting pays. Deliberately asymmetric:
 * committing to a standard should stay worth doing on balance, so the
 * mechanic encourages engagement rather than punishing anyone who uses
 * it — but an over-promise you had no operational basis for still costs
 * real Reputation.
 */
const MISS_PENALTY_FRACTION = 0.5;

export type TargetCommitment = {
  /** 0..1. */
  targetOtp: number;
  targetNps: number;
  /** Absolute simMinute the window closes at — compared directly against `state.simMinute`. */
  endsAtMinute: number;
  /**
   * Departures, arrivals, on-time arrivals and NPS points accumulated
   * *inside this window only* — incremented by step.ts alongside the today- and
   * lifetime-scoped counters it already keeps. Scoped counters rather
   * than a lifetime average because a promise is about what you deliver
   * from now on, not about a record that may be months long.
   */
  flightsDeparted: number;
  /** On-time's denominator: it's judged at arrival (sim/delays.ts). Departures stay the sample size and NPS's denominator. */
  flightsArrived: number;
  flightsOnTime: number;
  npsPoints: number;
};

export type TargetOutcome = 'met' | 'missed' | 'not-enough-flights';

export type TargetResult = {
  outcome: TargetOutcome;
  targetOtp: number;
  targetNps: number;
  achievedOtp: number;
  achievedNps: number;
  flightsDeparted: number;
  /** Signed: positive when the promise was kept, negative when it wasn't, zero when unjudged. */
  reputationDelta: number;
};

/**
 * What hitting this promise pays. Pure function of the promise itself,
 * so the UI can show the stake before anything is committed — which is
 * the whole point of scaling by ambition: you should be able to see the
 * trade before taking it.
 */
export function targetReward(targetOtp: number, targetNps: number): number {
  const otpAmbition = Math.max(0, targetOtp - TARGET_OTP_BASELINE) * 100;
  const npsAmbition = Math.max(0, targetNps);
  return Math.round(otpAmbition * OTP_REPUTATION_PER_PERCENTAGE_POINT + npsAmbition * NPS_REPUTATION_PER_POINT);
}

/** What missing it costs — see MISS_PENALTY_FRACTION for why it isn't symmetric. */
export function targetPenalty(targetOtp: number, targetNps: number): number {
  return Math.round(targetReward(targetOtp, targetNps) * MISS_PENALTY_FRACTION);
}

const MINUTES_PER_DAY = 1440;

/**
 * Start a commitment running from now. Callers (ui/missions.ts) are
 * responsible for not calling this while one is already active; the UI
 * hides the control in that case.
 */
export function commitTarget(state: SimState, targetOtp: number, targetNps: number): void {
  state.activeTarget = {
    targetOtp,
    targetNps,
    endsAtMinute: state.simMinute + TARGET_WINDOW_DAYS * MINUTES_PER_DAY,
    flightsDeparted: 0,
    flightsArrived: 0,
    flightsOnTime: 0,
    npsPoints: 0,
  };
}

/**
 * Close out the active commitment if its window has elapsed, applying the
 * Reputation swing and recording the result for the UI to show. Called
 * once per simulated day from step.ts's day-rollover — a window that ends
 * mid-day is judged at the next rollover, which is close enough for a
 * 30-day promise and keeps this on the same cadence as every other
 * daily-scale system.
 *
 * Does nothing when there's no commitment or its window is still open, so
 * it's safe to call unconditionally.
 */
export function resolveTargetIfDue(state: SimState): void {
  const target = state.activeTarget;
  if (!target || state.simMinute < target.endsAtMinute) return;

  const achievedOtp = target.flightsArrived > 0 ? target.flightsOnTime / target.flightsArrived : 0;
  const achievedNps = target.flightsDeparted > 0 ? target.npsPoints / target.flightsDeparted : 0;

  let outcome: TargetOutcome;
  let reputationDelta: number;
  if (target.flightsDeparted < TARGET_MIN_SAMPLE_FLIGHTS) {
    outcome = 'not-enough-flights';
    reputationDelta = 0;
  } else if (achievedOtp >= target.targetOtp && achievedNps >= target.targetNps) {
    outcome = 'met';
    reputationDelta = targetReward(target.targetOtp, target.targetNps);
  } else {
    outcome = 'missed';
    reputationDelta = -targetPenalty(target.targetOtp, target.targetNps);
  }

  state.reputation += reputationDelta;
  state.lastTargetResult = {
    outcome,
    targetOtp: target.targetOtp,
    targetNps: target.targetNps,
    achievedOtp,
    achievedNps,
    flightsDeparted: target.flightsDeparted,
    reputationDelta,
  };
  state.activeTarget = null;
}
