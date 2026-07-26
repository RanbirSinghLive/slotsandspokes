import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from '../render/projection';
import { airports, type Airport } from '../render/airports';
import {
  computeBlockMinutes,
  defaultReturnDepartMinute,
  marketKey,
  nextLegId,
  recommendedFare,
  validateSchedule,
  type ScheduleLeg,
} from '../sim/schedule';
import { addScheduleRow, filterScheduleToRoute, minuteOfDayToTimeString, renderScheduleWarnings } from './panels';
import { addCommercialRow } from './commercial';
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

/**
 * Whether origin/dest is a market that already has service — checked
 * bidirectionally, the same definition render/routes.ts uses to decide
 * what counts as "the same route" for drawing purposes (a market is a
 * market regardless of which direction a given leg happens to fly).
 * Drives the form's heading: "New Frequency" for an existing market,
 * "New Route" for a genuinely new one.
 */
function isExistingMarket(originIata: string, destIata: string, schedule: ScheduleLeg[]): boolean {
  return schedule.some(
    (leg) => (leg.origin === originIata && leg.dest === destIata) || (leg.origin === destIata && leg.dest === originIata),
  );
}

/**
 * A leg already departing this exact origin, for this exact destination,
 * at this exact minute — checked same-direction only, unlike
 * isExistingMarket above. Same-direction matters here: two flights leaving
 * in *opposite* directions at the same clock time is an ordinary
 * synchronized schedule bank, not a conflict. Two leaving the same
 * direction at the identical minute has no legitimate interpretation in
 * this model, so it's hard-blocked rather than just flagged.
 */
function findExactTimeCollision(
  originIata: string,
  destIata: string,
  departMinute: number,
  schedule: ScheduleLeg[],
): ScheduleLeg | undefined {
  return schedule.find(
    (leg) => leg.origin === originIata && leg.dest === destIata && leg.departMinute === departMinute,
  );
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
 * Cancel any in-progress arm/confirm gesture from outside this module —
 * main.ts calls this when switching away from the Map view (M11), since
 * an armed or pending route makes no sense once the canvas it was drawn
 * on is hidden.
 */
export function cancelPendingRoute(): void {
  reset();
}

/**
 * Handle a canvas mousedown *before* main.ts's own pan-drag logic does.
 * Returns true when the route builder consumed the click (armed a new
 * route, confirmed one, or cancelled a pending one) — main.ts should skip
 * starting a pan in that case. Returns false to mean "not mine, go ahead
 * and pan as usual."
 */
export function handleRouteBuilderMouseDown(event: MouseEvent, state: SimState): boolean {
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
      showForm(builderState.origin, clicked, state.schedule);
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
const formHeading = document.querySelector<HTMLElement>('#new-route-heading')!;
const formLabel = document.querySelector<HTMLElement>('#new-route-label')!;
const formBlock = document.querySelector<HTMLElement>('#new-route-block')!;
const formError = document.querySelector<HTMLElement>('#new-route-error')!;
const formTailSelect = document.querySelector<HTMLSelectElement>('#new-route-tail')!;
const formDepartInput = document.querySelector<HTMLInputElement>('#new-route-depart')!;
const formReturnCheckbox = document.querySelector<HTMLInputElement>('#new-route-return')!;
const formReturnPreview = document.querySelector<HTMLElement>('#new-route-return-preview')!;
const formConfirmButton = document.querySelector<HTMLButtonElement>('#new-route-confirm')!;
const formCancelButton = document.querySelector<HTMLButtonElement>('#new-route-cancel')!;

const DEFAULT_DEPART_TIME = '12:00';

function showForm(origin: Airport, dest: Airport, schedule: ScheduleLeg[]): void {
  formHeading.textContent = isExistingMarket(origin.iata, dest.iata, schedule) ? 'New Frequency' : 'New Route';
  formLabel.textContent = `${origin.iata} → ${dest.iata}`;
  formBlock.textContent = `Block time: ${computeBlockMinutes(origin.iata, dest.iata)} min`;
  formSection.hidden = false;

  // Reset to a fixed default every time the form opens, rather than
  // leaving whatever time a *previous* route's form was left at. Without
  // this, a leftover time from an unrelated earlier route can silently
  // collide with an existing leg on this new market and block the Add
  // button with no obvious reason why — exactly what happened creating a
  // second YSJ-YQB frequency after leaving the input at 13:00 from an
  // earlier route.
  formDepartInput.value = DEFAULT_DEPART_TIME;
  // Defaults to checked every time the form opens, same reasoning as
  // resetting the depart time below: adding a route almost always means
  // "and back," and this is what stops a leg like this session's C-GVIA
  // YYG->YHZ from getting created alone, with nothing to fly the aircraft
  // back into its own rotation.
  formReturnCheckbox.checked = true;
  updateFormValidation(origin, dest, schedule);

  // Filter the schedule table to this market *now*, while the form is
  // still open — not only after "Add Route" is clicked. Filtering only on
  // confirm meant the table narrowed the instant the form closed, which
  // in practice looked like nothing happened: by the time the filter took
  // effect, attention had already moved on with the popup. Filtering here
  // instead shows the market's existing frequencies (times already taken,
  // by which tails) while the player is still choosing theirs — which is
  // also just more useful context to have during the decision itself.
  filterScheduleToRoute(origin.iata, dest.iata);
}

function hideForm(): void {
  formSection.hidden = true;
}

/**
 * Live-check the depart time (and, when the return checkbox is on, the
 * auto-computed return leg's time too) against findExactTimeCollision() and
 * hard-block submission when either collides — unlike the M8/M9 rotation
 * checks, which allow a bad edit through and just log it, an exact-time
 * double-booking has no legitimate interpretation, so it's caught here in
 * the form rather than after the fact. Also keeps the return-leg preview
 * text current, so the player can see what "Add return leg too" is actually
 * about to create before they click Add Route.
 */
function updateFormValidation(origin: Airport, dest: Airport, schedule: ScheduleLeg[]): void {
  const departMinute = timeStringToMinuteOfDay(formDepartInput.value);
  const blockMinutes = computeBlockMinutes(origin.iata, dest.iata);
  const outboundCollision = findExactTimeCollision(origin.iata, dest.iata, departMinute, schedule);

  let returnDepartMinute: number | null = null;
  let returnCollision: ScheduleLeg | undefined;
  if (formReturnCheckbox.checked) {
    returnDepartMinute = defaultReturnDepartMinute(departMinute, blockMinutes);
    returnCollision = findExactTimeCollision(dest.iata, origin.iata, returnDepartMinute, schedule);
  }

  if (outboundCollision) {
    formError.textContent = `${outboundCollision.tail} already departs ${origin.iata} for ${dest.iata} at this exact time (${outboundCollision.legId}). Pick a different time.`;
    formConfirmButton.disabled = true;
  } else if (returnCollision) {
    formError.textContent = `${returnCollision.tail} already departs ${dest.iata} for ${origin.iata} at the auto-computed return time (${minuteOfDayToTimeString(returnDepartMinute!)}, ${returnCollision.legId}). Uncheck the return leg, or pick a different depart time.`;
    formConfirmButton.disabled = true;
  } else {
    formError.textContent = '';
    formConfirmButton.disabled = false;
  }

  formReturnPreview.textContent =
    formReturnCheckbox.checked && returnDepartMinute !== null
      ? `Return: ${dest.iata} → ${origin.iata} at ${minuteOfDayToTimeString(returnDepartMinute)}`
      : '';
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

  // Re-check for an exact-time collision (and refresh the return-leg
  // preview) every time the player changes the depart time or toggles the
  // return checkbox, so the form reacts live instead of only at submission.
  formDepartInput.addEventListener('input', () => {
    if (builderState.mode !== 'confirming') return;
    updateFormValidation(builderState.origin, builderState.dest, state.schedule);
  });
  formReturnCheckbox.addEventListener('change', () => {
    if (builderState.mode !== 'confirming') return;
    updateFormValidation(builderState.origin, builderState.dest, state.schedule);
  });

  formConfirmButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    const { origin, dest } = builderState;
    const tail = formTailSelect.value;
    const departMinute = timeStringToMinuteOfDay(formDepartInput.value);
    const blockMinutes = computeBlockMinutes(origin.iata, dest.iata);

    // Defensive re-check: the button should already be disabled in this
    // case, but never add a duplicate timeslot regardless.
    if (findExactTimeCollision(origin.iata, dest.iata, departMinute, state.schedule)) return;

    const outboundLeg: ScheduleLeg = {
      legId: nextLegId(tail, state.schedule),
      tail,
      origin: origin.iata,
      dest: dest.iata,
      departMinute,
      blockMinutes,
    };
    state.schedule.push(outboundLeg);
    addScheduleRow(outboundLeg, state);

    // Adding a route creates its return leg too, by default — 99% of the
    // time a player drawing A->B wants B->A as well, and the case that
    // doesn't is exactly the case that used to strand a tail at the far
    // end with no way back into its own rotation (see WEEK-THREE.md). The
    // checkbox is the deliberate escape hatch for the real exception: an
    // extra one-way frequency on a market that already has a return, or a
    // one-off repositioning move where a return truly isn't wanted yet.
    if (formReturnCheckbox.checked) {
      const returnDepartMinute = defaultReturnDepartMinute(departMinute, blockMinutes);
      // Same defensive re-check as the outbound leg above — if the
      // auto-computed return time happens to collide, just skip adding it
      // rather than fail the whole submission; the outbound leg (and the
      // form's live validation, which would have already disabled Add
      // Route in this case) still make this an edge case, not a silent one.
      if (!findExactTimeCollision(dest.iata, origin.iata, returnDepartMinute, state.schedule)) {
        const returnLeg: ScheduleLeg = {
          legId: nextLegId(tail, state.schedule),
          tail,
          origin: dest.iata,
          dest: origin.iata,
          departMinute: returnDepartMinute,
          blockMinutes,
        };
        state.schedule.push(returnLeg);
        addScheduleRow(returnLeg, state);
      }
    }

    renderScheduleWarnings(validateSchedule(state.schedule, state.aircraft));

    // Fare/marketing are set at the market level (sim/state.ts's
    // RouteSettings), not per leg — a brand-new market gets a fresh entry
    // (recommendedFare() default, zero marketing spend); a second
    // frequency on a market that already has one reuses it unchanged,
    // rather than resetting whatever fare the player already set there.
    // marketKey() is bidirectional, so this covers the return leg too —
    // one entry for the whole market regardless of how many legs serve it.
    const key = marketKey(origin.iata, dest.iata);
    if (!state.routeSettings[key]) {
      state.routeSettings[key] = { fare: recommendedFare(origin.iata, dest.iata), marketingSpend: 0 };
      addCommercialRow(origin.iata, dest.iata, state);
    }

    // The Route filter is already set to this exact market — see
    // showForm() — so the new row satisfies it automatically and just
    // joins whatever else is already narrowed into view.

    reset();
  });

  formCancelButton.addEventListener('click', () => {
    reset();
  });
}
