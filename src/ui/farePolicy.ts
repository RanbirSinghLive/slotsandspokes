import { FARE_POLICY_MAX, FARE_POLICY_MIN, pricingSummary, setFarePolicy } from '../sim/pricing';
import type { SimState } from '../sim/state';

/**
 * The airline-wide fare policy (sim/pricing.ts), in the Network view's
 * Fleet tab: one slider pricing every market that follows it, and a line
 * saying how many do. A market's own fare and stance are in
 * its route view (ui/inspector/route.ts).
 *
 * The slider is built once in the markup and only its value and the
 * status line are updated, so it is never replaced mid-drag.
 */

const slider = document.querySelector<HTMLInputElement>('#fare-policy-slider')!;
const valueEl = document.querySelector<HTMLSpanElement>('#fare-policy-value')!;
const statusEl = document.querySelector<HTMLDivElement>('#fare-policy-status')!;

function renderStatus(state: SimState): void {
  valueEl.textContent = `${Math.round(state.farePolicyMultiplier * 100)}% of recommended`;
  const { policy, stance, hand } = pricingSummary(state);
  const total = policy + stance + hand;
  if (total === 0) {
    statusEl.textContent = 'No markets yet';
    return;
  }
  const others = [stance > 0 ? `${stance} on a stance` : '', hand > 0 ? `${hand} by hand` : ''].filter(Boolean);
  statusEl.textContent = `${policy}/${total} markets on policy` + (others.length > 0 ? ` · ${others.join(' · ')}` : '');
}

export function setupFarePolicy(state: SimState): void {
  slider.min = String(Math.round(FARE_POLICY_MIN * 100));
  slider.max = String(Math.round(FARE_POLICY_MAX * 100));
  slider.value = String(Math.round(state.farePolicyMultiplier * 100));
  slider.addEventListener('input', () => {
    setFarePolicy(state, Number(slider.value) / 100);
    renderStatus(state);
  });
  renderStatus(state);
}

/** Bring the status line up to date, for markets opened, closed or re-priced since. Leaves the slider alone. */
export function updateFarePolicy(state: SimState): void {
  renderStatus(state);
}
