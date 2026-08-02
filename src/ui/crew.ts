import {
  crewRequirement,
  dailyCrewSalary,
  hireCost,
  hireCrew,
  trainingCost,
  startTraining,
  cabinTrainingCost,
  startCabinTraining,
  cabinServiceShare,
  CABIN_TRAINING_DAYS,
  maintenanceAgeFactor,
  RESERVE_DEPTH_MIN,
  RESERVE_DEPTH_MAX,
  HIRE_LEAD_TIME_DAYS,
  TRAINING_DAYS,
  MAX_PILOT_TIER,
  type CrewRole,
} from '../sim/crew';
import type { SimState } from '../sim/state';

/**
 * The Crew tab. Hiring is **bulk** rather than a Fleet-Market-style
 * candidate table: a table works at twelve aircraft but not at forty
 * pilots, and crew are modelled as pools rather than individuals anyway,
 * so picking named people would be pretending at a granularity the sim
 * doesn't have.
 */

const MINUTES_PER_DAY = 1440;
const TIER_NAMES = ['Light turboprop', 'Regional', 'Mainline jet'];

const el = <T extends HTMLElement>(id: string) => document.querySelector<T>(id)!;

const poolsEl = el<HTMLDivElement>('#crew-pools');
const salaryEl = el<HTMLDivElement>('#crew-salary');
const groundedEl = el<HTMLDivElement>('#crew-grounded');

const reserveSlider = el<HTMLInputElement>('#crew-reserve-slider');
const reserveValue = el<HTMLSpanElement>('#crew-reserve-value');
const reserveNote = el<HTMLDivElement>('#crew-reserve-note');

const hireRoleSelect = el<HTMLSelectElement>('#crew-hire-role');
const hireTierSelect = el<HTMLSelectElement>('#crew-hire-tier');
const hireCountInput = el<HTMLInputElement>('#crew-hire-count');
const hireCostEl = el<HTMLDivElement>('#crew-hire-cost');
const hireButton = el<HTMLButtonElement>('#crew-hire-button');

const trainTierSelect = el<HTMLSelectElement>('#crew-train-tier');
const trainCountInput = el<HTMLInputElement>('#crew-train-count');
const trainCostEl = el<HTMLDivElement>('#crew-train-cost');
const trainButton = el<HTMLButtonElement>('#crew-train-button');

const cabinTrainCountInput = el<HTMLInputElement>('#crew-cabin-train-count');
const cabinTrainCostEl = el<HTMLDivElement>('#crew-cabin-train-cost');
const cabinTrainButton = el<HTMLButtonElement>('#crew-cabin-train-button');

const pendingEl = el<HTMLDivElement>('#crew-pending');

const maintenanceEl = el<HTMLDivElement>('#crew-maintenance');

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/** A "have / need" line, marked short when the pool can't cover the operating minimum. */
function poolRow(label: string, have: number, need: number, target: number): string {
  const short = have < need;
  return `
    <div class="crew-pool-row">
      <span class="crew-pool-label">${label}</span>
      <span class="${short ? 'crew-short' : 'crew-ok'}">${have}</span>
      <span class="crew-pool-need">need ${need} · target ${target}</span>
    </div>`;
}

function renderPools(state: SimState): void {
  const req = crewRequirement(state);
  const rows: string[] = [];

  for (let tier = 1; tier <= MAX_PILOT_TIER; tier++) {
    // Only show a tier once it's relevant — an all-turboprop operator
    // doesn't need a mainline-jet row cluttering the panel.
    if (req.pilotsByTier[tier - 1] === 0 && state.crew.pilotsByTier[tier - 1] === 0) continue;
    rows.push(
      poolRow(
        `Pilots — ${TIER_NAMES[tier - 1]}`,
        state.crew.pilotsByTier[tier - 1],
        req.pilotsByTier[tier - 1],
        req.targetPilotsByTier[tier - 1],
      ),
    );
  }
  if (rows.length === 0) rows.push(poolRow('Pilots', 0, 0, 0));

  rows.push(poolRow('Cabin crew', state.crew.cabinCrew, req.cabinCrew, req.targetCabinCrew));
  rows.push(
    poolRow(
      `— service-trained (${Math.round(cabinServiceShare(state.crew) * 100)}%)`,
      Math.round(state.crew.cabinCrewTrained),
      0,
      state.crew.cabinCrew,
    ),
  );
  // Mechanics have no operating minimum — they're a continuum, not a
  // threshold — so "need" is shown as 0 and only the target matters.
  rows.push(poolRow('Mechanics', state.crew.mechanics, 0, req.targetMechanics));

  poolsEl.innerHTML = rows.join('');
  salaryEl.textContent = `${money(dailyCrewSalary(state.crew))}/day in salaries, paid whether or not they fly.`;

  // Grounding is decided once per day at rollover, so `groundedTails` is
  // stale for anything that changed since — leasing an aircraft mid-day
  // would otherwise read as "every aircraft is crewed" while the pools
  // plainly can't cover it. Check the requirement directly as well, and
  // say which of the two situations this is.
  const grounded = state.groundedTails.length;
  const shortOfMinimum =
    state.aircraft.length > 0 &&
    (state.crew.cabinCrew < req.cabinCrew ||
      req.pilotsByTier.some((need, i) => state.crew.pilotsByTier.slice(i).reduce((a, b) => a + b, 0) < need));

  if (shortOfMinimum) {
    groundedEl.textContent = 'Below the operating minimum — aircraft will be grounded at the next day rollover.';
  } else if (grounded > 0) {
    groundedEl.textContent = `${grounded} aircraft grounded today for lack of crew — their flights are cancelled.`;
  } else {
    groundedEl.textContent = 'Every aircraft is crewed today.';
  }
  groundedEl.classList.toggle('crew-short', shortOfMinimum || grounded > 0);

  const factor = maintenanceAgeFactor(state);
  const perAircraft = state.aircraft.length > 0 ? state.crew.mechanics / state.aircraft.length : 0;
  const pct = Math.round(Math.abs(1 - factor) * 100);
  maintenanceEl.textContent =
    `${perAircraft.toFixed(1)} mechanics per aircraft — airframes behave ` +
    (factor <= 1 ? `${pct}% younger than their years.` : `${pct}% older than their years.`);
  maintenanceEl.classList.toggle('crew-short', factor > 1);
}

function renderReserve(state: SimState): void {
  reserveSlider.value = String(Math.round(state.reserveDepth * 100));
  reserveValue.textContent = `${Math.round((state.reserveDepth - 1) * 100)}% above minimum`;
  const req = crewRequirement(state);
  reserveNote.textContent =
    `Target headcount ${req.targetPilotsTotal} pilots, ${req.targetCabinCrew} cabin, ${req.targetMechanics} mechanics. ` +
    `Thin reserves are cheap until a bad day; deep ones are insurance you mostly don't need.`;
}

function renderHireCost(state: SimState): void {
  const role = hireRoleSelect.value as CrewRole;
  hireTierSelect.disabled = role !== 'pilot';
  const tier = role === 'pilot' ? Number(hireTierSelect.value) : 1;
  const count = Math.max(1, Number(hireCountInput.value) || 1);
  const cost = hireCost(role, tier, count);
  hireCostEl.textContent = `${money(cost)} up front · arrives in ${HIRE_LEAD_TIME_DAYS} days`;
  hireButton.disabled = cost > state.cash;
}

function renderTrainCost(state: SimState): void {
  const fromTier = Number(trainTierSelect.value);
  const count = Math.max(1, Number(trainCountInput.value) || 1);
  const cost = trainingCost(fromTier, count);
  const available = state.crew.pilotsByTier[fromTier - 1];
  trainCostEl.textContent =
    `${money(cost)} · ${TRAINING_DAYS} days · ${count} of ${available} tier-${fromTier} pilots unavailable while training`;
  trainButton.disabled = cost > state.cash || count > available;
}

function renderCabinTrainCost(state: SimState): void {
  const count = Math.max(1, Number(cabinTrainCountInput.value) || 1);
  const cost = cabinTrainingCost(count);
  const share = cabinServiceShare(state.crew);
  const npsNow = Math.round(share * 15);
  cabinTrainCostEl.textContent =
    `${money(cost)} · ${CABIN_TRAINING_DAYS} days off the line · ` +
    `currently worth +${npsNow} NPS per flight at ${Math.round(share * 100)}% trained`;
  cabinTrainButton.disabled = cost > state.cash || count > state.crew.cabinCrew;
}

function renderPending(state: SimState): void {
  const items: string[] = [];
  for (const hire of state.pendingHires) {
    const days = Math.max(0, Math.ceil((hire.availableAtMinute - state.simMinute) / MINUTES_PER_DAY));
    const what = hire.role === 'pilot' ? `tier-${hire.tier} pilots` : hire.role === 'cabin' ? 'cabin crew' : 'mechanics';
    items.push(`<div class="crew-pending-row">${hire.count} ${what} arriving in ${days} day${days === 1 ? '' : 's'}</div>`);
  }
  for (const training of state.pendingTraining) {
    const days = Math.max(0, Math.ceil((training.completesAtMinute - state.simMinute) / MINUTES_PER_DAY));
    const what =
      training.kind === 'pilot'
        ? `${training.count} pilots upgrading to tier ${training.fromTier + 1}`
        : `${training.count} cabin crew in recurrent service training`;
    items.push(`<div class="crew-pending-row">${what} back in ${days} day${days === 1 ? '' : 's'}</div>`);
  }
  pendingEl.innerHTML = items.length > 0 ? items.join('') : '<div class="crew-pending-row">Nothing in the pipeline.</div>';
}

export function setupCrewPanel(state: SimState): void {
  reserveSlider.min = String(Math.round(RESERVE_DEPTH_MIN * 100));
  reserveSlider.max = String(Math.round(RESERVE_DEPTH_MAX * 100));
  reserveSlider.addEventListener('input', () => {
    state.reserveDepth = Number(reserveSlider.value) / 100;
    updateCrewPanel(state);
  });

  hireRoleSelect.addEventListener('change', () => renderHireCost(state));
  hireTierSelect.addEventListener('change', () => renderHireCost(state));
  hireCountInput.addEventListener('input', () => renderHireCost(state));
  hireButton.addEventListener('click', () => {
    const role = hireRoleSelect.value as CrewRole;
    const tier = role === 'pilot' ? Number(hireTierSelect.value) : 1;
    const count = Math.max(1, Number(hireCountInput.value) || 1);
    if (hireCost(role, tier, count) > state.cash) return; // button is disabled; stale-click guard
    hireCrew(state, role, tier, count);
    updateCrewPanel(state);
  });

  cabinTrainCountInput.addEventListener('input', () => renderCabinTrainCost(state));
  cabinTrainButton.addEventListener('click', () => {
    const count = Math.max(1, Number(cabinTrainCountInput.value) || 1);
    if (count > state.crew.cabinCrew || cabinTrainingCost(count) > state.cash) return;
    startCabinTraining(state, count);
    updateCrewPanel(state);
  });

  trainTierSelect.addEventListener('change', () => renderTrainCost(state));
  trainCountInput.addEventListener('input', () => renderTrainCost(state));
  trainButton.addEventListener('click', () => {
    const fromTier = Number(trainTierSelect.value);
    const count = Math.max(1, Number(trainCountInput.value) || 1);
    if (count > state.crew.pilotsByTier[fromTier - 1] || trainingCost(fromTier, count) > state.cash) return;
    startTraining(state, fromTier, count);
    updateCrewPanel(state);
  });

  updateCrewPanel(state);
}

/**
 * Refreshed every frame while visible, like the Dev and Missions tabs:
 * pending arrivals count down daily, and grounded aircraft change at each
 * rollover.
 */
export function updateCrewPanel(state: SimState): void {
  renderPools(state);
  renderReserve(state);
  renderHireCost(state);
  renderTrainCost(state);
  renderCabinTrainCost(state);
  renderPending(state);
}
