import './style.css';
import { projection, fitProjection, baselineScale } from './render/projection';
import { drawBasemap } from './render/basemap';
import { drawTerminator } from './render/terminator';
import { drawRoutes } from './render/routes';
import { drawAirports } from './render/airports';
import { drawAircraft } from './render/aircraft';
import { drawDemandLayer } from './render/demand';
import { validateSchedule } from './sim/schedule';
import { createInitialState, type SimState } from './sim/state';
import { step } from './sim/step';
import { updatePanel, setupScheduleEditor, PANEL_WIDTH_PX } from './ui/panels';
import {
  setupRouteBuilder,
  handleRouteBuilderMouseDown,
  handleRouteBuilderMouseMove,
  handleRouteBuilderKeyDown,
  drawRoutePreview,
  cancelPendingRoute,
} from './ui/routeBuilder';
import { setupRotationBoard, updateRotationBoard } from './ui/rotationBoard';
import { setupCommercialPanel, updateCommercialPanel } from './ui/commercial';

// M4 brought only one aircraft to life, to prove out the clock and the
// depart/arrive mechanism on something small. M5 turns the rest on by
// listing all three tails here — see the comment on createInitialState.
const ACTIVE_TAILS = ['C-GVIA', 'C-FATL', 'C-GMAR'];
const state: SimState = createInitialState(ACTIVE_TAILS);

// Validate this game's own schedule (not just the static template) — the
// M8 schedule editor re-runs this same check after every edit, so a change
// that breaks a rotation gets caught the same way a broken schedule.json
// would be caught here at startup.
validateSchedule(state.schedule);
setupScheduleEditor(state);
setupRouteBuilder(state);
setupRotationBoard();
setupCommercialPanel(state);

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const clockEl = document.querySelector<HTMLDivElement>('#clock')!;
const speedButtons = document.querySelectorAll<HTMLButtonElement>('#speed-controls button');
const viewToggleButtons = document.querySelectorAll<HTMLButtonElement>('#view-toggle .view-dropdown button');
const viewGroups = document.querySelectorAll<HTMLDivElement>('#view-toggle .view-group');
const rotationBoardEl = document.querySelector<HTMLDivElement>('#rotation-board')!;
const commercialPanelEl = document.querySelector<HTMLDivElement>('#commercial-panel')!;

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

// Which of the four main views is currently showing. The clock and
// sidebar panel stay relevant regardless, so they're not gated by this.
// 'ops' and 'demand' both draw on the same canvas (just different layers
// on top of the same basemap/projection); 'rotation' and 'commercial' each
// hide the canvas in favor of their own DOM element (#rotation-board,
// #commercial-panel) — see ui/rotationBoard.ts and ui/commercial.ts for
// why those two get real DOM instead of a canvas layer.
type View = 'ops' | 'demand' | 'rotation' | 'commercial';
let currentView: View = 'ops';

function render(): void {
  updateClock(state);
  updatePanel(state);

  if (currentView === 'rotation' || currentView === 'commercial') return;

  const cssWidth = window.innerWidth - PANEL_WIDTH_PX;
  const cssHeight = window.innerHeight;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBasemap(ctx);

  if (currentView === 'ops') {
    drawTerminator(ctx, latestFractionalMinute);
    drawRoutes(ctx);
    drawAircraft(ctx, state, latestFractionalMinute);
    drawAirports(ctx);
    drawRoutePreview(ctx);
  } else {
    drawDemandLayer(ctx);
  }
}

const MINUTES_PER_DAY = 1440;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function updateClock(state: SimState): void {
  const dayNumber = Math.floor(state.simMinute / MINUTES_PER_DAY) + 1;
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  clockEl.textContent = `Day ${dayNumber} · ${pad(hours)}:${pad(minutes)} UTC`;
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

  latestFractionalMinute = state.simMinute + accumulator / MS_PER_SIM_MINUTE;
  render();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

speedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    speedMultiplier = Number(button.dataset.speed);
    speedButtons.forEach((b) => b.classList.toggle('active', b === button));
  });
});

// --- View toggle (Ops / Demand / Rotation / Commercial) ---
//
// Grouped into two dropdowns rather than a flat row of four: "Maps"
// (Ops, Demand — both draw on the canvas/projection) and "Reports"
// (Rotation, Commercial — both real DOM, not canvas). Each group's
// trigger button shows an SVG icon, not a text label, per design; the
// two options underneath are still plain text buttons, same as before.
//
// #map, #rotation-board, and #commercial-panel are siblings sized
// identically in style.css; #map stays visible for both 'ops' and
// 'demand' (render() just draws a different layer on top of the same
// basemap for each — see above), and only one of #rotation-board /
// #commercial-panel is ever un-hidden at a time for their two views.
// Switching away from 'ops' cancels any in-progress route-creation
// gesture (ui/routeBuilder.ts) — an armed or pending route stops making
// sense once you're not looking at the ops layer it was drawn on.
// Switching *to* the rotation board or commercial panel refreshes it, in
// case the schedule changed while it was hidden — the rotation board has
// no interactive elements to lose, and the commercial panel only
// refreshes its numeric cells, never rebuilding the fare/marketing
// sliders themselves (see ui/commercial.ts).
const VIEW_GROUP: Record<View, string> = {
  ops: 'maps',
  demand: 'maps',
  rotation: 'reports',
  commercial: 'reports',
};

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

  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't immediately re-close via the document listener below
    if (dropdown.hidden) {
      openThisDropdown();
    } else {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
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
    const view = button.dataset.view as View;
    closeAllDropdowns();
    if (view === currentView) return;

    currentView = view;
    canvas.hidden = view === 'rotation' || view === 'commercial';
    rotationBoardEl.hidden = view !== 'rotation';
    commercialPanelEl.hidden = view !== 'commercial';
    viewToggleButtons.forEach((b) => b.classList.toggle('active', b === button));
    // The group trigger itself also shows which group the active view
    // belongs to, so it's visible at a glance without opening either
    // dropdown — e.g. the Maps icon stays highlighted while on Demand.
    viewGroups.forEach((group) => {
      const isActiveGroup = group.dataset.group === VIEW_GROUP[view];
      group.querySelector<HTMLButtonElement>('.view-group-trigger')!.classList.toggle('active', isActiveGroup);
    });

    if (view !== 'ops') cancelPendingRoute();
    if (view === 'rotation') updateRotationBoard(state);
    if (view === 'commercial') updateCommercialPanel(state);

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
  // on any click on the canvas, but only in Ops mode — arming a route by
  // clicking an airport wouldn't mean anything while looking at the demand
  // layer instead. Only once it says "not mine" (or isn't asked at all)
  // does an ordinary click-and-drag start panning, exactly as before.
  if (currentView === 'ops' && handleRouteBuilderMouseDown(event, state)) {
    render();
    return;
  }

  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  translateAtDragStart = projection.translate();
});

canvas.addEventListener('mousemove', (event) => {
  if (currentView === 'ops' && handleRouteBuilderMouseMove(event)) render();
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
