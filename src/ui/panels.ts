import { removeRotation as removeRotationFromSchedule } from '../sim/playerActions';
import { validateSchedule } from '../sim/schedule';
import { allRotations, utilisationProblems, type Rotation } from '../sim/utilisation';
import { select } from './selection';
import { classByCode } from '../sim/aircraftClasses';
import { planeIconElement } from './planeIcons';
import { updatePnlHistoryPanel } from './pnlHistory';
import { formatLoadFactor, networkLoadFactor } from '../sim/loadFactor';
import { goalsSummary } from './inspector/goals';
import type { SimState } from '../sim/state';
import { minuteOfDayToTimeString } from '../sim/clock';

// Must match the --panel-width custom property's default value in
// style.css — see the comment there. Week six: widened from 280 to fit a
// tab bar and ledger-style content (Commercial, etc.) that used to get
// the full canvas-width area to themselves.
export const PANEL_WIDTH_PX = 420;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const otpEl = document.querySelector<HTMLSpanElement>('#panel-otp')!;
const completionEl = document.querySelector<HTMLSpanElement>('#panel-completion')!;
const loadEl = document.querySelector<HTMLSpanElement>('#panel-load')!;
const goalsEl = document.querySelector<HTMLButtonElement>('#panel-goals')!;
// Opens Network › Goals (ui/inspector/goals.ts).
goalsEl.addEventListener('click', () => select({ kind: 'goals' }));
const revenueEl = document.querySelector<HTMLSpanElement>('#panel-revenue')!;
const costEl = document.querySelector<HTMLSpanElement>('#panel-cost')!;
const marginEl = document.querySelector<HTMLSpanElement>('#panel-margin')!;
const rotationsBody = document.querySelector<HTMLTableSectionElement>('#rotations-table tbody')!;
const rotationsEmptyEl = document.querySelector<HTMLDivElement>('#rotations-empty')!;
const scheduleWarningsEl = document.querySelector<HTMLUListElement>('#schedule-warnings')!;

/**
 * Show validateSchedule()'s problems (if any) directly in the Schedule
 * panel, not just the console — a route added onto a tail that's already
 * busy elsewhere (its own separate rotation) breaks with zero revenue and
 * no other visible symptom, and console-only errors are easy to miss
 * without devtools open. Every validateSchedule() call site should route
 * its result through here so the panel never shows a stale list from
 * before the player's latest edit.
 */
export function renderScheduleWarnings(problems: string[]): void {
  scheduleWarningsEl.innerHTML = '';
  scheduleWarningsEl.hidden = problems.length === 0;
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem;
    scheduleWarningsEl.appendChild(item);
  }
}

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * Refresh the sidebar from `state`. Called once per rendered frame, same as
 * the canvas draw calls — this is a plain read of state, same rule as
 * everything under render/: it never writes back to it.
 */
export function updatePanel(state: SimState): void {
  cashEl.textContent = formatMoney(state.cash);
  otpEl.textContent =
    state.flightsArrivedTotal === 0
      ? '—'
      : `${Math.round((state.flightsOnTimeTotal / state.flightsArrivedTotal) * 100)}%`;
  // Completion Factor — the second reliability axis. On-time says how
  // punctual the flights that operated were; this says how many operated
  // at all, and a carrier can be excellent at one and dreadful at the other.
  completionEl.textContent =
    state.flightsScheduledTotal === 0
      ? '—'
      : `${Math.round(((state.flightsScheduledTotal - state.flightsCancelledTotal) / state.flightsScheduledTotal) * 100)}%`;
  // Load factor (sim/loadFactor.ts): how full the airline flies, last 7 days.
  loadEl.textContent = formatLoadFactor(networkLoadFactor(state));
  // Where the airline stands on the ladder (sim/ladder.ts).
  goalsEl.textContent = `${goalsSummary(state)} ›`;
  revenueEl.textContent = formatMoney(state.todayRevenue);
  costEl.textContent = formatMoney(state.todayCost);
  marginEl.textContent = formatMoney(state.todayMargin);
  updatePnlHistoryPanel(state);

  renderRotations(state);
}

// The formatter itself lives in sim/clock.ts (the sim writes clock times
// into its own messages); re-exported so the panels keep importing it here.
export { minuteOfDayToTimeString };

/**
 * Week seven, phase C: the schedule table is gone and this replaces it.
 *
 * The old table listed individual legs with an editable depart time and a
 * per-leg delete — which made sense while the player authored the
 * timeline. They no longer do: rotations are packed into the day
 * automatically, so a per-leg time field would be a control that lies, and
 * deleting one leg out of a rotation would strand the rest of it away from
 * base. The unit the player builds is the unit they remove.
 *
 * Rebuilt **only when the rotations actually change** — a per-frame
 * rebuild once broke the remove buttons outright (a click only fires if
 * mousedown and mouseup land on the same element).
 * Nothing here is time-varying anyway: a rotation's chain, window and
 * share only move when a rotation is added or removed, or when a base
 * change regroups the legs. `signature` captures exactly that.
 *
 * A row's remove handler closes over its `Rotation`, which holds the same
 * leg objects that are in `state.schedule` — so even a handler built
 * several changes ago still removes the right legs, and the rebuild that
 * follows replaces it.
 */
// null rather than '' so the first render always builds — an empty fleet
// legitimately has an empty signature, and starting them equal would skip
// the build that sets the empty-state message's visibility.
let rotationsSignature: string | null = null;

function renderRotations(state: SimState): void {
  const rotations = allRotations(state);
  const signature = rotations
    .map((r) => `${r.tail}:${r.airports.join('>')}:${r.departMinute}:${r.arriveMinute}:${r.closed}`)
    .join('|');
  if (signature === rotationsSignature) return;
  rotationsSignature = signature;

  rotationsEmptyEl.hidden = rotations.length > 0;
  rotationsBody.innerHTML = '';

  for (const rotation of rotations) {
    const row = document.createElement('tr');
    row.className = 'rotation-row';
    if (!rotation.closed) row.classList.add('rotation-row--open');

    // The plane opens its own view (ui/inspector/aircraft.ts): its whole
    // day, leg by leg.
    const planeCell = document.createElement('td');
    const typeCode = state.aircraft.find((a) => a.tail === rotation.tail)?.typeCode ?? '';
    const planeLink = document.createElement('button');
    planeLink.type = 'button';
    planeLink.className = 'inspector-link';
    planeLink.append(planeIconElement(typeCode), classByCode(typeCode)?.name ?? typeCode);
    planeLink.title = `${rotation.tail}: open its day`;
    planeLink.addEventListener('click', () => select({ kind: 'aircraft', tail: rotation.tail }));
    planeCell.append(planeLink);

    const routeCell = document.createElement('td');
    routeCell.className = 'rotation-route-cell';
    routeCell.textContent = rotation.airports.join(' → ');

    const windowCell = document.createElement('td');
    windowCell.textContent = `${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)}`;

    // The pivot's headline number, per rotation: what share of one
    // aircraft's usable day this costs. Adding up a tail's rows tells the
    // player how full that aeroplane is without a timeline to read.
    const shareCell = document.createElement('td');
    shareCell.textContent = `${Math.round(rotation.share * 100)}%`;

    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'rotation-remove-button';
    removeButton.textContent = '×';
    removeButton.setAttribute('aria-label', `Remove ${rotation.tail} ${rotation.airports.join(' ')}`);
    removeButton.addEventListener('click', () => removeRotation(rotation, state));
    removeCell.appendChild(removeButton);

    row.append(planeCell, routeCell, windowCell, shareCell, removeCell);
    rotationsBody.appendChild(row);
  }
}

/**
 * The rotations table's remove button: sim/playerActions.ts takes the
 * rotation out, then the warnings are redrawn for the new schedule.
 */
export function removeRotation(rotation: Rotation, state: SimState): void {
  removeRotationFromSchedule(state, rotation);
  renderScheduleWarnings(scheduleProblems(state));
}

/**
 * Every problem worth showing the player, from both halves of the check:
 * `validateSchedule()` for what the *world* says (an aircraft parked
 * somewhere its legs never depart from, an aircraft too large for an
 * airport it's booked into) and `utilisationProblems()` for what the
 * *budget* says (a tail asked to fly more than a day). One function so
 * every call site gets both — the two used to be one list, and phase C
 * splitting them made it easy to accidentally render only half.
 */
export function scheduleProblems(state: SimState): string[] {
  return [...validateSchedule(state.schedule, state.aircraft), ...utilisationProblems(state)];
}
