import { mandatedLeg, mandatesOf } from '../sim/mandates';
import { powertrainMark } from './powertrainMark';
import { planeStatus, planeTip } from './inspector/aircraft';
import { aogFor } from '../sim/aog';
import { TOUCH_TIP_MS } from './mapTools';
import { nightStopLegs } from '../sim/nightStops';
import { hasLineBase } from '../sim/bases';
import { deferredItems, MX_HOLD_AT, tonightCheck } from '../sim/mxChecks';
import { draftProblem, dropRotationInDraft, overlappingLegs, planBringNightStopHome, planConnections, planFleetSort, planDropRotation, planGroundTimeChange, removeRotation as removeRotationFromSchedule, saveDraft, scheduleAfterSlips, snappedStart, type DraftMove, type DropPlan, type SortMode } from '../sim/playerActions';
import { GROUND_STEP_MINUTES, type DropConnections } from '../sim/scheduleDraft';
import { cancelPendingRetime, type RetimePlan } from '../sim/retime';
import { airportHours, FIRST_OPEN_HOUR, freeInHour, OPEN_HOURS } from '../sim/hours';
import { money, shortMoney } from './format';
import { formatNps, networkNps } from '../sim/nps';
import { SAME_ROUTE_SPACING_MINUTES, stackedDepartures, validateSchedule, type ScheduleLeg } from '../sim/schedule';
import { allRotations, rotationsForTail, USABLE_DAY_END_MINUTE, USABLE_DAY_MINUTES, USABLE_DAY_START_MINUTE, utilisationProblems, wrappedLongHaul, type Rotation } from '../sim/utilisation';
import { select, selectRoute, type Selection } from './selection';
import { networkTrends, type Measure } from '../sim/trends';
import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { planeIconElement, TYPE_COLOURS } from './planeIcons';
import { updatePnlHistoryPanel } from './pnlHistory';
import { formatLoadFactor, networkLoadFactor } from '../sim/loadFactor';
import { goalsSummary } from './inspector/goals';
import type { SimState } from '../sim/state';
import { minuteOfDay, minuteOfDayToTimeString } from '../sim/clock';
import { info } from './inspector/dom';
import { linkToMap } from './mapLink';
import { glyphSvg, type GlyphName } from './glyphs';
import { marginMovers, type MarginMovers } from '../sim/marginMovers';
import { marginTip, percentText, trendMark } from './marginChip';
import { networkMargin, type NetworkMargin } from '../sim/networkMargin';
import { hubBanksAt } from '../sim/hubStyle';

// Must match the --panel-width custom property's default value in
// style.css — see the comment there. Wide enough for the tab bar, the
// cards and the inspector's tables.
export const PANEL_WIDTH_PX = 420;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const otpEl = document.querySelector<HTMLSpanElement>('#panel-otp')!;
const marginEl = document.querySelector<HTMLSpanElement>('#panel-margin')!;
const completionEl = document.querySelector<HTMLSpanElement>('#panel-completion')!;
const loadEl = document.querySelector<HTMLSpanElement>('#panel-load')!;
const npsEl = document.querySelector<HTMLElement>('#panel-nps')!;
const goalsEl = document.querySelector<HTMLButtonElement>('#panel-goals')!;

/**
 * The Network panel's cards: each headline number opens the view that
 * explains it. Cash and Runway open Money; the four route measures open
 * Routes sorted by that measure, worst first; Goals and Fleet open
 * their own views, and Attention (ui/rail.ts) opens the first thing wrong.
 */
const cardTargets: [string, Selection][] = [
  ['#card-cash', { kind: 'money' }],
  ['#card-runway', { kind: 'money' }],
  ['#card-margin', { kind: 'money' }],
  ['#card-otp', { kind: 'routes', sort: 'onTime' }],
  ['#card-completion', { kind: 'routes', sort: 'completion' }],
  ['#card-load', { kind: 'routes', sort: 'loadFactor' }],
  ['#card-nps', { kind: 'routes', sort: 'nps' }],
  ['#panel-goals', { kind: 'goals' }],
  ['#card-fleet', { kind: 'fleet' }],
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

/** The Margin card: the week's flying margin, coloured by band, with its move against the week before. */
function showMargin(card: HTMLElement, valueEl: HTMLElement, margin: NetworkMargin | null, movers: MarginMovers | null): void {
  const trendEl = card.querySelector<HTMLElement>('.stat-trend')!;
  if (margin === null) {
    valueEl.textContent = '—';
    trendEl.textContent = '';
    card.dataset.trend = '';
    card.dataset.tip = 'Shown after 3 flown days';
    return;
  }
  valueEl.textContent = percentText(margin.flying);
  card.dataset.trend = margin.previousFlying === null ? '' : margin.flying - margin.previousFlying > 0.01 ? 'better' : margin.flying - margin.previousFlying < -0.01 ? 'worse' : 'steady';
  if (margin.previousFlying === null) {
    trendEl.textContent = '';
  } else {
    const mark = trendMark(margin.flying, margin.previousFlying);
    trendEl.textContent = mark === '' ? '■ holding' : `${mark} ${points(margin.flying, margin.previousFlying)}`;
  }
  trendEl.title = 'Against the week before';
  card.dataset.tip = marginTip(margin, movers);
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
  // Flying margin (sim/networkMargin.ts): what the routes keep of their revenue, last 7 days.
  showMargin(marginEl.closest<HTMLElement>('.stat-card')!, marginEl, networkMargin(state), marginMovers(state));
  // Load factor (sim/loadFactor.ts): how full the airline flies, last 7 days.
  loadEl.textContent = formatLoadFactor(networkLoadFactor(state));
  showTrend(loadEl.closest<HTMLElement>('.stat-card')!, trends.loadFactor, points);
  // NPS (sim/nps.ts): the airline's name, about the last month.
  npsEl.textContent = state.npsScoredFlightsTotal === 0 ? '—' : formatNps(networkNps(state));
  showTrend(npsEl.closest<HTMLElement>('.stat-card')!, trends.nps, (now, before) => `${now >= before ? '+' : '−'}${Math.abs(Math.round(now - before))}`);
  // Where the airline stands on the ladder (sim/ladder.ts), and head office.
  linkCard(goalsEl, 'Goals', goalsSummary(state));
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
/** The state the timeline draws and plans on: the real one, or the draft's copy while one is open. */
let lastTimelineState: SimState | null = null;
let liveState: SimState | null = null;

function renderRotations(live: SimState): void {
  liveState = live;
  restoreDraft(live);
  // While a draft is open the timeline draws and plans on its copy of the state.
  const state = draft ? draft.world : live;
  lastTimelineState = state;
  // Mid-drag the timeline is the player's; a rebuild would drop what they
  // hold. Unless what they hold is already gone (the panel rebuilt around
  // it): then the drag is over.
  if (drag && drag.span.isConnected) return;
  if (drag) cancelDrag();
  const rotations = draft ? draftRotations(live, draft.world) : allRotations(live);
  const signature =
    [...collapsedTypes].join(',') +
    '|' +
    state.aircraft.map((aircraft) => aircraft.tail).join(',') +
    '|' +
    rotations.map((r) => `${r.tail}:${r.airports.join('>')}:${r.departMinute}:${r.arriveMinute}:${r.closed}`).join('|') +
    '|' +
    JSON.stringify(state.pendingRetimes ?? []) +
    '|' +
    (draft ? draft.drops.length : 'live');
  if (signature === rotationsSignature) return;
  rotationsSignature = signature;

  rotationsEmptyEl.hidden = rotations.length > 0;
  rotationsTimelineEl.replaceChildren(...(rotations.length > 0 ? buildTimeline(state, rotations) : []));
  rotationsTimelineEl.classList.toggle('is-planning', draft !== null);
  updateDraftBar();
  updateNightCells(state, true);
}

/** Rebuild now, whatever the signature says: a group folded or unfolded, a move made. */
function rebuildTimeline(): void {
  rotationsSignature = null;
  if (liveState) renderRotations(liveState);
}

// --- Planning a draft -------------------------------------------------------

/**
 * Every Gantt change (a drop, a swap, a turn step, a sort, a night stop's ⌂)
 * goes in a **draft**: the timeline then plans on a copy of the state, where
 * flights may overlap (red where they do), until the green ✓ replays every
 * change on the real state (sim/scheduleDraft.ts), all or nothing. ✕ throws
 * the draft away, ↶ takes back the last change. One rule, so the player
 * always knows a change isn't made until ✓.
 */
type Draft = {
  world: SimState;
  /** Each drop's moves (a swap is several), in the order they were made. */
  drops: DraftMove[][];
};
let draft: Draft | null = null;

// One row over the timeline: the sort icons, and the draft's controls beside them while a draft is open.
const timelineTools = document.createElement('div');
timelineTools.id = 'timeline-tools';
const draftBar = document.createElement('div');
draftBar.id = 'timeline-draft-bar';
draftBar.hidden = true;
rotationsTimelineEl.before(timelineTools);

/** An icon button: the words ride in `data-tip`, shown on hover and for a moment after a tap (ui/mapTools.ts). */
function draftButton(className: string, glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `draft-button ${className}`;
  button.textContent = glyph;
  button.dataset.tip = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * One-click re-sorts (sim/scheduleSort.ts): same markets back to back on the
 * same plane, times untouched. The result lands in the draft, read on the
 * timeline and confirmed with the ✓.
 */
const SORTS: { mode: SortMode; glyph: GlyphName; tip: string }[] = [
  { mode: 'fifo', glyph: 'sortFifo', tip: 'FIFO · same markets together, filling planes first to last' },
  { mode: 'lifo', glyph: 'sortLifo', tip: 'LIFO · same markets together, filling planes last to first' },
  { mode: 'optimise', glyph: 'sortBest', tip: 'Optimise · same markets together, fewest rotations moved' },
];

// --- Connections at the hubs --------------------------------------------------

/**
 * ⇆ on: a rotation held in a drag, or hovered, lights the flights it would
 * connect with at a hub (sim/hubs.ts connectionsWith(): green a good wait,
 * amber a long one) and dims the rest, and the drag tip gives the hub's
 * connecting passengers a day before and after. Remembered in this browser.
 */
const CNX_KEY = 'slotsandspokes-gantt-cnx';
/** How much of the day before each wave its band covers: the good-connection window, a flight home landing 75 to 40 minutes ahead. */
const WAVE_BAND_MINUTES = 75;
let cnxOn = false;
try {
  cnxOn = localStorage.getItem(CNX_KEY) === '1';
} catch {
  // Storage blocked: off until switched on.
}
const cnxButton = document.createElement('button');
cnxButton.type = 'button';
cnxButton.className = 'draft-button is-cnx';
cnxButton.textContent = '⇆';
cnxButton.dataset.tip = 'CNX · drag or hover a rotation: flights it connects with at a hub light up (green 40–75m, amber up to 3h), the rest dim · tip: hub connecting pax/day before→after';
cnxButton.setAttribute('aria-label', 'Show connections');
const showCnxButton = () => {
  cnxButton.classList.toggle('is-on', cnxOn);
  cnxButton.setAttribute('aria-pressed', String(cnxOn));
};
showCnxButton();
cnxButton.addEventListener('click', () => {
  cnxOn = !cnxOn;
  showCnxButton();
  if (!cnxOn) clearConnections();
  try {
    localStorage.setItem(CNX_KEY, cnxOn ? '1' : '0');
  } catch {
    // Storage blocked: it lasts until the page closes.
  }
});

/** Light the flights in `found` and dim every other rotation but `held`. */
function showConnections(found: DropConnections, held: HTMLElement): void {
  clearConnections();
  rotationsTimelineEl.classList.add('is-cnx-live');
  held.classList.add('is-cnx-hit');
  for (const connection of found.connections) {
    const block = rotationsTimelineEl.querySelector<HTMLElement>(`.timeline-leg[data-leg="${CSS.escape(connection.legId)}"]`);
    if (!block) continue;
    block.classList.add(connection.quality >= 1 ? 'is-cnx-good' : 'is-cnx-poor');
    block.closest('.timeline-rotation')?.classList.add('is-cnx-hit');
  }
}

function clearConnections(): void {
  rotationsTimelineEl.classList.remove('is-cnx-live');
  for (const el of rotationsTimelineEl.querySelectorAll('.is-cnx-good, .is-cnx-poor, .is-cnx-hit')) el.classList.remove('is-cnx-good', 'is-cnx-poor', 'is-cnx-hit');
}

/** The hubs' connecting passengers a day, in the tip: "⇆ YYZ 140→155", or "⇆ YYZ 140" when it doesn't change. */
function hubsText(found: DropConnections): string {
  return found.hubs.map((h) => (h.before === h.after ? `⇆ ${h.hub} ${h.after}` : `⇆ ${h.hub} ${h.before}→${h.after}`)).join(' · ');
}

const sortGroup = document.createElement('div');
sortGroup.id = 'timeline-sorts';
for (const { mode, glyph, tip } of SORTS) {
  const button = draftButton('is-sort', '', tip, () => sortFleet(mode));
  button.innerHTML = glyphSvg(glyph);
  sortGroup.append(button);
}
timelineTools.append(sortGroup, cnxButton, draftBar);

function sortFleet(mode: SortMode): void {
  if (!liveState) return;
  // Planned on the draft's copy while one is open, so a sort builds on the moves already made.
  const plan = planFleetSort(draft?.world ?? liveState, mode);
  if (!plan.ok) {
    flashTip(`Not sorted · ${plan.reason}`, true);
    return;
  }
  if (plan.moves.length === 0) {
    flashTip(plan.note ? `Already sorted · ${plan.note}` : 'Already sorted', false);
    return;
  }
  addToDraft(plan.moves);
  flashTip(`⇄ ${plan.moves.length} rotation${plan.moves.length === 1 ? '' : 's'} moved · ✓ saves`, false);
  rebuildTimeline();
}

/** The bar over the timeline while a draft is open: ✎ and a count, then ✓ save, ↶ undo, ✕ discard. Icons only; the tips say which is which. */
function updateDraftBar(): void {
  draftBar.hidden = draft === null;
  if (!draft) {
    draftBar.replaceChildren();
    return;
  }
  const mark = document.createElement('span');
  mark.className = 'draft-mark';
  mark.textContent = `✎ ${draft.drops.length}`;
  mark.title = 'Planning · flights may overlap until you save';
  draftBar.replaceChildren(
    mark,
    draftButton('is-save', '✓', 'Verify and save', saveTheDraft),
    draftButton('is-undo', '↶', 'Undo the last move', undoDraftDrop),
    draftButton('is-discard', '✕', 'Discard all', discardDraft),
  );
}

function discardDraft(): void {
  draft = null;
  storeDraft();
  rebuildTimeline();
}

// The open draft is kept in this browser, so a reload doesn't lose it. It is
// replayed on the real state when the page comes back, and dropped if it no
// longer fits or belongs to another game.
const DRAFT_KEY = 'slotsandspokes-gantt-draft';

/** Which game a stored draft belongs to (rngSeed moves every day; these don't). */
function gameKey(state: SimState): string {
  return `${state.homeAirport}|${state.airspaceSeed ?? 0}`;
}

function storeDraft(): void {
  try {
    if (draft && liveState) localStorage.setItem(DRAFT_KEY, JSON.stringify({ game: gameKey(liveState), drops: draft.drops }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked: the draft just lives until the page closes.
  }
}

/** Bring a stored draft back, once, the first time the timeline draws. */
let draftRestored = false;
function restoreDraft(live: SimState): void {
  if (draftRestored) return;
  draftRestored = true;
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { game: string; drops: DraftMove[][] } | null;
    if (!stored || stored.game !== gameKey(live) || stored.drops.length === 0) return;
    const world = structuredClone(live);
    for (const moves of stored.drops) if (!dropRotationInDraft(world, moves).ok) throw new Error('draft no longer fits');
    draft = { world, drops: stored.drops };
  } catch {
    draft = null;
    storeDraft();
  }
}

/** Whether every flight in the draft is back where the real schedule has it and nothing new is held for tomorrow: nothing left to save. */
function draftChangesNothing(live: SimState, world: SimState): boolean {
  // A move on a plane in the air changes only what's held for tomorrow, not today's flights.
  if (JSON.stringify(world.pendingRetimes ?? []) !== JSON.stringify(live.pendingRetimes ?? [])) return false;
  const byId = new Map(live.schedule.map((leg) => [leg.legId, leg]));
  return world.schedule.every((leg) => {
    const was = byId.get(leg.legId);
    return was && was.tail === leg.tail && was.departMinute === leg.departMinute;
  });
}

/**
 * The draft's rotations. A plane whose flights join up in the draft is
 * grouped as the draft has it (a night stop made or brought home there
 * shows as one); a plane with overlaps keeps the real schedule's grouping,
 * drawn where the draft has put its flights.
 */
function draftRotations(live: SimState, world: SimState): Rotation[] {
  const conflicted = overlappingLegs(world);
  const clean = new Set(world.aircraft.map((a) => a.tail).filter((tail) => !world.schedule.some((leg) => leg.tail === tail && conflicted.has(leg.legId))));
  return [...[...clean].flatMap((tail) => rotationsForTail(world, tail)), ...realRotationsIn(live, world).filter((rotation) => !clean.has(rotation.tail))];
}

/** The real state's rotations, drawn where the draft has put their flights. */
function realRotationsIn(live: SimState, world: SimState): Rotation[] {
  const byId = new Map(world.schedule.map((leg) => [leg.legId, leg]));
  return allRotations(live).map((rotation) => {
    const moved = rotation.legs.map((leg) => byId.get(leg.legId) ?? leg);
    // A long-haul pair over midnight keeps its flight out first; its flight back is stored a day early.
    const overMidnight = wrappedLongHaul(world, moved[0].tail) !== null;
    const legs = overMidnight ? moved : moved.sort((a, b) => a.departMinute - b.departMinute);
    const last = legs[legs.length - 1];
    return { ...rotation, tail: legs[0].tail, legs, airports: [legs[0].origin, ...legs.map((leg) => leg.dest)], departMinute: legs[0].departMinute, arriveMinute: last.departMinute + (overMidnight ? 24 * 60 : 0) + last.blockMinutes };
  });
}

/** Start a draft, or carry on with the open one: make a drop's moves on its copy of the state. */
function addToDraft(moves: DraftMove[]): boolean {
  if (!liveState) return false;
  if (!draft) draft = { world: structuredClone(liveState), drops: [] };
  const result = dropRotationInDraft(draft.world, moves);
  if (!result.ok) {
    flashTip(result.reason, true);
    if (draft.drops.length === 0) draft = null;
    return false;
  }
  draft.drops.push(moves);
  closeIfUnchanged();
  storeDraft();
  return true;
}

/** A draft that has put everything back closes itself: there is nothing to verify. */
function closeIfUnchanged(): void {
  if (!draft || !liveState || !draftChangesNothing(liveState, draft.world)) return;
  draft = null;
  flashTip('Back as it was', false);
}

function undoDraftDrop(): void {
  if (!draft || !liveState) return;
  const drops = draft.drops.slice(0, -1);
  if (drops.length === 0) {
    discardDraft();
    return;
  }
  const world = structuredClone(liveState);
  for (const moves of drops) dropRotationInDraft(world, moves);
  draft = { world, drops };
  closeIfUnchanged();
  storeDraft();
  rebuildTimeline();
}

function saveTheDraft(): void {
  if (!draft || !liveState) return;
  const moves = draft.drops.flat();
  const problem = draftProblem(liveState, moves);
  if (problem) {
    // Stays open, its overlaps red: the player fixes them and verifies again.
    flashTip(`Not saved · ${problem}`, true);
    return;
  }
  const result = saveDraft(liveState, moves);
  flashTip(result.ok ? `Saved · ${moves.length} rotation${moves.length === 1 ? '' : 's'}` : result.reason, !result.ok);
  if (!result.ok) return;
  draft = null;
  storeDraft();
  renderScheduleWarnings(scheduleProblems(liveState));
  rebuildTimeline();
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
 * the top, room in each (sim/hours.ts). Let go to put it in the draft (✓ saves); Esc puts it
 * back. A click without a drag opens its route.
 */
function buildTimeline(state: SimState, rotations: Rotation[]): HTMLElement[] {
  const start = Math.min(USABLE_DAY_START_MINUTE, ...rotations.map((r) => r.departMinute));
  // A move held for tomorrow is drawn too, so the axis reaches its end (a long-haul flight back after midnight sits a day on).
  const heldEnds = (state.pendingRetimes ?? []).flatMap((move) =>
    move.legs.map((held) => (held.departMinute < move.legs[0].departMinute ? held.departMinute + 24 * 60 : held.departMinute) + (held.blockMinutes ?? 0)),
  );
  // A plane on a daily long-haul round trip can start it at any hour, so the axis is then a whole day: what runs past its end comes back in at the start.
  const wraps = rotations.some(isDailyLongHaul);
  const end = wraps
    ? Math.max(start + 24 * 60, ...rotations.filter((r) => !isDailyLongHaul(r)).map((r) => r.arriveMinute))
    : Math.max(USABLE_DAY_END_MINUTE, ...rotations.map((r) => r.arriveMinute), ...heldEnds);
  timelineWindow = { start, end };
  // In a draft: which flights have been moved in it, and which now sit on others.
  // Legs flying an accepted event, starred on their rotation.
  const eventLegs = new Set(mandatesOf(state).filter((m) => m.status === 'accepted').flatMap((m) => mandatedLeg(state, m)?.legId ?? []));
  const drafted = new Set(draft?.drops.flat().flatMap((move) => move.legIds));
  const conflicted = draft ? overlappingLegs(state) : null;
  // Flights leaving too close behind another of yours on the same route and way (an older save can still have them).
  const stacked = stackedDepartures(state.schedule);
  const clockMinute = (minute: number) => ((minute % 1440) + 1440) % 1440;
  const at = (minute: number) => `${((minute - start) / (end - start)) * 100}%`;
  const width = (minutes: number) => `${(minutes / (end - start)) * 100}%`;

  // Hour ticks every four hours, labelled.
  const axis = document.createElement('div');
  axis.className = 'timeline-axis';
  const tickHours: number[] = [];
  for (let hour = Math.ceil(start / 240) * 4; hour * 60 <= end; hour += 4) {
    tickHours.push(hour);
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
  key.append(
    '☾ ✓ · 2 · −40m · ✗ · ● · ☾A ',
    info(`Tonight's line check, beside each plane (one every 5 nights at a line base). ✓ checked tonight. 2 not due for 2 nights. −40m short by that long. ✗ due and missed. ● a deferred item (${MX_HOLD_AT} holds the plane a morning). A hatched cell with A: the night's spare hours go to that plane's A check.`),
  );
  if (Object.keys(state.hubStyles).length > 0) {
    key.append(' · ▮ wave ', info('Planes based at a banked hub show its waves: land home inside the teal band (75 to 40 minutes before) and leave on its right edge, so passengers connect.'));
  }
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
    // A folded group still shows a grounded plane inside it, kept live by updateNightCells().
    const downEl = document.createElement('span');
    downEl.className = 'timeline-group-down';
    downEl.dataset.type = cls.code;
    header.append(downEl, usedEl);
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

      // The plane opens its own view (ui/inspector/aircraft.ts); its tip is the plane at a glance.
      const plane = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: aircraft.tail });
      plane.type = 'button';
      plane.className = 'inspector-link timeline-plane';
      plane.dataset.tail = aircraft.tail;
      plane.append(aircraft.tail);
      const mark = powertrainMark(aircraft);
      if (mark) plane.append(mark);
      // AOG, refit, ferry or new delivery, kept live by updateNightCells().
      const statusEl = document.createElement('span');
      statusEl.className = 'timeline-status';
      statusEl.dataset.tail = aircraft.tail;
      plane.append(statusEl);
      const share = own.reduce((sum, rotation) => sum + rotation.share, 0);
      const shareEl = document.createElement('span');
      shareEl.className = 'timeline-share';
      shareEl.classList.toggle('is-over', share > 1);
      shareEl.textContent = `${Math.round(share * 100)}%`;
      plane.append(shareEl);
      // Tonight's line check and deferred items (sim/mxChecks.ts), kept live by updateNightCells().
      const nightEl = document.createElement('span');
      nightEl.className = 'timeline-night';
      nightEl.dataset.tail = aircraft.tail;
      plane.append(nightEl);
      plane.dataset.tip = aircraft.tail;
      // The tip is read when it shows (ui/mapTools.ts listens further up, so this runs first).
      const refreshTip = () => {
        if (liveState) plane.dataset.tip = planeTip(liveState, aircraft.tail);
      };
      plane.addEventListener('mouseover', refreshTip);
      plane.addEventListener('focusin', refreshTip);
      plane.addEventListener('click', () => {
        refreshTip();
        // On a touch screen the first tap shows the tip; a second one while it is up opens the plane.
        if (window.matchMedia('(pointer: coarse)').matches && tippedTail?.tail !== aircraft.tail) {
          window.clearTimeout(tippedTail?.timer);
          tippedTail = { tail: aircraft.tail, timer: window.setTimeout(() => (tippedTail = null), TOUCH_TIP_MS) };
          return;
        }
        tippedTail = null;
        select({ kind: 'aircraft', tail: aircraft.tail });
      });

      const track = document.createElement('div');
      track.className = 'timeline-track';
      track.dataset.tail = aircraft.tail;
      track.dataset.type = aircraft.typeCode;
      track.style.setProperty('--puck', colour);
      // A faint line at each hour tick on the axis, so a block's time reads down the rows.
      for (const hour of tickHours) {
        const line = document.createElement('span');
        line.className = 'timeline-gridline';
        line.style.left = at(hour * 60);
        track.append(line);
      }
      // At a banked base, each wave (sim/hubStyle.ts): a band where flights home should land, ending in a line where flights out leave.
      const banks = hubBanksAt(state, aircraft.baseAirport);
      if (banks) {
        for (let wave = banks.firstMinute; wave < end; wave += banks.periodMinutes) {
          if (wave < start) continue;
          const band = document.createElement('span');
          band.className = 'timeline-wave';
          band.style.left = at(Math.max(start, wave - WAVE_BAND_MINUTES));
          band.style.width = width(Math.min(WAVE_BAND_MINUTES, wave - start));
          track.append(band);
        }
      }
      // A night stop's two halves (sim/nightStops.ts): the morning flight home and the evening flight out.
      const nightStop = nightStopLegs(state, aircraft.tail);
      const halfButtons: HTMLButtonElement[] = [];
      for (const rotation of own) {
        const half = nightStop !== null && (rotation.legs[0] === nightStop.morning || rotation.legs[0] === nightStop.evening);
        const span = linkToMap(document.createElement('div'), { kind: 'route', a: rotation.airports[0], b: rotation.airports[1] });
        span.className = 'timeline-rotation';
        span.classList.toggle('is-open', !rotation.closed && !half);
        span.classList.toggle('is-night-stop', half);
        span.dataset.legs = rotation.legs.map((leg) => leg.legId).join(',');
        span.classList.toggle('is-draft', rotation.legs.some((leg) => drafted.has(leg.legId)));
        span.classList.toggle('is-conflict', rotation.legs.some((leg) => conflicted?.has(leg.legId)));
        span.style.left = at(rotation.departMinute);
        span.style.width = width(rotation.arriveMinute - rotation.departMinute);
        span.title =
          `${rotation.airports.join(' → ')} · ${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)}` +
          ` · ${Math.round(rotation.share * 100)}% of a plane` +
          (rotation.legs[0].dayParity !== undefined ? ` · ${rotation.legs[0].dayParity === 0 ? 'even' : 'odd'} days only · a second plane on the other days makes it daily` : '') +
          (half
            ? ` · night stop ${nightStop!.morning.origin} · ⌂ or push it past ${rotation.legs[0] === nightStop!.morning ? 'the start' : 'the end'} of the day to bring it home`
            : isDailyLongHaul(rotation)
              ? ' · drag to any start · late starts fly back after midnight'
              : rotation.closed
              ? ' · drag to move it · past either end of the day for a night stop · double-click or hold a flight to stretch its turn'
              : ' · never returns to base');
        span.addEventListener('pointerdown', (event) => startDrag(event, span, rotation, track, rotation.closed || half));
        // Double-click, or a long press on touch (startDrag()): the turn after the flight under the pointer.
        span.addEventListener('dblclick', (event) => {
          clearTimeout(routeClickTimer);
          const legId = legUnderPointer(span, rotation, event.clientX);
          if (legId) openGroundStepper(legId);
        });
        span.addEventListener('mouseenter', () => {
          if (cnxOn && !drag) showConnections(planConnections(state, rotation.legs), span);
        });
        span.addEventListener('mouseleave', () => {
          if (cnxOn && !drag) clearConnections();
        });
        span.addEventListener('click', (event) => {
          // A drag ends in a click too; only a plain click opens the route.
          if (justDragged) return;
          // With a mouse, a moment's wait: the click may be the first of a double-click, which opens the turn instead.
          clearTimeout(routeClickTimer);
          if (event.pointerType === 'mouse' && event.detail === 1) routeClickTimer = setTimeout(() => selectRoute(state, rotation.airports[0], rotation.airports[1]), DOUBLE_CLICK_MS);
          else if (event.detail <= 1) selectRoute(state, rotation.airports[0], rotation.airports[1]);
        });
        const within = (minute: number) => `${((minute - rotation.departMinute) / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
        // A long-haul pair over midnight stores its flight back a day early (sim/utilisation.ts wrappedLongHaul): drawn after the flight out.
        const departOf = (leg: ScheduleLeg) => (leg.departMinute < rotation.departMinute ? leg.departMinute + 24 * 60 : leg.departMinute);
        const stackedNotes: string[] = [];
        rotation.legs.forEach((leg, i) => {
          const block = document.createElement('div');
          block.className = 'timeline-leg';
          block.dataset.leg = leg.legId;
          block.style.left = within(departOf(leg));
          block.style.width = `${(leg.blockMinutes / (rotation.arriveMinute - rotation.departMinute)) * 100}%`;
          const stackedOn = stacked.get(leg.legId);
          if (stackedOn) {
            block.classList.add('is-stacked');
            stackedNotes.push(`${leg.origin}→${leg.dest} ${minuteOfDayToTimeString(clockMinute(leg.departMinute))} · ${stackedOn.tail} ${minuteOfDayToTimeString(clockMinute(stackedOn.departMinute))}`);
          }
          span.append(block);
          // Where the plane waits between this flight and the one before: the chain reads ALB ▬ LGA ▬ ALB.
          if (i > 0) {
            const before = rotation.legs[i - 1];
            span.append(groundLabel(before.dest, within((departOf(before) + before.blockMinutes + departOf(leg)) / 2)));
          }
        });
        if (stackedNotes.length > 0) span.title += ` · ⇉ ${stackedNotes.join(' · ')} · ${SAME_ROUTE_SPACING_MINUTES}m apart min · drag to space them`;
        if (rotation.legs.some((leg) => eventLegs.has(leg.legId))) {
          const star = document.createElement('span');
          star.className = 'timeline-event-star';
          star.textContent = '★';
          span.append(star);
          span.title += ' · ★ event flight';
        }
        // Its morning back, past the axis's end, drawn again a day earlier at the start (the track clips both).
        if (wraps && isDailyLongHaul(rotation)) {
          const twin = span.cloneNode(true) as HTMLElement;
          twin.classList.add('is-wrap-twin');
          twin.style.left = at(rotation.departMinute - 24 * 60);
          twin.addEventListener('pointerdown', (event) => startDrag(event, span, rotation, track, true));
          twin.addEventListener('click', () => {
            if (!justDragged) selectRoute(state, rotation.airports[0], rotation.airports[1]);
          });
          wrapTwins.set(span, twin);
          track.classList.add('has-wrap');
          track.append(twin);
        }
        // ⌂ goes in the draft like a drag; × removes for real, so it waits until the draft is saved or thrown away.
        if (half) span.append(nightHomeButtonFor(aircraft.tail, state));
        if (draft) {
          track.append(span);
          continue;
        }
        const removeButton = removeButtonFor(rotation, state, half ? own.find((other) => other !== rotation && (other.legs[0] === nightStop!.morning || other.legs[0] === nightStop!.evening)) : undefined);
        if (half) halfButtons.push(removeButton);
        // Past the axis's end, the × goes on the end that shows: the morning back at the start.
        const twin = wrapTwins.get(span);
        (twin && rotation.arriveMinute > end ? twin : span).append(removeButton);
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
      // Moves held for tomorrow (sim/retime.ts): one dashed box per flight where it will sit,
      // so a night stop's two ends don't draw one outline across the whole day.
      for (const move of state.pendingRetimes ?? []) {
        if (move.legs[0]?.tail !== aircraft.tail) continue;
        move.legs.forEach((held, i) => {
          const block = state.schedule.find((l) => l.legId === held.legId)?.blockMinutes ?? 0;
          const pending = document.createElement('div');
          pending.className = 'timeline-pending';
          // A long-haul pair over midnight holds its flight back a day early: drawn after the flight out.
          const heldStart = held.departMinute < move.legs[0].departMinute ? held.departMinute + 24 * 60 : held.departMinute;
          pending.style.left = at(heldStart);
          pending.style.width = width(block);
          if (wraps && heldStart + block > end) {
            const twin = document.createElement('div');
            twin.className = 'timeline-pending';
            twin.style.left = at(heldStart - 24 * 60);
            twin.style.width = width(block);
            track.append(twin);
          }
          pending.title = `Moves here tomorrow ${minuteOfDayToTimeString(held.departMinute)} · today's flying stays as it is`;
          // Its tip can't show (the box lets the pointer through to the flying below), so the box says it: booked, from tomorrow.
          if (i === 0) {
            const label = document.createElement('span');
            label.className = 'timeline-pending-label';
            label.textContent = `⏭ ${minuteOfDayToTimeString(held.departMinute)}`;
            pending.append(label);
          }
          if (i === 0 && !draft) {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'timeline-pending-cancel';
            cancel.textContent = '✕';
            cancel.title = `Saved · flies ${minuteOfDayToTimeString(held.departMinute)} from tomorrow, today's flying stays · ✕ cancels the move`;
            cancel.setAttribute('aria-label', `Cancel the move held for tomorrow on ${aircraft.tail}`);
            cancel.addEventListener('click', (event) => {
              event.stopPropagation();
              cancelPendingRetime(state, held.legId);
              rebuildTimeline();
            });
            pending.append(cancel);
          }
          track.append(pending);
        });
      }
      // The base in each wait between rotations, where another one could drop in.
      if (aircraft.baseAirport) {
        // A long-haul pair's morning back, wrapped to the start, is flying too.
        let free = Math.max(start, ...(wraps ? own.map((rotation) => rotation.arriveMinute - 24 * 60) : []));
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

/** A round trip one plane flies every day that outruns the usable day: it may start at any hour and run on past midnight (sim/retime.ts). */
function isDailyLongHaul(rotation: Rotation): boolean {
  return rotation.legs.length === 2 && rotation.legs[0].dayParity === undefined && rotation.arriveMinute - rotation.departMinute > USABLE_DAY_MINUTES;
}

/** Each daily long-haul rotation's copy a day earlier, which shows its morning back at the start of the axis. */
const wrapTwins = new WeakMap<HTMLElement, HTMLElement>();

/** The plane whose tip a tap put up, and the timer that forgets it: a second tap on it while the tip is up opens the plane. */
let tippedTail: { tail: string; timer: number } | null = null;

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
  drop: DropPlan | null;
  /** The held rotation's connections at its new time, when ⇆ is on. */
  connections: DropConnections | null;
  /** A touch held still this long opens the turn stepper instead (LONG_PRESS_MS). */
  pressTimer: ReturnType<typeof setTimeout> | undefined;
  /** A long-haul rotation's copy a day earlier, moved with it. */
  twin: HTMLElement | null;
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
/** A route's click waits this long for a second one: a double-click opens the turn stepper instead. */
const DOUBLE_CLICK_MS = 250;
let routeClickTimer: ReturnType<typeof setTimeout> | undefined;
/** How long a touch held still opens the turn stepper. */
const LONG_PRESS_MS = 500;

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
    drop: null,
    connections: null,
    pressTimer: undefined,
    twin: wrapTwins.get(span) ?? null,
  };
  // A finger held still on a flight: its turn, as a double-click is with a mouse.
  if (event.pointerType !== 'mouse') {
    const clientX = event.clientX;
    drag.pressTimer = setTimeout(() => {
      if (!drag || drag.moved) return;
      const legId = legUnderPointer(span, rotation, clientX);
      cancelDrag();
      // The click when the finger lifts isn't a click on the route.
      justDragged = true;
      window.addEventListener('pointerup', () => setTimeout(() => (justDragged = false), 0), { once: true });
      if (legId) openGroundStepper(legId);
    }, LONG_PRESS_MS);
  }
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
    clearTimeout(drag.pressTimer);
    closeGroundStepper();
    scheduleClock.hold();
    drag.span.classList.add('is-dragging');
    drag.twin?.classList.add('is-dragging');
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
  // The row the pointer is level with, of any type (a plane of another type
  // at the same base takes it re-timed; one elsewhere is refused, red);
  // else its own. Picked by height, not by what's under the pointer (the
  // held block itself is), and shown by sliding the block over that row
  // rather than moving it in the page: moving it would drop the pointer
  // capture and end the drag.
  const homeRect = drag.homeTrack.getBoundingClientRect();
  const rows = [...rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-track')];
  const track =
    rows.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3;
    }) ?? drag.homeTrack;
  drag.span.style.transform = `translateY(${track.getBoundingClientRect().top - homeRect.top}px)`;
  for (const candidate of rows) candidate.classList.toggle('is-drop-target', candidate === track && track !== drag.homeTrack);
  const tail = track.dataset.tail!;
  // In 5-minute steps, pulled to a neighbouring flight or the day's ends when close (sim/scheduleDraft.ts).
  const start = snappedStart(lastTimelineState, drag.rotation.legs.map((leg) => leg.legId), tail, Math.round((drag.rotation.departMinute + dx * drag.minutesPerPx) / 5) * 5);
  drag.span.style.left = `${((start - timelineWindow.start) / (timelineWindow.end - timelineWindow.start)) * 100}%`;
  if (drag.twin) {
    drag.twin.style.left = `${((start - 24 * 60 - timelineWindow.start) / (timelineWindow.end - timelineWindow.start)) * 100}%`;
    drag.twin.style.transform = drag.span.style.transform;
  }

  if (!drag.target || drag.target.tail !== tail || drag.target.start !== start) {
    drag.target = { tail, start };
    drag.drop = planDropRotation(lastTimelineState, drag.rotation.legs.map((leg) => leg.legId), tail, start);
    // A swap lights the rotations that would trade places with the held one.
    const swapping = new Set(drag.drop.kind === 'swap' ? drag.drop.moves.slice(1).flatMap((move) => move.legIds) : []);
    for (const other of rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-rotation')) {
      other.classList.toggle('is-swapping', other !== drag.span && (other.dataset.legs ?? '').split(',').some((id) => swapping.has(id)));
    }
    // Where it would sit; a refused drop has nothing to connect.
    drag.connections = cnxOn && drag.drop.ok ? planConnections(lastTimelineState, drag.drop.plan.legs) : null;
    if (drag.connections) showConnections(drag.connections, drag.span);
    else clearConnections();
  }
  const { plan, kind } = drag.drop!;
  drag.span.classList.toggle('is-bad', !drag.drop!.ok);
  drag.twin?.classList.toggle('is-bad', !drag.drop!.ok);
  drag.span.classList.toggle('is-hold', drag.drop!.ok && kind === 'hold');
  drag.span.dataset.time = minuteOfDayToTimeString(start);
  dragTip.textContent = !drag.drop!.ok
    ? `${minuteOfDayToTimeString(start)} · ${drag.drop!.reason}`
    : kind === 'swap'
      ? `⇄ ${swapName(drag.drop!)} · ${describeRetime(plan, tail, drag.rotation.tail, start)}`
      : kind === 'hold'
        ? `✎ ${minuteOfDayToTimeString(start)} · ${tail} · ${drag.drop!.reason}`
        : describeRetime(plan, tail, drag.rotation.tail, start);
  // The other side of a swap moves too, which these numbers don't count.
  if (drag.connections && drag.connections.hubs.length > 0 && kind !== 'swap') dragTip.textContent += ` · ${hubsText(drag.connections)}`;
  dragTip.classList.toggle('is-bad', !drag.drop!.ok);
  dragTip.hidden = false;
  const spanRect = drag.span.getBoundingClientRect();
  dragTip.style.left = `${Math.max(8, Math.min(window.innerWidth - dragTip.offsetWidth - 8, spanRect.left))}px`;
  // Under the block: its time is on top of it.
  dragTip.style.top = `${Math.min(window.innerHeight - dragTip.offsetHeight - 8, spanRect.bottom + 6)}px`;
}

/** The rotations a swap trades with, short: "C-P001 PHL→MHT→PHL", or "C-P001 ×2" when there are several. */
function swapName(drop: DropPlan): string {
  return drop.swapWith.length === 1 ? drop.swapWith[0] : `${drop.swapWith[0].split(' ')[0]} ×${drop.swapWith.length}`;
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
      : 'no line base: line check back at base every 5 nights';
    return [`Night stop ${plan.station}`, `out ${minuteOfDayToTimeString(b.departMinute)}`, `back ${minuteOfDayToTimeString(a.departMinute)}`, check, ...(plan.crewWarning ? [plan.crewWarning] : []), ...(plan.deferred ? ['from tomorrow'] : [])].join(' · ');
  }
  const parts = [minuteOfDayToTimeString(start)];
  // A long-haul round trip: when it's back at base, the next morning for a late start.
  const [out, back] = plan.legs;
  if (plan.legs.length === 2) {
    const backMinute = (back.departMinute < out.departMinute ? back.departMinute + 24 * 60 : back.departMinute) + back.blockMinutes;
    if (backMinute - out.departMinute > USABLE_DAY_MINUTES) parts.push(`↩ ${minuteOfDayToTimeString(backMinute)}`);
  }
  if (tail !== fromTail) parts.push(tail);
  if (plan.marginChangePerDay !== 0) parts.push(`${plan.marginChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.marginChangePerDay))}/day`);
  if (plan.slotFeeChangePerDay !== 0) parts.push(`slots ${plan.slotFeeChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.slotFeeChangePerDay))}/day`);
  if (plan.startsTomorrow) parts.push('from tomorrow');
  if (plan.crewWarning) parts.push(plan.crewWarning);
  return parts.join(' · ');
}

function onDragEnd(): void {
  if (!drag) return;
  const { moved, drop, target, rotation } = drag;
  finishDrag();
  if (!moved) return;
  // The click that follows a drag isn't a click on the route.
  justDragged = true;
  setTimeout(() => (justDragged = false), 0);
  if (drop?.ok && target && liveState && (target.start !== rotation.departMinute || target.tail !== rotation.tail)) {
    // Every change goes in the draft: nothing real changes until ✓.
    if (addToDraft(drop.moves)) flashTip(drop.kind === 'hold' ? `✎ ${drop.reason} · ✓ saves when nothing overlaps` : `✎ ${drop.kind === 'swap' ? `⇄ ${swapName(drop)}` : describeRetime(drop.plan, target.tail, rotation.tail, target.start)} · ✓ saves`, false);
  } else if (drop && !drop.ok) {
    // Snapped back: say why, where the tip was, so the player isn't left guessing.
    flashTip(`Not moved · ${drop.reason}`, true);
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
  clearTimeout(drag.pressTimer);
  clearConnections();
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
    // Immediate: main.ts's Esc, on this same window, would otherwise step the inspector back too.
    event.stopImmediatePropagation();
    cancelDrag();
  }
}, true);

/** The result of a move, shown where the tip was for a moment. */
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function flashTip(text: string, bad: boolean): void {
  dragTip.textContent = text;
  dragTip.classList.toggle('is-bad', bad);
  dragTip.hidden = false;
  // A newer flash restarts the clock, so an older one's timer can't hide it early.
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (!drag) dragTip.hidden = true;
  }, 2500);
}

// --- A flight's turn ----------------------------------------------------------

/**
 * The turn stepper: double-click a flight, or hold a finger on it, and − / +
 * shorten or stretch the wait at the airport it lands at by
 * GROUND_STEP_MINUTES, the plane's later flights that day moving with it
 * (sim/scheduleDraft.ts planGroundTime()). Each step is made like a drop:
 * on the real schedule, or in the draft while one is open. A step that
 * can't be made says why, red, and changes nothing.
 */
const groundStepper = document.createElement('div');
groundStepper.id = 'timeline-ground-stepper';
groundStepper.hidden = true;
document.body.append(groundStepper);
let groundLegId: string | null = null;

/** The flight under the pointer in a rotation's block: the last one to leave before that point, so a turn's gap belongs to the flight into it. */
function legUnderPointer(span: HTMLElement, rotation: Rotation, clientX: number): string | null {
  const rect = span.getBoundingClientRect();
  const minute = rotation.departMinute + ((clientX - rect.left) / Math.max(1, rect.width)) * (rotation.arriveMinute - rotation.departMinute);
  const departOf = (leg: ScheduleLeg) => (leg.departMinute < rotation.departMinute ? leg.departMinute + 24 * 60 : leg.departMinute);
  let found: string | null = rotation.legs[0]?.legId ?? null;
  for (const leg of rotation.legs) if (departOf(leg) <= minute) found = leg.legId;
  return found;
}

function closeGroundStepper(): void {
  groundStepper.hidden = true;
  groundLegId = null;
}

function openGroundStepper(legId: string): void {
  groundLegId = legId;
  drawGroundStepper(null, false);
}

/** The stepper beside the flight's block: the station and its wait between − and +, and a line for what the last step did. */
function drawGroundStepper(status: string | null, bad: boolean): void {
  const state = lastTimelineState;
  const block = groundLegId ? rotationsTimelineEl.querySelector<HTMLElement>(`.timeline-leg[data-leg="${CSS.escape(groundLegId)}"]`) : null;
  if (!state || !groundLegId || !block) {
    closeGroundStepper();
    return;
  }
  const legId = groundLegId;
  const now = planGroundTimeChange(state, legId, 0);
  const fixed = now.groundMinutes === 0 && !now.ok;
  const minus = draftButton('is-ground', '−', `${GROUND_STEP_MINUTES} min less at ${now.station} · later flights earlier`, () => stepGround(legId, -GROUND_STEP_MINUTES));
  const plus = draftButton('is-ground', '+', `${GROUND_STEP_MINUTES} min more at ${now.station} · later flights later`, () => stepGround(legId, GROUND_STEP_MINUTES));
  minus.disabled = fixed || now.groundMinutes - GROUND_STEP_MINUTES < now.minimumMinutes;
  plus.disabled = fixed;
  const value = document.createElement('span');
  value.className = 'ground-value';
  value.textContent = fixed ? now.station : `${now.station} ${now.groundMinutes}m`;
  value.dataset.tip = fixed ? (now.reason ?? '') : `Turn at ${now.station} · ${now.groundMinutes}m on the ground · min ${now.minimumMinutes}m`;
  const close = draftButton('is-ground-close', '✕', 'Close', closeGroundStepper);
  const line = document.createElement('div');
  line.className = 'ground-status';
  line.classList.toggle('is-bad', bad || fixed);
  line.textContent = status ?? (fixed ? (now.reason ?? '') : '');
  line.hidden = line.textContent === '';
  const controls = document.createElement('div');
  controls.className = 'ground-controls';
  controls.append(minus, value, plus, close);
  groundStepper.replaceChildren(controls, line);
  groundStepper.hidden = false;
  // Over the end of the flight, where the turn starts; kept on screen.
  const rect = block.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - groundStepper.offsetWidth - 8, rect.right - groundStepper.offsetWidth / 2));
  const above = rect.top - groundStepper.offsetHeight - 6;
  groundStepper.style.left = `${left}px`;
  groundStepper.style.top = `${above >= 8 ? above : rect.bottom + 6}px`;
}

function stepGround(legId: string, deltaMinutes: number): void {
  if (!lastTimelineState || !liveState) return;
  const plan = planGroundTimeChange(lastTimelineState, legId, deltaMinutes);
  if (!plan.ok) {
    drawGroundStepper(plan.reason, true);
    return;
  }
  const hubs = hubsText(planConnections(lastTimelineState, plan.plan.legs));
  const later = plan.moves[0].legIds.length;
  // Into the draft, like every Gantt change: ✓ saves it.
  const made = addToDraft(plan.moves);
  rebuildTimeline();
  if (!made) {
    drawGroundStepper('Not changed', true);
    return;
  }
  const parts = [`${deltaMinutes > 0 ? '+' : '−'}${Math.abs(deltaMinutes)}m`, `${later} later flight${later === 1 ? '' : 's'} moved`];
  if (plan.plan.marginChangePerDay !== 0) parts.push(`${plan.plan.marginChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.plan.marginChangePerDay))}/day`);
  if (plan.plan.slotFeeChangePerDay !== 0) parts.push(`slots ${plan.plan.slotFeeChangePerDay > 0 ? '+' : '−'}${shortMoney(Math.abs(plan.plan.slotFeeChangePerDay))}/day`);
  if (plan.plan.startsTomorrow || plan.plan.deferred) parts.push('from tomorrow');
  if (hubs) parts.push(hubs);
  drawGroundStepper(parts.join(' · '), false);
}

// A tap or click anywhere else closes it; so does Esc.
document.addEventListener('pointerdown', (event) => {
  if (!groundStepper.hidden && !groundStepper.contains(event.target as Node)) closeGroundStepper();
}, true);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !groundStepper.hidden) {
    event.stopImmediatePropagation();
    closeGroundStepper();
  }
}, true);

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
    // Into the draft, like every Gantt change: ✓ saves it.
    const pair = nightStopLegs(state, tail);
    if (plan?.ok && addToDraft([{ legIds: pair ? [pair.morning.legId, pair.evening.legId] : [], tail, start: 0, bringHome: true }])) {
      flashTip(`✎ ${describeRetime(plan, tail, tail, plan.legs[0].departMinute)} · ✓ saves`, false);
    } else if (!plan?.ok) flashTip(plan?.reason ?? 'Not on a night stop', true);
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
      const again = window.matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';
      button.title = partner ? `${again} again to remove the night stop, both flights` : `${again} again to remove this rotation`;
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
  for (const cell of rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-status')) {
    const status = planeStatus(state, cell.dataset.tail!);
    cell.textContent = status?.text ?? '';
    cell.className = `timeline-status${status ? ` is-${status.tone}` : ''}`;
  }
  for (const cell of rotationsTimelineEl.querySelectorAll<HTMLElement>('.timeline-group-down')) {
    const down = state.aircraft.filter((a) => a.typeCode === cell.dataset.type && aogFor(state, a.tail) && !aogFor(state, a.tail)?.refitTo).length;
    cell.textContent = down > 0 ? `AOG ${down}` : '';
  }
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
    const status = tonight.away ? '☾✗' : tonight.short ? `☾−${tonight.work - tonight.night}m` : tonight.inHouse ? '☾✓' : `☾${tonight.nightsLeft}`;
    // The label is narrow, so a check night shows its letters in place of the tick.
    cell.textContent = (tonight.banking && !tonight.short ? '☾A' : status) + pips;
    cell.className = `timeline-night${tonight.away || tonight.short ? ' is-short' : ''}${deferred >= MX_HOLD_AT - 1 ? ' is-hold' : ''}${tonight.banking ? ' is-check' : ''}`;
    cell.title =
      (tonight.away
        ? `Tonight at ${tonight.station}: line check due and no line base slot rated for it, so a deferred item.`
        : !tonight.inHouse
          ? `Tonight at ${tonight.station}: no line check, due in ${tonight.nightsLeft} night${tonight.nightsLeft === 1 ? '' : 's'}.`
          : `Tonight at ${tonight.station}, line check: ${Math.floor(tonight.night / 60)}h ${String(tonight.night % 60).padStart(2, '0')}m for ${Math.floor(tonight.work / 60)}h ${String(tonight.work % 60).padStart(2, '0')}m of work` +
          (tonight.short ? ', so the check is cut short: a deferred item.' : '.')) +
      (tonight.banking ? ' The spare hours go to its A check.' : '') +
      (deferred > 0 ? ` ${deferred} deferred item${deferred === 1 ? '' : 's'} (●): at ${MX_HOLD_AT}, held for a morning.` : '');
  }
}

function updateTimelineNow(state: SimState): void {
  updateNightCells(state);
  if (!timelineWindow) return;
  const today = minuteOfDay(state);
  // A whole-day axis from 06:00 has the small hours at its end.
  const minute = today < timelineWindow.start && today + 24 * 60 <= timelineWindow.end ? today + 24 * 60 : today;
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
  // Read as the schedule flies from tomorrow, so a plane mid line slip (sim/lineSlips.ts) isn't flagged as stranded.
  return [...validateSchedule(scheduleAfterSlips(state), state.aircraft), ...utilisationProblems(state)];
}
