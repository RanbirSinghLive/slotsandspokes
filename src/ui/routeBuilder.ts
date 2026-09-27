import { geoCircle, geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import aircraftTypesData from '../../data/aircraft-types.json';
import { projection } from '../render/projection';
import { airports, findNearestAirport, type Airport } from '../render/airports';
import { greatCircleDistanceNm } from '../sim/geo';
import { demandAgainstSeats, marketSize, neverFills } from '../sim/marketSize';
import { suppressedMarketReason } from '../sim/demand';
import { nextSlotFees, type SlotQuote } from '../sim/slots';
import { legsServingMarket, type ScheduleLeg } from '../sim/schedule';
import { USABLE_DAY_MINUTES } from '../sim/utilisation';
import { applyRotation, autoPickTail, planRotation, type RotationPlan } from '../sim/rotations';
import { minuteOfDayToTimeString, renderScheduleWarnings, scheduleProblems } from './panels';
import { hideCompetitionTooltip } from './competitionTooltip';
import type { SimState } from '../sim/state';

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
 * The same market read updateFormValidation() gives (see its own
 * comment), for a candidate that hasn't been clicked yet.
 * Assumes this candidate adds two frequencies to the market — the leg out
 * and the leg back — because the minimal rotation is exactly that
 * out-and-back, and a hovered airport isn't yet part of a chain whose
 * real leg count could be counted instead.
 */
function showRouteHoverTooltip(
  origin: Airport,
  candidate: Airport,
  base: Airport,
  screenX: number,
  screenY: number,
  state: SimState,
): void {
  const tail = activeTail(state, candidate);
  const aircraft = tail ? state.aircraft.find((a) => a.tail === tail) : undefined;
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  routeHoverTooltipTitle.textContent = `${origin.iata} → ${candidate.iata}`;

  if (type) {
    const existingFrequency = legsServingMarket(origin.iata, candidate.iata, state.schedule);
    const newFrequency = existingFrequency + 2;
    const distanceNm = greatCircleDistanceNm(origin, candidate);
    const outOfRange = distanceNm > type.rangeNm;

    // The market in words (sim/marketSize.ts): how big the city pair is,
    // and whether this plane would fill today. The numbers stay hidden;
    // the player learns them by flying.
    const suppressed = suppressedMarketReason(origin.iata, candidate.iata);
    const fill = demandAgainstSeats(state, origin.iata, candidate.iata, newFrequency, type.seats);
    const pdewText = suppressed
      ? 'No market — same city'
      : `${marketSize(state, origin.iata, candidate.iata)} market · ${type.seats} seats, ${fill.words}`;

    // A stop can be comfortably in range from here and still be a dead
    // end, because the rotation has to get *home*: the range ring is drawn
    // around this leg's origin, so it says nothing about whether the base
    // is reachable from the far side. Warning here, on hover, is the only
    // place that reading can arrive before the click that needs it —
    // otherwise the first sign is the confirm button refusing, naming a
    // leg the player never drew. Not fatal, and deliberately not phrased
    // as though it were: another stop on the way back closes the loop,
    // which is exactly what "Add stop" is for.
    const homeNm = greatCircleDistanceNm(candidate, base);
    const cannotGetHome = !outOfRange && candidate.iata !== base.iata && homeNm > type.rangeNm;

    routeHoverTooltipBody.textContent = outOfRange
      ? `${pdewText} — out of range (${Math.round(distanceNm)} nm)`
      : cannotGetHome
        ? `${pdewText} — ${base.iata} is ${Math.round(homeNm)} nm back, too far to close directly; needs another stop`
        : `${pdewText}  ·  ${candidate.iata} ${nextSlotText(state, candidate.iata)}`;
    routeHoverTooltipBody.classList.toggle('out-of-range', outOfRange);
    routeHoverTooltipBody.classList.toggle('needs-another-stop', cannotGetHome);
    // Thin now means "can never fill this aircraft even fully grown" —
    // testing today's actual instead would fire on virtually every market
    // in the early game, since they all start at the virgin floor, and a
    // warning that's always on is no warning at all.
    routeHoverTooltipBody.classList.toggle('thin-market', !outOfRange && neverFills(state, origin.iata, candidate.iata, newFrequency, type.seats));
  } else {
    routeHoverTooltipBody.textContent = '';
    routeHoverTooltipBody.classList.remove('out-of-range', 'thin-market', 'needs-another-stop');
  }

  routeHoverTooltip.hidden = false;
  routeHoverTooltip.style.left = `${screenX + 16}px`;
  routeHoverTooltip.style.top = `${screenY + 16}px`;
}

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * The slot line for a rotation or a flight: which new slot pairs it takes
 * and what each costs a day. Shared with the route card's add-flight
 * button (ui/mapMenu.ts) so both say it the same way.
 */
export function describeSlotQuotes(quotes: SlotQuote[]): string {
  const priced = quotes.filter((quote) => quote.fees.length > 0);
  if (priced.length === 0) return 'Slots: already held.';
  const parts = priced.map((quote) => {
    const total = quote.fees.reduce((sum, fee) => sum + fee, 0);
    const count = quote.fees.length > 1 ? `${quote.fees.length} pairs ` : '';
    return `${quote.iata} ${count}${total === 0 ? 'free' : `${money(total)}/day`}`;
  });
  return `New slots: ${parts.join(', ')}.`;
}

/** What the next slot pair at an airport would cost, for the hover tooltip. */
function nextSlotText(state: SimState, iata: string): string {
  const [fee] = nextSlotFees(state, iata, 1);
  if (fee === null) return 'no slots left';
  return fee === 0 ? 'slot free' : `slot ${money(fee)}/day`;
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
 * The route-creation gesture: arm from an airport (the map menu's Route
 * button, ui/mapMenu.ts), move the mouse (no need to hold the button) to
 * draw a live preview toward the cursor, and click a second airport to
 * confirm. `idle`/`armed`/`confirming` is the whole state machine; nothing
 * here is part of SimState, since it's transient interaction state, not
 * simulated-world state. Nobody names a plane: autoPickTail() chooses one
 * once the destination is known, so the player never sees a tail.
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
  | { mode: 'armed'; chain: Airport[] }
  | { mode: 'confirming'; chain: Airport[]; dest: Airport };

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


/** The plane the gesture in progress will use. */
function activeTail(state: SimState, dest: Airport | null): string | null {
  if (builderState.mode === 'idle') return null;
  return autoPickTail(state, builderState.chain, dest);
}

/**
 * Arm the route builder from `airport`: used by the map menu's Route
 * button (ui/mapMenu.ts). Everything downstream (preview, "add stop",
 * capacity/range validation on confirm) lives in the armed state.
 */
/** Whether a route is being drawn, in which case the route builder owns the pointer. */
export function isRouteBuilderActive(): boolean {
  return builderState.mode !== 'idle';
}

export function armRouteBuilderAt(airport: Airport): void {
  builderState = { mode: 'armed', chain: [airport] };
  setArmedCursor(true);
}

/**
 * Open the route form for `origin` to `dest` as if the player had drawn
 * it on the map: the panel's "where to fly next" links (ui/inspector/airport.ts).
 */
export function openRouteForm(state: SimState, origin: string, dest: string): void {
  const from = airports.find((airport) => airport.iata === origin);
  const to = airports.find((airport) => airport.iata === dest);
  if (!from || !to) return;
  reset();
  builderState = { mode: 'confirming', chain: [from], dest: to };
  showForm([from], to, state);
}

/**
 * Handle a canvas mousedown *before* main.ts's own pan-drag logic does.
 * Returns true when the route builder consumed the click (armed a new
 * route, confirmed one, or cancelled a pending one) — main.ts should skip
 * starting a pan in that case. Returns false to mean "not mine, go ahead
 * and pan as usual."
 */
export function handleRouteBuilderMouseDown(event: MouseEvent, state: SimState): boolean {
  // Nothing armed means this click isn't ours; the map menu or a pan gets it.
  if (builderState.mode === 'idle') return false;

  const clicked = findNearestAirport(event.clientX, event.clientY);

  if (builderState.mode === 'armed') {
    const origin = chainOrigin(builderState.chain);
    if (clicked && clicked.iata === origin.iata) {
      reset(); // re-clicking the airport the next leg departs from cancels
      return true;
    }
    if (clicked) {
      showForm(builderState.chain, clicked, state);
      builderState = { mode: 'confirming', chain: builderState.chain, dest: clicked };
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
    showRouteHoverTooltip(origin, candidate, builderState.chain[0], event.clientX, event.clientY, state);
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
  if (builderState.mode === 'idle') return;

  const { chain } = builderState;
  const tail = activeTail(state, null);
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
const formSlots = document.querySelector<HTMLElement>('#new-route-slots')!;
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

  // No candidate at all means no plane is based at this airport, which is
  // reachable now that the plane is picked automatically.
  const tail = activeTail(state, dest);
  if (!tail || state.aircraft.length === 0) {
    formLabel.textContent = `${origin.iata} → ${dest.iata}`;
    formBlock.textContent = '';
    formTailLabel.textContent = '';
    formError.textContent = `No plane is based at ${chainOrigin(chain).iata}. Tap the airport and use Plane to add one.`;
    formConfirmButton.disabled = true;
    formAddStopButton.disabled = true;
    formPdew.textContent = '';
    formUtilisation.textContent = '';
    formPositioningPreview.textContent = '';
    formSlots.textContent = '';
    return;
  }

  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;
  const plan = planRotation(chain, dest, tail, state);
  formTailLabel.textContent = type ? `${type.name} (${tail})` : tail;

  // The chain as the player sees it, always ending back where it started —
  // the closing leg is implicit in the gesture, so showing it here is how
  // they know it's coming.
  const routeIatas = plan.airports.map((airport) => airport.iata);
  if (routeIatas[routeIatas.length - 1] !== plan.base.iata) routeIatas.push(plan.base.iata);
  formLabel.textContent = routeIatas.join(' → ');

  const firstLeg = plan.legs[0];
  formBlock.textContent = firstLeg
    ? `${plan.legs.length} leg${plan.legs.length === 1 ? '' : 's'} · ${formatDuration(plan.clockMinutes)} · ` +
      `${minuteOfDayToTimeString(firstLeg.departMinute)}–${minuteOfDayToTimeString(plan.arriveBackMinute)}`
    : '';

  // The market read for the leg being added (sim/marketSize.ts): its
  // size in words and whether this plane would fill, shown even if the
  // checks below block this attempt, since it's still useful context.
  // `newFrequency` is the existing schedule's flights on this market plus
  // however many of this rotation's own legs serve it (a rotation that
  // shuttles YFC↔YQM twice adds four): the same count sim/economy.ts's
  // flightResult() divides the market's demand by.
  if (type) {
    const fromThisRotation = plan.legs.filter(
      (leg) =>
        (leg.origin === origin.iata && leg.dest === dest.iata) || (leg.origin === dest.iata && leg.dest === origin.iata),
    ).length;
    const newFrequency = legsServingMarket(origin.iata, dest.iata, state.schedule) + Math.max(fromThisRotation, 1);
    // A suppressed market (sim/demand.ts) carries nobody. Deliberately
    // still buildable — the restriction is soft — but saying so plainly
    // beats letting someone discover it from an empty P&L.
    const suppressed = suppressedMarketReason(origin.iata, dest.iata);
    const fill = demandAgainstSeats(state, origin.iata, dest.iata, newFrequency, type.seats);
    formPdew.textContent = suppressed
      ? `${origin.iata}–${dest.iata}: no market — ${suppressed}`
      : `${origin.iata}–${dest.iata}: ${marketSize(state, origin.iata, dest.iata)} market · ${type.seats} seats, ${fill.words}`;
    // See the hover tooltip's own note: thin is judged on the market fully
    // grown, not on what it carries before anyone has built it.
    formPdew.classList.toggle('thin-market', neverFills(state, origin.iata, dest.iata, newFrequency, type.seats));
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

  formSlots.textContent = describeSlotQuotes(plan.slotQuotes);

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
 * Add a planned rotation to the schedule (sim/rotations.ts's
 * applyRotation() does the work), then bring the page up to date: new
 * schedule warnings. Returns the new leg ids.
 */
export function commitRotation(state: SimState, tail: string, plan: RotationPlan): string[] {
  const { legIds } = applyRotation(state, tail, plan);
  renderScheduleWarnings(scheduleProblems(state));
  return legIds;
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
    builderState = { mode: 'armed', chain: [...builderState.chain, builderState.dest] };
    previewGeo = null;
    candidate = null;
    hideForm();
    setArmedCursor(true);
  });

  formConfirmButton.addEventListener('click', () => {
    if (builderState.mode !== 'confirming') return;
    const { chain, dest } = builderState;
    const tail = activeTail(state, dest);
    if (!tail) return;
    const plan = planRotation(chain, dest, tail, state);
    // The button is already disabled in this case — this is the same
    // rules, not a second copy of them, so it can't drift.
    if (plan.error || plan.legs.length === 0) return;

    const createdLegIds = commitRotation(state, tail, plan);
    onRouteConfirmed(createdLegIds);
    reset();
  });

  formCancelButton.addEventListener('click', () => {
    reset();
  });
}
