import { recommendedFare, marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Week six's fare policy. Raised directly, and the complaint was exact:
 * a per-market fare slider is busy work rather than a decision. Three
 * things made it so — nothing in the world reacts to your price, so a
 * static optimum exists permanently; the Commercial panel previews margin
 * as you drag, so finding it isn't even a search; and worst, it is the
 * *same* puzzle repeated once per market, so the chore grows with your
 * network. The mechanic got more tedious the better you played.
 *
 * The fix here addresses the third and worst of those: fare becomes one
 * airline-wide **policy** — a multiplier on `recommendedFare()`, which is
 * already distance-aware, so a single number prices an entire network
 * sensibly. Per-market override stays available for the cases that
 * genuinely differ (a contested market, a route you want to defend), but
 * it is no longer *required* to play well. One decision instead of N
 * identical ones.
 *
 * Deliberately not solving the first two — a static optimum is still a
 * static optimum, just found once instead of twenty times. Making
 * competitors respond to price is what would actually remove it, and
 * that's competitor AI, gated by CLAUDE.md until asked for directly.
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

/**
 * Re-price every market that is still following policy, leaving
 * overridden ones alone. Called whenever the policy multiplier changes.
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
    settings.fare = policyFare(state, leg.origin, leg.dest);
  }
}
