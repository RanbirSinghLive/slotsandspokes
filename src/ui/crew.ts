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
  projectedHeadcount,
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

const standingRoleSelect = el<HTMLSelectElement>('#crew-standing-role');
const standingTierSelect = el<HTMLSelectElement>('#crew-standing-tier');
const standingRateInput = el<HTMLInputElement>('#crew-standing-rate');
const standingCostEl = el<HTMLDivElement>('#crew-standing-cost');
const standingButton = el<HTMLButtonElement>('#crew-standing-button');
const standingListEl = el<HTMLDivElement>('#crew-standing-list');

const pendingEl = el<HTMLDivElement>('#crew-pending');

const maintenanceEl = el<HTMLDivElement>('#crew-maintenance');

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * A "have / need" line, marked short when the pool can't cover the
 * operating minimum. `incoming` is headcount already bought and on its way
 * — shown right on the pool it will land in, because hiring has a
 * ten-day lead time and without this the Pilots row is completely
 * unmoved by a successful recruitment. The pipeline list further down said
 * so all along, but nobody watching the number they just paid to change
 * is looking there.
 */
function poolRow(label: string, have: number, need: number, target: number, incoming = 0): string {
  const short = have < need;
  return `
    <div class="crew-pool-row">
      <span class="crew-pool-label">${label}</span>
      <span class="${short ? 'crew-short' : 'crew-ok'}">${have}${incoming > 0 ? `<span class="crew-incoming"> +${incoming}</span>` : ''}</span>
      <span class="crew-pool-need">need ${need} · target ${target}</span>
    </div>`;
}

/** Headcount already paid for and in the pipeline, by where it will land. */
function incomingCrew(state: SimState): { pilotsByTier: number[]; cabinCrew: number; mechanics: number } {
  const pilotsByTier = new Array(MAX_PILOT_TIER).fill(0);
  let cabinCrew = 0;
  let mechanics = 0;

  for (const hire of state.pendingHires) {
    if (hire.role === 'pilot') pilotsByTier[hire.tier - 1] += hire.count;
    else if (hire.role === 'cabin') cabinCrew += hire.count;
    else mechanics += hire.count;
  }
  // Pilots away upgrading come back one tier higher, and cabin crew come
  // back to the same pool they left — both are headcount the player is
  // waiting on just as much as a new hire.
  for (const training of state.pendingTraining) {
    if (training.kind === 'pilot') pilotsByTier[training.fromTier] += training.count;
    else cabinCrew += training.count;
  }
  return { pilotsByTier, cabinCrew, mechanics };
}

function renderPools(state: SimState): void {
  const req = crewRequirement(state);
  const incoming = incomingCrew(state);
  const rows: string[] = [];

  for (let tier = 1; tier <= MAX_PILOT_TIER; tier++) {
    // Only show a tier once it's relevant — an all-turboprop operator
    // doesn't need a mainline-jet row cluttering the panel. A tier with
    // crew on the way counts as relevant, or hiring into an empty tier
    // would appear to do nothing at all.
    if (
      req.pilotsByTier[tier - 1] === 0 &&
      state.crew.pilotsByTier[tier - 1] === 0 &&
      incoming.pilotsByTier[tier - 1] === 0
    ) {
      continue;
    }
    rows.push(
      poolRow(
        `Pilots — ${TIER_NAMES[tier - 1]}`,
        state.crew.pilotsByTier[tier - 1],
        req.pilotsByTier[tier - 1],
        req.targetPilotsByTier[tier - 1],
        incoming.pilotsByTier[tier - 1],
      ),
    );
  }
  if (rows.length === 0) rows.push(poolRow('Pilots', 0, 0, 0));

  rows.push(poolRow('Cabin crew', state.crew.cabinCrew, req.cabinCrew, req.targetCabinCrew, incoming.cabinCrew));
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
  rows.push(poolRow('Mechanics', state.crew.mechanics, 0, req.targetMechanics, incoming.mechanics));

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

/**
 * Every one of these three buttons goes grey when it can't be afforded (or,
 * for the training ones, when there aren't enough people to send). A grey
 * button with no stated reason reads as a broken button — that is exactly
 * how "Recruit doesn't do anything" was reported — so each cost line now
 * says what is missing, the same plain-message treatment the route
 * builder's blocked states already get.
 */
function shortfallNote(cost: number, cash: number): string {
  return cost > cash ? ` — ${money(cost - cash)} short` : '';
}

function renderHireCost(state: SimState): void {
  const role = hireRoleSelect.value as CrewRole;
  hireTierSelect.disabled = role !== 'pilot';
  const tier = role === 'pilot' ? Number(hireTierSelect.value) : 1;
  const count = Math.max(1, Number(hireCountInput.value) || 1);
  const cost = hireCost(role, tier, count);
  hireCostEl.textContent =
    `${money(cost)} up front · arrives in ${HIRE_LEAD_TIME_DAYS} days${shortfallNote(cost, state.cash)}`;
  hireCostEl.classList.toggle('crew-short', cost > state.cash);
  hireButton.disabled = cost > state.cash;
}

function renderTrainCost(state: SimState): void {
  const fromTier = Number(trainTierSelect.value);
  const count = Math.max(1, Number(trainCountInput.value) || 1);
  const cost = trainingCost(fromTier, count);
  const available = state.crew.pilotsByTier[fromTier - 1];
  const tooFew = count > available;
  trainCostEl.textContent =
    `${money(cost)} · ${TRAINING_DAYS} days · ${count} of ${available} tier-${fromTier} pilots unavailable while training` +
    (tooFew ? ` — you only have ${available}` : shortfallNote(cost, state.cash));
  trainCostEl.classList.toggle('crew-short', tooFew || cost > state.cash);
  trainButton.disabled = cost > state.cash || tooFew;
}

function renderCabinTrainCost(state: SimState): void {
  const count = Math.max(1, Number(cabinTrainCountInput.value) || 1);
  const cost = cabinTrainingCost(count);
  const share = cabinServiceShare(state.crew);
  const npsNow = Math.round(share * 15);
  const tooFew = count > state.crew.cabinCrew;
  cabinTrainCostEl.textContent =
    `${money(cost)} · ${CABIN_TRAINING_DAYS} days off the line · ` +
    `currently worth +${npsNow} NPS per flight at ${Math.round(share * 100)}% trained` +
    (tooFew ? ` — you only have ${state.crew.cabinCrew}` : shortfallNote(cost, state.cash));
  cabinTrainCostEl.classList.toggle('crew-short', tooFew || cost > state.cash);
  cabinTrainButton.disabled = cost > state.cash || tooFew;
}

function roleLabel(role: CrewRole, tier: number): string {
  if (role === 'pilot') return `${TIER_NAMES[tier - 1]} pilots`;
  return role === 'cabin' ? 'cabin crew' : 'mechanics';
}

/**
 * What starting this order would commit to. Deliberately quotes a monthly
 * run rate rather than a total: there is no total, since the order stops
 * at the fleet's own target and that target moves with the fleet.
 */
function renderStandingCost(state: SimState): void {
  const role = standingRoleSelect.value as CrewRole;
  standingTierSelect.disabled = role !== 'pilot';
  const tier = role === 'pilot' ? Number(standingTierSelect.value) : 1;
  const rate = Math.max(1, Number(standingRateInput.value) || 1);

  const req = crewRequirement(state);
  const target = role === 'pilot' ? req.targetPilotsByTier[tier - 1] : role === 'cabin' ? req.targetCabinCrew : req.targetMechanics;
  const projected = projectedHeadcount(state, role, tier);
  const short = Math.max(0, target - projected);

  const alreadyRunning = state.standingOrders.some((o) => o.role === role && (role !== 'pilot' || o.tier === tier));
  standingButton.disabled = alreadyRunning;

  standingCostEl.textContent = alreadyRunning
    ? `Already running for ${roleLabel(role, tier)} — cancel it below to change the rate.`
    : short === 0
      ? `${money(hireCost(role, tier, rate))}/month while below target. ${roleLabel(role, tier)} are already at target (${projected} of ${target}), so this would sit idle until the fleet grows.`
      : `${money(hireCost(role, tier, rate))}/month until target. ${short} short right now (${projected} of ${target}), about ${Math.ceil(short / rate)} month${Math.ceil(short / rate) === 1 ? '' : 's'} at this rate.`;
}

/**
 * The running orders, each cancellable.
 *
 * Rebuilt **only when its own content changes**, not on every call. This
 * whole panel is refreshed once per frame while the Crew tab is visible
 * (see updateCrewPanel() below and main.ts's render loop), and these rows
 * own buttons: a click only fires when mousedown and mouseup land on the
 * same element, so tearing the list down ~60 times a second makes Cancel
 * do nothing at all. Exactly the bug ui/panels.ts's renderFleet() documents
 * — and it survived a scripted `.click()` here too, because that invokes
 * the handler directly and never exercises the press.
 *
 * The signature covers everything rendered, including the projected and
 * target counts, so the status text still tracks daily changes.
 */
let standingSignature: string | null = null;

function renderStandingList(state: SimState): void {
  const req0 = crewRequirement(state);
  const signature = state.standingOrders
    .map((o) => {
      const target =
        o.role === 'pilot' ? req0.targetPilotsByTier[o.tier - 1] : o.role === 'cabin' ? req0.targetCabinCrew : req0.targetMechanics;
      return `${o.role}:${o.tier}:${o.perMonth}:${projectedHeadcount(state, o.role, o.tier)}/${target}`;
    })
    .join('|');
  if (signature === standingSignature) return;
  standingSignature = signature;

  standingListEl.innerHTML = '';
  if (state.standingOrders.length === 0) {
    standingListEl.innerHTML = '<div class="crew-pending-row">No standing orders.</div>';
    return;
  }

  const req = crewRequirement(state);
  for (const order of state.standingOrders) {
    const target =
      order.role === 'pilot'
        ? req.targetPilotsByTier[order.tier - 1]
        : order.role === 'cabin'
          ? req.targetCabinCrew
          : req.targetMechanics;
    const projected = projectedHeadcount(state, order.role, order.tier);
    const idle = projected >= target;

    const row = document.createElement('div');
    row.className = 'crew-standing-row';

    const label = document.createElement('span');
    label.textContent = `${order.perMonth}/month ${roleLabel(order.role, order.tier)}`;

    const status = document.createElement('span');
    status.className = idle ? 'crew-standing-idle' : 'crew-standing-active';
    status.textContent = idle ? `holding at target (${projected}/${target})` : `hiring — ${projected}/${target}`;

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'crew-standing-cancel';
    cancel.textContent = '×';
    cancel.setAttribute('aria-label', `Cancel standing order for ${roleLabel(order.role, order.tier)}`);
    cancel.addEventListener('click', () => {
      const index = state.standingOrders.indexOf(order);
      if (index !== -1) state.standingOrders.splice(index, 1);
      updateCrewPanel(state);
    });

    row.append(label, status, cancel);
    standingListEl.appendChild(row);
  }
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

  standingRoleSelect.addEventListener('change', () => renderStandingCost(state));
  standingTierSelect.addEventListener('change', () => renderStandingCost(state));
  standingRateInput.addEventListener('input', () => renderStandingCost(state));
  standingButton.addEventListener('click', () => {
    const role = standingRoleSelect.value as CrewRole;
    const tier = role === 'pilot' ? Number(standingTierSelect.value) : 1;
    if (state.standingOrders.some((o) => o.role === role && (role !== 'pilot' || o.tier === tier))) return;
    state.standingOrders.push({
      role,
      tier,
      perMonth: Math.max(1, Number(standingRateInput.value) || 1),
      accrued: 0,
    });
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
  renderStandingCost(state);
  renderStandingList(state);
  renderPending(state);
}
