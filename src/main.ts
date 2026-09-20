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
import { drawRouteMapMode, MAP_MODES, MAP_MODE_COLORS, type MapMode } from './render/mapmodes';
import { showCompetitionTooltip, hideCompetitionTooltip } from './ui/competitionTooltip';
import { createNewGameState, type SimState } from './sim/state';
import { step } from './sim/step';
import { updatePanel, renderScheduleWarnings, scheduleProblems, PANEL_WIDTH_PX } from './ui/panels';
import {
  setupRouteBuilder,
  handleRouteBuilderMouseDown,
  handleRouteBuilderMouseMove,
  handleRouteBuilderKeyDown,
  drawRoutePreview,
  hideRouteHoverTooltip,
} from './ui/routeBuilder';
import { handleAirportDetailMouseDown, handleAirportDetailKeyDown, hideAirportDetail } from './ui/airportDetail';
import { setupCommercialPanel, updateCommercialPanel } from './ui/commercial';
import { setupFleetMarket } from './ui/fleetMarket';
import { setupOnTimePanel, updateOnTimePanel } from './ui/onTime';
import { setupExecutivePanel, updateExecutivePanel } from './ui/executive';
import { setupExecutivesPanel, updateExecutivesPanel } from './ui/executives';
import { setupFuelPricePanel, updateFuelPricePanel } from './ui/fuelPrice';
import { setupTechTreePanel, updateTechTreePanel } from './ui/techTree';
import { setupDevPanel, updateDevPanel } from './ui/devTools';
import { setupMissionsPanel, updateMissionsPanel } from './ui/missions';
import { setupCrewPanel, updateCrewPanel } from './ui/crew';
import { setupAirportsPanel, updateAirportsPanel } from './ui/airports';
import { setupInfoTooltips } from './ui/infoTooltip';
import { updateTicker } from './ui/ticker';
import { updateAlerts } from './ui/alerts';
import { setupLoans, updateLoans } from './ui/loans';
import { isInsolvent } from './sim/loans';
import { setupGameControls, updateGameControls } from './ui/gameControls';
import { loadSavedState, saveState } from './ui/save';

// Week three's persistence fix (see WEEK-THREE.md): resume a saved game
// if one exists, rather than always starting fresh. A fresh game starts
// from createNewGameState() — zero fleet, zero schedule, seeded from
// Date.now() so every new playthrough gets its own weather/delay history
// (src/headless/run.ts calls the older createInitialState() instead, with
// its own fixed default seed, and is unaffected by any of this).
const state: SimState = loadSavedState() ?? createNewGameState();

// Validate this game's own schedule (not just the static template) — the
// route builder re-runs this same check after every rotation added or
// removed, so a schedule that over-commits an aircraft gets caught the
// same way a broken schedule.json would be caught here at startup.
renderScheduleWarnings(scheduleProblems(state));
// The callback fires once a rotation's legs are actually in
// state.schedule. It jumps to the Fleet tab, where the new rotation shows
// up in the rotations list with its utilisation share — the reading the
// pivot replaced the Gantt with. switchToSidebarTab is a plain `function`
// declaration further down this file, so it's hoisted and safely callable
// here even though this line runs before its own definition.
setupRouteBuilder(state, () => switchToSidebarTab('fleet'));
setupCommercialPanel(state);
setupFleetMarket(state);
setupOnTimePanel();
setupExecutivePanel();
setupExecutivesPanel();
setupFuelPricePanel();
setupTechTreePanel(state);
setupDevPanel();
setupMissionsPanel(state);
setupCrewPanel(state);
setupAirportsPanel();
setupInfoTooltips();
setupLoans(state);
setupGameControls(state);

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const clockEl = document.querySelector<HTMLDivElement>('#clock')!;
const speedButtons = document.querySelectorAll<HTMLButtonElement>('#speed-controls button');
// Demand/Competition (week four): independent on/off toggles layered on
// top of the map, not exclusive views — see the overlay-toggle wiring
// below. Week six: the ledgers that used to be exclusive "views" replacing
// the map (Rotation/Commercial/Fleet Market/On-Time/Executive) moved into
// sidebar tabs instead (see switchToSidebarTab() below) — the map is no
// longer something you ever navigate away from.
const overlayToggleButtons = document.querySelectorAll<HTMLButtonElement>('#view-toggle .view-dropdown button[data-overlay]');
// Both hover-dropdown groups share one wiring pass below — the Maps
// (Demand/Competition) group and the Competition map's airline filter,
// which reuses the exact same .view-group/.view-dropdown markup and
// open/close behavior, just with a text trigger instead of an icon.
const viewGroups = document.querySelectorAll<HTMLDivElement>('#hud .view-group');
const competitionAirlineGroup = document.querySelector<HTMLDivElement>('#competition-airline-group')!;
const competitionAirlineTrigger = document.querySelector<HTMLButtonElement>('#competition-airline-trigger')!;
const competitionAirlineDropdown = document.querySelector<HTMLDivElement>('#competition-airline-dropdown')!;
const mapModeDropdown = document.querySelector<HTMLDivElement>('#mapmode-dropdown')!;
const mapModeLegend = document.querySelector<HTMLDivElement>('#mapmode-legend')!;
const mapModeLegendTitle = document.querySelector<HTMLDivElement>('#mapmode-legend-title')!;
const mapModeLegendScale = document.querySelector<HTMLDivElement>('#mapmode-legend-scale')!;

// Built from MAP_MODES (render/mapmodes.ts) rather than hand-authored in
// index.html, so the button list can never drift out of sync with the
// enum main.ts is actually switching on.
for (const { mode, label } of MAP_MODES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.mapmode = mode;
  button.textContent = label;
  if (mode === 'none') button.classList.add('active');
  mapModeDropdown.appendChild(button);
}

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
// sidebarTab does, since it's persistent UI state, not simulated state.
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
// Week six: sidebar tabs. Each of these used to be a full-screen panel
// that replaced the map (`canvas.hidden = true`); now they're content
// panes inside the sidebar (#sidebar-tab-content) that replace each other,
// while the map stays visible and interactive underneath the whole time.
// Same element IDs as before — only their CSS treatment and DOM position
// changed — so nothing in ui/commercial.ts, ui/fleetMarket.ts,
// ui/onTime.ts, or ui/executive.ts needed to change.
const fleetTabEl = document.querySelector<HTMLDivElement>('#fleet-tab')!;
const commercialPanelEl = document.querySelector<HTMLDivElement>('#commercial-panel')!;
const fleetMarketPanelEl = document.querySelector<HTMLDivElement>('#fleet-market-panel')!;
const onTimePanelEl = document.querySelector<HTMLDivElement>('#ontime-panel')!;
const executivePanelEl = document.querySelector<HTMLDivElement>('#executive-panel')!;
const techTreePanelEl = document.querySelector<HTMLDivElement>('#tech-tree-panel')!;
const airportsPanelEl = document.querySelector<HTMLDivElement>('#airports-panel')!;
const crewPanelEl = document.querySelector<HTMLDivElement>('#crew-panel')!;
const missionsPanelEl = document.querySelector<HTMLDivElement>('#missions-panel')!;
const devPanelEl = document.querySelector<HTMLDivElement>('#dev-panel')!;
const gameTabEl = document.querySelector<HTMLDivElement>('#game-tab')!;
const sidebarTabButtons = document.querySelectorAll<HTMLButtonElement>('#sidebar-tabs button');

// The Dev tab is a debugging tool, not part of the game: hidden unless the
// page is opened with ?dev in the URL.
if (new URLSearchParams(window.location.search).has('dev')) {
  document.querySelector<HTMLButtonElement>('#sidebar-tabs [data-tab="dev"]')!.hidden = false;
}

// Both resize()'s canvas sizing and the CSS `--panel-width` custom
// property (style.css's #map/#panel both read it) come from this one
// variable, so they can never drift apart the way two separately-updated
// numbers could. Still clamped against MIN_MAP_WIDTH_PX below so the map
// never gets squeezed away to nothing on a narrow window, and recomputed
// on every resize() rather than only when first set.
//
// Week seven, phase C: the Rotation tab's expand-to-900px affordance is
// gone with the Gantt it existed for, so `desiredPanelWidthPx` no longer
// varies. Kept as a variable rather than folded back into a constant
// because the clamp still needs somewhere to read the unclamped value
// from.
const MIN_MAP_WIDTH_PX = 200;
const desiredPanelWidthPx = PANEL_WIDTH_PX;
let currentPanelWidthPx = PANEL_WIDTH_PX;

function applyPanelWidth(): void {
  currentPanelWidthPx = Math.min(desiredPanelWidthPx, window.innerWidth - MIN_MAP_WIDTH_PX);
  document.documentElement.style.setProperty('--panel-width', `${currentPanelWidthPx}px`);
}

/**
 * Size the canvas's actual pixel buffer, then fit the projection to it, then
 * draw. Called once at startup and again on every resize (including a
 * Rotation-tab expand/collapse, via setPanelWidth() above, since that
 * changes how much width the canvas actually has).
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
  applyPanelWidth(); // re-clamp in case the window itself was resized, not just the panel
  const cssWidth = window.innerWidth - currentPanelWidthPx;
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

// Week six: which sidebar tab is showing. The map itself is no longer part
// of this switch at all — it renders unconditionally now, every frame,
// regardless of which tab is open (see render(), below) — only the
// sidebar's own content pane changes. Demand and Competition stay
// independent on/off toggles layered on top of the map (unchanged from
// week four), since they were already built the right way for this: a
// layer you toggle, not a destination you navigate to.
type SidebarTab =
  | 'fleet'
  | 'commercial'
  | 'fleet-market'
  | 'ontime'
  | 'executive'
  | 'techtree'
  | 'airports'
  | 'crew'
  | 'missions'
  | 'dev'
  | 'game';
let sidebarTab: SidebarTab = 'fleet';
let demandOverlayOn = false;
let competitionOverlayOn = false;
// Week eight: which mapmode is recolouring the route network (render/
// mapmodes.ts) — mutually exclusive with itself (there's only one map
// underneath) but layered the same way Demand/Competition are: an
// independent thing turned on over the map, not a sidebar destination.
let mapMode: MapMode = 'none';

function render(nowMs: number = performance.now()): void {
  updateClock(state);
  updatePanel(state);
  updateTicker(state);
  // Always-visible regardless of which tab is open — see ui/alerts.ts's
  // own comment for why that's the point. switchToSidebarTab is a plain
  // `function` declaration further down this file, hoisted and safely
  // callable here the same way setupRouteBuilder()'s onRouteConfirmed
  // callback already relies on.
  updateAlerts(state, (tab) => switchToSidebarTab(tab as SidebarTab));

  // The loan pop-up and the game-over screen are global overlays, not
  // part of any one sidebar tab, so they need to keep refreshing
  // regardless of which one is showing. Pausing on insolvency (see tick()
  // below) is handled separately from this refresh, since render() can
  // run before speedMultiplier itself is declared (resize()'s very first
  // call, at startup).
  updateLoans(state);

  // The Dev tab is the one panel that refreshes every frame rather than
  // on tab-select — watching cost accumulate across a simulated day is
  // the whole point of it, so a snapshot taken when the tab opened would
  // be useless. Gated on it actually being visible so it costs nothing
  // the rest of the time.
  if (sidebarTab === 'dev') updateDevPanel(state);
  // Same every-frame treatment as the Dev tab, for the same reason: a
  // commitment's progress moves with every departure, and a mission can
  // complete on any tick.
  if (sidebarTab === 'missions') updateMissionsPanel(state);
  if (sidebarTab === 'crew') updateCrewPanel(state);
  if (sidebarTab === 'airports') updateAirportsPanel(state);

  const cssWidth = window.innerWidth - currentPanelWidthPx;
  const cssHeight = window.innerHeight;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBasemap(ctx);
  drawTerminator(ctx, latestFractionalMinute);

  // Demand draws first (a background of all 45 possible markets, sized
  // by estimated demand) so your own network — either plain gray or, if
  // the Competition overlay is also on, three-way colored — always draws
  // on top of it, not the other way around.
  if (demandOverlayOn) drawDemandLayer(ctx, state);

  // Mapmode, Competition and the plain grey network are three ways to draw
  // the same route lines, never combined — each already draws every route,
  // just coloured differently, so drawing more than one would double every
  // line. Mapmode wins when active: it's the more deliberate "I asked to
  // see this" choice, same precedence Competition already had over plain.
  if (mapMode !== 'none') {
    drawRouteMapMode(ctx, state, mapMode);
  } else if (competitionOverlayOn) {
    drawCompetitionLayer(ctx, selectedCompetitorAirline, state);
  } else {
    drawRoutes(ctx, state);
  }

  drawAircraft(ctx, state, latestFractionalMinute);
  drawAirports(ctx, state);
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

// --- Sidebar tabs (Fleet / Commercial / Fleet Market /
// --- On-Time / Executive) and overlay toggles (Demand / Competition) —
// --- week six
//
// Week four made Demand/Competition independent layers on top of the map
// instead of exclusive "modes." Week six extends that same idea to every
// other Report: they used to be exclusive views that hid the canvas
// entirely (`canvas.hidden = true`) and showed a different full-screen DOM
// panel instead; now they're tabs *inside the sidebar*, and the map just
// renders unconditionally, every frame, regardless of which tab is
// showing (see render(), above) — there's no "switching away" from it to
// undo anymore, so a route gesture in progress on the map is never
// force-cancelled by picking a different tab the way it used to be by
// picking a different panel.

/**
 * Switch which sidebar tab is showing — refreshes whichever one just
 * became visible, in case its data changed while it was hidden (the
 * commercial panel only refreshes its numeric cells, never rebuilding the
 * fare/marketing sliders themselves — see ui/commercial.ts). Called by the
 * sidebar's own tab buttons *and* by ui/routeBuilder.ts's
 * onRouteConfirmed callback, which jumps to Fleet so a newly added
 * rotation is visible in the rotations list straight away.
 */
function switchToSidebarTab(tab: SidebarTab): void {
  if (tab === sidebarTab) return;

  sidebarTab = tab;
  fleetTabEl.hidden = tab !== 'fleet';
  commercialPanelEl.hidden = tab !== 'commercial';
  fleetMarketPanelEl.hidden = tab !== 'fleet-market';
  onTimePanelEl.hidden = tab !== 'ontime';
  executivePanelEl.hidden = tab !== 'executive';
  techTreePanelEl.hidden = tab !== 'techtree';
  airportsPanelEl.hidden = tab !== 'airports';
  crewPanelEl.hidden = tab !== 'crew';
  missionsPanelEl.hidden = tab !== 'missions';
  devPanelEl.hidden = tab !== 'dev';
  gameTabEl.hidden = tab !== 'game';

  sidebarTabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));

  if (tab === 'commercial') updateCommercialPanel(state);
  if (tab === 'ontime') updateOnTimePanel(state);
  if (tab === 'executive') {
    updateExecutivesPanel(state);
    updateExecutivePanel(state);
    updateFuelPricePanel(state);
  }
  if (tab === 'techtree') updateTechTreePanel(state);
  if (tab === 'game') updateGameControls();

  render();
}

sidebarTabButtons.forEach((button) => {
  button.addEventListener('click', () => switchToSidebarTab(button.dataset.tab as SidebarTab));
});

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

  function closeThisDropdown(): void {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  // Week six: the map-layers group (Demand/Competition) is a deliberate
  // on/off picker now — Google Maps' own layers button works this way —
  // so it opens and closes strictly on click, never on hover. The
  // Competition airline filter keeps the original hover-opens-on-mouse
  // behavior below, since it's a plain single-select list you're just
  // browsing, not a set of toggles worth a deliberate open/close. Week
  // eight's mapmode picker is the same deliberate-choice shape as the
  // layers group, just single-select instead of independent toggles, so
  // it gets the same click-only treatment.
  const isLayersPicker = group.dataset.group === 'maps' || group.dataset.group === 'mapmode';

  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't immediately re-close via the document listener below
    // Click always *opens* for the hover-opened groups (never toggles
    // closed) — hover has already opened it by the time a click fires, so
    // a toggle would immediately close what hover just opened. The
    // layers picker has no hover-open to race against, so its click is a
    // real open/close toggle instead.
    if (isLayersPicker && !dropdown.hidden) {
      closeThisDropdown();
    } else {
      openThisDropdown();
    }
  });

  if (!isLayersPicker) {
    // Opening on hover (not just click) is why .view-dropdown sits flush
    // against its trigger with no gap in style.css — mouseenter/mouseleave
    // fire on `group` as a whole, which contains both the trigger and the
    // dropdown, so moving the pointer from one into the other never counts
    // as leaving the group; a real gap between them would.
    group.addEventListener('mouseenter', openThisDropdown);
    group.addEventListener('mouseleave', closeThisDropdown);
  }
});

// Clicking anywhere outside a group (its trigger or its open dropdown)
// closes whichever one is open — standard dropdown-menu behavior.
document.addEventListener('click', (event) => {
  const target = event.target as Node;
  const clickedInsideAGroup = [...viewGroups].some((group) => group.contains(target));
  if (!clickedInsideAGroup) closeAllDropdowns();
});

/**
 * Demand and Competition, as independent on/off toggles layered on the
 * map. Each toggle's `.active` class (reusing the same styling
 * `#view-toggle button.active` already has) is the only visual
 * "checkbox" state; there's no separate checkmark glyph. Unlike week
 * four, flipping one doesn't need to "switch to the Map panel" anymore —
 * the map is always showing regardless of which sidebar tab is open.
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

    competitionAirlineGroup.hidden = !competitionOverlayOn;
    render();
  });
});

/**
 * Fills the legend's title and colour key for whichever mapmode is
 * active, and hides the whole thing for `'none'` — a legend with nothing
 * to key would just be clutter. Text and swatch colours both come from
 * render/mapmodes.ts's own exports (MAP_MODE_COLORS), so this can never
 * describe a scale the map isn't actually drawing.
 */
function updateMapModeLegend(): void {
  mapModeLegend.hidden = mapMode === 'none';
  if (mapMode === 'none') return;

  const swatch = (color: string, label: string) =>
    `<div><span class="mapmode-legend-swatch" style="background:${color}"></span><span>${label}</span></div>`;

  if (mapMode === 'profitability') {
    mapModeLegendTitle.textContent = 'Profitability (margin ÷ revenue)';
    mapModeLegendScale.innerHTML =
      swatch(MAP_MODE_COLORS.loss, 'Losing money') +
      swatch(MAP_MODE_COLORS.breakeven, 'Breakeven') +
      swatch(MAP_MODE_COLORS.profit, '+20% margin or better');
  } else {
    mapModeLegendTitle.textContent = 'On-time performance';
    mapModeLegendScale.innerHTML =
      swatch(MAP_MODE_COLORS.loss, '0% on-time') +
      swatch(MAP_MODE_COLORS.breakeven, '80% (Reputation baseline)') +
      swatch(MAP_MODE_COLORS.profit, '100% on-time');
  }
}

/**
 * The mapmode picker: single-select, unlike Demand/Competition's
 * independent toggles, since there's only one map underneath to recolour.
 * Picking a mode deselects every other button in the same dropdown.
 */
mapModeDropdown.querySelectorAll<HTMLButtonElement>('button[data-mapmode]').forEach((button) => {
  button.addEventListener('click', () => {
    closeAllDropdowns();
    mapMode = button.dataset.mapmode as MapMode;
    mapModeDropdown.querySelectorAll<HTMLButtonElement>('button[data-mapmode]').forEach((b) => b.classList.toggle('active', b === button));
    updateMapModeLegend();
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
  // Any stale airport-detail popover (ui/airportDetail.ts) gets cleared
  // before deciding what this click actually does — otherwise arming a
  // route, or just starting a pan, would leave the previous click's
  // popover visibly hanging around underneath it. Unconditional and
  // first, so every path below starts from the same clean state.
  hideAirportDetail();

  // M10's route-creation gesture (ui/routeBuilder.ts) gets first refusal
  // on any click on the map. Only once it says "not mine" does an
  // ordinary click-and-drag start panning, exactly as before. The map is
  // always live now (week six), so there's no "different panel" case to
  // exempt this from anymore — every click on the canvas reaches here.
  if (handleRouteBuilderMouseDown(event, state)) {
    render();
    return;
  }

  // Week eight: second refusal — a click the route builder didn't want
  // (no plane selected) might still be "show me this airport" rather
  // than the start of a pan. See ui/airportDetail.ts's own comment for
  // why a selected tail always means the route builder owns the click.
  if (handleAirportDetailMouseDown(event, state)) {
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
window.addEventListener('keydown', handleAirportDetailKeyDown);

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
