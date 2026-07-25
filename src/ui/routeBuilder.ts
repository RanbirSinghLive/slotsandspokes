import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from '../render/projection';
import { airports, type Airport } from '../render/airports';
import { computeBlockMinutes, nextLegId, validateSchedule, type ScheduleLeg } from '../sim/schedule';
import { addScheduleRow } from './panels';
import type { SimState } from '../sim/state';

const HIT_RADIUS_PX = 14;
const RING_RADIUS = 8;
const PREVIEW_STROKE = '#ffd166';
const ORIGIN_RING_STROKE = '#9aa3b8';
const CANDIDATE_RING_STROKE = '#ffd166';

/**
 * The M10 route-creation gesture: click an airport to arm it, move the
 * mouse (no need to hold the button) to draw a live preview toward the
 * cursor, and click a second airport to confirm — see WEEK-TWO.md for the
 * full design writeup. `idle`/`armed`/`confirming` is the whole state
 * machine; nothing here is part of SimState, since it's transient
 * interaction state, not simulated-world state.
 */
type BuilderState =
  | { mode: 'idle' }
  | { mode: 'armed'; origin: Airport }
  | { mode: 'confirming'; origin: Airport; dest: Airport };

let builderState: BuilderState = { mode: 'idle' };
// Only meaningful while armed: where the cursor currently is (in lon/lat,
// for drawing the preview) and which airport, if any, it's close enough to
// snap onto.
let previewGeo: [number, number] | null = null;
let candidate: Airport | null = null;

function findNearestAirport(screenX: number, screenY: number): Airport | null {
  let nearest: Airport | null = null;
  let nearestDistPx = HIT_RADIUS_PX;
  for (const airport of airports) {
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const distPx = Math.hypot(point[0] - screenX, point[1] - screenY);
    if (distPx < nearestDistPx) {
      nearestDistPx = distPx;
      nearest = airport;
    }
  }
  return nearest;
}

function setArmedCursor(armed: boolean): void {
  document.querySelector<HTMLCanvasElement>('#map')!.classList.toggle('armed', armed);
}

function reset(): void {
  builderState = { mode: 'idle' };
  previewGeo = null;
  candidate = null;
  setArmedCursor(false);
  hideForm();
}

/**
 * Handle a canvas mousedown *before* main.ts's own pan-drag logic does.
 * Returns true when the route builder consumed the click (armed a new
 * route, confirmed one, or cancelled a pending one) — main.ts should skip
 * starting a pan in that case. Returns false to mean "not mine, go ahead
 * and pan as usual."
 */
export function handleRouteBuilderMouseDown(event: MouseEvent): boolean {
  const clicked = findNearestAirport(event.clientX, event.clientY);

  if (builderState.mode === 'idle') {
    if (!clicked) return false; // empty map: not our gesture, let panning happen
    builderState = { mode: 'armed', origin: clicked };
    setArmedCursor(true);
    return true;
  }

  if (builderState.mode === 'armed') {
    if (clicked && clicked.iata === builderState.origin.iata) {
      reset(); // re-clicking the origin cancels
      return true;
    }
    if (clicked) {
      showForm(builderState.origin, clicked);
      builderState = { mode: 'confirming', origin: builderState.origin, dest: clicked };
      return true;
    }
    reset(); // clicked open water while armed: cancel
    return true;
  }

  // Confirming: the form has focus. Swallow map clicks rather than acting
  // on them until Add/Cancel/Escape resolves the pending route.
  return true;
}

/**
 * Update the live preview while armed. No-op in every other mode — returns
 * whether anything changed, so main.ts only pays for an extra render() on
 * mouse moves that actually matter (armed), not on every idle move over
 * the map the way an unconditional call would.
 */
export function handleRouteBuilderMouseMove(event: MouseEvent): boolean {
  if (builderState.mode !== 'armed') return false;
  const geo = projection.invert?.([event.clientX, event.clientY]);
  if (!geo) return false;
  previewGeo = geo;
  candidate = findNearestAirport(event.clientX, event.clientY);
  return true;
}

/** Escape cancels an armed or pending route from anywhere. */
export function handleRouteBuilderKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && builderState.mode !== 'idle') {
    reset();
  }
}

/**
 * Draw the live preview arc and origin/candidate highlight rings. Called
 * from main.ts's render(), same as every other canvas layer — a plain
 * read of this module's own transient state, drawn above everything else
 * so it's never hidden behind the basemap or a route.
 */
export function drawRoutePreview(ctx: CanvasRenderingContext2D): void {
  if (builderState.mode === 'idle') return;

  const { origin } = builderState;
  const originPoint = projection([origin.lon, origin.lat]);
  if (originPoint) {
    ctx.beginPath();
    ctx.arc(originPoint[0], originPoint[1], RING_RADIUS, 0, 2 * Math.PI);
    ctx.strokeStyle = ORIGIN_RING_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (builderState.mode !== 'armed' || !previewGeo) return;

  // Snap the preview's endpoint to the candidate airport's exact
  // coordinates when hovering near one, rather than the raw cursor
  // position — so the preview shows precisely where the real route would
  // go, not an approximation of it.
  const destGeo: [number, number] = candidate ? [candidate.lon, candidate.lat] : previewGeo;
  const line: LineString = { type: 'LineString', coordinates: [[origin.lon, origin.lat], destGeo] };

  const path = geoPath(projection, ctx);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = PREVIEW_STROKE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  path(line);
  ctx.stroke();
  ctx.restore();

  if (candidate) {
    const candidatePoint = projection([candidate.lon, candidate.lat]);
    if (candidatePoint) {
      ctx.beginPath();
      ctx.arc(candidatePoint[0], candidatePoint[1], RING_RADIUS, 0, 2 * Math.PI);
      ctx.strokeStyle = CANDIDATE_RING_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

// --- The confirmation form (real DOM, per CLAUDE.md's panel rule) ---

const formSection = document.querySelector<HTMLElement>('#new-route-section')!;
const formLabel = document.querySelector<HTMLElement>('#new-route-label')!;
const formBlock = document.querySelector<HTMLElement>('#new-route-block')!;
const formTailSelect = document.querySelector<HTMLSelectElement>('#new-route-tail')!;
const formDepartInput = document.querySelector<HTMLInputElement>('#new-route-depart')!;
const formConfirmButton = document.querySelector<HTMLButtonElement>('#new-route-confirm')!;
const formCancelButton = document.querySelector<HTMLButtonElement>('#new-route-cancel')!;

function showForm(origin: Airport, dest: Airport): void {
  formLabel.textContent = `${origin.iata} → ${dest.iata}`;
  formBlock.textContent = `Block time: ${computeBlockMinutes(origin.iata, dest.iata)} min`;
  formSection.hidden = false;
}

function hideForm(): void {
  formSection.hidden = true;
}

function timeStringToMinuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Wire up the confirmation form and populate the tail dropdown from the
 * active fleet. Called once at startup, alongside setupScheduleEditor() —
 * same "build once, mutate only via events" rule, for the same reason: a
 * <select> or <input> the player is mid-interaction with shouldn't get
 * torn out by a periodic re-render.
 *
 * Adding a route doesn't run any new rotation-fitting logic — it appends
 * the leg to state.schedule (the same array step() reads from) and
 * re-runs validateSchedule(), exactly the way editing an existing leg's
 * time already does in M8. If the chosen tail/time doesn't actually chain
 * with that tail's other legs, the same console error catches it; nothing
 * here prevents adding it anyway, on purpose, for consistency with M8.
 */
export function setupRouteBuilder(state: SimState): void {
  for (const aircraft of state.aircraft) {
    const option = document.createElement('option');
    option.value = aircraft.tail;
    option.textContent = aircraft.tail;
    formTailSelect.appendChild(option);
  }

  formConfirmButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    const { origin, dest } = builderState;
    const tail = formTailSelect.value;

    const leg: ScheduleLeg = {
      legId: nextLegId(tail, state.schedule),
      tail,
      origin: origin.iata,
      dest: dest.iata,
      departMinute: timeStringToMinuteOfDay(formDepartInput.value),
      blockMinutes: computeBlockMinutes(origin.iata, dest.iata),
    };
    state.schedule.push(leg);
    addScheduleRow(leg, state);
    validateSchedule(state.schedule);

    reset();
  });

  formCancelButton.addEventListener('click', () => {
    reset();
  });
}
