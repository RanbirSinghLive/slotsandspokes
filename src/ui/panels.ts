import { removeRotation as removeRotationFromSchedule } from '../sim/playerActions';
import { money, shortMoney } from './format';
import { formatNps, networkNps } from '../sim/nps';
import { validateSchedule } from '../sim/schedule';
import { allRotations, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE, utilisationProblems, type Rotation } from '../sim/utilisation';
import { select, selectRoute, type Selection } from './selection';
import { networkTrends, type Measure } from '../sim/trends';
import { classByCode } from '../sim/aircraftClasses';
import { planeIconElement } from './planeIcons';
import { updatePnlHistoryPanel } from './pnlHistory';
import { formatLoadFactor, networkLoadFactor } from '../sim/loadFactor';
import { goalsSummary } from './inspector/goals';
import { headOfficeSummary } from './inspector/headOffice';
import type { SimState } from '../sim/state';
import { minuteOfDay, minuteOfDayToTimeString } from '../sim/clock';
import { linkToMap } from './mapLink';

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
  trendEl.textContent = measure.direction === 'steady' ? `${arrow} holding` : `${arrow} ${change(measure.now, measure.before)}`;
  trendEl.title = 'Against the same point last week';
}

function points(now: number, before: number): string {
  const change = Math.round((now - before) * 100);
  return `${change > 0 ? '+' : '−'}${Math.abs(change)} pts`;
}

/** The label-and-value body of the Goals and Head office cards, with a sparkline under the value when given one. */
function linkCard(card: HTMLElement, label: string, value: string, spark?: number[]): void {
  const text = `${label}|${value}|${spark?.join(',') ?? ''}`;
  if (card.dataset.text === text) return;
  card.dataset.text = text;
  const labelEl = document.createElement('span');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'stat-value stat-value-small';
  valueEl.textContent = `${value} ›`;
  card.replaceChildren(labelEl, valueEl);
  if (spark && spark.length > 1) card.append(sparkline(spark));
}

/**
 * A tiny line of recent values with no axes, for reading a trend at a
 * glance: fuel on the Head office card. The fuel chart itself is in the
 * Head office view.
 */
function sparkline(values: number[]): SVGSVGElement {
  const width = 100;
  const height = 16;
  // At least a fifth of the average in height, so a 1% wobble stays a
  // wobble rather than filling the card like a spike.
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = (Math.min(...values) + Math.max(...values)) / 2;
  const span = Math.max(Math.max(...values) - Math.min(...values), 0.2 * Math.abs(mean)) || 1;
  const low = middle - span / 2;
  const points = values.map((value, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 1 - ((value - low) / span) * (height - 2)).toFixed(1)}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'stat-spark');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.join(' '));
  svg.append(line);
  return svg;
}
const rotationsTimelineEl = document.querySelector<HTMLDivElement>('#rotations-timeline')!;
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

/**
 * Refresh the sidebar from `state`. Called once per rendered frame, same as
 * the canvas draw calls — this is a plain read of state, same rule as
 * everything under render/: it never writes back to it.
 */
export function updatePanel(state: SimState): void {
  const trends = networkTrends(state);
  cashEl.textContent = money(state.cash);
  showTrend(cashEl.closest<HTMLElement>('.stat-card')!, trends.cash, (now, before) => `${now >= before ? '+' : '−'}${shortMoney(Math.abs(now - before))}`);
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
  // The last 30 days of fuel, the price Head office is mostly about.
  linkCard(headOfficeEl, 'Head office', headOfficeSummary(state), (state.fuelPriceHistory ?? []).slice(-30));
  updatePnlHistoryPanel(state);

  renderRotations(state);
  updateTimelineNow(state);
}

// The formatter itself lives in sim/clock.ts (the sim writes clock times
// into its own messages); re-exported so the panels keep importing it here.
export { minuteOfDayToTimeString };

/**
 * The rotations timeline: removed one rotation at a time, never per leg. Rotations are
 * packed into the day automatically, so a per-leg time field would be a
 * control that lies, and deleting one leg out of a rotation would strand
 * the rest of it away from base. The unit the player builds is the unit
 * they remove.
 *
 * Rebuilt **only when the rotations actually change** — a per-frame
 * rebuild once broke the remove buttons outright (a click only fires if
 * mousedown and mouseup land on the same element).
 * The only thing that moves with time is the now line, which
 * updateTimelineNow() slides every frame without a rebuild. A rotation's
 * chain, window and share only move when a rotation is added or removed,
 * or when a base change regroups the legs. `signature` captures exactly that.
 *
 * A rotation's remove handler closes over its `Rotation`, which holds the same
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
  const signature =
    state.aircraft.map((aircraft) => aircraft.tail).join(',') +
    '|' +
    rotations.map((r) => `${r.tail}:${r.airports.join('>')}:${r.departMinute}:${r.arriveMinute}:${r.closed}`).join('|');
  if (signature === rotationsSignature) return;
  rotationsSignature = signature;

  rotationsEmptyEl.hidden = rotations.length > 0;
  rotationsTimelineEl.replaceChildren(...(rotations.length > 0 ? buildTimeline(state, rotations) : []));
}

/**
 * The rotations as a timeline: one row per plane, its day drawn across
 * the usable day (06:00–22:00 home time, stretched if a long-haul
 * rotation runs outside it). Each flight is a solid block labelled with
 * where it lands; the faint span around a rotation's flights is the
 * rotation, and opens its route. Gaps are the plane sitting idle, which
 * is what a list of windows and percentages hid.
 */
function buildTimeline(state: SimState, rotations: Rotation[]): HTMLElement[] {
  const start = Math.min(USABLE_DAY_START_MINUTE, ...rotations.map((r) => r.departMinute));
  const end = Math.max(USABLE_DAY_END_MINUTE, ...rotations.map((r) => r.arriveMinute));
  timelineWindow = { start, end };
  const at = (minute: number) => `${((minute - start) / (end - start)) * 100}%`;
  const width = (minutes: number) => `${(minutes / (end - start)) * 100}%`;

  // Hour ticks every four hours, labelled.
  const axis = document.createElement('div');
  axis.className = 'timeline-axis';
  for (let hour = Math.ceil(start / 240) * 4; hour * 60 <= end; hour += 4) {
    const tick = document.createElement('span');
    tick.style.left = at(hour * 60);
    tick.textContent = String(hour % 24).padStart(2, '0');
    axis.append(tick);
  }
  const rows: HTMLElement[] = [axis];

  for (const aircraft of state.aircraft) {
    // A plane with no flights still gets its row: an empty track is an idle plane.
    const own = rotations.filter((rotation) => rotation.tail === aircraft.tail);
    const row = document.createElement('div');
    row.className = 'timeline-row';

    // The plane opens its own view (ui/inspector/aircraft.ts).
    const plane = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: aircraft.tail });
    plane.type = 'button';
    plane.className = 'inspector-link timeline-plane';
    plane.append(planeIconElement(aircraft.typeCode), ` ${aircraft.tail}`);
    const share = own.reduce((sum, rotation) => sum + rotation.share, 0);
    const shareEl = document.createElement('span');
    shareEl.className = 'timeline-share';
    shareEl.textContent = `${Math.round(share * 100)}%`;
    plane.append(shareEl);
    plane.title = `${classByCode(aircraft.typeCode)?.name ?? aircraft.typeCode} ${aircraft.tail} · ${aircraft.baseAirport ?? 'no base'} · ${Math.round(share * 100)}% of its day`;
    plane.addEventListener('click', () => select({ kind: 'aircraft', tail: aircraft.tail }));

    const track = document.createElement('div');
    track.className = 'timeline-track';
    for (const rotation of own) {
      const span = linkToMap(document.createElement('div'), { kind: 'route', a: rotation.airports[0], b: rotation.airports[1] });
      span.className = 'timeline-rotation';
      span.classList.toggle('is-open', !rotation.closed);
      span.style.left = at(rotation.departMinute);
      span.style.width = width(rotation.arriveMinute - rotation.departMinute);
      span.title =
        `${rotation.airports.join(' → ')} · ${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)}` +
        ` · ${Math.round(rotation.share * 100)}% of a plane` +
        (rotation.closed ? '' : ' · never returns to base');
      span.addEventListener('click', () => selectRoute(state, rotation.airports[0], rotation.airports[1]));
      for (const leg of rotation.legs) {
        const block = document.createElement('div');
        block.className = 'timeline-leg';
        block.style.left = `${((leg.departMinute - rotation.departMinute) / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
        block.style.width = `${(leg.blockMinutes / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
        block.textContent = leg.dest;
        span.append(block);
      }
      span.append(removeButtonFor(rotation, state));
      track.append(span);
    }
    const now = document.createElement('div');
    now.className = 'timeline-now';
    track.append(now);
    row.append(plane, track);
    rows.push(row);
  }
  return rows;
}

/** A rotation's ×: two clicks, since a rotation can't be put back. */
function removeButtonFor(rotation: Rotation, state: SimState): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rotation-remove-button';
  button.textContent = '×';
  button.setAttribute('aria-label', `Remove ${rotation.tail} ${rotation.airports.join(' ')}`);
  let armed = false;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!armed) {
      armed = true;
      button.classList.add('is-armed');
      button.title = 'Click again to remove this rotation';
      return;
    }
    removeRotation(rotation, state);
  });
  return button;
}

/** The timeline's minute range as last drawn, for placing the now line each frame. */
let timelineWindow: { start: number; end: number } | null = null;

/** Move every row's now line to the current home-local time: cheap, so it runs every frame. */
function updateTimelineNow(state: SimState): void {
  if (!timelineWindow) return;
  const minute = minuteOfDay(state);
  const inside = minute >= timelineWindow.start && minute <= timelineWindow.end;
  const left = `${((minute - timelineWindow.start) / (timelineWindow.end - timelineWindow.start)) * 100}%`;
  for (const line of rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-now')) {
    line.hidden = !inside;
    line.style.left = left;
  }
}

/**
 * The timeline's remove button: sim/playerActions.ts takes the
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
