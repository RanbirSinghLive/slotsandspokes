import './style.css';
import { dayIndex, homeUtcOffsetMinutes, minuteOfDay as homeMinuteOfDay } from './sim/clock';
import { projection, fitProjection, mapGesture, setMapElement, mapPoint, mapSize, mapSizeChanged, type ClientPoint } from './render/projection';
import { setupMapInput } from './ui/mapInput';
import { zoomAt as cameraZoomAt, panFrom, panBy, currentView, restoreView } from './render/camera';
import { drawBasemap } from './render/basemap';
import { drawRightsView } from './render/rightsView';
import { drawTerminator } from './render/terminator';
import { drawAirportChips } from './render/airportChips';
import { drawRoutes,drawSelectedRoute } from './render/routes';
import { drawPainGauges } from './render/pain';
import { drawCallPulse, callPulseActive } from './render/callPulse';
import { drawAirports, drawSelectedAirport, airports, setKnownAirports, nearestAirportCandidate, setAirportHold } from './render/airports';
import { drawHubView, hasHubView } from './render/hubs';
import { drawFog } from './render/fog';
import { drawWeatherEffects } from './render/weather';
import { drawAirspaceClosures } from './render/airspace';
import { updateMandates } from './ui/mandates';
import { drawMandateStars } from './render/mandates';
import { drawAircraft, findFlightAt, flightScreenPoint } from './render/aircraft';
import { OTP_BASELINE } from './sim/routeOtp';
import { updateMarket } from './ui/market';
import { drawDelayCascade } from './render/cascade';
import { projectRestOfDay } from './sim/cascade';
import { showFlightTooltip, hideFlightTooltip } from './ui/flightTooltip';
import { showAirportTooltip, hideAirportTooltip } from './ui/airportTooltip';
import { drawDemandLayer } from './render/demand';
import { drawCompetitionLayer, competitorAirlines, findCompetitionHover, drawNewCompetitorRouteFlashes } from './render/competition';
import { drawRouteMapMode, MAP_MODE_COLORS, type MapMode } from './render/mapmodes';
import { cargoLegend, drawCargoLayer } from './render/cargo';
import { showCompetitionTooltip, hideCompetitionTooltip } from './ui/competitionTooltip';
import { createNewGameState, type SimState } from './sim/state';
import { chooseHome, homeOptions } from './sim/homes';
import { showHomePicker } from './ui/homePicker';
import { gameDateWithYear } from './ui/format';
import { setOpsView } from './render/opsView';
import { drawOpsRouteLabels } from './render/opsHub';

import { drawDisruptions, findDisruptionPinAt } from './render/disruptions';
import { setAirportFilter, visibleAirports, type AirportFilter } from './ui/airportFilter';
import { step } from './sim/step';
import { updatePanel, renderScheduleWarnings, scheduleProblems, PANEL_WIDTH_PX, setScheduleClock } from './ui/panels';
import {
  setupRouteBuilder,
  handleRouteBuilderMouseDown,
  handleRouteBuilderMouseMove,
  handleRouteBuilderKeyDown,
  drawRoutePreview,
  hideRouteHoverTooltip,
  isRouteBuilderActive,
} from './ui/routeBuilder';
import { handleMapMenuMouseDown, handleMapMenuKeyDown, hideMapMenu, isMapMenuOpen } from './ui/mapMenu';
import { back, getSelection, NETWORK, onSelectionChange, select, type Selection } from './ui/selection';
import { refreshInspectorForNewDay, renderInspector } from './ui/inspector/inspector';
import { isHubPlannerOpen } from './ui/hubPlanner';
import { setupFarePolicy, updateFarePolicy } from './ui/farePolicy';
import { setupInfoTooltips } from './ui/infoTooltip';
import { setupMapToolTips } from './ui/mapTools';
import { updateTicker } from './ui/ticker';
import { updateStamps } from './ui/stamp';
import { updateOpsBoard } from './ui/opsBoard';
import { updateCalls } from './ui/callAlert';
import { openCallPopup } from './ui/callPopup';
import { updateHudPnl } from './ui/hudPnl';
import { updateAlerts } from './ui/alerts';
import { updatePoolBars } from './ui/poolBars';
import { setupGameOver, updateGameOver } from './ui/gameOver';
import { showYearReport } from './ui/yearReport';

/** The day the year one report shows (day 0 is the first). */
const YEAR_ONE_DAY = 365;
import { updateRunway } from './ui/runway';
import { isInsolvent } from './sim/insolvency';
import { setupGameControls } from './ui/gameControls';
import { setupBriefs, updateBriefs } from './ui/briefWindow';
import { startCloudSave } from './ui/cloudSave';
import { setupCloudSaveControls } from './ui/cloudSaveControls';
import { setupRail, updateRail } from './ui/rail';
import { closeJumpBox, isJumpBoxOpen, openJumpBox, setupJumpBox } from './ui/jumpBox';
import { clearMapHover, getMapHover, setupMapLinks } from './ui/mapLink';
import { holdSaving, loadSavedState, saveFileText, saveState, storedSaveText } from './ui/save';
import { setupCrashCatcher, showProblemCard } from './ui/problemCard';
import { feedbackUrl, openFeedback } from './ui/feedback';
import { setupShortcutsCard } from './ui/shortcuts';
import { setupTutorial, startTutorial, updateTutorial } from './ui/tutorial';

// Resume a saved game if one exists. A fresh game starts from
// createNewGameState(), seeded from Date.now() so every new playthrough
// gets its own weather and delay history. (The headless runner starts
// the same way but with a fixed seed — see src/headless/newGame.ts.)
const loaded = loadSavedState();
const savedState = loaded.kind === 'loaded' ? loaded.state : null;
const state: SimState = savedState ?? createNewGameState();
// A save this build can't read is kept, not overwritten: saving waits
// until the player has seen why, and can download it first.
if (loaded.kind === 'unreadable') {
  holdSaving(true);
  showProblemCard({
    title: 'Your save can\'t be loaded',
    message: `${loaded.reason} It's still stored. Download it to keep it; starting a new game will replace it.`,
    saveText: storedSaveText,
    actions: [{ label: 'Start a new game', run: () => holdSaving(false) }],
  });
}
// A game with no save to resume starts by choosing a home city (see the
// picker at the bottom of this file). Until then it is paused.
let choosingHome = savedState === null;

// Validate the loaded schedule once at startup; the route builder re-runs
// this same check after every rotation added or removed.
renderScheduleWarnings(scheduleProblems(state));
// The callback fires once a rotation's legs are actually in
// state.schedule. From the Overview it opens Fleet, where the new rotation
// shows on its plane's timeline; anywhere else the player is already
// looking at something, so it stays.
setupRouteBuilder(state, () => {
  if (getSelection().kind === 'network' && !panelHidden) select({ kind: 'fleet' });
});
setupFarePolicy(state);
setupInfoTooltips();
setupMapToolTips();
setupGameOver();
setupGameControls(state);
setupBriefs(state);
setupCloudSaveControls();
void startCloudSave(state);

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
setMapElement(canvas);
const ctx = canvas.getContext('2d')!;
const clockEl = document.querySelector<HTMLDivElement>('#clock')!;
const speedButtons = document.querySelectorAll<HTMLButtonElement>('#speed-controls button');
// The map's lens (index.html's #map-tools): one at a time, its legend
// and filter directly under the buttons. See setLens() below.
const lensButtons = document.querySelectorAll<HTMLButtonElement>('#lens-bar button[data-lens]');
const lensLegend = document.querySelector<HTMLDivElement>('#lens-legend')!;
const lensLegendTitle = document.querySelector<HTMLDivElement>('#lens-legend-title')!;
const lensLegendScale = document.querySelector<HTMLDivElement>('#lens-legend-scale')!;
const lensAirlines = document.querySelector<HTMLDivElement>('#lens-airlines')!;

// null means every rival (the whole Rivals lens); an airline name filters
// render/competition.ts's layer down to that carrier's own network. Lives
// outside render() the same way sidebarTab does, since it's persistent
// UI state, not simulated state.
let selectedCompetitorAirline: string | null = null;

function selectCompetitorAirline(airline: string | null): void {
  selectedCompetitorAirline = airline;
  lensAirlines.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', (b.dataset.airline || null) === airline));
  hideCompetitionTooltip(); // stale position/content for whatever was hovered under the old filter
  // The side panel follows the filter: one airline opens its view, every
  // rival the list of rivals (ui/inspector/rival.ts).
  const code = state.competitorRoutes.find((route) => route.airline === airline)?.code;
  select(code ? { kind: 'rival', code } : { kind: 'rivals' });
  render();
}

// New rivals enter as the game goes on (sim/pressure.ts), so the chips are
// rebuilt whenever the list of airlines changes rather than once at
// startup. If the airline being filtered on vanished, the filter falls
// back to every rival.
let competitorAirlineSignature = '';

function syncCompetitorAirlineChips(): void {
  const airlines = competitorAirlines(state);
  const signature = airlines.join('|');
  if (signature === competitorAirlineSignature) return;
  competitorAirlineSignature = signature;
  if (selectedCompetitorAirline && !airlines.includes(selectedCompetitorAirline)) selectedCompetitorAirline = null;

  const chip = (label: string, airline: string | null) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.airline = airline ?? '';
    button.textContent = label;
    button.classList.toggle('active', airline === selectedCompetitorAirline);
    button.addEventListener('click', () => selectCompetitorAirline(airline));
    return button;
  };
  lensAirlines.replaceChildren(chip('All', null), ...airlines.map((airline) => chip(airline, airline)));
}

// Both resize()'s canvas sizing and the CSS `--panel-width` custom
// property (style.css's #map/#panel/#rail all read it) come from this one
// variable, so they can never drift apart the way two separately-updated
// numbers could. It covers the rail plus the panel beside it. Still
// clamped against MIN_MAP_WIDTH_PX below so the map never gets squeezed
// away to nothing on a narrow window, and recomputed on every resize()
// rather than only when first set.
//
// Hiding the panel (the rail's Hide, ui/rail.ts) is what varies it:
// hidden leaves only the rail.
const MIN_MAP_WIDTH_PX = 200;
/** The rail's width, which stays when the panel is hidden; icons only, with the names in tips (style.css's --rail-width starts at the same number). */
const RAIL_WIDTH_PX = 44;
const railWidthPx = (): number => RAIL_WIDTH_PX;
/** At or below this window width the panel is a sheet over the map, not a column beside it (style.css's :root[data-narrow]). */
const NARROW_WINDOW_PX = 700;
const MAP_SHEET_MARGIN = 0.5;
const isNarrowWindow = (): boolean => window.innerWidth <= NARROW_WINDOW_PX;
// A phone starts with the map showing; the rail opens the panel.
let panelHidden = isNarrowWindow();
let currentPanelWidthPx = PANEL_WIDTH_PX + railWidthPx();

function applyPanelWidth(): void {
  const narrow = isNarrowWindow();
  document.documentElement.toggleAttribute('data-narrow', narrow);
  // A phone caches a map twice as big as the screen each way, so a drag has picture to slide over (render/projection.ts).
  mapGesture.margin = narrow ? MAP_SHEET_MARGIN : 0;
  // Narrow: the panel floats over the map, so the map only gives up the rail.
  const desiredPanelWidthPx = (panelHidden || narrow ? 0 : PANEL_WIDTH_PX) + railWidthPx();
  document.documentElement.style.setProperty('--rail-width', `${railWidthPx()}px`);
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
function resize(keepView = false): void {
  applyPanelWidth(); // re-clamp in case the window itself was resized, not just the panel
  const previous = keepView ? currentView() : null;
  const cssWidth = window.innerWidth - currentPanelWidthPx;
  const cssHeight = window.innerHeight;
  // A phone's 3x screen would draw nine pixels per CSS pixel; 2x looks the same on this map and costs less than half as much.
  const dpr = Math.min(window.devicePixelRatio || 1, isNarrowWindow() ? 2 : Infinity);

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  // On a phone 100vh is the page with the browser's toolbars hidden, taller than
  // the visible window, which stretched the picture and put taps below the finger.
  // Everything else reads the map's size back from this box (render/projection.ts's mapSize()).
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  mapSizeChanged();

  // Reset any previous scale before reapplying it — resize can fire many
  // times, and scale() otherwise compounds on top of itself.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const home = airports.find((airport) => airport.iata === state.homeAirport) ?? airports[0];
  fitProjection(cssWidth, cssHeight, home);
  if (previous) restoreView(previous, cssWidth, cssHeight);
  render();
}

// The exact (fractional) simulated minute currently on screen. Updated once
// per animation frame by tick() below; render() re-reads it every time it's
// called, including from pan/zoom/resize, which don't otherwise know what
// time it is.
let latestFractionalMinute = state.simMinute;

// What the renderer draws on top of the network, set together by the
// lens (setLens(), below).
let demandOverlayOn = false;
let competitionOverlayOn = false;
let cargoOverlayOn = false;
// Which mapmode is recolouring the route network (render/
// mapmodes.ts) — mutually exclusive with itself (there's only one map
// underneath) but layered the same way Demand/Competition are: an
// independent thing turned on over the map, not a sidebar destination.
let mapMode: MapMode = 'none';
// Where the pointer is over the map, or null when it's off it or dragging.
// Planes move under a still pointer, so which plane is hovered is worked
// out again every frame in render() rather than only on mousemove.
let hoverPoint: { x: number; y: number } | null = null;

// Set by render() when the cash runway pop-up opens (ui/runway.ts), and
// acted on by tick(), which owns the speed controls — the same split as the
// insolvency pause below, for the same reason: render() can run before
// speedMultiplier exists.
let runwayPauseRequested = false;
// The speed the clock runs at, copied in by tick() so render() can hand it to the briefs.
let briefSpeed = 1;

function render(nowMs: number = performance.now()): void {
  updateClock(state);
  updatePanel(state);
  if (getSelection().kind === 'routes') updateFarePolicy(state);
  updateRail(state, panelHidden);
  updateTicker(state);
  updateStamps(state, performance.now());
  updateOpsBoard(state, () => select({ kind: 'routes', sort: 'completion' }));
  updateHudPnl(state);
  updateTutorial(state, choosingHome);
  updateMarket(state);
  updatePoolBars(state);
  // Always visible, whatever screen is open: see ui/alerts.ts's own
  // comment for why that's the point. An alert with no view of its own
  // (a schedule problem) opens Fleet, where the rotations are.
  updateAlerts(state, () => select({ kind: 'fleet' }), choosingHome);
  if (updateMandates(state, choosingHome, () => select({ kind: 'fleet' }))) runwayPauseRequested = true;
  if (updateBriefs(state, choosingHome, briefSpeed)) runwayPauseRequested = true;
  const newCall = updateCalls(state, choosingHome);
  if (newCall) {
    openCallPopup(state, newCall.tail, newCall.kind);
    runwayPauseRequested = true;
  }

  // The game-over screen is a global overlay, not part of any one sidebar
  // tab, so it keeps refreshing whichever one is showing. Pausing on
  // insolvency (see tick() below) is handled separately, since render()
  // can run before speedMultiplier itself is declared (resize()'s very
  // first call, at startup).
  updateGameOver(state);
  if (updateRunway(state)) runwayPauseRequested = true;

  const { width: cssWidth, height: cssHeight } = mapSize();

  // The known airports, less any the map's airport filter hides (ui/airportFilter.ts).
  setKnownAirports(visibleAirports(state));
  syncCompetitorAirlineChips();
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBasemap(ctx);
  drawTerminator(ctx, latestFractionalMinute, state.startDayOfYear ?? 0);
  drawFog(ctx, state);
  drawRightsView(ctx, state);

  // Demand draws first (a background of all 45 possible markets, sized
  // by estimated demand) so your own network — either plain gray or, if
  // the Competition overlay is also on, three-way colored — always draws
  // on top of it, not the other way around.
  if (demandOverlayOn) {
    // Lines for one airport's markets: the one under the pointer, else the selected one.
    const hovered = hoverPoint && !isRouteBuilderActive() && !isMapMenuOpen() ? nearestAirportCandidate(hoverPoint.x, hoverPoint.y) : null;
    const selected = getSelection();
    drawDemandLayer(ctx, state, hovered?.airport.iata ?? (selected.kind === 'airport' ? selected.iata : null));
  }

  // Mapmode, Competition and the plain grey network are three ways to draw
  // the same route lines, never combined — each already draws every route,
  // just coloured differently, so drawing more than one would double every
  // line. Mapmode wins when active: it's the more deliberate "I asked to
  // see this" choice, same precedence Competition already had over plain.
  drawAirspaceClosures(ctx, state);
  if (mapMode !== 'none') {
    drawRouteMapMode(ctx, state, mapMode);
  } else if (competitionOverlayOn) {
    drawCompetitionLayer(ctx, selectedCompetitorAirline, state);
  } else {
    // Frequency and yield labels only on the Demand lens; on the plain map they clog the hubs.
    drawRoutes(ctx, state, demandOverlayOn);
  }
  // The Cargo lens draws over the routes and under the airport dots: a circle per
  // airport, your freight-carrying routes, and the hovered airport's best partners.
  if (cargoOverlayOn) {
    const hovered = hoverPoint && !isRouteBuilderActive() && !isMapMenuOpen() ? nearestAirportCandidate(hoverPoint.x, hoverPoint.y) : null;
    const selected = getSelection();
    drawCargoLayer(ctx, state, hovered?.airport.iata ?? (selected.kind === 'airport' ? selected.iata : null));
  }
  // A rival being squeezed out of one of your markets, or the respite
  // after one left (render/pain.ts): on whichever layer drew the routes.
  drawPainGauges(ctx, state);
  // The route the side panel is showing, on top of whichever layer drew routes.
  // The selection, and the panel row under the pointer (ui/mapLink.ts),
  // marked the same way.
  const selection = getSelection();
  const mapHover = getMapHover();
  markRoutesOf(selection);
  if (mapHover) markRoutesOf(mapHover);

  // Hovering a plane (not the route line) shows its own story: why it's
  // late (ui/flightTooltip.ts) and how that lateness spreads through the
  // rest of its day (render/cascade.ts). Not while a route is being drawn
  // or a click menu is open, which already own the pointer.
  const hoveredFlight =
    hoverPoint && !isRouteBuilderActive() && !isMapMenuOpen()
      ? findFlightAt(hoverPoint.x, hoverPoint.y, state, latestFractionalMinute)
      : null;
  if (hoveredFlight) {
    const restOfDay = projectRestOfDay(state, hoveredFlight.tail);
    drawDelayCascade(ctx, hoveredFlight, restOfDay, latestFractionalMinute);
    const point = flightScreenPoint(hoveredFlight, latestFractionalMinute);
    if (point) showFlightTooltip(hoveredFlight, restOfDay, state, point[0], point[1]);
  } else {
    hideFlightTooltip();
  }
  // A selected plane in the air keeps its cascade drawn without hovering,
  // so its day stays readable while the panel shows it.
  const selectedFlight = selection.kind === 'aircraft' ? state.activeFlights.find((f) => f.tail === selection.tail) : undefined;
  if (selectedFlight && selectedFlight !== hoveredFlight) {
    drawDelayCascade(ctx, selectedFlight, projectRestOfDay(state, selectedFlight.tail), latestFractionalMinute);
  }

  drawAircraft(ctx, state, latestFractionalMinute, hoveredFlight?.legId ?? selectedFlight?.legId ?? null);
  drawAirports(ctx, state);
  drawOpsRouteLabels(ctx, state, selection, mapHover, hoverPoint);
  drawMandateStars(ctx, state);

  drawAirportChips(ctx, state);

  drawDisruptions(ctx, state);
  // The airport the side panel is showing, on top of its dot.
  drawCallPulse(ctx, performance.now());
  if (selection.kind === 'airport') drawSelectedAirport(ctx, selection.iata);
  if (mapHover?.kind === 'airport') drawSelectedAirport(ctx, mapHover.iata);

  // Hovering one of your airports (and not a plane) shows who connects
  // through it (render/hubs.ts). Drawn after the airports so its labels
  // sit on top.
  // Its name and headline numbers go in a hover card (ui/airportTooltip.ts),
  // unless the Competition overlay's own card is covering airports.
  const hoveredAirport =
    hoverPoint && !hoveredFlight && !isRouteBuilderActive() && !isMapMenuOpen() ? nearestAirportCandidate(hoverPoint.x, hoverPoint.y) : null;
  if (hoveredAirport && !cargoOverlayOn && hasHubView(state, hoveredAirport.airport.iata)) drawHubView(ctx, state, hoveredAirport.airport.iata);
  if (hoveredAirport && hoverPoint && !competitionOverlayOn) {
    showAirportTooltip(state, hoveredAirport.airport.iata, hoverPoint.x, hoverPoint.y);
  } else {
    hideAirportTooltip();
  }
  drawWeatherEffects(ctx, state);
  drawRoutePreview(ctx, state);

  // Always drawn, regardless of the Demand/Competition overlay toggles —
  // "a rival just opened a route" is news worth surfacing on the plain
  // map too, not something gated behind a specific layer being on.
  drawNewCompetitorRouteFlashes(ctx, state, nowMs);
}

/**
 * Mark what a selection points at along its routes: a route's line, every
 * route a plane flies today, a rival's whole network (so its reach reads
 * at a glance). An airport's ring is drawn later, over the dots.
 */
function markRoutesOf(target: Selection): void {
  if (target.kind === 'route') drawSelectedRoute(ctx, target.a, target.b);
  if (target.kind === 'aircraft') {
    const drawn = new Set<string>();
    for (const leg of state.schedule) {
      const key = [leg.origin, leg.dest].sort().join('-');
      if (leg.tail !== target.tail || drawn.has(key)) continue;
      drawn.add(key);
      drawSelectedRoute(ctx, leg.origin, leg.dest);
    }
  }
  if (target.kind === 'rival') {
    for (const route of state.competitorRoutes) {
      if (route.code === target.code) drawSelectedRoute(ctx, route.origin, route.dest);
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** −240 → "UTC−4", 330 → "UTC+5:30". */
function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `UTC${sign}${hours}${minutes ? `:${pad(minutes)}` : ''}`;
}

function updateClock(state: SimState): void {
  // Home-local time, because that is the clock the airline's day runs on
  // (sim/clock.ts) — rotation windows, the 06:00–22:00 flying day and the
  // 22:00 curfew all read against it.
  const localMinute = homeMinuteOfDay(state);
  const hours = Math.floor(localMinute / 60);
  const minutes = localMinute % 60;
  clockEl.textContent = `${gameDateWithYear(state, dayIndex(state))} · ${pad(hours)}:${pad(minutes)} ${state.homeAirport} time`;
  clockEl.title = `Local time at your home airport, ${state.homeAirport} (${formatUtcOffset(homeUtcOffsetMinutes(state))}). Every schedule time in the game uses this clock.`;
}

// A resize keeps the player's pan and zoom; only Home (below) and a new home airport refit.
window.addEventListener('resize', () => resize(true));
window.visualViewport?.addEventListener('resize', () => resize(true));
resize();

// Hide the side panel entirely and let the map fill the screen — CLAUDE.md's
// "the map is all you need" goal taken literally. `panelHidden` (declared
// above, next to applyPanelWidth()) is the only state; everything else here
// just reflects it.
const panelEl = document.querySelector<HTMLElement>('#panel')!;
function setPanelHidden(hidden: boolean): void {
  panelHidden = hidden;
  panelEl.hidden = panelHidden;
  clearMapHover();
  // The map's available width just changed, same as a real window resize.
  resize(true);
}
panelEl.hidden = panelHidden;
document.querySelector('#panel-close')!.addEventListener('click', () => setPanelHidden(true));
setupRail({ isHidden: () => panelHidden, setHidden: setPanelHidden });
setupJumpBox(state);
setupShortcutsCard(() => choosingHome);
// Feedback, from the rail and the Game screen: the pre-filled form (ui/feedback.ts).
document.querySelector('#rail-feedback')!.addEventListener('click', () => openFeedback(state));
document.querySelector('#about-feedback-button')!.addEventListener('click', () => openFeedback(state));
// The rail's Alpha badge opens the Game screen: the version, the save as a file, the credits.
document.querySelector('#rail-alpha')!.addEventListener('click', () => {
  if (panelHidden) setPanelHidden(false);
  select({ kind: 'game' });
});
// The report so far (ui/yearReport.ts), any time, from the Game screen.
document.querySelector('#about-report-button')!.addEventListener('click', () => {
  showYearReport(state, `Day ${dayIndex(state)} · report so far`);
});
// The tutorial (ui/tutorial.ts): offered on a first visit, and from the Game screen.
document.querySelector('#about-tutorial-button')!.addEventListener('click', () => {
  select(NETWORK);
  startTutorial();
});
setupMapLinks(() => render());
document.querySelector('#rail-jump')!.addEventListener('click', () => openJumpBox(state));

// The inspector (ui/inspector/) follows the selection: a map click, a link
// or the breadcrumb changes it, and the panel rebuilds to show it. A hidden
// panel comes back, since otherwise the click would seem to do nothing.
// On a phone a tap on the map keeps the map showing, so the ring that tap opens stays in view; the rail opens the sheet.
let mapTapInProgress = false;
onSelectionChange(() => {
  if (panelHidden && getSelection().kind !== 'network' && !(mapTapInProgress && isNarrowWindow())) setPanelHidden(false);
  clearMapHover();
  renderInspector(state);
  render();
});

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
const MAX_FRAME_DELTA_MS = 250;
let accumulator = 0;
let speedMultiplier = 1;
let lastFrameTimeMs: number | null = null;

// Drawing is the expensive part of a frame, so a frame that could not look
// different from the last one is not drawn. Paused with nobody touching the
// game, the picture only needs a refresh a few times a second (clocks,
// flashes); on a phone, moving planes are drawn at 30 fps, which a map hides.
const PAUSED_REDRAW_MS = 250;
// A breathing ring needs more than four frames a second to look smooth.
const PULSE_REDRAW_MS = 66;
const PHONE_FRAME_MS = 1000 / 30 - 3;
const isPhoneScreen = window.matchMedia('(pointer: coarse)').matches;
let lastRenderMs = 0;
let inputSinceRender = true;
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'keydown', 'wheel', 'click', 'input', 'change']) {
  window.addEventListener(type, () => (inputSinceRender = true), { capture: true, passive: true });
}

function frameNeedsRender(nowMs: number): boolean {
  const sinceRenderMs = nowMs - lastRenderMs;
  if (speedMultiplier === 0) return inputSinceRender || sinceRenderMs >= (callPulseActive() ? PULSE_REDRAW_MS : PAUSED_REDRAW_MS);
  return !isPhoneScreen || sinceRenderMs >= PHONE_FRAME_MS;
}

// Save once per simulated day crossed, not every minute: a day-old save is a perfectly fine worst case to resume
// from, and this is 1440x fewer localStorage writes than saving every
// tick would be. Initialized from whatever day the game actually starts
// on (loaded or fresh) so resuming a save doesn't immediately re-save
// before a new day has actually passed.
let lastSavedDay = dayIndex(state);

function tick(nowMs: number): void {
  if (lastFrameTimeMs === null) {
    // First frame: nothing to measure a delta against yet.
    lastFrameTimeMs = nowMs;
    requestAnimationFrame(tick);
    return;
  }

  // At most this much real time is fed to the simulator per frame. A
  // backgrounded tab pauses animation frames, and on return the gap could be
  // minutes: at 100x that is hundreds of thousands of steps in one frame,
  // a long freeze. Capped, the game simply resumes where it left off.
  const deltaMs = Math.min(nowMs - lastFrameTimeMs, MAX_FRAME_DELTA_MS);
  lastFrameTimeMs = nowMs;

  accumulator += deltaMs * speedMultiplier;
  while (accumulator >= MS_PER_SIM_MINUTE) {
    step(state);
    accumulator -= MS_PER_SIM_MINUTE;
  }

  const currentDay = dayIndex(state);
  if (currentDay !== lastSavedDay) {
    // A year flown: stop the clock and show the year one report
    // (ui/yearReport.ts), then carry on at the speed it had.
    if (lastSavedDay < YEAR_ONE_DAY && currentDay >= YEAR_ONE_DAY && !isInsolvent(state)) {
      const speedBefore = speedMultiplier;
      speedMultiplier = 0;
      speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
      showYearReport(state, 'Year one', () => {
        speedMultiplier = speedBefore;
        speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speedBefore));
      });
    }
    lastSavedDay = currentDay;
    saveState(state);
    // The day's numbers have moved (demand, the last-7-days bars, rival
    // fares), so whatever the inspector shows is rebuilt once per day.
    if (getSelection().kind !== 'network') refreshInspectorForNewDay(state);
  }

  // The failure state: the instant Cash is gone, force a stop — there's
  // nothing left to decide, so nothing should keep flying behind the
  // game-over screen ui/gameOver.ts is about to show.
  if (isInsolvent(state) && speedMultiplier !== 0) {
    speedMultiplier = 0;
    speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  }

  // The runway pop-up pauses once so the warning can't scroll past at
  // 100x. speedBeforePause is left alone, so Space resumes at the old speed.
  briefSpeed = speedMultiplier;
  if (runwayPauseRequested) {
    runwayPauseRequested = false;
    speedMultiplier = 0;
    speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  }

  latestFractionalMinute = state.simMinute + accumulator / MS_PER_SIM_MINUTE;
  if (frameNeedsRender(nowMs)) {
    lastRenderMs = nowMs;
    inputSinceRender = false;
    render(nowMs);
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

// The first-visit tutorial prompt, with the clock to pause for reading
// and run again at the end.
setupTutorial((speed) => {
  speedMultiplier = speed;
  if (speed !== 0) speedBeforePause = speed;
  speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === speed));
});

// Anything uncaught pauses the game and says so, with the save to keep
// (ui/problemCard.ts). The frame loop stops at an error in it, so the
// card's way on is a reload from the last save.
setupCrashCatcher(
  () => {
    speedMultiplier = 0;
    speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  },
  () => saveFileText(state),
  () => feedbackUrl(state),
);

// The Schedule holds the clock while a rotation is dragged (ui/panels.ts),
// so what its tip reads doesn't move under the player, then runs again at
// the speed it had.
let speedBeforeDrag: number | null = null;
setScheduleClock({
  hold: () => {
    if (speedBeforeDrag !== null) return;
    speedBeforeDrag = speedMultiplier;
    speedMultiplier = 0;
  },
  release: () => {
    if (speedBeforeDrag === null) return;
    speedMultiplier = speedBeforeDrag;
    speedBeforeDrag = null;
  },
});

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
  if (event.code !== 'Space' || choosingHome) return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
  event.preventDefault(); // stop the page itself from scrolling on Space
  togglePause();
});

/**
 * The map's lens: what the map is showing on top of your network. One at
 * a time, so there's one rule for every button and the one that's on is
 * always lit. Network is the plain map; Profit recolours your routes by
 * margin and Ops by on-time, with the operating detail of render/opsView.ts
 * drawn on top (render/mapmodes.ts); Demand draws every market's demand and
 * headroom (render/demand.ts); Rivals draws the rival networks, with a
 * chip per airline to narrow it to one (render/competition.ts); Cargo
 * draws what each airport makes and needs and the freight lanes that
 * match (render/cargo.ts).
 */
type Lens = 'network' | 'profit' | 'ops' | 'demand' | 'rivals' | 'cargo';
const LENS_ORDER: Lens[] = ['network', 'profit', 'ops', 'demand', 'rivals', 'cargo'];
let lens: Lens = 'network';

function setLens(next: Lens): void {
  lens = next;
  demandOverlayOn = lens === 'demand';
  competitionOverlayOn = lens === 'rivals';
  cargoOverlayOn = lens === 'cargo';
  mapMode = lens === 'profit' ? 'profitability' : lens === 'ops' ? 'ontime' : 'none';
  setOpsView(lens === 'ops');
  lensButtons.forEach((button) => {
    const on = button.dataset.lens === lens;
    button.classList.toggle('active', on);
    button.setAttribute('aria-checked', String(on));
  });
  lensAirlines.hidden = lens !== 'rivals';
  hideCompetitionTooltip(); // stale content from whatever was hovered under the old lens
  updateLensLegend();
  render();
}

lensButtons.forEach((button) => button.addEventListener('click', () => setLens(button.dataset.lens as Lens)));

// Keys 1–6 pick a lens, unless the player is typing into something.
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < LENS_ORDER.length) setLens(LENS_ORDER[index]);
});

/**
 * The legend under the lens: its title and colour key. Swatch colours
 * come from the renderers' own exports (MAP_MODE_COLORS), so this can
 * never describe a scale the map isn't drawing. The plain Network lens
 * needs no key.
 */
function updateLensLegend(): void {
  lensLegend.hidden = lens === 'network';
  lensLegendScale.classList.toggle('is-wrapped', lens === 'cargo');
  const swatch = (color: string, label: string) =>
    `<div><span class="mapmode-legend-swatch" style="background:${color}"></span><span>${label}</span></div>`;
  if (lens === 'profit') {
    lensLegendTitle.textContent = 'Margin ÷ revenue';
    lensLegendScale.innerHTML =
      swatch(MAP_MODE_COLORS.loss, 'loss') + swatch(MAP_MODE_COLORS.breakeven, 'breakeven') + swatch(MAP_MODE_COLORS.profit, '+20%');
  } else if (lens === 'ops') {
    lensLegendTitle.textContent = 'On-time, last 7 days';
    lensLegendScale.innerHTML =
      swatch(MAP_MODE_COLORS.loss, '0%') +
      swatch(MAP_MODE_COLORS.breakeven, `${Math.round(OTP_BASELINE * 100)}% baseline`) +
      swatch(MAP_MODE_COLORS.profit, '100%') +
      '<div><span>width = seats a day</span></div>';
  } else if (lens === 'demand') {
    lensLegendTitle.textContent = `People waiting to fly · ${isPhoneScreen ? 'tap' : 'hover'} an airport for its biggest markets`;
    lensLegendScale.innerHTML =
      swatch('rgba(94, 214, 196, 0.6)', 'underserved') + swatch('rgba(154, 163, 184, 0.5)', 'well served') + swatch('#ffb347', 'you turn away') + swatch('#e8c170', 'contract offer');
  } else if (lens === 'rivals') {
    lensLegendTitle.textContent = 'Rival networks · pick one to narrow';
    lensLegendScale.innerHTML = '';
  } else if (lens === 'cargo') {
    lensLegendTitle.textContent = `Cargo · ${isPhoneScreen ? 'tap' : 'hover'} an airport`;
    lensLegendScale.innerHTML =
      '<div class="legend-note"><span class="cargo-key-ring is-makes">▲</span><span class="cargo-key-lane"></span><span class="cargo-key-ring is-needs">▼</span>' +
      '<span class="cargo-key-lane is-dashed" title="not flown yet"></span></div>' +
      cargoLegend()
        .map((entry) => `<div class="legend-good" title="${entry.label}"><span>${entry.glyph}</span></div>`)
        .join('');
  }
}

// Which airports the map shows (ui/airportFilter.ts): a visible three-way
// switch in the bottom-left corner.
const airportFilterButtons = document.querySelectorAll<HTMLButtonElement>('#airport-filter button[data-airports]');
airportFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setAirportFilter(button.dataset.airports as AirportFilter);
    airportFilterButtons.forEach((other) => other.classList.toggle('active', other === button));
    render();
  });
});

// O picks the Ops lens, or goes back to Network when Ops is already showing.
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== 'o') return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  setLens(lens === 'ops' ? 'network' : 'ops');
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

// Whether the radial ring was open when this click started: a click on
// empty map closes the ring first, and only a click with no ring open
// clears the selection too.
let ringOpenAtMouseDown = false;
/** A press that moves less than this far before release is a click, not a pan. */
const CLICK_SLOP_PX = 4;

/**
 * A press on the map, from a mouse button or a tap: closes any open ring, then
 * gives the route builder, a plane, a grounded-plane pin and the airport ring
 * first refusal, and only otherwise starts a pan.
 */
function pressMap(event: ClientPoint): void {
  mapTapInProgress = true;
  queueMicrotask(() => (mapTapInProgress = false));
  ringOpenAtMouseDown = isMapMenuOpen();
  // Any open ring (ui/mapMenu.ts) gets closed before deciding what this
  // click actually does, otherwise arming a route, or just starting a
  // pan, would leave the previous click's ring hanging around underneath
  // it. Unconditional and first, so every path below starts from the same
  // clean state.
  hideMapMenu();

  // The route-creation gesture (ui/routeBuilder.ts) gets first refusal
  // on any click on the map. Only once it says "not mine" does an
  // ordinary click-and-drag start panning.
  if (handleRouteBuilderMouseDown(event, state)) {
    render();
    return;
  }

  // A plane in the air, drawn on top of everything, gets the click before
  // the airports and routes under it: it opens that plane's view.
  const clickedFlight = findFlightAt(...mapPoint(event.clientX, event.clientY), state, latestFractionalMinute);
  if (clickedFlight) {
    select({ kind: 'aircraft', tail: clickedFlight.tail });
    render();
    return;
  }

  // A grounded plane's pin (Ops view) opens the Maintenance screen.
  if (findDisruptionPinAt(...mapPoint(event.clientX, event.clientY), state)) {
    select({ kind: 'maintenance' });
    render();
    return;
  }

  // Second refusal: a click the route builder didn't want
  // (no plane selected) might still be "show me this airport" rather
  // than the start of a pan. See ui/mapMenu.ts's own comment for
  // why a selected tail always means the route builder owns the click.
  if (handleMapMenuMouseDown(event, state)) {
    render();
    return;
  }

  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  translateAtDragStart = projection.translate();
}

canvas.addEventListener('mousedown', pressMap);

/**
 * One hover system for the whole map. Priority order: if a route is currently armed,
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
// A touch has no hover: the mouse events that follow a tap would otherwise leave a hover card stuck on the map.
let lastInputWasTouch = false;
const pointOf = (event: MouseEvent): { x: number; y: number } => {
  const [x, y] = mapPoint(event.clientX, event.clientY);
  return { x, y };
};
canvas.addEventListener('pointerdown', (event) => (lastInputWasTouch = event.pointerType === 'touch'));

canvas.addEventListener('mousemove', (event) => {
  hoverPoint = isDragging || lastInputWasTouch ? null : pointOf(event);
  if (handleRouteBuilderMouseMove(event, state)) {
    render();
    hideCompetitionTooltip();
    return;
  }

  // The hover tooltip is the Competition overlay's readout (who else flies
  // this). Anywhere else the click card says everything worth saying, and
  // showing both at once put two popups on the same airport, so it appears
  // only with the overlay on and never while a click menu is open.
  if (!competitionOverlayOn || isMapMenuOpen()) {
    hideCompetitionTooltip();
    return;
  }

  // A plane under the pointer wins over the route or airport beneath it.
  if (findFlightAt(...mapPoint(event.clientX, event.clientY), state, latestFractionalMinute)) {
    hideCompetitionTooltip();
    return;
  }

  const hover = findCompetitionHover(...mapPoint(event.clientX, event.clientY), selectedCompetitorAirline, state, competitionOverlayOn);
  if (hover) {
    showCompetitionTooltip(hover, event.clientX, event.clientY, state, competitionOverlayOn);
  } else {
    hideCompetitionTooltip();
  }
});

canvas.addEventListener('mouseleave', () => {
  hoverPoint = null;
  hideFlightTooltip();
  hideAirportTooltip();
  hideCompetitionTooltip();
  hideRouteHoverTooltip();
});

window.addEventListener('mousemove', (event) => {
  if (!isDragging) return;
  const dx = event.clientX - dragStartX;
  const dy = event.clientY - dragStartY;
  panFrom(translateAtDragStart, dx, dy);
  render();
});

/** The end of a press: one that never moved, on empty map, returns the panel to Network. */
function releaseMap(event: ClientPoint): void {
  // A click on empty map (no route builder, no ring, no airport or route
  // under it, so it started a pan that never moved) returns the panel to
  // Network.
  const moved = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
  if (isDragging && moved < CLICK_SLOP_PX && !ringOpenAtMouseDown) select(NETWORK);
  isDragging = false;
}

window.addEventListener('mouseup', releaseMap);

// --- Touch ---
//
// ui/mapInput.ts turns finger events into taps, drags and pinches; this says what
// each does. Moves only change the projection: the frame loop draws it once per
// frame, where a draw per event (several arrive per frame on a phone) made the
// map lag. A tap runs the same press and release a mouse click does.

// Press and hold on an airport opens its details sheet, with a ring filling
// around the airport while the hold registers. Moving off (a drag), a second
// finger (a pinch) or letting go early cancels it; a release before the end is
// the ordinary tap, which selects the airport and opens its ring of actions.
const HOLD_MS = 450;
let holdTimer: number | null = null;
let holdOpened = false;

function startAirportHold(x: number, y: number): void {
  holdOpened = false;
  const airport = isRouteBuilderActive() ? null : nearestAirportCandidate(x, y)?.airport;
  if (!airport) return;
  setAirportHold(airport.iata, HOLD_MS);
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    holdOpened = true;
    setAirportHold(null);
    navigator.vibrate?.(15);
    openAirportSheet(airport.iata);
  }, HOLD_MS);
}

function cancelAirportHold(): void {
  if (holdTimer !== null) window.clearTimeout(holdTimer);
  holdTimer = null;
  setAirportHold(null);
}

/** Show an airport's details on a phone, where a tap alone leaves the map in view. */
function openAirportSheet(iata: string): void {
  hideMapMenu();
  select({ kind: 'airport', iata });
  if (panelHidden) setPanelHidden(false);
}

const DOUBLE_TAP_ZOOM = 2;

/** Zoom in on (x, y) over a moment, as a double tap does. */
function animateZoomAt(x: number, y: number, factor: number): void {
  const started = performance.now();
  let applied = 1;
  mapGesture.active = true;
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / 180);
    const target = Math.pow(factor, 1 - (1 - progress) * (1 - progress));
    zoomAt(x, y, target / applied, false);
    applied = target;
    if (progress < 1) requestAnimationFrame(step);
    else mapGesture.active = false;
  };
  requestAnimationFrame(step);
}

setupMapInput(canvas, mapPoint, {
  pressed: (x, y) => startAirportHold(x, y),
  cancelHold: cancelAirportHold,
  gestureStarted: () => {
    mapGesture.active = true;
    hideMapMenu();
  },
  holdFired: () => holdOpened,
  pan: (dx, dy) => panBy(dx, dy),
  pinch: (x, y, ratio, dx, dy) => {
    panBy(dx, dy);
    zoomAt(x, y, ratio, false);
  },
  gestureEnded: () => {
    mapGesture.active = false;
  },
  tap: (clientX, clientY) => {
    pressMap({ clientX, clientY });
    releaseMap({ clientX, clientY });
  },
  doubleTap: (x, y) => {
    hideMapMenu();
    animateZoomAt(x, y, DOUBLE_TAP_ZOOM);
  },
});

// Esc steps the inspector back one level, but only when nothing else on
// screen wants Esc first. Listening in the capture phase runs this before
// every ordinary keydown listener (the route builder's, the ring's, the hub
// planner's), whenever they were added, so it sees them still open on the
// press that closes them.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || choosingHome) return;
    if (isJumpBoxOpen()) {
      closeJumpBox();
      return;
    }
    if (isRouteBuilderActive() || isMapMenuOpen() || isHubPlannerOpen()) return;
    back();
  },
  { capture: true },
);
window.addEventListener('keydown', handleRouteBuilderKeyDown);
window.addEventListener('keydown', handleMapMenuKeyDown);

// --- Zoom (scroll wheel) ---
//
// The wheel, pinch and buttons all zoom through render/camera.ts; this just draws afterwards.
// `redraw` is false mid-gesture, where the frame loop draws once per frame.
function zoomAt(x: number, y: number, factor: number, redraw = true): void {
  cameraZoomAt(x, y, factor);
  if (redraw) render();
}

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    zoomAt(...mapPoint(event.clientX, event.clientY), Math.pow(1.002, -event.deltaY));
  },
  { passive: false },
);

// The map tools' zoom buttons: zoom toward the middle of the map,
// or refit it around home, as at the start.
const ZOOM_BUTTON_FACTOR = 1.5;
const mapMiddle = (): [number, number] => [canvas.clientWidth / 2, canvas.clientHeight / 2];
document.querySelector('#zoom-in')!.addEventListener('click', () => zoomAt(...mapMiddle(), ZOOM_BUTTON_FACTOR));
document.querySelector('#zoom-out')!.addEventListener('click', () => zoomAt(...mapMiddle(), 1 / ZOOM_BUTTON_FACTOR));
document.querySelector('#zoom-home')!.addEventListener('click', () => resize());

// On a phone the lens and the airport filters fold behind the layers button, so they only cover the map when wanted.
const toolsToggle = document.querySelector<HTMLButtonElement>('#map-tools-toggle')!;
toolsToggle.addEventListener('click', () => {
  const open = !document.documentElement.hasAttribute('data-tools');
  document.documentElement.toggleAttribute('data-tools', open);
  toolsToggle.setAttribute('aria-expanded', String(open));
  toolsToggle.classList.toggle('active', open);
});

// --- Choosing a home city (new games only) ---
//
// Paused until a city is chosen, so no simulated time passes behind the
// picker. Choosing replaces the placeholder starting fleet with a
// propeller at the chosen city, saves straight away (so reloading does
// not ask again), refits the map around it and starts the clock.
if (choosingHome) {
  speedMultiplier = 0;
  speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  showHomePicker(homeOptions(), (iata, season, difficulty, eventsOff) => {
    chooseHome(state, iata, season, difficulty, eventsOff);
    saveState(state);
    choosingHome = false;
    resize();
    // Paused, so the first route is drawn before any cash is spent on
    // nothing; 1× or Space starts the clock at 1×.
    speedMultiplier = 0;
    speedBeforePause = 1;
    speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
  });
}

// A resumed game starts paused: a reload, a loaded save or an imported
// one should never fly days the player didn't watch. Space or 1× resumes
// it, at 1×.
if (savedState !== null) {
  speedMultiplier = 0;
  speedButtons.forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === 0));
}
