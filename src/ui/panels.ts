import { removeRotation as removeRotationFromSchedule } from '../sim/playerActions';
import { formatNps, networkNps } from '../sim/nps';
import { validateSchedule } from '../sim/schedule';
import { allRotations, utilisationProblems, type Rotation } from '../sim/utilisation';
import { select, type Selection } from './selection';
import { networkTrends, type Measure } from '../sim/trends';
import { classByCode } from '../sim/aircraftClasses';
import { planeIconElement } from './planeIcons';
import { updatePnlHistoryPanel } from './pnlHistory';
import { formatLoadFactor, networkLoadFactor } from '../sim/loadFactor';
import { goalsSummary } from './inspector/goals';
import { headOfficeSummary } from './inspector/headOffice';
import type { SimState } from '../sim/state';
import { minuteOfDayToTimeString } from '../sim/clock';

// Must match the --panel-width custom property's default value in
// style.css — see the comment there. Wide enough for the tab bar, the
// cards and the inspector's tables.
export const PANEL_WIDTH_PX = 420;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const otpEl = document.querySelector<HTMLSpanElement>('#panel-otp')!;
const completionEl = document.querySelector<HTMLSpanElement>('#panel-completion')!;
const loadEl = document.querySelector<HTMLSpanElement>('#panel-load')!;
const npsEl = document.querySelector<HTMLElement>('#panel-nps')!;
const goalsEl = document.querySelector<HTMLButtonElement>('#panel-goals')!;
const headOfficeEl = document.querySelector<HTMLButtonElement>('#panel-head-office')!;

/**
 * The Network panel's cards: each headline number opens the view that
 * explains it. Cash and Runway open Money; the four route measures open
 * Routes sorted by that measure, worst first; Goals and Head office open
 * their own views.
 */
const cardTargets: [string, Selection][] = [
  ['#card-cash', { kind: 'money' }],
  ['#card-runway', { kind: 'money' }],
  ['#card-otp', { kind: 'routes', sort: 'onTime' }],
  ['#card-completion', { kind: 'routes', sort: 'completion' }],
  ['#card-load', { kind: 'routes', sort: 'loadFactor' }],
  ['#card-nps', { kind: 'routes', sort: 'nps' }],
  ['#panel-goals', { kind: 'goals' }],
  ['#panel-head-office', { kind: 'headOffice' }],
];
for (const [selector, target] of cardTargets) {
  document.querySelector<HTMLButtonElement>(selector)!.addEventListener('click', () => select(target));
}

/**
 * A card's trend (sim/trends.ts), as its colour and a line under the
 * value: green getting better, amber holding, red getting worse, against
 * the week before. `change` says by how much, in the card's own units.
 */
function showTrend(card: HTMLElement, measure: Measure, change: (now: number, before: number) => string): void {
  const trendEl = card.querySelector<HTMLElement>('.stat-trend')!;
  card.dataset.trend = measure.direction ?? '';
  if (measure.direction === null || measure.now === null || measure.before === null) {
    trendEl.textContent = '';
    return;
  }
  const arrow = measure.direction === 'better' ? '▲' : measure.direction === 'worse' ? '▼' : '■';
  trendEl.textContent = measure.direction === 'steady' ? `${arrow} holding` : `${arrow} ${change(measure.now, measure.before)} on last week`;
}

function points(now: number, before: number): string {
  const change = Math.round((now - before) * 100);
  return `${change > 0 ? '+' : '−'}${Math.abs(change)} pts`;
}

/** The label-and-value body of the Goals and Head office cards. */
function linkCard(card: HTMLElement, label: string, value: string): void {
  const text = `${label}|${value}`;
  if (card.dataset.text === text) return;
  card.dataset.text = text;
  const labelEl = document.createElement('span');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'stat-value stat-value-small';
  valueEl.textContent = `${value} ›`;
  card.replaceChildren(labelEl, valueEl);
}
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
  const trends = networkTrends(state);
  cashEl.textContent = formatMoney(state.cash);
  showTrend(cashEl.closest<HTMLElement>('.stat-card')!, trends.cash, (now, before) => `${now >= before ? '+' : '−'}${formatMoney(Math.abs(now - before))}`);
  // On-time and Completion over the last week once there is one (sim/trends.ts),
  // so the figure and its colour agree; the lifetime share until then.
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  otpEl.textContent =
    trends.onTime.now !== null
      ? percent(trends.onTime.now)
      : state.flightsArrivedTotal === 0
        ? '—'
        : percent(state.flightsOnTimeTotal / state.flightsArrivedTotal);
  showTrend(otpEl.closest<HTMLElement>('.stat-card')!, trends.onTime, points);
  // Completion Factor — the second reliability axis. On-time says how
  // punctual the flights that operated were; this says how many operated
  // at all, and a carrier can be excellent at one and dreadful at the other.
  completionEl.textContent =
    trends.completion.now !== null
      ? percent(trends.completion.now)
      : state.flightsScheduledTotal === 0
        ? '—'
        : percent((state.flightsScheduledTotal - state.flightsCancelledTotal) / state.flightsScheduledTotal);
  showTrend(completionEl.closest<HTMLElement>('.stat-card')!, trends.completion, points);
  // Load factor (sim/loadFactor.ts): how full the airline flies, last 7 days.
  loadEl.textContent = formatLoadFactor(networkLoadFactor(state));
  showTrend(loadEl.closest<HTMLElement>('.stat-card')!, trends.loadFactor, points);
  // NPS (sim/nps.ts): the airline's name, about the last month.
  npsEl.textContent = state.npsScoredFlightsTotal === 0 ? '—' : formatNps(networkNps(state));
  showTrend(npsEl.closest<HTMLElement>('.stat-card')!, trends.nps, (now, before) => `${now >= before ? '+' : '−'}${Math.abs(Math.round(now - before))}`);
  // Where the airline stands on the ladder (sim/ladder.ts), and head office.
  linkCard(goalsEl, 'Goals', goalsSummary(state));
  linkCard(headOfficeEl, 'Head office', headOfficeSummary(state));
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
 * The rotations list: one row per rotation, never per leg. Rotations are
 * packed into the day automatically, so a per-leg time field would be a
 * control that lies, and deleting one leg out of a rotation would strand
 * the rest of it away from base. The unit the player builds is the unit
 * they remove.
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
 * every call site gets both, never only half.
 */
export function scheduleProblems(state: SimState): string[] {
  return [...validateSchedule(state.schedule, state.aircraft), ...utilisationProblems(state)];
}
