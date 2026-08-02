import { geoCircle, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import aircraftTypesData from '../../data/aircraft-types.json';
import { projection } from '../render/projection';
import { airports, type Airport } from '../render/airports';
import { greatCircleDistanceNm } from '../sim/geo';
import { actualDailyDemand, currentPotentialDemand } from '../sim/marketDemand';
import { suppressedMarketReason } from '../sim/demand';
import { isSlotControlled, remainingSlotCapacity, slotsOwned, slotsTotal } from '../sim/airports';
import {
  computeBlockMinutes,
  defaultReturnDepartMinute,
  isAircraftTypeAllowedAt,
  legsServingMarket,
  marketKey,
  MIN_TURN_MINUTES,
  networkAirports,
  nextLegId,
  nextPositioningLegId,
  validateSchedule,
  type PositioningLeg,
  type ScheduleLeg,
} from '../sim/schedule';
import { addScheduleRow, filterScheduleToRoute, minuteOfDayToTimeString, renderScheduleWarnings } from './panels';
import { addCommercialRow } from './commercial';
import { policyFare } from '../sim/pricing';
import { getSelectedTail } from './fleetSelection';
import { hideCompetitionTooltip } from './competitionTooltip';
import type { SimState } from '../sim/state';

const HIT_RADIUS_PX = 14;
const RING_RADIUS = 8;
const PREVIEW_STROKE = '#ffd166';
const ORIGIN_RING_STROKE = '#9aa3b8';
const CANDIDATE_RING_STROKE = '#ffd166';
const RANGE_RING_STROKE = '#4a90d9';

// A minimal local view of aircraft-types.json — just what this module
// needs (range for the ring, seats for the PDEW/CAP readout below,
// cruiseKts so a route's block time reflects the plane actually flying
// it), same "small local type" pattern render/competition.ts's
// marketKey() already uses rather than importing sim/economy.ts's fuller
// EconomyAircraftType.
type AircraftTypeSpec = { code: string; name: string; seats: number; rangeNm: number; cruiseKts: number };
const aircraftTypesByCode = new Map<string, AircraftTypeSpec>(
  (aircraftTypesData as AircraftTypeSpec[]).map((type) => [type.code, type]),
);

// --- The armed-state hover tooltip (week four) ---
//
// PDEW/CAP for whichever airport the cursor is currently snapped to as a
// candidate destination, shown *before* the second click confirms
// anything — same real-DOM, positioned-via-mousemove shape as
// ui/competitionTooltip.ts's tooltip.
const routeHoverTooltip = document.querySelector<HTMLElement>('#route-hover-tooltip')!;
const routeHoverTooltipTitle = document.querySelector<HTMLElement>('#route-hover-tooltip-title')!;
const routeHoverTooltipBody = document.querySelector<HTMLElement>('#route-hover-tooltip-body')!;

/**
 * Same PDEW/CAP formula updateFormValidation() uses (see its own
 * comment), just computed for a candidate that hasn't been clicked yet.
 * Reads the confirmation form's return checkbox for whether to assume a
 * return leg — a reasonable best guess even before the form exists for
 * this specific candidate, since it defaults to checked every time the
 * form opens anyway.
 */
function showRouteHoverTooltip(origin: Airport, candidate: Airport, screenX: number, screenY: number, state: SimState): void {
  const tail = getSelectedTail();
  const aircraft = tail ? state.aircraft.find((a) => a.tail === tail) : undefined;
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  routeHoverTooltipTitle.textContent = `${origin.iata} → ${candidate.iata}`;

  if (type) {
    const existingFrequency = legsServingMarket(origin.iata, candidate.iata, state.schedule);
    const newFrequency = existingFrequency + (formReturnCheckbox.checked ? 2 : 1);
    const pdew = Math.round(actualDailyDemand(state, origin.iata, candidate.iata) / newFrequency);
    const potentialPdew = Math.round(currentPotentialDemand(state, origin.iata, candidate.iata) / newFrequency);
    const distanceNm = greatCircleDistanceNm(origin, candidate);
    const outOfRange = distanceNm > type.rangeNm;

    // "now → potential" (week six): with market stimulation, what a
    // market carries today and what it could carry once built are very
    // different numbers, and the second is the one route choice actually
    // turns on. Collapses to a single figure on a market already at
    // maturity, where the two are equal.
    const suppressed = suppressedMarketReason(origin.iata, candidate.iata);
    const pdewText = suppressed
      ? 'No market — same city'
      : potentialPdew > pdew
        ? `PDEW: ${pdew} → ${potentialPdew}`
        : `PDEW: ${pdew}`;

    routeHoverTooltipBody.textContent = outOfRange
      ? `${pdewText}  CAP: ${type.seats} — out of range (${Math.round(distanceNm)} nm)`
      : `${pdewText}  CAP: ${type.seats}`;
    routeHoverTooltipBody.classList.toggle('out-of-range', outOfRange);
    // Thin now means "can never fill this aircraft even fully grown" —
    // testing today's actual instead would fire on virtually every market
    // in the early game, since they all start at the virgin floor, and a
    // warning that's always on is no warning at all.
    routeHoverTooltipBody.classList.toggle('thin-market', !outOfRange && potentialPdew < type.seats);
  } else {
    routeHoverTooltipBody.textContent = '';
    routeHoverTooltipBody.classList.remove('out-of-range', 'thin-market');
  }

  routeHoverTooltip.hidden = false;
  routeHoverTooltip.style.left = `${screenX + 16}px`;
  routeHoverTooltip.style.top = `${screenY + 16}px`;
}

/**
 * Exported so main.ts can hide the tooltip on canvas `mouseleave` without
 * cancelling the whole armed gesture the way reset() would — moving the
 * mouse off the map briefly (to the sidebar, say) shouldn't lose an
 * in-progress route.
 */
export function hideRouteHoverTooltip(): void {
  routeHoverTooltip.hidden = true;
}

/**
 * The M10 route-creation gesture: pick a plane from the Fleet panel first
 * (week three — see ui/fleetSelection.ts), click an airport to arm it,
 * move the mouse (no need to hold the button) to draw a live preview
 * toward the cursor, and click a second airport to confirm — see
 * WEEK-TWO.md for the original design writeup and WEEK-THREE.md for the
 * pick-a-plane-first change. `idle`/`armed`/`confirming` is the whole
 * state machine; nothing here is part of SimState, since it's transient
 * interaction state, not simulated-world state. `tail` is captured into
 * `armed`/`confirming` at arm time so a gesture always finishes with the
 * plane it started with, even if the Fleet panel selection changes
 * mid-gesture — see cancelIfTailChanged() below for what happens then.
 */
type BuilderState =
  | { mode: 'idle' }
  | { mode: 'armed'; origin: Airport; tail: string }
  | { mode: 'confirming'; origin: Airport; dest: Airport; tail: string };

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

/**
 * Where `tail` actually is (or will be) right now, for deciding whether
 * assigning it to a new route needs a positioning leg first — see
 * PositioningLeg's own comment (sim/schedule.ts) for why this exists at
 * all. Ground and airborne aircraft need different answers: a grounded
 * tail can reposition as soon as its turn time clears, while an airborne
 * one can only start repositioning after it lands wherever it's already
 * headed (its current ActiveFlight's destination) plus its own turn time —
 * there's no such thing as diverting a flight already in the air. `null`
 * only if `tail` isn't part of the active fleet at all.
 */
function currentOrUpcomingAirport(tail: string, state: SimState): { airport: string; earliestDepartMinute: number } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return null;

  if (aircraft.status === 'ground' && aircraft.atAirport) {
    return { airport: aircraft.atAirport, earliestDepartMinute: Math.max(state.simMinute, aircraft.groundSinceMinute + MIN_TURN_MINUTES) };
  }

  const activeFlight = state.activeFlights.find((f) => f.tail === tail);
  if (activeFlight) {
    return { airport: activeFlight.dest, earliestDepartMinute: activeFlight.arriveMinute + MIN_TURN_MINUTES };
  }

  return null;
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
  hideRouteHoverTooltip();
}

/**
 * If the Fleet panel's selection (ui/fleetSelection.ts) has moved on to a
 * different tail — or been cleared — since the current gesture armed,
 * cancel it rather than let it finish for the wrong plane, or for none at
 * all. Cheap enough to call from every entry point that might notice a
 * change (a mousedown, or every render via drawRoutePreview()) rather
 * than needing panels.ts to reach into this module directly, which would
 * create a circular import between the two (routeBuilder.ts already
 * imports from panels.ts the other way).
 */
function cancelIfTailChanged(): void {
  if (builderState.mode !== 'idle' && builderState.tail !== getSelectedTail()) {
    reset();
  }
}

/**
 * Handle a canvas mousedown *before* main.ts's own pan-drag logic does.
 * Returns true when the route builder consumed the click (armed a new
 * route, confirmed one, or cancelled a pending one) — main.ts should skip
 * starting a pan in that case. Returns false to mean "not mine, go ahead
 * and pan as usual."
 */
export function handleRouteBuilderMouseDown(event: MouseEvent, state: SimState): boolean {
  cancelIfTailChanged();
  const clicked = findNearestAirport(event.clientX, event.clientY);

  if (builderState.mode === 'idle') {
    // Week three: a plane has to be selected (Fleet panel) before the map
    // will arm anything — drawing a route with no idea which plane it's
    // for was the whole gap this closes. No tail selected just means
    // "not our gesture," same as clicking empty water always has.
    const tail = getSelectedTail();
    if (!tail || !clicked) return false;
    builderState = { mode: 'armed', origin: clicked, tail };
    setArmedCursor(true);
    return true;
  }

  if (builderState.mode === 'armed') {
    if (clicked && clicked.iata === builderState.origin.iata) {
      reset(); // re-clicking the origin cancels
      return true;
    }
    if (clicked) {
      showForm(builderState.origin, clicked, state);
      builderState = { mode: 'confirming', origin: builderState.origin, dest: clicked, tail: builderState.tail };
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
 * the map the way an unconditional call would. Also shows/hides the
 * PDEW/CAP hover tooltip (week four) for whichever airport `candidate`
 * snaps to, so that reading is visible before the second click confirms
 * anything.
 */
export function handleRouteBuilderMouseMove(event: MouseEvent, state: SimState): boolean {
  if (builderState.mode !== 'armed') return false;
  const geo = projection.invert?.([event.clientX, event.clientY]);
  if (!geo) return false;
  previewGeo = geo;
  candidate = findNearestAirport(event.clientX, event.clientY);

  if (candidate && candidate.iata !== builderState.origin.iata) {
    showRouteHoverTooltip(builderState.origin, candidate, event.clientX, event.clientY, state);
  } else {
    hideRouteHoverTooltip();
  }

  return true;
}

/** Escape cancels an armed or pending route from anywhere. */
export function handleRouteBuilderKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && builderState.mode !== 'idle') {
    reset();
  }
}

/**
 * Draw the live preview arc, origin/candidate highlight rings, and (week
 * three) the selected plane's range ring. Called from main.ts's render(),
 * same as every other canvas layer — reads this module's own transient
 * state plus `state.aircraft` (to look up the armed tail's aircraft type),
 * drawn above everything else so it's never hidden behind the basemap or
 * a route.
 */
export function drawRoutePreview(ctx: CanvasRenderingContext2D, state: SimState): void {
  cancelIfTailChanged();
  if (builderState.mode === 'idle') return;

  const { origin, tail } = builderState;

  // The range ring is a true geodesic circle (d3.geoCircle()), not a flat
  // pixel circle — this map's Mercator projection distorts distance by
  // latitude, so a naive on-screen circle would lie about how far the
  // plane can actually reach. Radius is in degrees of arc; 60nm per
  // degree is exact (it's the definition of a nautical mile), not an
  // approximation the way the cost/demand model's constants are.
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  if (type) {
    const path = geoPath(projection, ctx);
    const circle = geoCircle().center([origin.lon, origin.lat]).radius(type.rangeNm / 60)();
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = RANGE_RING_STROKE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    path(circle);
    ctx.stroke();
    ctx.restore();
  }

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

const formSection = document.querySelector<HTMLElement>('#new-route-popover')!;
const formHeading = document.querySelector<HTMLElement>('#new-route-heading')!;
const formLabel = document.querySelector<HTMLElement>('#new-route-label')!;
const formBlock = document.querySelector<HTMLElement>('#new-route-block')!;
const formPdew = document.querySelector<HTMLElement>('#new-route-pdew')!;
const formError = document.querySelector<HTMLElement>('#new-route-error')!;
const formTailLabel = document.querySelector<HTMLElement>('#new-route-tail-label')!;
const formDepartInput = document.querySelector<HTMLInputElement>('#new-route-depart')!;
const formReturnCheckbox = document.querySelector<HTMLInputElement>('#new-route-return')!;
const formReturnPreview = document.querySelector<HTMLElement>('#new-route-return-preview')!;
const formPositioningPreview = document.querySelector<HTMLElement>('#new-route-positioning-preview')!;
const formConfirmButton = document.querySelector<HTMLButtonElement>('#new-route-confirm')!;
const formCancelButton = document.querySelector<HTMLButtonElement>('#new-route-cancel')!;

// A tail's first leg of the day, with nothing yet on its schedule to
// slot in behind — matches data/schedule.json's own convention (every
// preset tail's day starts around 06:00–07:00), not an arbitrary pick.
const MORNING_DEPART_TIME = '07:00';

/**
 * What depart time to suggest when the form opens — always overridable,
 * never the only option, but "always defaults to noon regardless of
 * context" was the whole complaint this replaces. Two cases:
 *
 * - `tail` already has legs, and the chronologically *last* one of its
 *   day lands at this route's `origin` — suggest right after that
 *   arrival (`defaultReturnDepartMinute()`, the same "land, then this
 *   much turn buffer" formula the auto-generated return leg already
 *   uses), so a route drawn to continue a tail's day slots in behind
 *   its last flight instead of defaulting to an unrelated fixed hour.
 * - Anything else (no legs yet — a fresh pool aircraft's first route —
 *   or an origin that doesn't match where the tail's day currently
 *   ends) — suggest the morning default. A mismatched origin needs a
 *   positioning leg anyway (see currentOrUpcomingAirport()), so there's
 *   no single "right after" time to suggest for it.
 */
function suggestedDepartTime(origin: Airport, tail: string, state: SimState): string {
  const tailLegs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  const lastLeg = tailLegs[tailLegs.length - 1];
  if (lastLeg && lastLeg.dest === origin.iata) {
    return minuteOfDayToTimeString(defaultReturnDepartMinute(lastLeg.departMinute, lastLeg.blockMinutes));
  }
  return MORNING_DEPART_TIME;
}

// Week six: the form used to be a fixed section in the sidebar, always in
// the same place regardless of where on the map the route actually was.
// Now it's a small floating popover, Google-Maps-info-window-style,
// anchored to the destination airport that was just clicked — appearing
// right where you're actively working instead of off in a side panel.
const POPOVER_OFFSET_PX = 16;

/**
 * Position the popover near (screenX, screenY) — the destination
 * airport's own projected point, not the raw click position, so it
 * anchors to the place rather than to wherever the cursor happened to be
 * within the snap radius. Corrected *after* an initial placement, not
 * computed once up front, since the form's own height varies with its
 * content (an error message, the positioning-leg preview) — a route drawn
 * near the right or bottom edge of the screen would otherwise render
 * partly off it.
 */
function positionPopover(screenX: number, screenY: number): void {
  formSection.style.left = `${screenX + POPOVER_OFFSET_PX}px`;
  formSection.style.top = `${screenY + POPOVER_OFFSET_PX}px`;

  const rect = formSection.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0) formSection.style.left = `${screenX + POPOVER_OFFSET_PX - overflowX - 8}px`;
  if (overflowY > 0) formSection.style.top = `${screenY + POPOVER_OFFSET_PX - overflowY - 8}px`;
}

function showForm(origin: Airport, dest: Airport, state: SimState): void {
  formHeading.textContent = isExistingMarket(origin.iata, dest.iata, state.schedule) ? 'New Frequency' : 'New Route';
  formLabel.textContent = `${origin.iata} → ${dest.iata}`;
  // Week three: the tail was already chosen (Fleet panel) before this
  // route was even armed, so it's shown here read-only, not re-picked.
  const tail = getSelectedTail() ?? '';
  const aircraftForBlock = state.aircraft.find((a) => a.tail === tail);
  const typeForBlock = aircraftForBlock ? aircraftTypesByCode.get(aircraftForBlock.typeCode) : undefined;
  formBlock.textContent = `Block time: ${computeBlockMinutes(origin.iata, dest.iata, typeForBlock?.cruiseKts)} min`;
  formTailLabel.textContent = tail;
  formSection.hidden = false;
  // The armed-state hover tooltip (PDEW/CAP for the candidate) has nothing
  // left to add once the form itself is showing the same numbers, and the
  // general airport/market hover tooltip (whatever was last hovered on
  // the way to this click) has even less reason to still be up — now
  // that both float near the same map point instead of one living safely
  // in the sidebar, leaving either up would just mean it overlapping the
  // form.
  hideRouteHoverTooltip();
  hideCompetitionTooltip();

  // Suggest a time rather than always resetting to a fixed default —
  // see suggestedDepartTime() above. Still always overridable, and still
  // reset every time the form opens rather than leaving whatever time a
  // *previous* route's form was left at: a leftover time from an
  // unrelated earlier route could otherwise silently collide with an
  // existing leg on this new market and block the Add button with no
  // obvious reason why — exactly what happened creating a second
  // YSJ-YQB frequency after leaving the input at 13:00 from an earlier
  // route.
  formDepartInput.value = suggestedDepartTime(origin, tail, state);
  // Defaults to checked every time the form opens, same reasoning as
  // resetting the depart time below: adding a route almost always means
  // "and back," and this is what stops a leg like this session's C-GVIA
  // YYG->YHZ from getting created alone, with nothing to fly the aircraft
  // back into its own rotation.
  formReturnCheckbox.checked = true;
  updateFormValidation(origin, dest, state);

  // Positioned last, after updateFormValidation() above has already set
  // the return-leg/positioning-leg preview text (and possibly an error
  // message) — the popover's real height depends on which of those are
  // showing, so measuring it any earlier (e.g., right after `hidden =
  // false`) would clamp against a shorter box than what's actually about
  // to render, and it could still spill past the bottom of the screen.
  const destPoint = projection([dest.lon, dest.lat]);
  if (destPoint) positionPopover(destPoint[0], destPoint[1]);

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
 * about to create before they click Add Route. Also shows a positioning-
 * leg preview (week three) whenever the currently selected tail isn't
 * standing at `origin` — see currentOrUpcomingAirport() — so the player
 * knows *before* confirming that this route won't start earning revenue
 * immediately, and why: a real, costed repositioning flight is happening
 * first, not a bug.
 */
function updateFormValidation(origin: Airport, dest: Airport, state: SimState): void {
  // Defensive fallback — arming now requires a tail to already be
  // selected (ui/fleetSelection.ts), so this shouldn't be reachable in
  // practice, but the message stays accurate if it somehow is.
  const tail = getSelectedTail();
  if (!tail || state.aircraft.length === 0) {
    formError.textContent = 'Buy or lease an aircraft first — see Fleet under the Reports menu.';
    formConfirmButton.disabled = true;
    formPdew.textContent = '';
    formReturnPreview.textContent = '';
    formPositioningPreview.textContent = '';
    return;
  }

  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  // Week four's PDEW/CAP readout: the un-minmaxed demand-vs-capacity
  // ceiling for this market, shown even if the checks below end up
  // blocking this specific attempt — still useful context for a market
  // you might come back and draw differently. `newFrequency` is the
  // existing schedule's frequency on this market *plus* what this
  // confirm would add (1 leg, or 2 if the return checkbox is on) — the
  // same denominator sim/economy.ts's flightResult() divides the
  // market's demand by, just read before committing instead of after, so
  // this can never drift from what the flight would actually carry once
  // it's flying. CAP is the plane's raw seat count, not the load-factor-
  // adjusted ceiling — the whole point is showing the number *before*
  // any of the fare/yield/competition knobs apply, which is what
  // "un-minmaxed" means here.
  if (type) {
    const existingFrequency = legsServingMarket(origin.iata, dest.iata, state.schedule);
    const newFrequency = existingFrequency + (formReturnCheckbox.checked ? 2 : 1);
    const pdew = Math.round(actualDailyDemand(state, origin.iata, dest.iata) / newFrequency);
    const potentialPdew = Math.round(currentPotentialDemand(state, origin.iata, dest.iata) / newFrequency);
    // A suppressed market (sim/demand.ts) carries nobody. Deliberately
    // still buildable — the restriction is soft — but saying so plainly
    // beats letting someone discover it from an empty P&L.
    const suppressed = suppressedMarketReason(origin.iata, dest.iata);
    formPdew.textContent = suppressed
      ? `No market: ${suppressed}`
      : potentialPdew > pdew
        ? `PDEW: ${pdew} now → ${potentialPdew} potential  CAP: ${type.seats}`
        : `PDEW: ${pdew}  CAP: ${type.seats}`;
    // See the hover tooltip's own note: thin is judged on potential, not
    // on what the market happens to carry before anyone has built it.
    formPdew.classList.toggle('thin-market', potentialPdew < type.seats);
  } else {
    formPdew.textContent = '';
  }

  // Grow the network one airport at a time: a new route's origin has to
  // already be somewhere the player flies — reaching a brand-new airport
  // only happens as a *destination*, which is what lets it join the
  // network for the next route to start from. An empty network (the very
  // first route of the game) is exempt, since nothing could possibly be
  // "already in" it yet.
  const network = networkAirports(state.schedule);
  if (network.size > 0 && !network.has(origin.iata)) {
    formError.textContent = `${origin.iata} isn't in your network yet — a new route has to start from an airport you already fly to. Fly there as a destination first, then routes can start from it.`;
    formConfirmButton.disabled = true;
    formReturnPreview.textContent = '';
    formPositioningPreview.textContent = '';
    return;
  }

  // Week six: departures from a slot-controlled airport need slots to
  // put them in. Same "hard block, plain message" shape as the network
  // check above — you can buy more in the Airports tab, so this is a
  // constraint with a purchasable answer rather than a dead end. Both
  // ends are checked, since a return leg departs from the destination.
  const addingReturn = formReturnCheckbox.checked;
  for (const [airport, departuresAdded] of [
    [origin.iata, 1],
    [dest.iata, addingReturn ? 1 : 0],
  ] as [string, number][]) {
    if (departuresAdded === 0 || !isSlotControlled(airport)) continue;
    if (remainingSlotCapacity(state, airport) >= departuresAdded) continue;
    formError.textContent =
      `${airport} is slot-controlled and you hold ${slotsOwned(state, airport)} of ${slotsTotal(airport)} slots, ` +
      `all in use. Buy another in the Airports tab before adding a departure here.`;
    formConfirmButton.disabled = true;
    formReturnPreview.textContent = '';
    formPositioningPreview.textContent = '';
    return;
  }

  // Week three: a route beyond the selected plane's real range (see the
  // ring drawn in drawRoutePreview()) is flatly impossible, not just
  // inadvisable — same "hard block, plain message" shape as the network
  // check above.
  if (type) {
    const distanceNm = greatCircleDistanceNm(origin, dest);
    if (distanceNm > type.rangeNm) {
      formError.textContent = `${dest.iata} is ${Math.round(distanceNm)} nm from ${origin.iata} — beyond the ${type.name}'s ${type.rangeNm} nm range with a full load.`;
      formConfirmButton.disabled = true;
      formReturnPreview.textContent = '';
      formPositioningPreview.textContent = '';
      return;
    }
  }

  // Week four: airport size constraints (Airport.maxAircraftType) are
  // just as much a hard "no" as range — a real runway or gate limit,
  // not a matter of degree — so this gets the exact same block-and-
  // explain treatment rather than just a warning.
  if (type) {
    const blockedIata = !isAircraftTypeAllowedAt(origin.iata, type.code)
      ? origin.iata
      : !isAircraftTypeAllowedAt(dest.iata, type.code)
        ? dest.iata
        : null;
    if (blockedIata) {
      formError.textContent = `${blockedIata} only takes aircraft up to a smaller size than the ${type.name} — too large to operate there.`;
      formConfirmButton.disabled = true;
      formReturnPreview.textContent = '';
      formPositioningPreview.textContent = '';
      return;
    }
  }

  const departMinute = timeStringToMinuteOfDay(formDepartInput.value);
  const blockMinutes = computeBlockMinutes(origin.iata, dest.iata, type?.cruiseKts);
  const outboundCollision = findExactTimeCollision(origin.iata, dest.iata, departMinute, state.schedule);

  let returnDepartMinute: number | null = null;
  let returnCollision: ScheduleLeg | undefined;
  if (formReturnCheckbox.checked) {
    returnDepartMinute = defaultReturnDepartMinute(departMinute, blockMinutes);
    returnCollision = findExactTimeCollision(dest.iata, origin.iata, returnDepartMinute, state.schedule);
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

  const currentPosition = currentOrUpcomingAirport(tail, state);
  if (currentPosition && currentPosition.airport !== origin.iata) {
    formPositioningPreview.textContent = `Positioning: ${tail} will fly ${currentPosition.airport} → ${origin.iata} first (${computeBlockMinutes(currentPosition.airport, origin.iata, type?.cruiseKts)} min, cost only, no passengers) before this route starts.`;
  } else if (!currentPosition) {
    // A Fleet Market purchase with no base yet (see ui/fleetMarket.ts) —
    // deploying it here is free and immediate, not a positioning flight,
    // since it was never anywhere else to begin with.
    formPositioningPreview.textContent = `${tail} has no base yet — this route will make ${origin.iata} its new base.`;
  } else {
    formPositioningPreview.textContent = '';
  }
}

function timeStringToMinuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Wire up the confirmation form. Called once at startup, alongside
 * setupScheduleEditor() — same "build once, mutate only via events" rule,
 * for the same reason: an `<input>` the player is mid-interaction with
 * shouldn't get torn out by a periodic re-render. There's no Tail
 * dropdown to populate any more (week three) — the plane is chosen before
 * the form ever opens, via the Fleet panel (ui/fleetSelection.ts).
 *
 * Adding a route doesn't run any new rotation-fitting logic — it appends
 * the leg to state.schedule (the same array step() reads from) and
 * re-runs validateSchedule(), exactly the way editing an existing leg's
 * time already does in M8. If the chosen tail/time doesn't actually chain
 * with that tail's other legs, the same console error catches it; nothing
 * here prevents adding it anyway, on purpose, for consistency with M8 —
 * that's what `onRouteConfirmed` (M12) is for: main.ts uses it to jump the
 * player straight to the rotation board with the new leg(s) highlighted,
 * so retiming a guess that didn't land well is the very next thing that
 * happens, not something they have to notice a warning about later.
 */
export function setupRouteBuilder(state: SimState, onRouteConfirmed: (legIds: string[]) => void): void {
  // Re-check for an exact-time collision (and refresh the return-leg and
  // positioning-leg previews) every time the player changes the depart
  // time or the return checkbox, so the form reacts live instead of only
  // at submission.
  formDepartInput.addEventListener('input', () => {
    if (builderState.mode !== 'confirming') return;
    updateFormValidation(builderState.origin, builderState.dest, state);
  });
  formReturnCheckbox.addEventListener('change', () => {
    if (builderState.mode !== 'confirming') return;
    updateFormValidation(builderState.origin, builderState.dest, state);
  });

  formConfirmButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    const { origin, dest, tail } = builderState;
    const aircraftForRange = state.aircraft.find((a) => a.tail === tail);
    const typeForRange = aircraftForRange ? aircraftTypesByCode.get(aircraftForRange.typeCode) : undefined;
    const departMinute = timeStringToMinuteOfDay(formDepartInput.value);
    const blockMinutes = computeBlockMinutes(origin.iata, dest.iata, typeForRange?.cruiseKts);

    // Defensive re-checks: the button should already be disabled in
    // either case, but never add a duplicate timeslot or an impossible
    // route regardless.
    if (findExactTimeCollision(origin.iata, dest.iata, departMinute, state.schedule)) return;
    if (typeForRange && greatCircleDistanceNm(origin, dest) > typeForRange.rangeNm) return;
    if (
      typeForRange &&
      (!isAircraftTypeAllowedAt(origin.iata, typeForRange.code) || !isAircraftTypeAllowedAt(dest.iata, typeForRange.code))
    ) {
      return;
    }

    // If the chosen tail isn't standing at this route's origin, queue a
    // one-time positioning leg to get it there first — see
    // currentOrUpcomingAirport() and PositioningLeg's own comment
    // (sim/schedule.ts). This is the whole point of positioning legs
    // existing at all: describe the network you want and let the game
    // work out how to get a plane there, rather than blocking the route or
    // requiring a separate manual leg first.
    //
    // `currentPosition === null` is different: a Fleet Market purchase
    // (ui/fleetMarket.ts) that's never flown before has no base at all,
    // not merely a *different* one, so there's nothing to fly it in from.
    // Deploying it here is free and immediate — this route just becomes
    // its home base, which is also the closest thing this game has to a
    // "pick a home airport" step, arrived at implicitly rather than as a
    // separate purchase-time decision.
    const currentPosition = currentOrUpcomingAirport(tail, state);
    if (currentPosition && currentPosition.airport !== origin.iata) {
      const positioningLeg: PositioningLeg = {
        legId: nextPositioningLegId(tail, state.positioningLegs),
        tail,
        origin: currentPosition.airport,
        dest: origin.iata,
        departMinute: currentPosition.earliestDepartMinute,
        blockMinutes: computeBlockMinutes(currentPosition.airport, origin.iata, typeForRange?.cruiseKts),
      };
      state.positioningLegs.push(positioningLeg);
    } else if (!currentPosition) {
      const aircraft = state.aircraft.find((a) => a.tail === tail);
      if (aircraft) {
        aircraft.atAirport = origin.iata;
        aircraft.groundSinceMinute = state.simMinute;
      }
    }

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
    const createdLegIds = [outboundLeg.legId];

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
        createdLegIds.push(returnLeg.legId);
      }
    }

    renderScheduleWarnings(validateSchedule(state.schedule, state.aircraft, state.positioningLegs));

    // Fare/marketing are set at the market level (sim/state.ts's
    // RouteSettings), not per leg — a brand-new market gets a fresh entry
    // (policy fare, zero marketing spend); a second
    // frequency on a market that already has one reuses it unchanged,
    // rather than resetting whatever fare the player already set there.
    // marketKey() is bidirectional, so this covers the return leg too —
    // one entry for the whole market regardless of how many legs serve it.
    const key = marketKey(origin.iata, dest.iata);
    if (!state.routeSettings[key]) {
      // Priced by the airline-wide policy (sim/pricing.ts), not by bare
      // recommendedFare() — a new route should open at whatever the rest
      // of the network is charging, not silently ignore the policy and
      // need a manual correction straight after being drawn.
      state.routeSettings[key] = {
        fare: policyFare(state, origin.iata, dest.iata),
        fareIsOverridden: false,
        marketingSpend: 0,
      };
      addCommercialRow(origin.iata, dest.iata, state);
    }

    // The Route filter is already set to this exact market — see
    // showForm() — so the new row satisfies it automatically and just
    // joins whatever else is already narrowed into view.

    onRouteConfirmed(createdLegIds);
    reset();
  });

  formCancelButton.addEventListener('click', () => {
    reset();
  });
}
