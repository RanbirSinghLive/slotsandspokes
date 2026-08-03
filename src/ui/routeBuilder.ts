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
  isAircraftTypeAllowedAt,
  legsServingMarket,
  marketKey,
  MIN_TURN_MINUTES,
  networkAirports,
  nextLegId,
  type ScheduleLeg,
} from '../sim/schedule';
import {
  aircraftUtilisation,
  legUtilisationMinutes,
  USABLE_DAY_END_MINUTE,
  USABLE_DAY_MINUTES,
  USABLE_DAY_START_MINUTE,
} from '../sim/utilisation';
import { minuteOfDayToTimeString, renderScheduleWarnings, scheduleProblems } from './panels';
import { addCommercialRow } from './commercial';
import { policyFare } from '../sim/pricing';
import { getSelectedTail } from './fleetSelection';
import { hideCompetitionTooltip } from './competitionTooltip';
import type { SimState } from '../sim/state';

const HIT_RADIUS_PX = 14;
const RING_RADIUS = 8;
const PREVIEW_STROKE = '#ffd166';
const CHAIN_STROKE = '#ffd166';
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
 * Assumes this candidate adds two frequencies to the market — the leg out
 * and the leg back — because the minimal rotation is exactly that
 * out-and-back, and a hovered airport isn't yet part of a chain whose
 * real leg count could be counted instead.
 */
function showRouteHoverTooltip(origin: Airport, candidate: Airport, screenX: number, screenY: number, state: SimState): void {
  const tail = getSelectedTail();
  const aircraft = tail ? state.aircraft.find((a) => a.tail === tail) : undefined;
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  routeHoverTooltipTitle.textContent = `${origin.iata} → ${candidate.iata}`;

  if (type) {
    const existingFrequency = legsServingMarket(origin.iata, candidate.iata, state.schedule);
    const newFrequency = existingFrequency + 2;
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
 *
 * Week seven (the utilisation pivot, WEEK-SEVEN.md): what gets built is
 * no longer a single leg but a **rotation** — an ordered chain of
 * airports starting and ending at the aircraft's base. `chain` holds the
 * airports agreed so far, base first; the last entry is whatever the next
 * leg departs from. "Add stop" appends the pending destination to it and
 * re-arms from there instead of confirming, so `YUL-YFC-YQM-YFC-YQM-YUL`
 * is buildable in one gesture. A plain out-and-back is just the
 * two-airport case, which is why there's no "add return leg" checkbox any
 * more — the rotation always closes back to the base.
 */
type BuilderState =
  | { mode: 'idle' }
  | { mode: 'armed'; chain: Airport[]; tail: string }
  | { mode: 'confirming'; chain: Airport[]; dest: Airport; tail: string };

let builderState: BuilderState = { mode: 'idle' };
// Only meaningful while armed: where the cursor currently is (in lon/lat,
// for drawing the preview) and which airport, if any, it's close enough to
// snap onto.
let previewGeo: [number, number] | null = null;
let candidate: Airport | null = null;

/** Where the next leg of the chain departs from — the last airport agreed so far. */
function chainOrigin(chain: Airport[]): Airport {
  return chain[chain.length - 1];
}

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
 * this model.
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
    builderState = { mode: 'armed', chain: [clicked], tail };
    setArmedCursor(true);
    return true;
  }

  if (builderState.mode === 'armed') {
    const origin = chainOrigin(builderState.chain);
    if (clicked && clicked.iata === origin.iata) {
      reset(); // re-clicking the airport the next leg departs from cancels
      return true;
    }
    if (clicked) {
      showForm(builderState.chain, clicked, state);
      builderState = { mode: 'confirming', chain: builderState.chain, dest: clicked, tail: builderState.tail };
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

  const origin = chainOrigin(builderState.chain);
  if (candidate && candidate.iata !== origin.iata) {
    showRouteHoverTooltip(origin, candidate, event.clientX, event.clientY, state);
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
 * Draw the chain agreed so far, the live preview arc, base/origin/candidate
 * highlight rings, and (week three) the selected plane's range ring.
 * Called from main.ts's render(), same as every other canvas layer — reads
 * this module's own transient state plus `state.aircraft` (to look up the
 * armed tail's aircraft type), drawn above everything else so it's never
 * hidden behind the basemap or a route.
 */
export function drawRoutePreview(ctx: CanvasRenderingContext2D, state: SimState): void {
  cancelIfTailChanged();
  if (builderState.mode === 'idle') return;

  const { chain, tail } = builderState;
  const origin = chainOrigin(chain);

  // The range ring is a true geodesic circle (d3.geoCircle()), not a flat
  // pixel circle — this map's Mercator projection distorts distance by
  // latitude, so a naive on-screen circle would lie about how far the
  // plane can actually reach. Radius is in degrees of arc; 60nm per
  // degree is exact (it's the definition of a nautical mile), not an
  // approximation the way the cost/demand model's constants are. Centred
  // on the chain's current origin, since that's where the next leg
  // actually departs from — not on the base, which may be several stops
  // back by now.
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  const path = geoPath(projection, ctx);
  if (type) {
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

  // Week seven: the legs already agreed, drawn solid so a multi-stop
  // rotation is visible as a shape on the map while it's being built —
  // the dashed arc below is only ever the one leg still being chosen.
  // While confirming, the pending destination counts as agreed for
  // drawing purposes; it's the airport the popover is anchored to, so
  // leaving it out of the line would look like a gap.
  const drawnChain = builderState.mode === 'confirming' ? [...chain, builderState.dest] : chain;
  if (drawnChain.length > 1) {
    const chainLine: LineString = {
      type: 'LineString',
      coordinates: drawnChain.map((airport) => [airport.lon, airport.lat]),
    };
    ctx.save();
    ctx.strokeStyle = CHAIN_STROKE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    path(chainLine);
    ctx.stroke();
    ctx.restore();
  }

  for (const airport of drawnChain) {
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    ctx.beginPath();
    ctx.arc(point[0], point[1], RING_RADIUS, 0, 2 * Math.PI);
    ctx.strokeStyle = airport.iata === origin.iata ? CANDIDATE_RING_STROKE : ORIGIN_RING_STROKE;
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

// --- Packing a rotation into the day (week seven) ---

/**
 * One leg of a packed rotation, before it becomes a real ScheduleLeg.
 * Same fields minus the identity ones (legId, tail), which only get
 * assigned once the player actually confirms.
 */
type PackedLeg = { origin: string; dest: string; departMinute: number; blockMinutes: number };

/** Five-minute steps, the granularity nudgeing uses to dodge an exact-time collision. */
const COLLISION_NUDGE_MINUTES = 5;
/** Enough nudging to clear a couple of hours of congestion, then give up. */
const MAX_COLLISION_NUDGES = 24;

/**
 * Walk `airports` in order, giving each leg the cursor's current time and
 * then advancing the cursor by that leg's block time plus its turn. The
 * last leg closes the loop back to `airports[0]` (the base), which is what
 * makes rotation continuity automatic — an aircraft that starts and ends
 * its day at the same place can repeat that day forever, and no
 * positioning leg is ever needed to make it work.
 *
 * A zero-length hop is skipped rather than emitted, which is what lets the
 * player click the base itself as the final stop to say "close the loop
 * here" without producing a base→base leg.
 */
function packRotation(airports: Airport[], cruiseKts: number | undefined, startMinute: number): PackedLeg[] {
  const legs: PackedLeg[] = [];
  let cursor = startMinute;
  for (let i = 0; i < airports.length; i++) {
    const from = airports[i];
    const to = airports[(i + 1) % airports.length];
    if (from.iata === to.iata) continue;
    const blockMinutes = computeBlockMinutes(from.iata, to.iata, cruiseKts);
    legs.push({ origin: from.iata, dest: to.iata, departMinute: cursor, blockMinutes });
    cursor += blockMinutes + MIN_TURN_MINUTES;
  }
  return legs;
}

/**
 * When a new rotation's day starts. The usable day opens at 06:00, but a
 * tail that already flies a rotation can only start another one after it
 * finishes the first and turns — packing every rotation from 06:00 would
 * double-book the aircraft against itself, and `validateSchedule()`'s
 * continuity check would (rightly) call that broken.
 *
 * Because every rotation ends back at the base, appending after the
 * previous one always chains cleanly: the tail lands at base, turns, and
 * departs base again.
 */
function rotationStartMinute(tail: string, state: SimState): number {
  const tailLegs = state.schedule.filter((leg) => leg.tail === tail);
  if (tailLegs.length === 0) return USABLE_DAY_START_MINUTE;
  const lastArrival = Math.max(...tailLegs.map((leg) => leg.departMinute + leg.blockMinutes));
  return Math.max(USABLE_DAY_START_MINUTE, lastArrival + MIN_TURN_MINUTES);
}

/**
 * The packed rotation, nudged later in five-minute steps until no leg
 * departs at the exact minute another tail already flies that same market
 * (findExactTimeCollision()). Auto-packing makes that collision likely
 * rather than rare — two aircraft based at the same airport, both opening
 * their day at 06:00 on the same market, would hit it every time — and
 * the player no longer authors departure times, so there is no "pick a
 * different time" for them to do. Nudging resolves it quietly instead.
 * Gives up after MAX_COLLISION_NUDGES and returns the last attempt; the
 * fit and collision checks in planRotation() then report whatever is
 * actually wrong.
 */
function packRotationAvoidingCollisions(
  airports: Airport[],
  cruiseKts: number | undefined,
  startMinute: number,
  schedule: ScheduleLeg[],
): PackedLeg[] {
  let legs = packRotation(airports, cruiseKts, startMinute);
  for (let attempt = 0; attempt < MAX_COLLISION_NUDGES; attempt++) {
    if (!legs.some((leg) => findExactTimeCollision(leg.origin, leg.dest, leg.departMinute, schedule))) return legs;
    legs = packRotation(airports, cruiseKts, startMinute + (attempt + 1) * COLLISION_NUDGE_MINUTES);
  }
  return legs;
}

/**
 * How many usable minutes the aircraft based at `baseIata` still have
 * between them. Pooled per base rather than per tail because that is the
 * level the "do I need another airframe" decision lives at (WEEK-SEVEN.md,
 * decision 1). `tail` is counted into the pool even if it is currently
 * unbased, since confirming a rotation from this base is exactly what
 * assigns it here.
 */
function baseSpareMinutes(state: SimState, baseIata: string, tail: string): number {
  const pool = state.aircraft.filter(
    (aircraft) => aircraft.baseAirport === baseIata || (aircraft.tail === tail && aircraft.baseAirport === null),
  );
  const capacityMinutes = pool.length * USABLE_DAY_MINUTES;
  const usedMinutes = pool.reduce((total, aircraft) => total + aircraftUtilisation(state, aircraft.tail).minutes, 0);
  return capacityMinutes - usedMinutes;
}

/**
 * Everything the popover needs to describe — and the confirm handler needs
 * to commit — the rotation currently being drawn. One function so the two
 * can never disagree: the old form re-derived its checks in the confirm
 * handler as a defensive second pass, which meant two copies of the same
 * rules to keep in step.
 *
 * `error` non-null hard-blocks Add Rotation. `blocksAddStop` is separate
 * because one failure is genuinely fixable by extending the chain: a
 * closing leg back to base that's beyond the aircraft's range can be
 * rescued by adding a nearer stop before it. Every other failure only gets
 * worse with more legs.
 */
type RotationPlan = {
  /** The full ordered chain including the pending destination, base first. */
  airports: Airport[];
  base: Airport;
  legs: PackedLeg[];
  /** Block plus turn for the whole rotation — what it spends of an aircraft. */
  rotationMinutes: number;
  rotationShare: number;
  spareMinutesBefore: number;
  arriveBackMinute: number;
  error: string | null;
  blocksAddStop: boolean;
};

function planRotation(chain: Airport[], dest: Airport, tail: string, state: SimState): RotationPlan {
  const base = chain[0];
  const rotationAirports = [...chain, dest];
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  const legs = packRotationAvoidingCollisions(
    rotationAirports,
    type?.cruiseKts,
    rotationStartMinute(tail, state),
    state.schedule,
  );
  const rotationMinutes = legs.reduce((total, leg) => total + legUtilisationMinutes(leg.blockMinutes), 0);
  const lastLeg = legs[legs.length - 1];
  const arriveBackMinute = lastLeg ? lastLeg.departMinute + lastLeg.blockMinutes : rotationStartMinute(tail, state);
  const spareMinutesBefore = baseSpareMinutes(state, base.iata, tail);

  const plan: RotationPlan = {
    airports: rotationAirports,
    base,
    legs,
    rotationMinutes,
    rotationShare: rotationMinutes / USABLE_DAY_MINUTES,
    spareMinutesBefore,
    arriveBackMinute,
    error: null,
    blocksAddStop: true,
  };

  const fail = (error: string, blocksAddStop = true): RotationPlan => ({ ...plan, error, blocksAddStop });

  // Week seven, decision 2: bases are assigned explicitly, never inferred
  // from wherever a route happened to start. A rotation therefore has to
  // begin at the base of the aircraft flying it — that is what lets a
  // multi-leg loop like YUL-YFC-YQM-YFC-YQM-YUL be based at one airport
  // while flying legs that never touch it.
  if (aircraft?.baseAirport && aircraft.baseAirport !== base.iata) {
    return fail(
      `${tail} is based at ${aircraft.baseAirport} — a rotation starts and ends at its base. ` +
        `Start this one from ${aircraft.baseAirport}, or change ${tail}'s base in the Fleet tab.`,
    );
  }

  // Grow the network one airport at a time: a rotation's base has to
  // already be somewhere the player flies. Only the base is checked, not
  // every stop — each later stop is reached by the leg immediately before
  // it, so the chain brings its own reachability with it. An empty network
  // (the very first rotation of the game) is exempt, since nothing could
  // possibly be "already in" it yet.
  const network = networkAirports(state.schedule);
  if (network.size > 0 && !network.has(base.iata)) {
    return fail(
      `${base.iata} isn't in your network yet — a rotation has to start from an airport you already fly to. ` +
        `Fly there as a destination first, then rotations can start from it.`,
    );
  }

  // Week six: departures from a slot-controlled airport need slots to put
  // them in. Counted across the whole chain now rather than the two ends
  // of one leg — a rotation that passes through the same slot-controlled
  // airport twice needs two slots.
  const departuresByAirport = new Map<string, number>();
  for (const leg of legs) {
    departuresByAirport.set(leg.origin, (departuresByAirport.get(leg.origin) ?? 0) + 1);
  }
  for (const [iata, departures] of departuresByAirport) {
    if (!isSlotControlled(iata)) continue;
    if (remainingSlotCapacity(state, iata) >= departures) continue;
    return fail(
      `${iata} is slot-controlled and you hold ${slotsOwned(state, iata)} of ${slotsTotal(iata)} slots, ` +
        `all in use. This rotation needs ${departures} departure${departures === 1 ? '' : 's'} there — ` +
        `buy another slot in the Airports tab first.`,
    );
  }

  if (type) {
    // Week three: a route beyond the selected plane's real range (see the
    // ring drawn in drawRoutePreview()) is flatly impossible, not just
    // inadvisable. Every leg of the chain gets checked, including the
    // closing one back to base — which is the leg a long final stop
    // quietly breaks, and the only failure a further stop can fix.
    for (const leg of legs) {
      const distanceNm = greatCircleDistanceNm(
        airportByIata(leg.origin, rotationAirports),
        airportByIata(leg.dest, rotationAirports),
      );
      if (distanceNm <= type.rangeNm) continue;
      const isClosingLeg = leg === lastLeg && leg.dest === base.iata;
      return fail(
        `${leg.dest} is ${Math.round(distanceNm)} nm from ${leg.origin} — beyond the ${type.name}'s ${type.rangeNm} nm range with a full load.` +
          (isClosingLeg ? ` Add a stop closer to ${base.iata} before closing the rotation.` : ''),
        !isClosingLeg,
      );
    }

    // Week four: airport size constraints (Airport.maxAircraftType) are
    // just as much a hard "no" as range — a real runway or gate limit,
    // not a matter of degree — so this gets the same block-and-explain
    // treatment. Checked at every airport the rotation touches.
    for (const airport of rotationAirports) {
      if (isAircraftTypeAllowedAt(airport.iata, type.code)) continue;
      return fail(`${airport.iata} only takes aircraft up to a smaller size than the ${type.name} — too large to operate there.`);
    }
  }

  // Week seven: the fit check that replaces the Gantt. The rotation has to
  // land back at base inside the usable day (06:00–22:00). When it doesn't,
  // the useful thing to say is whether the *base* has room even though this
  // tail doesn't — the pooled figure is what decides "another aircraft, or
  // a shorter rotation?", and a pooled check of its own would never fire
  // separately (a rotation that fits one tail's day always fits its base's
  // pool, since the pool contains that tail).
  if (arriveBackMinute > USABLE_DAY_END_MINUTE) {
    const spareAfter = (spareMinutesBefore - rotationMinutes) / USABLE_DAY_MINUTES;
    return fail(
      `This rotation lands back at ${base.iata} at ${minuteOfDayToTimeString(arriveBackMinute)}, past the ${minuteOfDayToTimeString(USABLE_DAY_END_MINUTE)} end of ${tail}'s usable day. ` +
        (spareAfter >= 0
          ? `${base.iata} still has ${spareAfter.toFixed(2)} of an aircraft spare — put this on another tail based there.`
          : `${base.iata} has no spare aircraft left either — shorten the rotation, or buy another airframe.`),
    );
  }

  // Anything still colliding after packRotationAvoidingCollisions() gave
  // up. Rare, and not something the player can retime any more, so it says
  // what it is rather than asking for a different time.
  const collision = legs
    .map((leg) => findExactTimeCollision(leg.origin, leg.dest, leg.departMinute, state.schedule))
    .find((leg) => leg !== undefined);
  if (collision) {
    return fail(
      `${collision.tail} already departs ${collision.origin} for ${collision.dest} at every minute this rotation could use (${collision.legId}). Thin out that market first.`,
    );
  }

  return { ...plan, error: null, blocksAddStop: false };
}

/**
 * Look an Airport back up from a packed leg's IATA code. Every leg is
 * built from a consecutive pair in the chain, so the chain always
 * contains both of its endpoints — this never misses.
 */
function airportByIata(iata: string, chain: Airport[]): Airport {
  return chain.find((airport) => airport.iata === iata)!;
}

// --- The confirmation form (real DOM, per CLAUDE.md's panel rule) ---

const formSection = document.querySelector<HTMLElement>('#new-route-popover')!;
const formHeading = document.querySelector<HTMLElement>('#new-route-heading')!;
const formLabel = document.querySelector<HTMLElement>('#new-route-label')!;
const formBlock = document.querySelector<HTMLElement>('#new-route-block')!;
const formPdew = document.querySelector<HTMLElement>('#new-route-pdew')!;
const formError = document.querySelector<HTMLElement>('#new-route-error')!;
const formTailLabel = document.querySelector<HTMLElement>('#new-route-tail-label')!;
const formUtilisation = document.querySelector<HTMLElement>('#new-route-utilisation')!;
const formPositioningPreview = document.querySelector<HTMLElement>('#new-route-positioning-preview')!;
const formAddStopButton = document.querySelector<HTMLButtonElement>('#new-route-add-stop')!;
const formConfirmButton = document.querySelector<HTMLButtonElement>('#new-route-confirm')!;
const formCancelButton = document.querySelector<HTMLButtonElement>('#new-route-cancel')!;

/** "4h 05m" — rotation lengths read better in hours than in three-digit minutes. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${String(remainder).padStart(2, '0')}m` : `${remainder}m`;
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

function showForm(chain: Airport[], dest: Airport, state: SimState): void {
  const origin = chainOrigin(chain);
  formHeading.textContent =
    chain.length > 1
      ? 'Rotation'
      : isExistingMarket(origin.iata, dest.iata, state.schedule)
        ? 'New Frequency'
        : 'New Rotation';
  // Week three: the tail was already chosen (Fleet panel) before this
  // route was even armed, so it's shown here read-only, not re-picked.
  formTailLabel.textContent = getSelectedTail() ?? '';
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

  updateFormValidation(chain, dest, state);

  // Positioned last, after updateFormValidation() above has already set
  // the utilisation/positioning preview text (and possibly an error
  // message) — the popover's real height depends on which of those are
  // showing, so measuring it any earlier (e.g., right after `hidden =
  // false`) would clamp against a shorter box than what's actually about
  // to render, and it could still spill past the bottom of the screen.
  const destPoint = projection([dest.lon, dest.lat]);
  if (destPoint) positionPopover(destPoint[0], destPoint[1]);

}

function hideForm(): void {
  formSection.hidden = true;
}

/**
 * Render everything planRotation() worked out: the chain, what it spends
 * of an aircraft, what the base has left, the PDEW/CAP read for the leg
 * being added, and any hard block. Nothing here decides anything — the
 * rules all live in planRotation(), so the popover and the confirm handler
 * can't drift apart.
 */
function updateFormValidation(chain: Airport[], dest: Airport, state: SimState): void {
  const origin = chainOrigin(chain);

  // Defensive fallback — arming now requires a tail to already be
  // selected (ui/fleetSelection.ts), so this shouldn't be reachable in
  // practice, but the message stays accurate if it somehow is.
  const tail = getSelectedTail();
  if (!tail || state.aircraft.length === 0) {
    formLabel.textContent = `${origin.iata} → ${dest.iata}`;
    formBlock.textContent = '';
    formError.textContent = 'Buy or lease an aircraft first — see Fleet under the Reports menu.';
    formConfirmButton.disabled = true;
    formAddStopButton.disabled = true;
    formPdew.textContent = '';
    formUtilisation.textContent = '';
    formPositioningPreview.textContent = '';
    return;
  }

  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  const plan = planRotation(chain, dest, tail, state);

  // The chain as the player sees it, always ending back where it started —
  // the closing leg is implicit in the gesture, so showing it here is how
  // they know it's coming.
  const routeIatas = plan.airports.map((airport) => airport.iata);
  if (routeIatas[routeIatas.length - 1] !== plan.base.iata) routeIatas.push(plan.base.iata);
  formLabel.textContent = routeIatas.join(' → ');

  const firstLeg = plan.legs[0];
  formBlock.textContent = firstLeg
    ? `${plan.legs.length} leg${plan.legs.length === 1 ? '' : 's'} · ${formatDuration(plan.rotationMinutes)} · ` +
      `${minuteOfDayToTimeString(firstLeg.departMinute)}–${minuteOfDayToTimeString(plan.arriveBackMinute)}`
    : '';

  // Week four's PDEW/CAP readout, for the leg being added right now: the
  // un-minmaxed demand-vs-capacity ceiling for that market, shown even if
  // the checks below end up blocking this specific attempt — still useful
  // context for a market you might come back and draw differently.
  // `newFrequency` is the existing schedule's frequency on this market
  // *plus* however many of this rotation's own legs serve it (a rotation
  // that shuttles YFC↔YQM twice adds four) — the same denominator
  // sim/economy.ts's flightResult() divides the market's demand by, just
  // read before committing instead of after, so this can never drift from
  // what the flight would actually carry once it's flying. CAP is the
  // plane's raw seat count, not the load-factor-adjusted ceiling — the
  // whole point is showing the number *before* any of the
  // fare/yield/competition knobs apply.
  if (type) {
    const fromThisRotation = plan.legs.filter(
      (leg) =>
        (leg.origin === origin.iata && leg.dest === dest.iata) || (leg.origin === dest.iata && leg.dest === origin.iata),
    ).length;
    const newFrequency = legsServingMarket(origin.iata, dest.iata, state.schedule) + Math.max(fromThisRotation, 1);
    const pdew = Math.round(actualDailyDemand(state, origin.iata, dest.iata) / newFrequency);
    const potentialPdew = Math.round(currentPotentialDemand(state, origin.iata, dest.iata) / newFrequency);
    // A suppressed market (sim/demand.ts) carries nobody. Deliberately
    // still buildable — the restriction is soft — but saying so plainly
    // beats letting someone discover it from an empty P&L.
    const suppressed = suppressedMarketReason(origin.iata, dest.iata);
    formPdew.textContent = suppressed
      ? `${origin.iata}–${dest.iata}: no market — ${suppressed}`
      : potentialPdew > pdew
        ? `${origin.iata}–${dest.iata} PDEW: ${pdew} now → ${potentialPdew} potential  CAP: ${type.seats}`
        : `${origin.iata}–${dest.iata} PDEW: ${pdew}  CAP: ${type.seats}`;
    // See the hover tooltip's own note: thin is judged on potential, not
    // on what the market happens to carry before anyone has built it.
    formPdew.classList.toggle('thin-market', potentialPdew < type.seats);
  } else {
    formPdew.textContent = '';
    formPdew.classList.remove('thin-market');
  }

  // Week seven's headline: what this rotation costs in aeroplane, and what
  // the base has left afterwards. Spare is reported in aircraft rather
  // than minutes because that's the number that answers "is another
  // airframe worth it" — see sim/utilisation.ts's BaseUtilisation.
  const spareBefore = plan.spareMinutesBefore / USABLE_DAY_MINUTES;
  const spareAfter = (plan.spareMinutesBefore - plan.rotationMinutes) / USABLE_DAY_MINUTES;
  formUtilisation.textContent =
    `Uses ${Math.round(plan.rotationShare * 100)}% of an aircraft — ` +
    `${plan.base.iata} has ${spareBefore.toFixed(2)} spare, ${spareAfter.toFixed(2)} after this.`;

  formError.textContent = plan.error ?? '';
  formConfirmButton.disabled = plan.error !== null;
  formAddStopButton.disabled = plan.blocksAddStop;

  // Suppressed while blocked: the error is the only thing worth reading
  // in that state.
  formPositioningPreview.textContent =
    !plan.error && aircraft && !aircraft.baseAirport
      ? `${tail} has no base yet — this rotation will make ${plan.base.iata} its base.`
      : '';
}

/**
 * Wire up the confirmation form. Called once at startup, alongside
 * setupScheduleEditor() — same "build once, mutate only via events" rule,
 * for the same reason: an `<input>` the player is mid-interaction with
 * shouldn't get torn out by a periodic re-render. There's no Tail
 * dropdown to populate (week three — the plane is chosen before the form
 * ever opens, via the Fleet panel), and as of week seven no depart-time
 * input either: the rotation is packed into the day automatically, so
 * there is no time left for the player to author.
 */
export function setupRouteBuilder(state: SimState, onRouteConfirmed: (legIds: string[]) => void): void {
  // "Add stop" (WEEK-SEVEN.md, decision 6): take the pending destination
  // into the chain and re-arm from it, rather than confirming. The form
  // closes and the gesture goes back to armed, so the next click picks the
  // stop after this one — repeat as many times as the day has room for.
  formAddStopButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    builderState = { mode: 'armed', chain: [...builderState.chain, builderState.dest], tail: builderState.tail };
    previewGeo = null;
    candidate = null;
    hideForm();
    setArmedCursor(true);
  });

  formConfirmButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    const { chain, dest, tail } = builderState;
    const plan = planRotation(chain, dest, tail, state);
    // The button is already disabled in this case — this is the same
    // rules, not a second copy of them, so it can't drift.
    if (plan.error || plan.legs.length === 0) return;

    const aircraft = state.aircraft.find((a) => a.tail === tail);

    // Week seven, decision 2: an aircraft's base is explicit state, not
    // something inferred from its legs. An unbased airframe gets based
    // here by flying its first rotation from here — the closest thing the
    // game has to a "pick a home airport" step, and the only place a base
    // is set other than the Fleet tab's own dropdown.
    if (aircraft && !aircraft.baseAirport) aircraft.baseAirport = plan.base.iata;

    // Phase C removed positioning legs. A rotation ends where it began, so
    // a tail is always already at its base by the time it could fly
    // another one — the only tail that isn't is one taking its *first*
    // rotation, which is either a Fleet Market airframe that has never
    // been anywhere (atAirport null) or one left parked after its previous
    // rotations were removed. Placing it at the base is honest for both:
    // there's no revenue day being skipped and nothing to fly it in from.
    // A based tail whose legs start somewhere else is a different problem
    // and stays one — validateSchedule()'s stranded check reports it.
    if (aircraft && aircraft.status === 'ground' && !state.schedule.some((leg) => leg.tail === tail)) {
      aircraft.atAirport = plan.base.iata;
      aircraft.groundSinceMinute = state.simMinute;
    }

    const createdLegIds: string[] = [];
    // Keyed bidirectionally (marketKey) so out and back collapse to one
    // entry, but holding the leg itself so the Commercial row is created
    // in the direction the rotation actually flies rather than in
    // alphabetical order.
    const marketsTouched = new Map<string, PackedLeg>();
    for (const packed of plan.legs) {
      const leg: ScheduleLeg = {
        legId: nextLegId(tail, state.schedule),
        tail,
        origin: packed.origin,
        dest: packed.dest,
        departMinute: packed.departMinute,
        blockMinutes: packed.blockMinutes,
      };
      state.schedule.push(leg);
      createdLegIds.push(leg.legId);
      const key = marketKey(packed.origin, packed.dest);
      if (!marketsTouched.has(key)) marketsTouched.set(key, packed);
    }

    renderScheduleWarnings(scheduleProblems(state));

    // Fare/marketing are set at the market level (sim/state.ts's
    // RouteSettings), not per leg — a brand-new market gets a fresh entry
    // (policy fare, zero marketing spend); a rotation touching a market
    // that already has one reuses it unchanged, rather than resetting
    // whatever fare the player already set there. marketKey() is
    // bidirectional, so out and back share one entry.
    for (const [key, leg] of marketsTouched) {
      if (state.routeSettings[key]) continue;
      // Priced by the airline-wide policy (sim/pricing.ts), not by bare
      // recommendedFare() — a new route should open at whatever the rest
      // of the network is charging, not silently ignore the policy and
      // need a manual correction straight after being drawn.
      state.routeSettings[key] = {
        fare: policyFare(state, leg.origin, leg.dest),
        fareIsOverridden: false,
        marketingSpend: 0,
      };
      addCommercialRow(leg.origin, leg.dest, state);
    }

    onRouteConfirmed(createdLegIds);
    reset();
  });

  formCancelButton.addEventListener('click', () => {
    reset();
  });
}
