import './style.css';
import { projection, fitProjection, baselineScale } from './render/projection';
import { drawBasemap } from './render/basemap';
import { drawTerminator } from './render/terminator';
import { drawRoutes } from './render/routes';
import { drawAirports } from './render/airports';
import { drawWeatherEffects } from './render/weather';
import { drawAircraft } from './render/aircraft';
import { drawDemandLayer } from './render/demand';
import { drawCompetitionLayer, competitorAirlines, findCompetitionHover, drawNewCompetitorRouteFlashes } from './render/competition';
import { showCompetitionTooltip, hideCompetitionTooltip } from './ui/competitionTooltip';
import { validateSchedule } from './sim/schedule';
import { createNewGameState, type SimState } from './sim/state';
import { step } from './sim/step';
import { updatePanel, setupScheduleEditor, renderScheduleWarnings, PANEL_WIDTH_PX } from './ui/panels';
import {
  setupRouteBuilder,
  handleRouteBuilderMouseDown,
  handleRouteBuilderMouseMove,
  handleRouteBuilderKeyDown,
  drawRoutePreview,
  cancelPendingRoute,
  hideRouteHoverTooltip,
} from './ui/routeBuilder';
import { setupRotationBoard, updateRotationBoard, hideBarTooltip } from './ui/rotationBoard';
import { setupCommercialPanel, updateCommercialPanel } from './ui/commercial';
import { setupFleetMarket } from './ui/fleetMarket';
import { setupOnTimePanel, updateOnTimePanel } from './ui/onTime';
import { setupExecutivePanel, updateExecutivePanel } from './ui/executive';
import { updateTicker } from './ui/ticker';
import { setupLoans, updateLoans } from './ui/loans';
import { isInsolvent } from './sim/loans';
import { loadSavedState, saveState, clearSavedState } from './ui/save';

// Week three's persistence fix (see WEEK-THREE.md): resume a saved game
// if one exists, rather than always starting fresh. A fresh game starts
// from createNewGameState() — zero fleet, zero schedule, seeded from
// Date.now() so every new playthrough gets its own weather/delay history
// (src/headless/run.ts calls the older createInitialState() instead, with
// its own fixed default seed, and is unaffected by any of this).
const state: SimState = loadSavedState() ?? createNewGameState();

// Validate this game's own schedule (not just the static template) — the
// M8 schedule editor re-runs this same check after every edit, so a change
// that breaks a rotation gets caught the same way a broken schedule.json
// would be caught here at startup.
renderScheduleWarnings(validateSchedule(state.schedule, state.aircraft, state.positioningLegs));
setupScheduleEditor(state);
// The callback fires once a route (and its optional return leg) is
// actually added to state.schedule — see ui/routeBuilder.ts's own comment
// on why. switchToPanel is defined further down this file as a plain
// `function` declaration, so it's hoisted and safely callable here even
// though this line runs before its own definition; by the time this
// arrow function actually executes (a future route confirm), the whole
// module has already finished evaluating.
setupRouteBuilder(state, (legIds) => switchToPanel('rotation', legIds));
setupRotationBoard();
setupCommercialPanel(state);
setupFleetMarket(state);
setupOnTimePanel();
setupExecutivePanel();
setupLoans(state);

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const clockEl = document.querySelector<HTMLDivElement>('#clock')!;
const speedButtons = document.querySelectorAll<HTMLButtonElement>('#speed-controls button');
// Panel-switching buttons (Map/Rotation/Commercial/Fleet, [data-view]) and
// overlay-toggle buttons (Demand/Competition, [data-overlay]) used to be
// the same kind of button — one exclusive View — but week four split them
// apart: switching panels is still exclusive, but Demand/Competition are
// now independent on/off toggles layered on top of the Map panel instead.
const viewToggleButtons = document.querySelectorAll<HTMLButtonElement>('#view-toggle .view-dropdown button[data-view]');
const overlayToggleButtons = document.querySelectorAll<HTMLButtonElement>('#view-toggle .view-dropdown button[data-overlay]');
// All three hover-dropdown groups share one wiring pass below — the two
// view-switching ones (Maps, Reports) plus the Competition map's airline
// filter, which reuses the exact same .view-group/.view-dropdown markup
// and open/close behavior, just with a text trigger instead of an icon.
const viewGroups = document.querySelectorAll<HTMLDivElement>('#hud .view-group');
const competitionAirlineGroup = document.querySelector<HTMLDivElement>('#competition-airline-group')!;
const competitionAirlineTrigger = document.querySelector<HTMLButtonElement>('#competition-airline-trigger')!;
const competitionAirlineDropdown = document.querySelector<HTMLDivElement>('#competition-airline-dropdown')!;

for (const airline of competitorAirlines(state)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.airline = airline;
  button.textContent = airline;
  competitionAirlineDropdown.appendChild(button);
}

// null means "All competitors" (the aggregate Competition overlay); a
// specific airline name filters render/competition.ts's layer down to
// just that carrier's own network. Lives outside render() the same way
// panelView does, since it's persistent UI state, not simulated state.
let selectedCompetitorAirline: string | null = null;

competitionAirlineDropdown.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
  button.addEventListener('click', () => {
    selectedCompetitorAirline = button.dataset.airline || null;
    competitionAirlineTrigger.textContent = button.textContent;
    competitionAirlineDropdown
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => b.classList.toggle('active', b === button));
    closeAllDropdowns(); // function declaration, hoisted — defined further down with the other view groups
    hideCompetitionTooltip(); // stale position/content for whatever was hovered under the old filter
    render();
  });
});
const rotationBoardEl = document.querySelector<HTMLDivElement>('#rotation-board')!;
const commercialPanelEl = document.querySelector<HTMLDivElement>('#commercial-panel')!;
const fleetMarketPanelEl = document.querySelector<HTMLDivElement>('#fleet-market-panel')!;
const onTimePanelEl = document.querySelector<HTMLDivElement>('#ontime-panel')!;
const executivePanelEl = document.querySelector<HTMLDivElement>('#executive-panel')!;

// Week three: the only way back to a fresh game, now that one persists
// across reloads by default. Confirms first since this is irreversibly
// destructive to whatever's currently saved — clearing the save and
// reloading is simpler and more robust than trying to reset every piece
// of in-memory state by hand, and a fresh load already knows to seed
// from Date.now() when it finds nothing saved.
//
// A real inline confirmation, not window.confirm(): native dialogs are
// silently blocked in some embedded/preview browser contexts (they just
// resolve to "cancelled" with no visible sign anything happened), which
// made "New Game" look like it was doing nothing at all. Real DOM here
// matches CLAUDE.md's panel rule anyway, and it can't be silently
// suppressed the way a native dialog can.
const newGameButton = document.querySelector<HTMLButtonElement>('#new-game-button')!;
const newGameConfirmEl = document.querySelector<HTMLDivElement>('#new-game-confirm')!;
const newGameConfirmYes = document.querySelector<HTMLButtonElement>('#new-game-confirm-yes')!;
const newGameConfirmCancel = document.querySelector<HTMLButtonElement>('#new-game-confirm-cancel')!;

newGameButton.addEventListener('click', () => {
  newGameButton.hidden = true;
  newGameConfirmEl.hidden = false;
});

newGameConfirmYes.addEventListener('click', () => {
  clearSavedState();
  window.location.reload();
});

newGameConfirmCancel.addEventListener('click', () => {
  newGameConfirmEl.hidden = true;
  newGameButton.hidden = false;
});

/**
 * Size the canvas's actual pixel buffer, then fit the projection to it, then
 * draw. Called once at startup and again on every resize.
 *
 * Why devicePixelRatio matters: a CSS pixel and a physical screen pixel are
 * not the same thing on most displays today. A "retina"/HiDPI screen might
 * draw 2 (or 3) physical pixels for every 1 CSS pixel, so that text and lines
 * look crisp. `canvas.width`/`canvas.height` are the *pixel buffer* size —
 * how many actual pixels the canvas has to draw into — while the CSS
 * `width`/`height` (set in style.css as 100vw/100vh) control the *displayed*
 * size on the page. If we only set the CSS size, the browser stretches a
 * lower-resolution buffer to fill it, which is what blurriness on HiDPI
 * screens actually is.
 *
 * The fix: make the pixel buffer `devicePixelRatio` times bigger than the
 * CSS size, then scale the drawing context up by that same factor with
 * `ctx.scale()`. That way every draw call is still written in ordinary CSS
 * pixel coordinates (so the rest of the code never has to think about DPR),
 * but it lands on a high-enough-resolution buffer to look sharp.
 */
function resize(): void {
  const cssWidth = window.innerWidth - PANEL_WIDTH_PX;
  const cssHeight = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;

  // Reset any previous scale before reapplying it — resize can fire many
  // times, and scale() otherwise compounds on top of itself.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  fitProjection(cssWidth, cssHeight);
  render();
}

// The exact (fractional) simulated minute currently on screen. Updated once
// per animation frame by tick() below; render() re-reads it every time it's
// called, including from pan/zoom/resize, which don't otherwise know what
// time it is.
let latestFractionalMinute = state.simMinute;

// Which panel is currently showing. The clock and sidebar panel stay
// relevant regardless, so they're not gated by this. Only one of these
// four is ever visible at a time — 'map' is the canvas; 'rotation',
// 'commercial', and 'fleet-market' each hide the canvas in favor of their
// own DOM element (#rotation-board, #commercial-panel,
// #fleet-market-panel) — see ui/rotationBoard.ts, ui/commercial.ts, and
// ui/fleetMarket.ts for why those get real DOM instead of a canvas layer.
//
// Week four: Demand and Competition used to be two more entries in this
// same exclusive list — separate full-screen "modes" you had to leave
// the map to check. They're independent toggles now (demandOverlayOn,
// competitionOverlayOn, below), layered on top of the 'map' panel instead
// of replacing it, so checking a market's demand or competitive situation
// no longer costs you the ability to draw a route while looking at it.
type PanelView = 'map' | 'rotation' | 'commercial' | 'fleet-market' | 'ontime' | 'executive';
let panelView: PanelView = 'map';
let demandOverlayOn = false;
let competitionOverlayOn = false;

function render(nowMs: number = performance.now()): void {
  updateClock(state);
  updatePanel(state);
  // Before the panelView early-return below — an event happening while
  // you're deep in the Commercial panel should still get announced, not
  // silently missed until you happen to switch back to the map.
  updateTicker(state);

  // Same reasoning as updateTicker() above: the loan pop-up and the
  // game-over screen are global overlays, not part of any one panel, so
  // they need to keep refreshing regardless of which panel is showing.
  // Pausing on insolvency (see tick() below) is handled separately from
  // this refresh, since render() can run before speedMultiplier itself is
  // declared (resize()'s very first call, at startup).
  updateLoans(state);

  if (panelView !== 'map') return;

  const cssWidth = window.innerWidth - PANEL_WIDTH_PX;
  const cssHeight = window.innerHeight;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBasemap(ctx);
  drawTerminator(ctx, latestFractionalMinute);

  // Demand draws first (a background of all 45 possible markets, sized
  // by estimated demand) so your own network — either plain gray or, if
  // the Competition overlay is also on, three-way colored — always draws
  // on top of it, not the other way around.
  if (demandOverlayOn) drawDemandLayer(ctx, state);

  // The Competition overlay *replaces* the plain route drawing rather
  // than adding to it: drawCompetitionLayer() already draws every one of
  // your own routes too (just recolored by whether a competitor also
  // flies it), so drawing both would double every own-route line.
  if (competitionOverlayOn) {
    drawCompetitionLayer(ctx, selectedCompetitorAirline, state);
  } else {
    drawRoutes(ctx, state);
  }

  drawAircraft(ctx, state, latestFractionalMinute);
  drawAirports(ctx);
  drawWeatherEffects(ctx, state);
  drawRoutePreview(ctx, state);

  // Always drawn, regardless of the Demand/Competition overlay toggles —
  // "a rival just opened a route" is news worth surfacing on the plain
  // map too, not something gated behind a specific layer being on.
  drawNewCompetitorRouteFlashes(ctx, state, nowMs);
}

const MINUTES_PER_DAY = 1440;

// simMinute 0 is fixed at January 1, 2027 — requested directly, replacing
// the old "Day N" counter with a real calendar. `Date` only ever appears
// here, in display code, never in sim/: this is exactly the same "local
// time exists only for display" rule CLAUDE.md already applies to each
// airport's UTC offset, just for calendar dates instead of clock time —
// step() itself still knows nothing but simMinute.
const SIMULATION_START_UTC_MS = Date.UTC(2027, 0, 1);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatCalendarDate(dayIndex: number): string {
  const date = new Date(SIMULATION_START_UTC_MS + dayIndex * MINUTES_PER_DAY * 60_000);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function updateClock(state: SimState): void {
  const dayIndex = Math.floor(state.simMinute / MINUTES_PER_DAY);
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  clockEl.textContent = `${formatCalendarDate(dayIndex)} · ${pad(hours)}:${pad(minutes)} UTC`;
}

window.addEventListener('resize', resize);
resize();

// --- Simulation loop ---
//
// The accumulator pattern from CLAUDE.md: real time (`deltaMs`, milliseconds
// since the last animation frame) piles up in `accumulator`, and every time
// it reaches MS_PER_SIM_MINUTE we spend 125ms of it on one call to step(),
// which advances the simulated world by exactly one minute. This decouples
// "how often the browser paints a frame" from "how fast simulated time
// passes" — at 20x speed, `accumulator` fills up 20 times faster, so step()
// gets called roughly 20 times as often per second of real time.
//
// `speedMultiplier` is how many simulated minutes should pass per real
// millisecond, scaled by MS_PER_SIM_MINUTE; 0 means paused. Because
// `accumulator` only ever grows by `deltaMs * speedMultiplier`, setting
// speedMultiplier to 0 makes it stop growing entirely — step() never runs
// again, and neither does latestFractionalMinute change, so a paused
// aircraft doesn't just stop advancing, it stays at the exact fractional
// position it was at the instant of pausing.
const MS_PER_SIM_MINUTE = 125;
let accumulator = 0;
let speedMultiplier = 1;
let lastFrameTimeMs: number | null = null;

// Week three's persistence fix: save once per simulated day crossed, not
// every minute — a day-old save is a perfectly fine worst case to resume
// from, and this is 1440x fewer localStorage writes than saving every
// tick would be. Initialized from whatever day the game actually starts
// on (loaded or fresh) so resuming a save doesn't immediately re-save
// before a new day has actually passed.
let lastSavedDay = Math.floor(state.simMinute / MINUTES_PER_DAY);

function tick(nowMs: number): void {
  if (lastFrameTimeMs === null) {
    // First frame: nothing to measure a delta against yet.
    lastFrameTimeMs = nowMs;
    requestAnimationFrame(tick);
    return;
  }

  const deltaMs = nowMs - lastFrameTimeMs;
  lastFrameTimeMs = nowMs;

  accumulator += deltaMs * speedMultiplier;
  while (accumulator >= MS_PER_SIM_MINUTE) {
    step(state);
    accumulator -= MS_PER_SIM_MINUTE;
  }

  const currentDay = Math.floor(state.simMinute / MINUTES_PER_DAY);
  if (currentDay !== lastSavedDay) {
    lastSavedDay = currentDay;
    saveState(state);
  }

  // Week five's failure state: the instant every loan slot is spoken for
  // and Cash is still gone, force a stop — there's nothing left to decide,
  // so nothing should keep flying in the background behind the game-over
  // screen ui/loans.ts is about to show.
  if (isInsolvent(state) && speedMultiplier !== 0) {
    speedMultiplier = 0;
    speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  }

  latestFractionalMinute = state.simMinute + accumulator / MS_PER_SIM_MINUTE;
  render(nowMs);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

// Remembers whatever speed was active before a pause, so unpausing (either
// the Pause button or the spacebar, below) resumes at that speed instead of
// always snapping back to 1x.
let speedBeforePause = 1;

speedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    speedMultiplier = Number(button.dataset.speed);
    if (speedMultiplier !== 0) speedBeforePause = speedMultiplier;
    speedButtons.forEach((b) => b.classList.toggle('active', b === button));
  });
});

function togglePause(): void {
  speedMultiplier = speedMultiplier === 0 ? speedBeforePause : 0;
  speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speedMultiplier));
}

// Spacebar pause/resume. Ignored while a real DOM input has focus (schedule
// filters, fare fields, the New Route form, etc.) so typing a space into
// one of those doesn't also pause the game out from under the player.
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
  event.preventDefault(); // stop the page itself from scrolling on Space
  togglePause();
});

// --- Panel switching (Map / Rotation / Commercial / Fleet) and overlay
// --- toggles (Demand / Competition) — week four
//
// Grouped into two dropdowns: "Maps" (the Map panel switch, plus the two
// overlay toggles — all three draw on the canvas/projection) and
// "Reports" (Rotation, Commercial, Fleet — all real DOM, not canvas).
// Each group's trigger button shows an SVG icon, not a text label, per
// design.
//
// #map, #rotation-board, #commercial-panel, and #fleet-market-panel are
// siblings sized identically in style.css; #map stays visible for the
// 'map' panel regardless of which overlays are on (render() just draws
// more or fewer layers on top of the same basemap — see above), and only
// one of the three DOM panels is ever un-hidden at a time. Switching away
// from 'map' cancels any in-progress route-creation gesture
// (ui/routeBuilder.ts) — an armed or pending route stops making sense
// once you're not looking at the layer it was drawn on. Switching *to*
// the rotation board or commercial panel refreshes it, in case the
// schedule changed while it was hidden — the rotation board has no
// interactive elements to lose, and the commercial panel only refreshes
// its numeric cells, never rebuilding the fare/marketing sliders
// themselves (see ui/commercial.ts).
const PANEL_GROUP: Record<PanelView, string> = {
  map: 'maps',
  rotation: 'reports',
  commercial: 'reports',
  'fleet-market': 'reports',
  ontime: 'reports',
  executive: 'reports',
};

/**
 * Switch which panel is showing — the one place that toggles canvas vs.
 * DOM-panel visibility, refreshes whichever panel just became visible,
 * and cancels anything that only made sense on the panel being left.
 * Shared by the Map/Rotation/Commercial/Fleet buttons *and* the
 * Demand/Competition overlay toggles below, since toggling an overlay
 * only means anything while looking at the map — flipping one implies
 * "and show me the map," not just "remember this for later."
 */
function switchToPanel(view: PanelView, highlightLegIds: string[] = []): void {
  if (view === panelView) return;

  panelView = view;
  canvas.hidden = view !== 'map';
  rotationBoardEl.hidden = view !== 'rotation';
  commercialPanelEl.hidden = view !== 'commercial';
  fleetMarketPanelEl.hidden = view !== 'fleet-market';
  onTimePanelEl.hidden = view !== 'ontime';
  executivePanelEl.hidden = view !== 'executive';
  competitionAirlineGroup.hidden = view !== 'map' || !competitionOverlayOn;

  viewToggleButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  // The group trigger itself also shows which group the active panel
  // belongs to, so it's visible at a glance without opening either
  // dropdown.
  viewGroups.forEach((group) => {
    const isActiveGroup = group.dataset.group === PANEL_GROUP[view];
    group.querySelector<HTMLButtonElement>('.view-group-trigger')!.classList.toggle('active', isActiveGroup);
  });

  if (view !== 'map') {
    cancelPendingRoute();
    hideCompetitionTooltip();
    hideRouteHoverTooltip();
  }
  if (view !== 'rotation') hideBarTooltip(); // leaving the board mid-hover shouldn't leave its tooltip stuck on screen
  if (view === 'rotation') updateRotationBoard(state, highlightLegIds);
  if (view === 'commercial') updateCommercialPanel(state);
  if (view === 'ontime') updateOnTimePanel(state);
  if (view === 'executive') updateExecutivePanel(state);

  render();
}

function closeAllDropdowns(): void {
  viewGroups.forEach((group) => {
    group.querySelector<HTMLDivElement>('.view-dropdown')!.hidden = true;
    group.querySelector<HTMLButtonElement>('.view-group-trigger')!.setAttribute('aria-expanded', 'false');
  });
}

viewGroups.forEach((group) => {
  const trigger = group.querySelector<HTMLButtonElement>('.view-group-trigger')!;
  const dropdown = group.querySelector<HTMLDivElement>('.view-dropdown')!;

  function openThisDropdown(): void {
    closeAllDropdowns();
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  // Click always opens (never toggles closed) rather than the more usual
  // open/close toggle — on a mouse, hover (below) has already opened it
  // by the time a click fires, so a toggle would immediately close what
  // hover just opened. Touch/keyboard users, who never get a hover event
  // first, still get a working open; closing for them still works via
  // the document-level click-outside listener below.
  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't immediately re-close via the document listener below
    openThisDropdown();
  });

  // Opening on hover (not just click) is why .view-dropdown sits flush
  // against its trigger with no gap in style.css — mouseenter/mouseleave
  // fire on `group` as a whole, which contains both the trigger and the
  // dropdown, so moving the pointer from one into the other never counts
  // as leaving the group; a real gap between them would.
  group.addEventListener('mouseenter', openThisDropdown);
  group.addEventListener('mouseleave', () => {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });
});

// Clicking anywhere outside a group (its trigger or its open dropdown)
// closes whichever one is open — standard dropdown-menu behavior.
document.addEventListener('click', (event) => {
  const target = event.target as Node;
  const clickedInsideAGroup = [...viewGroups].some((group) => group.contains(target));
  if (!clickedInsideAGroup) closeAllDropdowns();
});

viewToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    closeAllDropdowns();
    switchToPanel(button.dataset.view as PanelView);
  });
});

/**
 * Demand and Competition, as independent on/off toggles rather than
 * exclusive views (week four) — see switchToPanel()'s own comment for
 * why flipping one also switches to the Map panel. Each toggle's `.active`
 * class (reusing the same styling `#view-toggle button.active` already
 * has) is the only visual "checkbox" state; there's no separate checkmark
 * glyph.
 */
overlayToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    closeAllDropdowns();

    if (button.dataset.overlay === 'demand') {
      demandOverlayOn = !demandOverlayOn;
      button.classList.toggle('active', demandOverlayOn);
    } else if (button.dataset.overlay === 'competition') {
      competitionOverlayOn = !competitionOverlayOn;
      button.classList.toggle('active', competitionOverlayOn);
      hideCompetitionTooltip(); // stale content from whatever was hovered under the old on/off state
    }

    switchToPanel('map');
    // switchToPanel() only recomputes this when the panel actually
    // changes — if we were already on 'map', it's still stale from
    // *before* this toggle just flipped, so set it again unconditionally.
    competitionAirlineGroup.hidden = panelView !== 'map' || !competitionOverlayOn;
    render();
  });
});

// --- Pan (click and drag) ---
//
// `projection.translate()` is the [x, y] pixel position that the
// projection's reference point (roughly, the map's own "origin") lands on.
// Dragging the mouse by (dx, dy) pixels should slide the whole map by that
// same (dx, dy), so panning is just: remember where the translate was when
// the drag started, then add the mouse's total movement to it on every
// subsequent move.
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let translateAtDragStart: [number, number] = [0, 0];

canvas.addEventListener('mousedown', (event) => {
  // M10's route-creation gesture (ui/routeBuilder.ts) gets first refusal
  // on any click on the map. Only once it says "not mine" (or isn't asked
  // at all, because we're on a different panel) does an ordinary
  // click-and-drag start panning, exactly as before.
  if (panelView === 'map' && handleRouteBuilderMouseDown(event, state)) {
    render();
    return;
  }

  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  translateAtDragStart = projection.translate();
});

/**
 * One hover system for the whole map (week four — this used to be two:
 * the route builder's own PDEW tooltip, active only while armed, and a
 * separate Competition-mode-only operator tooltip that didn't exist
 * anywhere else). Priority order: if a route is currently armed,
 * handleRouteBuilderMouseMove() already shows its own PDEW/CAP/range
 * tooltip for the candidate destination — showing a second, competing
 * tooltip on top of that would just be clutter, so the general operator
 * tooltip is suppressed whenever the route builder reports it handled
 * the move. Otherwise, hovering an airport or a market arc shows who
 * flies it — your own operator always, competitors too if the
 * Competition overlay is on (`includeCompetitors`, both for what counts
 * as hoverable at all — see findCompetitionHover()'s own comment — and
 * for what the tooltip actually reveals).
 */
canvas.addEventListener('mousemove', (event) => {
  if (panelView !== 'map') return;

  if (handleRouteBuilderMouseMove(event, state)) {
    render();
    hideCompetitionTooltip();
    return;
  }

  const hover = findCompetitionHover(event.clientX, event.clientY, selectedCompetitorAirline, state, competitionOverlayOn);
  if (hover) {
    showCompetitionTooltip(hover, event.clientX, event.clientY, state, competitionOverlayOn);
  } else {
    hideCompetitionTooltip();
  }
});

canvas.addEventListener('mouseleave', () => {
  hideCompetitionTooltip();
  hideRouteHoverTooltip();
});

window.addEventListener('mousemove', (event) => {
  if (!isDragging) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  projection.translate([translateAtDragStart[0] + dx, translateAtDragStart[1] + dy]);
  render();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

window.addEventListener('keydown', handleRouteBuilderKeyDown);

// --- Zoom (scroll wheel) ---
//
// Changing `projection.scale()` alone would zoom toward the map's reference
// point, not toward the mouse — try it and the whole map slides sideways as
// you scroll, which feels wrong. To zoom toward the cursor instead: find the
// [longitude, latitude] currently under the mouse *before* changing the
// scale, apply the new scale, then see where that same geographic point
// lands *after* the change, and nudge `translate` by the difference. That
// nudge cancels out the drift, so the point under the cursor never moves.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 20;

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();

    const mouseX = event.clientX;
    const mouseY = event.clientY;
    const geoUnderMouse = projection.invert?.([mouseX, mouseY]);
    if (!geoUnderMouse) return;

    const zoomFactor = Math.pow(1.002, -event.deltaY);
    const currentScale = projection.scale();
    const targetScale = currentScale * zoomFactor;
    const clampedScale = Math.min(Math.max(targetScale, baselineScale * MIN_ZOOM), baselineScale * MAX_ZOOM);

    projection.scale(clampedScale);

    const [driftedX, driftedY] = projection(geoUnderMouse)!;
    const [tx, ty] = projection.translate();
    projection.translate([tx + (mouseX - driftedX), ty + (mouseY - driftedY)]);

    render();
  },
  { passive: false },
);
