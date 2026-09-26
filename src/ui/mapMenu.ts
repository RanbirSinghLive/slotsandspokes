import { nearestAirportCandidate, type Airport } from '../render/airports';
import { findNearestOwnRoute } from '../render/routes';
import { projection } from '../render/projection';
import { TURN_BUFFER_CHOICES } from '../sim/turnBuffer';
import { connectingPassengersThrough, spokesOf } from '../sim/hubs';
import { HUB_STYLES, HUB_STYLE_ORDER, hubStyleAt } from '../sim/hubStyle';
import { setMapPreview, type MapPreview } from '../render/preview';
import type { SimState } from '../sim/state';
import { select, selectRoute } from './selection';
import { redrawInspectorPreview, renderInspector } from './inspector/inspector';
import { candidateTailsAt } from '../sim/rotations';
import { armRouteBuilderAt, describeSlotQuotes } from './routeBuilder';
import { hideCompetitionTooltip } from './competitionTooltip';
import { hideRadial, showRadial, updateRadial, type RadialAction } from './radial';
import * as ops from './routeActions';
import { planeIconInner } from './planeIcons';
import { AIRCRAFT_CLASSES } from '../sim/aircraftClasses';
import { USEFUL_LIFE_YEARS } from '../sim/leasing';

/**
 * Click something on the map, get a ring of actions for it at the click,
 * and its details in the side panel (the inspector, ui/inspector/). Two
 * kinds of thing can be clicked:
 *
 * - An **airport**: draw a route from it, add or return a plane based
 *   there, or change its hub style.
 * - A **route** (the line between two airports): add or remove a flight,
 *   move a flight up or down a size class, set its turn buffer, or remove
 *   the whole route.
 *
 * The ring's hover hints show in a small label under the ring. This
 * module only decides which actions each ring has and selects what was
 * clicked. Drawing the ring is ui/radial.ts; what an action does to the
 * network is ui/routeActions.ts, and through it the route builder's own
 * planning, so nothing here re-implements a rule.
 *
 * main.ts's mousedown handler gives the route builder first refusal on
 * every map click (it owns the map while a route is being drawn), and only
 * calls in here once it has said no.
 */

// Short enough to fit a button: the full names are in each button's label.
const HUB_STYLE_ICON_TEXT = { rolling: 'Roll', banked: 'Bank', tight: 'Tight' } as const;

const ringHintEl = document.querySelector<HTMLElement>('#radial-hint')!;
/** How far below the click point the ring's hint label sits: clear of the ring's buttons. */
const RING_HINT_OFFSET_PX = 84;

const ICON = {
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5 16.5 7.5"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  gaugeUp: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  gaugeDown: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  remove: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  // An arrow curving back: handing a plane back to the lessor.
  returnPlane: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  // Three spokes meeting at a hub.
  hub: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V3"/><path d="M9.8 13.3 4.5 17"/><path d="M14.2 13.3 19.5 17"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
};

/** A short label drawn as the button's icon, for choices that are numbers rather than things. */
function textIcon(text: string, fontSize = 10): string {
  const baseline = 12 + fontSize * 0.36;
  return `<text x="12" y="${baseline}" text-anchor="middle" font-size="${fontSize}" font-weight="600" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">${text}</text>`;
}

type Open = { kind: 'airport'; airport: Airport } | { kind: 'route'; a: string; b: string };

let open: Open | null = null;
let openState: SimState | null = null;
let anchorX = 0;
let anchorY = 0;
// The result of the last action, kept in the hint line until the pointer
// moves onto another button, so a click that changes something visibly
// elsewhere on the map still says what it did.
let notice: string | null = null;
let hover: { text: string; problem: boolean } | null = null;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

export function hideMapMenu(): void {
  ringHintEl.hidden = true;
  hideRadial();
  setMapPreview(null);
  open = null;
  openState = null;
  notice = null;
  hover = null;
}

/** The ring's hint: what the hovered button does or why it can't, else the last action's result. */
function renderHint(): void {
  const text = hover?.text ?? notice ?? '';
  ringHintEl.textContent = text;
  ringHintEl.classList.toggle('is-problem', !!hover?.problem);
  ringHintEl.hidden = text === '';
  positionRingHint();
}

/** Centre the ring's hint under the click point, or above it when there's no room below. */
function positionRingHint(): void {
  ringHintEl.style.left = `${anchorX}px`;
  ringHintEl.style.top = `${anchorY + RING_HINT_OFFSET_PX}px`;
  const rect = ringHintEl.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 8) ringHintEl.style.top = `${anchorY - RING_HINT_OFFSET_PX - rect.height}px`;
  const overflowLeft = 8 - rect.left;
  if (overflowLeft > 0) ringHintEl.style.left = `${anchorX + overflowLeft}px`;
}

function onHint(text: string | null, problem: boolean): void {
  hover = text === null ? null : { text, problem };
  renderHint();
}

function onPreview(preview: MapPreview | null): void {
  setMapPreview(preview);
  redrawInspectorPreview();
}

// --- Airports -----------------------------------------------------------


function airportActions(airport: Airport, state: SimState): RadialAction[] {
  const hasPlane = candidateTailsAt(state, airport.iata).length > 0;

  // Returning a lease early (sim/market.ts): one choice per plane based
  // here. Only a plane with nothing scheduled can go; the rest say why.
  const returnChoices: RadialAction[] = ops.returnOptions(state, airport.iata).map((option) => ({
    id: `return:${option.tail}`,
    label:
      `Return ${option.tail} (${option.name}, ${option.ageYears} yrs) for a $${option.fee.toLocaleString()} fee, ` +
      `saving $${option.saves.toLocaleString()}/day. It goes back on the market for anyone to lease.`,
    icon: planeIconInner(state.aircraft.find((a) => a.tail === option.tail)?.typeCode ?? ''),
    large: true,
    angleDeg: 0,
    confirm: true,
    disabledReason: option.blocked ?? undefined,
    onSelect: () => {
      const result = ops.returnPlane(state, option.tail);
      notice = result.ok ? result.message : result.reason;
      refresh();
      return false;
    },
  }));

  const planeChoices: RadialAction[] = ops.planeOptions(state, airport.iata).map((option) => ({
    id: `plane:${option.code}`,
    // The actual airframe on offer (sim/market.ts): its age is what
    // explains its price and how late it'll run.
    label: option.listing
      ? `Lease a ${option.name} (${option.seats} seats, ${option.listing.ageYears} yrs old, ` +
        `${Math.max(0, USEFUL_LIFE_YEARS - option.listing.ageYears)} yrs of life left) for ${money(option.listing.leasePricePerDay)}/day` +
        (option.listed > 1 ? ` · ${option.listed - 1} more listed` : ' · the last one listed')
      : `Lease a ${option.name}`,
    // Each class has its own silhouette (ui/planeIcons.ts), so the four
    // choices are told apart by shape rather than by guessing at size.
    icon: planeIconInner(option.code),
    large: true,
    angleDeg: 0,
    disabledReason: option.disabledReason,
    preview: option.preview,
    onSelect: () => {
      const result = ops.leasePlane(state, airport.iata, option.code);
      notice = result.ok ? result.message : result.reason;
      refresh();
    },
  }));

  // Hub style (sim/hubStyle.ts): each choice planned up front, like the
  // route ring's turn buffer, so one the base can't absorb is greyed out
  // with the reason, and hovering one previews its effect on the pools.
  const current = hubStyleAt(state, airport.iata);
  const spokeCount = spokesOf(state, airport.iata).size;
  const styleChoices: RadialAction[] = HUB_STYLE_ORDER.map((style) => {
    const spec = HUB_STYLES[style];
    const isCurrent = style === current;
    const plan = isCurrent ? null : ops.previewHubStyle(state, airport.iata, style);
    const connectingAfter = Math.round(
      connectingPassengersThrough({ ...state, hubStyles: { ...state.hubStyles, [airport.iata]: style } }, airport.iata),
    );
    return {
      id: `hub:${style}`,
      label: `${spec.name}${isCurrent ? ' (current)' : ''}: ${spec.description} About ${connectingAfter} connecting/day.`,
      icon: textIcon(HUB_STYLE_ICON_TEXT[style], 7),
      angleDeg: 0,
      selected: isCurrent,
      disabledReason: plan && !plan.ok ? plan.reason : undefined,
      preview: plan?.ok ? plan.preview : undefined,
      onSelect: () => {
        if (isCurrent) return false;
        const result = ops.setHubStyle(state, airport.iata, style);
        notice = result.ok ? result.message : result.reason;
        refresh();
        return false;
      },
    };
  });

  return [
    {
      id: 'hub-style',
      label: `Hub style (now ${HUB_STYLES[current].name}): how flights here are grouped, trading connections against congestion and aircraft time`,
      icon: ICON.hub,
      angleDeg: -165,
      disabledReason:
        spokeCount < 2 ? `Fly from ${airport.iata} to at least two airports first: connections need two routes to meet.` : undefined,
      children: styleChoices,
    },
    {
      id: 'route',
      label: 'Draw a route from here',
      icon: ICON.route,
      angleDeg: -115,
      disabledReason: hasPlane ? undefined : `No plane is based at ${airport.iata}. Use Plane to add one.`,
      onSelect: () => {
        armRouteBuilderAt(airport);
        hideMapMenu();
      },
    },
    { id: 'plane', label: 'Add a plane based here', icon: ICON.plane, angleDeg: -65, children: planeChoices },
    {
      id: 'return',
      label: 'Return a plane to the lessor',
      icon: ICON.returnPlane,
      angleDeg: 150,
      disabledReason: returnChoices.length === 0 ? `No planes are based at ${airport.iata}.` : undefined,
      children: returnChoices,
    },
  ];
}

function openAirportMenu(airport: Airport, state: SimState): void {
  const point = projection([airport.lon, airport.lat]);
  anchorX = point ? point[0] : anchorX;
  anchorY = point ? point[1] : anchorY;

  open = { kind: 'airport', airport };
  openState = state;
  notice = null;
  hover = null;

  select({ kind: 'airport', iata: airport.iata });
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: airportActions(airport, state), onHint, onPreview });
}

// --- Routes ---------------------------------------------------------------

/** What the add-flight button says, including how thin the demand would be spread. */
function addFlightLabel(className: string, readout: ReturnType<typeof ops.marketReadout>): string {
  const seats = AIRCRAFT_CLASSES.find((c) => c.name === className)?.seats ?? 0;
  const wantedAfter = Math.round(readout.demandTotal / (readout.legs + 2));
  const thin = wantedAfter < 0.4 * seats ? ', mostly empty for now' : '';
  return `Add a ${className} flight (about ${wantedAfter} passengers wanted per flight after, ${seats} seats${thin})`;
}

function routeActions(a: string, b: string, state: SimState): RadialAction[] {
  const gaugeUp = ops.previewGauge(state, a, b, 1);
  const gaugeDown = ops.previewGauge(state, a, b, -1);
  const addFlight = ops.previewAddFlight(state, a, b);
  const removeFlight = ops.previewRemoveFlight(state, a, b);
  const removeRoute = ops.previewRemoveRoute(state, a, b);
  const readout = ops.marketReadout(state, a, b);
  const buffer = ops.currentTurnBuffer(state, a, b);

  const act = (result: ops.Outcome<{ message: string }>): boolean => {
    notice = result.ok ? result.message : result.reason;
    refresh();
    return false;
  };

  // Each buffer choice is planned up front, so a choice the base can't
  // afford is greyed out with the reason before it's ever clicked.
  const bufferChoices: RadialAction[] = TURN_BUFFER_CHOICES.map((minutes) => {
    const isCurrent = minutes === buffer;
    const plan = isCurrent ? null : ops.previewTurnBuffer(state, a, b, minutes);
    return {
      id: `buffer:${minutes}`,
      label: isCurrent
        ? `+${minutes} min after each flight (current)`
        : `Set the turn buffer to +${minutes} min after each flight on ${a}–${b}` +
          (plan?.ok && plan.moved > 0 ? `. Moves ${plan.moved} rotation${plan.moved === 1 ? '' : 's'} to another plane to make room` : ''),
      icon: textIcon(minutes === 0 ? '0' : `+${minutes}`),
      angleDeg: 0,
      selected: isCurrent,
      disabledReason: plan && !plan.ok ? plan.reason : undefined,
      preview: plan?.ok ? plan.preview : undefined,
      onSelect: () => (isCurrent ? false : act(ops.setTurnBuffer(state, a, b, minutes))),
    };
  });

  return [
    {
      id: 'turn-buffer',
      label: `Turn buffer (now +${buffer} min): extra ground time after each flight soaks up delays, but uses aircraft time`,
      icon: ICON.clock,
      angleDeg: 150,
      children: bufferChoices,
    },
    {
      id: 'gauge-down',
      label: gaugeDown.ok
        ? `Downgauge one flight: ${gaugeDown.fromName} to ${gaugeDown.toName} (hold to downgauge several)`
        : 'Downgauge one flight',
      icon: ICON.gaugeDown,
      angleDeg: -170,
      repeatable: true,
      disabledReason: gaugeDown.ok ? undefined : gaugeDown.reason,
      preview: gaugeDown.ok ? gaugeDown.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, -1)),
    },
    {
      id: 'gauge-up',
      label: gaugeUp.ok
        ? `Upgauge one flight: ${gaugeUp.fromName} to ${gaugeUp.toName} (hold to upgauge several)`
        : 'Upgauge one flight',
      icon: ICON.gaugeUp,
      angleDeg: -132,
      repeatable: true,
      disabledReason: gaugeUp.ok ? undefined : gaugeUp.reason,
      preview: gaugeUp.ok ? gaugeUp.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, 1)),
    },
    {
      id: 'flight-down',
      label: 'Remove one flight (hold to remove several)',
      icon: ICON.minus,
      angleDeg: -94,
      repeatable: true,
      disabledReason: removeFlight.ok ? undefined : removeFlight.reason,
      preview: removeFlight.ok ? removeFlight.preview : undefined,
      onSelect: () => act(ops.removeFlight(state, a, b)),
    },
    {
      id: 'flight-up',
      label: addFlight.ok
        ? `${addFlightLabel(addFlight.className, readout)}. ${describeSlotQuotes(addFlight.plan.slotQuotes)} Hold to add several.`
        : 'Add a flight',
      icon: ICON.plus,
      angleDeg: -56,
      repeatable: true,
      disabledReason: addFlight.ok ? undefined : addFlight.reason,
      preview: addFlight.ok ? addFlight.preview : undefined,
      onSelect: () => act(ops.addFlight(state, a, b)),
    },
    {
      id: 'remove-route',
      label: 'Remove this route',
      icon: ICON.remove,
      angleDeg: -18,
      confirm: true,
      preview: removeRoute.ok ? removeRoute.preview : undefined,
      onSelect: () => {
        const result = ops.removeRoute(state, a, b);
        notice = result.ok ? result.message : result.reason;
        if (result.ok) {
          hideMapMenu();
          renderInspector(state);
          return false;
        }
        refresh();
        return false;
      },
    },
  ];
}

function openRouteMenu(a: string, b: string, state: SimState, x: number, y: number): void {
  anchorX = x;
  anchorY = y;
  open = { kind: 'route', a, b };
  openState = state;
  notice = null;
  hover = null;

  selectRoute(state, a, b);
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: routeActions(a, b, state), onHint, onPreview });
}

// --- Shared ---------------------------------------------------------------

/** Rebuild the details and the ring after an action changed the network, keeping them open. */
function refresh(): void {
  if (!open || !openState) return;
  const state = openState;
  // The button that was hovered has just been replaced, so it will never
  // report the pointer leaving; without this its hint would stay on screen
  // over the result of the click.
  hover = null;
  setMapPreview(null);

  if (open.kind === 'airport') {
    renderInspector(state);
    updateRadial(airportActions(open.airport, state));
  } else {
    // The inspector shows the route; with nothing flying it any more it
    // falls back to Network, and the ring has nothing left to act on.
    renderInspector(state);
    if (ops.rotationsServing(state, open.a, open.b).length === 0) {
      hideMapMenu();
      return;
    }
    updateRadial(routeActions(open.a, open.b, state));
  }
  renderHint();
}

// Below this fraction of the airport's own hit radius, the airport wins
// outright, full stop — no ratio comparison against a route. A route's
// arc starts exactly at its airport, so right on top of the airport dot
// itself the route's ratio is *also* near 0 (a click there really is on
// the line, technically, at the one point where it and the dot coincide).
// Without this floor, clicking dead-center on an airport with an outgoing
// route could occasionally hand the click to the route instead, on
// nothing more than sub-pixel rounding — found by testing this exact
// scenario after the ratio comparison below was first written.
const AIRPORT_SURE_WIN_RATIO = 0.5;

/**
 * First-refusal handler, same shape as ui/routeBuilder.ts's own
 * `handleRouteBuilderMouseDown`: returns whether this module consumed the
 * click, so main.ts knows not to start a pan.
 *
 * Outside the sure-win zone above, airport and route are compared by
 * `ratio` (distance divided by that target's own hit radius — see
 * nearestAirportCandidate()'s comment in render/airports.ts), not by
 * "airport checked first." A route's line only gets an 8px tolerance
 * against an airport's 14px, so on a short route (or the map zoomed out)
 * most of the line used to sit inside both endpoints' airport radii and
 * could never win at all — checking the ratio instead means a click
 * genuinely close to the line, but not close enough to either airport to
 * count as "on" it, now correctly goes to the route.
 */
export function handleMapMenuMouseDown(event: MouseEvent, state: SimState): boolean {
  const airport = nearestAirportCandidate(event.clientX, event.clientY);
  const route = findNearestOwnRoute(event.clientX, event.clientY, state);

  const airportWins = airport && (airport.ratio <= AIRPORT_SURE_WIN_RATIO || !route || airport.ratio <= route.ratio);
  if (airportWins) {
    hideCompetitionTooltip();
    openAirportMenu(airport.airport, state);
    return true;
  }

  if (route) {
    hideCompetitionTooltip();
    openRouteMenu(route.origin, route.dest, state, event.clientX, event.clientY);
    return true;
  }

  return false;
}

/** Whether a ring is showing, so the hover tooltip can stay out of its way. */
export function isMapMenuOpen(): boolean {
  return open !== null;
}

export function handleMapMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open) hideMapMenu();
}
