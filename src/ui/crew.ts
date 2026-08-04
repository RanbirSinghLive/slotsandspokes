import {
  crewRequirement,
  dailyCrewSalary,
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
  immediateHireCost,
  LINE_START_EFFICIENCY,
  LINE_MAX_EFFICIENCY,
  retoolLine,
  trainingCostPerHead,
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

const lineRoleSelect = el<HTMLSelectElement>('#crew-line-role');
const lineTierSelect = el<HTMLSelectElement>('#crew-line-tier');
const lineFundingInput = el<HTMLInputElement>('#crew-line-funding');
const lineCostEl = el<HTMLDivElement>('#crew-line-cost');
const lineButton = el<HTMLButtonElement>('#crew-line-button');
const linesListEl = el<HTMLDivElement>('#crew-lines-list');

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
  const cost = immediateHireCost(role, tier, count);
  hireCostEl.textContent =
    `${money(cost)} up front · arrives in ${HIRE_LEAD_TIME_DAYS} days · agency rate, ` +
    `a mature line makes the same head for ${money(trainingCostPerHead(role, tier) * count)}` +
    shortfallNote(cost, state.cash);
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

/** Heads per month a line at this funding and efficiency would produce. */
function outputPerMonth(role: CrewRole, tier: number, fundingPerMonth: number, efficiency: number): number {
  return (fundingPerMonth * efficiency) / trainingCostPerHead(role, tier);
}

/**
 * What opening this line would commit to. Quotes both ends of the ramp,
 * because the gap between them is the entire mechanic: what you get on day
 * one versus what the same money buys once the line has matured.
 */
function renderLineCost(state: SimState): void {
  const role = lineRoleSelect.value as CrewRole;
  lineTierSelect.disabled = role !== 'pilot';
  const tier = role === 'pilot' ? Number(lineTierSelect.value) : 1;
  const funding = Math.max(0, Number(lineFundingInput.value) || 0);

  const existing = state.trainingLines.find((l) => l.role === role && (role !== 'pilot' || l.tier === tier));
  lineButton.disabled = existing !== undefined || funding <= 0;

  if (existing) {
    lineCostEl.textContent = `Already running for ${roleLabel(role, tier)} — adjust its funding below, or retool another line onto this tier.`;
    lineCostEl.classList.remove('crew-short');
    return;
  }

  const atStart = outputPerMonth(role, tier, funding, LINE_START_EFFICIENCY);
  const atFull = outputPerMonth(role, tier, funding, LINE_MAX_EFFICIENCY);
  lineCostEl.textContent =
    `${money(funding)}/month · ${roleLabel(role, tier)} · ` +
    `${atStart.toFixed(1)}/month at first, ${atFull.toFixed(1)}/month once mature (about 6 months).`;
  lineCostEl.classList.toggle('crew-short', funding > state.cash * 3);
}

/**
 * One row per running line: what it produces, how efficient it is, its
 * funding, and controls to retool or close it.
 *
 * Rebuilt only when its content changes. This panel refreshes every frame
 * while the Crew tab is visible and these rows own an `<input>` and two
 * buttons — a per-frame rebuild would steal focus from the funding field
 * mid-edit and stop the buttons firing at all, since a click needs
 * mousedown and mouseup on the same element. See ui/panels.ts's
 * renderFleet() for what that looks like when missed.
 */
let linesSignature: string | null = null;

function renderLines(state: SimState): void {
  const signature = state.trainingLines
    .map((l) => `${l.id}:${l.role}:${l.tier}:${l.fundingPerMonth}:${l.efficiency.toFixed(3)}:${l.retoolDaysLeft}`)
    .join('|');
  if (signature === linesSignature) return;
  linesSignature = signature;

  linesListEl.innerHTML = '';
  if (state.trainingLines.length === 0) {
    linesListEl.innerHTML = '<div class="crew-pending-row">No training lines. Crew only arrive through a line, or an immediate hire above.</div>';
    return;
  }

  for (const line of state.trainingLines) {
    const row = document.createElement('div');
    row.className = 'crew-line-row';

    const title = document.createElement('div');
    title.className = 'crew-line-title';
    title.textContent = roleLabel(line.role, line.tier);

    const status = document.createElement('div');
    status.className = 'crew-line-status';
    status.textContent =
      line.retoolDaysLeft > 0
        ? `retooling — ${line.retoolDaysLeft} day${line.retoolDaysLeft === 1 ? '' : 's'} left, still funded, producing nobody`
        : `${Math.round(line.efficiency * 100)}% efficient · ${outputPerMonth(line.role, line.tier, line.fundingPerMonth, line.efficiency).toFixed(1)}/month`;

    const controls = document.createElement('div');
    controls.className = 'crew-line-controls';

    const funding = document.createElement('input');
    funding.type = 'number';
    funding.min = '0';
    funding.step = '500';
    funding.value = String(line.fundingPerMonth);
    funding.className = 'crew-line-funding';
    funding.addEventListener('change', () => {
      line.fundingPerMonth = Math.max(0, Number(funding.value) || 0);
      updateCrewPanel(state);
    });

    const suffix = document.createElement('span');
    suffix.className = 'crew-form-suffix';
    suffix.textContent = '$/month';

    // Retooling is only meaningful for pilots — cabin crew and mechanics
    // aren't type-rated, so their lines have nothing to convert between.
    const retool = document.createElement('select');
    retool.className = 'crew-line-retool';
    if (line.role === 'pilot') {
      for (let t = 1; t <= MAX_PILOT_TIER; t++) {
        const option = document.createElement('option');
        option.value = String(t);
        option.textContent = TIER_NAMES[t - 1];
        retool.appendChild(option);
      }
      retool.value = String(line.tier);
      retool.addEventListener('change', () => {
        retoolLine(line, Number(retool.value));
        updateCrewPanel(state);
      });
    } else {
      retool.hidden = true;
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'crew-line-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close the ${roleLabel(line.role, line.tier)} line`);
    close.addEventListener('click', () => {
      const index = state.trainingLines.indexOf(line);
      if (index !== -1) state.trainingLines.splice(index, 1);
      updateCrewPanel(state);
    });

    controls.append(funding, suffix, retool, close);
    row.append(title, status, controls);
    linesListEl.appendChild(row);
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
    if (immediateHireCost(role, tier, count) > state.cash) return; // button is disabled; stale-click guard
    hireCrew(state, role, tier, count);
    updateCrewPanel(state);
  });

  lineRoleSelect.addEventListener('change', () => renderLineCost(state));
  lineTierSelect.addEventListener('change', () => renderLineCost(state));
  lineFundingInput.addEventListener('input', () => renderLineCost(state));
  lineButton.addEventListener('click', () => {
    const role = lineRoleSelect.value as CrewRole;
    const tier = role === 'pilot' ? Number(lineTierSelect.value) : 1;
    if (state.trainingLines.some((l) => l.role === role && (role !== 'pilot' || l.tier === tier))) return;
    state.trainingLines.push({
      id: `line-${state.trainingLines.length + 1}-${role}-${tier}`,
      role,
      tier,
      fundingPerMonth: Math.max(0, Number(lineFundingInput.value) || 0),
      efficiency: LINE_START_EFFICIENCY,
      retoolDaysLeft: 0,
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
  renderLineCost(state);
  renderLines(state);
  renderPending(state);
}
