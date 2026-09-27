import {
  commitTarget,
  targetReward,
  targetPenalty,
  TARGET_WINDOW_DAYS,
  TARGET_MIN_SAMPLE_FLIGHTS,
} from '../sim/targets';
import type { SimState } from '../sim/state';

/**
 * The Missions tab's service targets (sim/targets.ts): a standard the
 * player commits to publicly and is held to over 30 days. Authored
 * missions were replaced by the ladder (sim/ladder.ts, the Goals view);
 * whether targets stay is WEEK-TEN.md thread 3's call, since they pay
 * Reputation.
 */

const MINUTES_PER_DAY = 1440;


const targetSetupEl = document.querySelector<HTMLDivElement>('#target-setup')!;
const targetOtpSlider = document.querySelector<HTMLInputElement>('#target-otp-slider')!;
const targetOtpValue = document.querySelector<HTMLSpanElement>('#target-otp-value')!;
const targetNpsSlider = document.querySelector<HTMLInputElement>('#target-nps-slider')!;
const targetNpsValue = document.querySelector<HTMLSpanElement>('#target-nps-value')!;
const targetStakeEl = document.querySelector<HTMLDivElement>('#target-stake')!;
const targetCommitButton = document.querySelector<HTMLButtonElement>('#target-commit')!;
const targetActiveEl = document.querySelector<HTMLDivElement>('#target-active')!;
const targetLastResultEl = document.querySelector<HTMLDivElement>('#target-last-result')!;

function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** The promise currently dialled in on the two sliders, in sim units. */
function pendingTarget(): { otp: number; nps: number } {
  return { otp: Number(targetOtpSlider.value) / 100, nps: Number(targetNpsSlider.value) };
}

function renderStake(): void {
  const { otp, nps } = pendingTarget();
  targetOtpValue.textContent = formatPct(otp);
  targetNpsValue.textContent = String(nps);

  const reward = targetReward(otp, nps);
  const penalty = targetPenalty(otp, nps);
  if (reward === 0) {
    targetStakeEl.textContent = `No stake — ${formatPct(otp)} on-time and ${nps} NPS is the baseline, not a promise.`;
    targetCommitButton.disabled = true;
    return;
  }
  targetCommitButton.disabled = false;
  targetStakeEl.innerHTML =
    `Hit it over ${TARGET_WINDOW_DAYS} days: <span class="target-reward">+${reward} Reputation</span>. ` +
    `Miss it: <span class="target-penalty">-${penalty}</span>.`;
}

function renderActiveTarget(state: SimState): void {
  const target = state.activeTarget;
  targetSetupEl.hidden = target !== null;
  targetActiveEl.hidden = target === null;
  if (!target) return;

  const otp = target.flightsArrived > 0 ? target.flightsOnTime / target.flightsArrived : 0;
  const nps = target.flightsDeparted > 0 ? target.npsPoints / target.flightsDeparted : 0;
  const daysLeft = Math.max(0, Math.ceil((target.endsAtMinute - state.simMinute) / MINUTES_PER_DAY));

  const otpOk = otp >= target.targetOtp;
  const npsOk = nps >= target.targetNps;
  // Below the sample floor the promise can't be judged at all, so showing
  // a confident pass/fail on three flights would be misleading.
  const enough = target.flightsDeparted >= TARGET_MIN_SAMPLE_FLIGHTS;

  targetActiveEl.innerHTML = `
    <div class="target-committed">Committed: ${formatPct(target.targetOtp)} on-time, ${target.targetNps} avg NPS</div>
    <div class="target-progress-row">
      <span>On-time so far</span>
      <span class="${enough && !otpOk ? 'target-behind' : 'target-ahead'}">${formatPct(otp)}</span>
    </div>
    <div class="target-progress-row">
      <span>Avg NPS so far</span>
      <span class="${enough && !npsOk ? 'target-behind' : 'target-ahead'}">${Math.round(nps)}</span>
    </div>
    <div class="target-progress-note">
      ${target.flightsDeparted} departure${target.flightsDeparted === 1 ? '' : 's'} in window ·
      ${daysLeft} day${daysLeft === 1 ? '' : 's'} left${
        enough ? '' : ` · needs ${TARGET_MIN_SAMPLE_FLIGHTS} to be judged`
      }
    </div>
  `;
}

function renderLastResult(state: SimState): void {
  const result = state.lastTargetResult;
  if (!result) {
    targetLastResultEl.textContent = '';
    return;
  }

  if (result.outcome === 'not-enough-flights') {
    targetLastResultEl.className = 'target-result';
    targetLastResultEl.textContent =
      `Last promise went unjudged — only ${result.flightsDeparted} departures in the window, ` +
      `below the ${TARGET_MIN_SAMPLE_FLIGHTS} needed. No Reputation either way.`;
    return;
  }

  const met = result.outcome === 'met';
  targetLastResultEl.className = met ? 'target-result target-result--met' : 'target-result target-result--missed';
  targetLastResultEl.textContent =
    `Last promise ${met ? 'kept' : 'missed'}: committed to ${formatPct(result.targetOtp)} on-time and ` +
    `${result.targetNps} NPS, delivered ${formatPct(result.achievedOtp)} and ${Math.round(result.achievedNps)}. ` +
    `${result.reputationDelta >= 0 ? '+' : ''}${result.reputationDelta} Reputation.`;
}

/** Wire the target controls once at startup, same as every other panel's setup function. */
export function setupMissionsPanel(state: SimState): void {
  targetOtpSlider.addEventListener('input', renderStake);
  targetNpsSlider.addEventListener('input', renderStake);
  targetCommitButton.addEventListener('click', () => {
    if (state.activeTarget) return; // the setup block is hidden in that case; this is just a stale-click guard
    const { otp, nps } = pendingTarget();
    commitTarget(state, otp, nps);
    updateMissionsPanel(state);
  });

  updateMissionsPanel(state);
}

/**
 * Refresh from `state` — called when the tab becomes visible and again
 * every frame while it's showing, since a running commitment's progress
 * moves with every departure.
 */
export function updateMissionsPanel(state: SimState): void {
  renderStake();
  renderActiveTarget(state);
  renderLastResult(state);
}
