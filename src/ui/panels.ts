import { nightStopLegs } from '../sim/nightStops';
import { hasLineBase, outstationCheck } from '../sim/bases';
import { deferredItems, MX_HOLD_AT, tonightCheck } from '../sim/mxChecks';
import { bringNightStopHome, planBringNightStopHome, planRetimeRotation, removeRotation as removeRotationFromSchedule, retimeRotation } from '../sim/playerActions';
import type { RetimePlan } from '../sim/retime';
import { airportHours, FIRST_OPEN_HOUR, freeInHour, OPEN_HOURS } from '../sim/hours';
import { money, shortMoney } from './format';
import { formatNps, networkNps } from '../sim/nps';
import { validateSchedule } from '../sim/schedule';
import { allRotations, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE, utilisationProblems, type Rotation } from '../sim/utilisation';
import { select, selectRoute, type Selection } from './selection';
import { networkTrends, type Measure } from '../sim/trends';
import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { planeIconElement, TYPE_COLOURS } from './planeIcons';
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
 * The Schedule: a rotation is removed and moved whole, never per leg.
 * Deleting or shifting one leg out of a rotation would strand the rest of
 * it away from base; the unit the player builds is the unit they move and
 * remove.
 *
 * Rebuilt **only when the rotations actually change** — a per-frame
 * rebuild once broke the remove buttons outright (a click only fires if
 * mousedown and mouseup land on the same element), and never mid-drag.
 * The only thing that moves with time is the now line, which
 * updateTimelineNow() slides every frame without a rebuild. A rotation's
 * chain, window and share only move when a rotation is added, removed or
 * moved, when a base change regroups the legs, or when a type's group is
 * folded. `signature` captures exactly that.
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

/** Types whose group of rows is folded away, by type code: remembered for the session. */
const collapsedTypes = new Set<string>();
let lastTimelineState: SimState | null = null;

function renderRotations(state: SimState): void {
  lastTimelineState = state;
  // Mid-drag the timeline is the player's; a rebuild would drop what they
  // hold. Unless what they hold is already gone (the panel rebuilt around
  // it): then the drag is over.
  if (drag && drag.span.isConnected) return;
  if (drag) cancelDrag();
  const rotations = allRotations(state);
  const signature =
    [...collapsedTypes].join(',') +
    '|' +
    state.aircraft.map((aircraft) => aircraft.tail).join(',') +
    '|' +
    rotations.map((r) => `${r.tail}:${r.airports.join('>')}:${r.departMinute}:${r.arriveMinute}:${r.closed}`).join('|') +
    '|' +
    JSON.stringify(state.pendingRetimes ?? []);
  if (signature === rotationsSignature) return;
  rotationsSignature = signature;

  rotationsEmptyEl.hidden = rotations.length > 0;
  rotationsTimelineEl.replaceChildren(...(rotations.length > 0 ? buildTimeline(state, rotations) : []));
  updateNightCells(state, true);
}

/** Rebuild now, whatever the signature says: a group folded or unfolded, a move made. */
function rebuildTimeline(): void {
  rotationsSignature = null;
  if (lastTimelineState) renderRotations(lastTimelineState);
}

/**
 * The Schedule: the rotations as a timeline, one row per plane, planes
 * grouped by type under a header that folds the group away. Each
 * rotation is a block in its type's colour (TYPE_COLOURS), its flights
 * solid inside it and labelled with where they land; gaps are the plane
 * sitting idle. The day runs 06:00–22:00 home time, stretched if a
 * long-haul rotation runs outside it.
 *
 * A rotation can be **dragged**: left and right to move it in the day, in
 * 5-minute steps, or down or up onto another plane of its type at its
 * base. While it's held, the sim plans the move (sim/retime.ts) and a tip
 * says what it would do or why it can't, and the base's hours show across
 * the top, room in each (sim/hours.ts). Let go to make it; Esc puts it
 * back. A click without a drag opens its route.
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
  // The dragged rotation's base, hour by hour: filled while a drag is on.
  const hoursLabel = document.createElement('span');
  hoursLabel.className = 'timeline-hours-label';
  const hoursStrip = document.createElement('div');
  hoursStrip.className = 'timeline-hours';
  timelineHours = { label: hoursLabel, strip: hoursStrip, at, width };
  const rows: HTMLElement[] = [document.createElement('span'), axis, hoursLabel, hoursStrip];
  // The key to the night cell beside each plane (sim/mxChecks.ts).
  const key = document.createElement('div');
  key.className = 'timeline-key';
  key.textContent = `☾ tonight's line check: ✓ at a mtc base · c contracted at a station · −40m short by · ✗ deferred, no check · ● deferred items (${MX_HOLD_AT} holds the plane a morning)`;
  rows.push(key);

  for (const cls of AIRCRAFT_CLASSES) {
    const planes = state.aircraft.filter((aircraft) => aircraft.typeCode === cls.code);
    if (planes.length === 0) continue;
    const colour = TYPE_COLOURS[cls.code] ?? '#5ed6c8';
    const collapsed = collapsedTypes.has(cls.code);
    const used = planes.reduce((sum, aircraft) => sum + rotations.filter((r) => r.tail === aircraft.tail).reduce((t, r) => t + r.share, 0), 0);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'timeline-group';
    header.style.setProperty('--puck', colour);
    header.setAttribute('aria-expanded', String(!collapsed));
    header.append(`${collapsed ? '▸' : '▾'} `, planeIconElement(cls.code), ` ${pluralClassName(cls.name)} ×${planes.length}`);
    const usedEl = document.createElement('span');
    usedEl.className = 'timeline-share';
    usedEl.textContent = `${Math.round((used / planes.length) * 100)}% used`;
    header.append(usedEl);
    header.addEventListener('click', () => {
      if (collapsedTypes.has(cls.code)) collapsedTypes.delete(cls.code);
      else collapsedTypes.add(cls.code);
      rebuildTimeline();
    });
    rows.push(header);
    if (collapsed) continue;

    for (const aircraft of planes) {
      // A plane with no flights still gets its row: an empty track is an idle plane.
      const own = rotations.filter((rotation) => rotation.tail === aircraft.tail);
      const row = document.createElement('div');
      row.className = 'timeline-row';

      // The plane opens its own view (ui/inspector/aircraft.ts).
      const plane = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: aircraft.tail });
      plane.type = 'button';
      plane.className = 'inspector-link timeline-plane';
      plane.append(aircraft.tail);
      const share = own.reduce((sum, rotation) => sum + rotation.share, 0);
      const shareEl = document.createElement('span');
      shareEl.className = 'timeline-share';
      shareEl.textContent = `${Math.round(share * 100)}%`;
      plane.append(shareEl);
      // Tonight's line check and deferred items (sim/mxChecks.ts), kept live by updateNightCells().
      const nightEl = document.createElement('span');
      nightEl.className = 'timeline-night';
      nightEl.dataset.tail = aircraft.tail;
      plane.append(nightEl);
      plane.title = `${cls.name} ${aircraft.tail} · ${aircraft.baseAirport ?? 'no base'} · ${Math.round(share * 100)}% of its day`;
      plane.addEventListener('click', () => select({ kind: 'aircraft', tail: aircraft.tail }));

      const track = document.createElement('div');
      track.className = 'timeline-track';
      track.dataset.tail = aircraft.tail;
      track.dataset.type = aircraft.typeCode;
      track.style.setProperty('--puck', colour);
      // A night stop's two halves (sim/nightStops.ts): the morning flight home and the evening flight out.
      const nightStop = nightStopLegs(state, aircraft.tail);
      const halfButtons: HTMLButtonElement[] = [];
      for (const rotation of own) {
        const half = nightStop !== null && (rotation.legs[0] === nightStop.morning || rotation.legs[0] === nightStop.evening);
        const span = linkToMap(document.createElement('div'), { kind: 'route', a: rotation.airports[0], b: rotation.airports[1] });
        span.className = 'timeline-rotation';
        span.classList.toggle('is-open', !rotation.closed && !half);
        span.classList.toggle('is-night-stop', half);
        span.style.left = at(rotation.departMinute);
        span.style.width = width(rotation.arriveMinute - rotation.departMinute);
        span.title =
          `${rotation.airports.join(' → ')} · ${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)}` +
          ` · ${Math.round(rotation.share * 100)}% of a plane` +
          (half
            ? ` · night stop ${nightStop!.morning.origin} · ⌂ or push it past ${rotation.legs[0] === nightStop!.morning ? 'the start' : 'the end'} of the day to bring it home`
            : rotation.closed
              ? ' · drag to move it · past either end of the day for a night stop'
              : ' · never returns to base');
        span.addEventListener('pointerdown', (event) => startDrag(event, span, rotation, track, rotation.closed || half));
        span.addEventListener('click', () => {
          // A drag ends in a click too; only a plain click opens the route.
          if (justDragged) return;
          selectRoute(state, rotation.airports[0], rotation.airports[1]);
        });
        const within = (minute: number) => `${((minute - rotation.departMinute) / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
        rotation.legs.forEach((leg, i) => {
          const block = document.createElement('div');
          block.className = 'timeline-leg';
          block.style.left = within(leg.departMinute);
          block.style.width = `${(leg.blockMinutes / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
          span.append(block);
          // Where the plane waits between this flight and the one before: the chain reads ALB ▬ LGA ▬ ALB.
          if (i > 0) {
            const before = rotation.legs[i - 1];
            span.append(groundLabel(before.dest, within((before.departMinute + before.blockMinutes + leg.departMinute) / 2)));
          }
        });
        if (half) span.append(nightHomeButtonFor(aircraft.tail, state));
        const removeButton = removeButtonFor(rotation, state, half ? own.find((other) => other !== rotation && (other.legs[0] === nightStop!.morning || other.legs[0] === nightStop!.evening)) : undefined);
        if (half) halfButtons.push(removeButton);
        span.append(removeButton);
        track.append(span);
      }
      // A night stop's two × are one control: hovering or arming either lights both.
      if (halfButtons.length === 2) {
        const [first, second] = halfButtons;
        for (const [a, b] of [[first, second], [second, first]]) {
          a.addEventListener('mouseenter', () => b.classList.add('is-linked'));
          a.addEventListener('mouseleave', () => b.classList.remove('is-linked'));
          a.addEventListener('click', () => b.classList.add('is-armed'));
        }
      }
      // Moves held for tomorrow (sim/retime.ts), drawn dashed where they'll sit.
      for (const move of state.pendingRetimes ?? []) {
        if (move.legs[0]?.tail !== aircraft.tail) continue;
        const scheduled = move.legs.map((leg) => ({ ...leg, block: state.schedule.find((l) => l.legId === leg.legId)?.blockMinutes ?? 0 }));
        const departs = Math.min(...scheduled.map((leg) => leg.departMinute));
        const arrives = Math.max(...scheduled.map((leg) => leg.departMinute + leg.block));
        const pending = document.createElement('div');
        pending.className = 'timeline-pending';
        pending.style.left = at(departs);
        pending.style.width = width(arrives - departs);
        pending.textContent = `tomorrow ${minuteOfDayToTimeString(departs)}`;
        pending.title = `Moves here tomorrow · today's flying stays as it is`;
        track.append(pending);
      }
      // The base in each wait between rotations, where another one could drop in.
      if (aircraft.baseAirport) {
        let free = start;
        for (const rotation of [...own].sort((a, b) => a.departMinute - b.departMinute)) {
          if (rotation.departMinute - free >= BASE_LABEL_MIN_GAP) track.append(groundLabel(aircraft.baseAirport, at((free + rotation.departMinute) / 2), true));
          free = rotation.arriveMinute;
        }
        if (end - free >= BASE_LABEL_MIN_GAP) track.append(groundLabel(aircraft.baseAirport, at((free + end) / 2), true));
      }
      const now = document.createElement('div');
      now.className = 'timeline-now';
      track.append(now);
      row.append(plane, track);
      rows.push(row);
    }
  }
  return rows;
}

/** A wait at base shorter than this has no room to name it. */
const BASE_LABEL_MIN_GAP = 45;

/** An airport's code in white, centred at `left`: where the plane is on the ground. */
function groundLabel(iata: string, left: string, atBase = false): HTMLElement {
  const label = document.createElement('span');
  label.className = atBase ? 'timeline-ground is-base' : 'timeline-ground';
  label.style.left = left;
  label.textContent = iata;
  return label;
}

// --- Dragging a rotation ----------------------------------------------------

type Drag = {
  rotation: Rotation;
  span: HTMLElement;
  homeTrack: HTMLElement;
  startX: number;
  startY: number;
  /** Minutes of the day per pixel of track, as laid out when the drag began. */
  minutesPerPx: number;
  moved: boolean;
  target: { tail: string; start: number } | null;
  plan: RetimePlan | null;
};

let drag: Drag | null = null;
let justDragged = false;
/** Where the held rotation started, drawn dashed while it's dragged. */
let dragGhost: HTMLElement | null = null;

/**
 * The clock is held while a rotation is dragged, so the numbers in the tip
 * don't move under the player, and runs again at its speed after.
 * main.ts owns the speed, so it hands these in.
 */
let scheduleClock: { hold: () => void; release: () => void } = { hold: () => {}, release: () => {} };

export function setScheduleClock(clock: { hold: () => void; release: () => void }): void {
  scheduleClock = clock;
}
let timelineHours: { label: HTMLElement; strip: HTMLElement; at: (minute: number) => string; width: (minutes: number) => string } | null = null;
const DRAG_THRESHOLD_PX = 4;

const dragTip = document.createElement('div');
dragTip.id = 'timeline-drag-tip';
dragTip.hidden = true;
document.body.append(dragTip);

/** `draggable`: a rotation that's back at base, or a night stop's half (sim/nightStops.ts). */
function startDrag(event: PointerEvent, span: HTMLElement, rotation: Rotation, track: HTMLElement, draggable: boolean): void {
  if (event.button !== 0 || !draggable) return;
  if ((event.target as HTMLElement).closest('.rotation-remove-button, .night-home-button')) return;
  if (!timelineWindow) return;
  const rect = track.getBoundingClientRect();
  drag = {
    rotation,
    span,
    homeTrack: track,
    startX: event.clientX,
    startY: event.clientY,
    minutesPerPx: (timelineWindow.end - timelineWindow.start) / Math.max(1, rect.width),
    moved: false,
    target: null,
    plan: null,
  };
  // Keep the pointer while it's held, even off the row; not every pointer can be captured.
  try {
    span.setPointerCapture(event.pointerId);
  } catch {
    // A drag still works while the pointer stays over the span.
  }
  span.addEventListener('pointermove', onDragMove);
  span.addEventListener('pointerup', onDragEnd);
  span.addEventListener('pointercancel', cancelDrag);
  span.addEventListener('lostpointercapture', cancelDrag);
}

function onDragMove(event: PointerEvent): void {
  if (!drag || !lastTimelineState || !timelineWindow) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  if (!drag.moved) {
    drag.moved = true;
    scheduleClock.hold();
    drag.span.classList.add('is-dragging');
    // The browser's own hover tips would sit over what's being dragged.
    drag.span.removeAttribute('title');
    for (const el of rotationsTimelineEl.querySelectorAll('[title]')) el.removeAttribute('title');
    dragGhost = document.createElement('div');
    dragGhost.className = 'timeline-ghost';
    dragGhost.style.left = drag.span.style.left;
    dragGhost.style.width = drag.span.style.width;
    drag.homeTrack.append(dragGhost);
    showBaseHours(lastTimelineState, drag.rotation.airports[0]);
  }
  // The row the pointer is level with, if it's a plane of the same type;
  // else its own. Picked by height, not by what's under the pointer (the
  // held block itself is), and shown by sliding the block over that row
  // rather than moving it in the page: moving it would drop the pointer
  // capture and end the drag.
  const homeRect = drag.homeTrack.getBoundingClientRect();
  const sameType = [...rotationsTimelineEl.querySelectorAll<HTMLElement>(`.timeline-track[data-type="${drag.homeTrack.dataset.type}"]`)];
  const track =
    sameType.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3;
    }) ?? drag.homeTrack;
  drag.span.style.transform = `translateY(${track.getBoundingClientRect().top - homeRect.top}px)`;
  for (const candidate of sameType) candidate.classList.toggle('is-drop-target', candidate === track && track !== drag.homeTrack);
  const start = Math.round((drag.rotation.departMinute + dx * drag.minutesPerPx) / 5) * 5;
  const tail = track.dataset.tail!;
  drag.span.style.left = `${((start - timelineWindow.start) / (timelineWindow.end - timelineWindow.start)) * 100}%`;

  if (!drag.target || drag.target.tail !== tail || drag.target.start !== start) {
    drag.target = { tail, start };
    drag.plan = planRetimeRotation(lastTimelineState, drag.rotation.legs.map((leg) => leg.legId), tail, start);
  }
  const plan = drag.plan!;
  drag.span.classList.toggle('is-bad', !plan.ok);
  drag.span.dataset.time = minuteOfDayToTimeString(start);
  dragTip.textContent = plan.ok ? describeRetime(plan, tail, drag.rotation.tail, start) : `${minuteOfDayToTimeString(start)} · ${plan.reason}`;
  dragTip.classList.toggle('is-bad', !plan.ok);
  dragTip.hidden = false;
  const spanRect = drag.span.getBoundingClientRect();
  dragTip.style.left = `${Math.max(8, Math.min(window.innerWidth - dragTip.offsetWidth - 8, spanRect.left))}px`;
  // Under the block: its time is on top of it.
  dragTip.style.top = `${Math.min(window.innerHeight - dragTip.offsetHeight - 8, spanRect.bottom + 6)}px`;
}

/** What a move would do, in ops shorthand: "08:10 · C-P004 · +$1,200/day · slots +$40/day". */
function describeRetime(plan: RetimePlan, tail: string, fromTail: string, start: number): string {
  // A night stop made or brought home (sim/nightStops.ts): what the night is, in ops terms.
  if (plan.kind !== 'move' && plan.station && lastTimelineState) {
    const [a, b] = plan.legs;
    const tomorrow = plan.deferred ? ' · from tomorrow' : '';
    if (plan.kind === 'unwrap') return `Sleeps at base again · ${plan.station} ${minuteOfDayToTimeString(a.departMinute)}–${minuteOfDayToTimeString(b.departMinute + b.blockMinutes)}${tomorrow}`;
    const check = hasLineBase(lastTimelineState, plan.station)
      ? 'line base: line check'
      : outstationCheck(lastTimelineState, plan.station) === 'contract'
        ? 'no line base: contracted check'
        : 'no line base: deferred, ● a night';
    return [`Night stop ${plan.station}`, `out ${minuteOfDayToTimeString(b.departMinute)}`, `back ${minuteOfDayToTimeString(a.departMinute)}`, check, ...(plan.crewWarning ? [plan.crewWarning] : []), ...(plan.deferred ? ['from tomorrow'] : [])].join(' · ');
  }
  const parts = [minuteOfDayToTimeString(start)];
  if (tail !== fromTail) parts.push(tail);
  if (plan.marginChangePerDay !== 0) parts.push(`${plan.marginChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.marginChangePerDay))}/day`);
  if (plan.slotFeeChangePerDay !== 0) parts.push(`slots ${plan.slotFeeChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.slotFeeChangePerDay))}/day`);
  if (plan.startsTomorrow) parts.push('from tomorrow');
  if (plan.crewWarning) parts.push(plan.crewWarning);
  return parts.join(' · ');
}

function onDragEnd(): void {
  if (!drag) return;
  const { moved, plan, target, rotation } = drag;
  finishDrag();
  if (!moved) return;
  // The click that follows a drag isn't a click on the route.
  justDragged = true;
  setTimeout(() => (justDragged = false), 0);
  if (plan?.ok && target && lastTimelineState && (target.start !== rotation.departMinute || target.tail !== rotation.tail)) {
    const result = retimeRotation(lastTimelineState, rotation.legs.map((leg) => leg.legId), target.tail, target.start);
    renderScheduleWarnings(scheduleProblems(lastTimelineState));
    flashTip(result.ok ? result.message : result.reason, !result.ok);
  } else if (plan && !plan.ok) {
    // Snapped back: say why, where the tip was, so the player isn't left guessing.
    flashTip(`Not moved · ${plan.reason}`, true);
  }
  rebuildTimeline();
}

function cancelDrag(): void {
  if (!drag) return;
  finishDrag();
  rebuildTimeline();
}

function finishDrag(): void {
  if (!drag) return;
  const moved = drag.moved;
  drag.span.removeEventListener('pointermove', onDragMove);
  drag.span.removeEventListener('pointerup', onDragEnd);
  drag.span.removeEventListener('pointercancel', cancelDrag);
  drag.span.removeEventListener('lostpointercapture', cancelDrag);
  if (drag.moved) scheduleClock.release();
  delete drag.span.dataset.time;
  drag.span.style.transform = '';
  for (const el of rotationsTimelineEl.querySelectorAll('.is-drop-target')) el.classList.remove('is-drop-target');
  dragGhost?.remove();
  dragGhost = null;
  drag = null;
  dragTip.hidden = true;
  if (timelineHours) {
    timelineHours.label.textContent = '';
    timelineHours.strip.replaceChildren();
  }
  // A drag took every hover tip away; a rebuild puts them back, refused drop or not.
  if (moved) rebuildTimeline();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drag) {
    event.stopPropagation();
    cancelDrag();
  }
}, true);

/** The result of a move, shown where the tip was for a moment. */
function flashTip(text: string, bad: boolean): void {
  dragTip.textContent = text;
  dragTip.classList.toggle('is-bad', bad);
  dragTip.hidden = false;
  setTimeout(() => {
    if (!drag) dragTip.hidden = true;
  }, 2500);
}

/** The dragged rotation's base across the top of the timeline, an hour a cell: room left (dim), full (amber). */
function showBaseHours(state: SimState, iata: string): void {
  if (!timelineHours) return;
  const hours = airportHours(state, iata);
  timelineHours.label.textContent = iata;
  const cells: HTMLElement[] = [];
  for (let hour = FIRST_OPEN_HOUR; hour < FIRST_OPEN_HOUR + OPEN_HOURS; hour++) {
    const cell = document.createElement('span');
    cell.className = 'timeline-hour';
    const free = freeInHour(hours, hour);
    cell.classList.toggle('is-full', free < 1);
    cell.style.left = timelineHours.at(hour * 60);
    cell.style.width = timelineHours.width(60);
    cell.title = `${String(hour).padStart(2, '0')}:00 · room ${Math.max(0, free)}`;
    cells.push(cell);
  }
  timelineHours.strip.replaceChildren(...cells);
}

/** A night stop half's ⌂: bring the night stop home, back to where it sat before (sim/retime.ts). Always showing, since the drag that undoes it is hidden. */
function nightHomeButtonFor(tail: string, state: SimState): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'night-home-button';
  button.textContent = '⌂';
  const plan = planBringNightStopHome(state, tail);
  button.title = plan?.ok ? `Bring ${tail} home for the night · ${describeRetime(plan, tail, tail, plan.legs[0].departMinute)}` : `Bring ${tail} home for the night · ${plan?.reason ?? 'not on a night stop'}`;
  button.setAttribute('aria-label', `Bring ${tail} night stop home`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const result = bringNightStopHome(state, tail);
    renderScheduleWarnings(scheduleProblems(state));
    flashTip(result.ok ? result.message : result.reason, !result.ok);
    rebuildTimeline();
  });
  return button;
}

/**
 * A rotation's ×: two clicks, since a rotation can't be put back. A night
 * stop's half takes its `partner` with it: one half alone would strand the plane.
 */
function removeButtonFor(rotation: Rotation, state: SimState, partner?: Rotation): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rotation-remove-button';
  button.textContent = '×';
  button.setAttribute('aria-label', `Remove ${rotation.tail} ${rotation.airports.join(' ')}`);
  let armed = false;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!armed && !button.classList.contains('is-armed')) {
      armed = true;
      button.classList.add('is-armed');
      button.title = partner ? 'Click again to remove the night stop, both flights' : 'Click again to remove this rotation';
      return;
    }
    removeRotation(rotation, state);
    if (partner) removeRotation(partner, state);
  });
  if (partner) button.title = 'Removes the night stop, both flights · ⌂ brings it home instead';
  return button;
}

/** The timeline's minute range as last drawn, for placing the now line each frame. */
let timelineWindow: { start: number; end: number } | null = null;

/** Move every row's now line to the current home-local time: cheap, so it runs every frame. */
/** The sim minute the night cells were last worked out at: they move with delays, so every NIGHT_REFRESH_MINUTES is enough. */
let nightCellsMinute = -Infinity;
const NIGHT_REFRESH_MINUTES = 15;

/**
 * Each plane's night cell: ☾ and tonight's check as the day is going
 * (checked, short by so many minutes, or away from base), then its
 * deferred items as pips. Its tooltip says what that means.
 */
function updateNightCells(state: SimState, force = false): void {
  if (!force && Math.abs(state.simMinute - nightCellsMinute) < NIGHT_REFRESH_MINUTES) return;
  nightCellsMinute = state.simMinute;
  for (const cell of rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-night')) {
    const tail = cell.dataset.tail!;
    const aircraft = state.aircraft.find((a) => a.tail === tail);
    const tonight = tonightCheck(state, tail);
    const deferred = aircraft ? deferredItems(aircraft) : 0;
    const pips = deferred > 0 ? ' ' + '●'.repeat(Math.min(deferred, MX_HOLD_AT)) : '';
    if (!tonight) {
      cell.textContent = pips;
      cell.className = 'timeline-night';
      cell.title = '';
      continue;
    }
    const status = tonight.away ? '☾✗' : tonight.short ? `☾−${tonight.work - tonight.night}m` : tonight.contracted ? '☾c' : '☾✓';
    cell.textContent = status + pips;
    cell.className = `timeline-night${tonight.away || tonight.short ? ' is-short' : ''}${deferred >= MX_HOLD_AT - 1 ? ' is-hold' : ''}`;
    cell.title =
      (tonight.away
        ? `Tonight at ${tonight.station}, no maintenance base, checks deferred: no line check, so a deferred item.`
        : `Tonight at ${tonight.station}${tonight.contracted ? ', contracted check' : ', maintenance base'}: ${Math.floor(tonight.night / 60)}h ${String(tonight.night % 60).padStart(2, '0')}m for ${Math.floor(tonight.work / 60)}h ${String(tonight.work % 60).padStart(2, '0')}m of work` +
          (tonight.short ? ', so the check is cut short: a deferred item.' : '.')) +
      (deferred > 0 ? ` ${deferred} deferred item${deferred === 1 ? '' : 's'} (●): at ${MX_HOLD_AT}, held for a morning.` : '');
  }
}

function updateTimelineNow(state: SimState): void {
  updateNightCells(state);
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
