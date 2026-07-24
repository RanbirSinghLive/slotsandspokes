import './style.css';
import { projection, fitProjection, baselineScale } from './render/projection';
import { drawBasemap } from './render/basemap';
import { drawTerminator } from './render/terminator';
import { drawRoutes } from './render/routes';
import { drawAirports } from './render/airports';
import { drawAircraft } from './render/aircraft';
import { scheduleLegs, validateSchedule } from './sim/schedule';
import { createInitialState, type SimState } from './sim/state';
import { step } from './sim/step';
import { updatePanel, PANEL_WIDTH_PX } from './ui/panels';

validateSchedule(scheduleLegs);

// M4 brought only one aircraft to life, to prove out the clock and the
// depart/arrive mechanism on something small. M5 turns the rest on by
// listing all three tails here — see the comment on createInitialState.
const ACTIVE_TAILS = ['C-GVIA', 'C-FATL', 'C-GMAR'];
const state: SimState = createInitialState(ACTIVE_TAILS);

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const clockEl = document.querySelector<HTMLDivElement>('#clock')!;
const speedButtons = document.querySelectorAll<HTMLButtonElement>('#speed-controls button');

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

function render(): void {
  const cssWidth = window.innerWidth - PANEL_WIDTH_PX;
  const cssHeight = window.innerHeight;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  drawBasemap(ctx);
  drawTerminator(ctx, latestFractionalMinute);
  drawRoutes(ctx);
  drawAircraft(ctx, state, latestFractionalMinute);
  drawAirports(ctx);
  updateClock(state);
  updatePanel(state);
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
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  translateAtDragStart = projection.translate();
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
