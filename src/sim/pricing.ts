import { recommendedFare, marketKey } from './schedule';
import type { FareStance, SimState } from './state';

/**
 * Fare policy. A per-market fare slider is busy work rather than a
 * decision: the same puzzle repeated once per market, growing with the
 * network. So fare is one airline-wide **policy**, a multiplier on
 * `recommendedFare()`, which is already distance-aware, so a single
 * number prices an entire network sensibly. A per-market fare stays
 * available for the cases that genuinely differ, but isn't required to
 * play well.
 *
 * On a market a rival also flies, the fare can instead follow a
 * **stance** (see stanceFare()): a named way of pricing against the rival
 * that re-prices every day as the rival's fare moves. Rivals answer your
 * fare (sim/competitors.ts), so there the best price isn't fixed, and the
 * stance forecast (sim/fareForecast.ts) shows where each one settles.
 */

export const FARE_POLICY_MIN = 0.5;
export const FARE_POLICY_MAX = 2.5;

/**
 * What `origin`-`dest` costs under the current policy, ignoring any
 * override. Rounded to whole dollars, same as `recommendedFare()` itself.
 */
export function policyFare(state: SimState, origin: string, dest: string): number {
  return Math.round(recommendedFare(origin, dest) * state.farePolicyMultiplier);
}

/** How far under the cheapest rival Undercut prices. */
export const UNDERCUT_SHARE = 0.1;
/** How far over the going rate Premium prices. */
export const PREMIUM_SHARE = 0.15;

/**
 * The fare a stance asks for on `origin`-`dest`, against the rivals'
 * fares today:
 *   - undercut: UNDERCUT_SHARE under the cheapest rival. Rivals match a
 *     cheaper fare down to a floor (sim/competitors.ts), so this chases
 *     them down to it.
 *   - match: the cheapest rival's fare.
 *   - premium: PREMIUM_SHARE over the going rate, whatever rivals charge.
 * With no rival on the market there is nobody to price against, so every
 * stance charges the policy fare. That lets a stance stay set while
 * rivals come and go.
 */
export function stanceFare(state: SimState, origin: string, dest: string, stance: FareStance): number {
  const key = marketKey(origin, dest);
  const rivalFares = state.competitorRoutes
    .filter((route) => marketKey(route.origin, route.dest) === key)
    .map((route) => route.fare);
  if (rivalFares.length === 0) return policyFare(state, origin, dest);
  const cheapestRival = Math.min(...rivalFares);
  if (stance === 'undercut') return Math.round(cheapestRival * (1 - UNDERCUT_SHARE));
  if (stance === 'match') return cheapestRival;
  return Math.round(recommendedFare(origin, dest) * (1 + PREMIUM_SHARE));
}

/**
 * Price a market by a stance from now on, or by policy again (`null`).
 * Either way the fare is no longer one set by hand.
 */
export function setFareStance(state: SimState, origin: string, dest: string, stance: FareStance | null): void {
  const settings = state.routeSettings[marketKey(origin, dest)];
  if (!settings) return;
  settings.fareStance = stance;
  settings.fareIsOverridden = false;
  settings.fare = stance ? stanceFare(state, origin, dest, stance) : policyFare(state, origin, dest);
}

/**
 * Re-price every market that isn't priced by hand: by its stance if it
 * has one, otherwise by policy. Called whenever the policy multiplier
 * changes, and every rollover before rivals set their fares
 * (sim/step.ts), so stances track rivals day by day.
 *
 * Markets are found from `state.schedule` rather than from
 * `state.routeSettings`' keys, because a key alone ("YHZ-YQM") doesn't
 * carry which airports it was built from in a form `recommendedFare()`
 * can use — splitting the string would work but would quietly break the
 * moment a code contained a hyphen.
 */
export function applyFarePolicy(state: SimState): void {
  const seen = new Set<string>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (seen.has(key)) continue;
    seen.add(key);

    const settings = state.routeSettings[key];
    if (!settings || settings.fareIsOverridden) continue;
    settings.fare = settings.fareStance
      ? stanceFare(state, leg.origin, leg.dest, settings.fareStance)
      : policyFare(state, leg.origin, leg.dest);
  }
}

/** Price a market by hand from now on: off the policy, and off any stance. */
export function setHandFare(state: SimState, origin: string, dest: string, fare: number): void {
  const settings = state.routeSettings[marketKey(origin, dest)];
  if (!settings) return;
  settings.fare = Math.max(1, Math.round(fare));
  settings.fareIsOverridden = true;
  settings.fareStance = null;
}

/** Set the airline-wide fare policy (clamped to its range) and re-price every market that follows it. */
export function setFarePolicy(state: SimState, multiplier: number): void {
  state.farePolicyMultiplier = Math.min(FARE_POLICY_MAX, Math.max(FARE_POLICY_MIN, multiplier));
  applyFarePolicy(state);
}


/** How the markets flown today are priced: by policy, by a stance, or by hand. */
export function pricingSummary(state: SimState): { policy: number; stance: number; hand: number } {
  const counts = { policy: 0, stance: 0, hand: 0 };
  for (const key of new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))) {
    const settings = state.routeSettings[key];
    if (!settings) continue;
    if (settings.fareIsOverridden) counts.hand++;
    else if (settings.fareStance) counts.stance++;
    else counts.policy++;
  }
  return counts;
}
