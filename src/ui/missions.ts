import { loadMissions } from '../sim/missions';
import {
  commitTarget,
  targetReward,
  targetPenalty,
  TARGET_WINDOW_DAYS,
  TARGET_MIN_SAMPLE_FLIGHTS,
} from '../sim/targets';
import type { SimState } from '../sim/state';

/**
 * The Missions tab: authored objectives (sim/missions.ts) and
 * player-set service targets (sim/targets.ts), together in one place
 * because they answer the same question — what should I be trying to do.
 *
 * WEEK-SIX.md's original sketch put these in the Executive ledger as a
 * fourth section. That predates the sidebar tab system existing; now that
 * adding a tab is cheap, they get their own. Burying the game's only
 * statement of purpose underneath loans and a cash chart would undercut
 * the exact complaint this feature exists to answer.
 */

const MINUTES_PER_DAY = 1440;

const missionsListEl = document.querySelector<HTMLDivElement>('#missions-list')!;

const targetSetupEl = document.querySelector<HTMLDivElement>('#target-setup')!;
const targetOtpSlider = document.querySelector<HTMLInputElement>('#target-otp-slider')!;
const targetOtpValue = document.querySelector<HTMLSpanElement>('#target-otp-value')!;
const targetNpsSlider = document.querySelector<HTMLInputElement>('#target-nps-slider')!;
const targetNpsValue = document.querySelector<HTMLSpanElement>('#target-nps-value')!;
const targetStakeEl = document.querySelector<HTMLDivElement>('#target-stake')!;
const targetCommitButton = document.querySelector<HTMLButtonElement>('#target-commit')!;
const targetActiveEl = document.querySelector<HTMLDivElement>('#target-active')!;
const targetLastResultEl = document.querySelector<HTMLDivElement>('#target-last-result')!;

const missions = loadMissions();
const missionCards = new Map<string, HTMLDivElement>();

function buildMissionCard(id: string, name: string, objective: string, flavor: string, reward: number): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'mission-card';

  const header = document.createElement('div');
  header.className = 'mission-header';
  const nameEl = document.createElement('span');
  nameEl.className = 'mission-name';
  nameEl.textContent = name;
  const rewardEl = document.createElement('span');
  rewardEl.className = 'mission-reward';
  rewardEl.textContent = `+${reward} Reputation`;
  header.append(nameEl, rewardEl);

  const objectiveEl = document.createElement('div');
  objectiveEl.className = 'mission-objective';
  objectiveEl.textContent = objective;

  // Shown whether or not it's complete: the history is the reason the
  // mission is interesting, not a reward for finishing it.
  const flavorEl = document.createElement('p');
  flavorEl.className = 'mission-flavor';
  flavorEl.textContent = flavor;

  const statusEl = document.createElement('div');
  statusEl.className = 'mission-status';

  card.append(header, objectiveEl, flavorEl, statusEl);
  missionCards.set(id, card);
  return card;
}

function renderMissions(state: SimState): void {
  for (const mission of missions) {
    const card = missionCards.get(mission.id);
    if (!card) continue;
    const done = state.completedMissionIds.includes(mission.id);
    card.classList.toggle('mission-card--complete', done);
    card.querySelector<HTMLDivElement>('.mission-status')!.textContent = done ? 'Complete' : 'In progress';
  }
}

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

  const otp = target.flightsDeparted > 0 ? target.flightsOnTime / target.flightsDeparted : 0;
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
  for (const mission of missions) {
    missionsListEl.appendChild(
      buildMissionCard(mission.id, mission.name, mission.objective, mission.flavor, mission.reputationReward),
    );
  }

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
 * moves with every departure and a mission can complete at any tick.
 */
export function updateMissionsPanel(state: SimState): void {
  renderMissions(state);
  renderStake();
  renderActiveTarget(state);
  renderLastResult(state);
}
