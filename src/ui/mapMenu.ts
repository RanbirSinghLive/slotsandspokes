import { findNearestAirport, airportPresence, type Airport } from '../render/airports';
import { findNearestOwnRoute } from '../render/routes';
import { projection } from '../render/projection';
import { utilisationPools } from '../sim/utilisation';
import { unmetDemandByAirport } from '../sim/unmetDemand';
import { rivalYieldFactor } from '../sim/pressure';
import { legsServingMarket } from '../sim/schedule';
import { buildPoolRows } from './poolBars';
import { getMapPreview, setMapPreview, type MapPreview } from '../render/preview';
import type { SimState } from '../sim/state';
import { armRouteBuilderAt, candidateTailsAt } from './routeBuilder';
import { hideCompetitionTooltip } from './competitionTooltip';
import { hideRadial, showRadial, updateRadial, type RadialAction } from './radial';
import * as ops from './routeActions';
import { planeIconInner } from './planeIcons';
import { AIRCRAFT_CLASSES } from '../sim/aircraftClasses';

/**
 * Click something on the map, get an info card and a ring of actions for
 * it. Two kinds of thing can be clicked:
 *
 * - An **airport**: draw a route from it, or add a plane based there.
 * - A **route** (the line between two airports): add or remove a flight,
 *   move a flight up or down a size class, or remove the whole route.
 *
 * This module only decides which actions each ring has and what the card
 * says. Drawing the ring is ui/radial.ts; what an action does to the
 * network is ui/routeActions.ts, and through it the route builder's own
 * planning, so nothing here re-implements a rule.
 *
 * main.ts's mousedown handler gives the route builder first refusal on
 * every map click (it owns the map while a route is being drawn), and only
 * calls in here once it has said no.
 */

const MAX_MARKET_ROWS = 6;
const CARD_OFFSET_PX = 16;

const cardEl = document.querySelector<HTMLElement>('#airport-detail-popover')!;
const titleEl = document.querySelector<HTMLElement>('#airport-detail-title')!;
const presenceEl = document.querySelector<HTMLElement>('#airport-detail-presence')!;
const basedEl = document.querySelector<HTMLElement>('#airport-detail-based')!;
const marketsEl = document.querySelector<HTMLElement>('#airport-detail-markets')!;
const poolsEl = document.querySelector<HTMLElement>('#airport-detail-pools')!;
const demandEl = document.querySelector<HTMLElement>('#airport-detail-demand')!;
const hintEl = document.querySelector<HTMLElement>('#airport-detail-hint')!;

const ICON = {
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5 16.5 7.5"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  gaugeUp: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  gaugeDown: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  remove: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
};

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
let cardPoolBase: string | null = null;
let cardPoolState: SimState | null = null;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

export function hideMapMenu(): void {
  cardEl.hidden = true;
  hideRadial();
  setMapPreview(null);
  cardPoolBase = null;
  cardPoolState = null;
  open = null;
  openState = null;
  notice = null;
  hover = null;
}

function renderHint(): void {
  const text = hover?.text ?? notice ?? '';
  hintEl.textContent = text;
  hintEl.classList.toggle('is-problem', !!hover?.problem);
}

function onHint(text: string | null, problem: boolean): void {
  hover = text === null ? null : { text, problem };
  renderHint();
}

function positionCard(): void {
  cardEl.style.left = `${anchorX + CARD_OFFSET_PX}px`;
  cardEl.style.top = `${anchorY + CARD_OFFSET_PX}px`;

  const rect = cardEl.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0) cardEl.style.left = `${anchorX + CARD_OFFSET_PX - overflowX - 8}px`;
  if (overflowY > 0) cardEl.style.top = `${anchorY + CARD_OFFSET_PX - overflowY - 8}px`;
}

// --- Airports -----------------------------------------------------------

/** The class pools for the planes based at `base`, as bars; `emptyText` when there are none. */
function fillPools(base: string | null, state: SimState, emptyText: string): void {
  cardPoolBase = base;
  cardPoolState = state;
  const pools = base ? utilisationPools(state, base) : [];
  basedEl.textContent = pools.every((pool) => pool.planes === 0) ? emptyText : `Planes based at ${base}:`;
  renderCardPools();
}

/** Redraw the card's bars, applying whatever the hovered button would change. */
function renderCardPools(): void {
  if (!cardPoolBase || !cardPoolState) {
    poolsEl.replaceChildren();
    return;
  }
  const pools = utilisationPools(cardPoolState, cardPoolBase);
  poolsEl.replaceChildren(...buildPoolRows(pools, getMapPreview()?.effects, cardPoolBase));
}

function onPreview(preview: MapPreview | null): void {
  setMapPreview(preview);
  renderCardPools();
}

function fillAirportCard(airport: Airport, state: SimState): void {
  titleEl.textContent = `${airport.iata} — ${airport.name}`;

  const presence = airportPresence(state, airport.iata);
  presenceEl.textContent = `${presence.level} · ${presence.departures} departure${presence.departures === 1 ? '' : 's'}/day`;
  presenceEl.classList.remove('airport-detail-over');

  const unmet = unmetDemandByAirport(state).get(airport.iata);
  const round = (n: number) => Math.round(n).toLocaleString();
  demandEl.textContent = unmet
    ? `Waiting: ${round(unmet.latent)} potential riders/day${unmet.spilled >= 1 ? `, ${round(unmet.spilled)} turned away` : ''}`
    : '';
  demandEl.classList.toggle('airport-detail-over', !!unmet && unmet.spilled >= 1);

  fillPools(airport.iata, state, 'No aircraft based here.');

  // Every market this airport touches, either direction, with how many
  // legs serve it.
  const frequencyByOther = new Map<string, number>();
  for (const leg of state.schedule) {
    if (leg.origin === airport.iata) frequencyByOther.set(leg.dest, (frequencyByOther.get(leg.dest) ?? 0) + 1);
    else if (leg.dest === airport.iata) frequencyByOther.set(leg.origin, (frequencyByOther.get(leg.origin) ?? 0) + 1);
  }
  const markets = [...frequencyByOther.entries()].sort((a, b) => b[1] - a[1]);
  if (markets.length === 0) {
    marketsEl.textContent = 'No markets served.';
  } else {
    const shown = markets.slice(0, MAX_MARKET_ROWS).map(([iata, freq]) => `${iata} (${freq})`);
    const rest = markets.length - shown.length;
    marketsEl.textContent = `Markets: ${shown.join(', ')}${rest > 0 ? `, +${rest} more` : ''}`;
  }
}

function airportActions(airport: Airport, state: SimState): RadialAction[] {
  const hasPlane = candidateTailsAt(state, airport.iata).length > 0;

  const planeChoices: RadialAction[] = ops.planeOptions(state, airport.iata).map((option) => ({
    id: `plane:${option.code}`,
    label: `Lease a ${option.name} (${option.seats} seats) for ${money(option.leasePerDay)}/day`,
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

  return [
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

  fillAirportCard(airport, state);
  cardEl.hidden = false;
  positionCard();
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: airportActions(airport, state), onHint, onPreview });
}

// --- Routes ---------------------------------------------------------------

function fillRouteCard(a: string, b: string, state: SimState): void {
  const summary = ops.summariseMarket(state, a, b);
  const readout = ops.marketReadout(state, a, b);

  titleEl.textContent = `${a} – ${b}`;
  presenceEl.textContent = `${summary.rotations.length} flight${summary.rotations.length === 1 ? '' : 's'}/day · ${summary.byClass.map((c) => `${c.name} x${c.count}`).join(', ')}`;
  presenceEl.classList.remove('airport-detail-over');

  const short = readout.demandNow > readout.seatsPerFlight;
  // A route you have only just opened has almost no demand, however big
  // the city pair is: demand is built by flying it, over weeks
  // (sim/marketDemand.ts). Saying so is what stops "20,000 potential" from
  // reading as "add ten flights".
  const young = readout.demandNow < 0.4 * readout.seatsPerFlight;
  demandEl.textContent = '';
  demandEl.classList.remove('airport-detail-over');
  presenceEl.classList.toggle('airport-detail-over', short);
  marketsEl.textContent =
    `Per flight: ${readout.demandNow} passengers wanted${readout.demandPotential > readout.demandNow ? ` (${readout.demandPotential} potential)` : ''}, ${readout.seatsPerFlight} seats.` +
    (short ? ' Demand exceeds seats: add a flight or upgauge.' : '') +
    (young ? ' Demand is still growing: extra flights fly emptier for now.' : '');
  const rivals = state.competitorRoutes.filter(
    (route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a),
  );
  if (rivals.length > 0) {
    const factor = rivalYieldFactor(a, b, legsServingMarket(a, b, state.schedule), state.competitorRoutes);
    const cut = Math.round((1 - factor) * 100);
    demandEl.textContent =
      `Rivals: ${rivals.map((r) => `${r.airline} ${r.dailyFrequency}/day`).join(', ')}` +
      (cut > 0 ? `. They cut your fares ${cut}%: more flights of your own reduce it.` : '');
    demandEl.classList.add('airport-detail-over');
  }

  fillPools(ops.routeBase(state, a, b), state, '');
}

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

  const act = (result: ops.Outcome<{ message: string }>): boolean => {
    notice = result.ok ? result.message : result.reason;
    refresh();
    return false;
  };

  return [
    {
      id: 'gauge-down',
      label: gaugeDown.ok ? `Downgauge one flight: ${gaugeDown.fromName} to ${gaugeDown.toName}` : 'Downgauge one flight',
      icon: ICON.gaugeDown,
      angleDeg: -170,
      disabledReason: gaugeDown.ok ? undefined : gaugeDown.reason,
      preview: gaugeDown.ok ? gaugeDown.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, -1)),
    },
    {
      id: 'gauge-up',
      label: gaugeUp.ok ? `Upgauge one flight: ${gaugeUp.fromName} to ${gaugeUp.toName}` : 'Upgauge one flight',
      icon: ICON.gaugeUp,
      angleDeg: -132,
      disabledReason: gaugeUp.ok ? undefined : gaugeUp.reason,
      preview: gaugeUp.ok ? gaugeUp.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, 1)),
    },
    {
      id: 'flight-down',
      label: 'Remove one flight',
      icon: ICON.minus,
      angleDeg: -94,
      disabledReason: removeFlight.ok ? undefined : removeFlight.reason,
      preview: removeFlight.ok ? removeFlight.preview : undefined,
      onSelect: () => act(ops.removeFlight(state, a, b)),
    },
    {
      id: 'flight-up',
      label: addFlight.ok ? addFlightLabel(addFlight.className, readout) : 'Add a flight',
      icon: ICON.plus,
      angleDeg: -56,
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

  fillRouteCard(a, b, state);
  cardEl.hidden = false;
  positionCard();
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: routeActions(a, b, state), onHint, onPreview });
}

// --- Shared ---------------------------------------------------------------

/** Rebuild the card and the ring after an action changed the network, keeping them open. */
function refresh(): void {
  if (!open || !openState) return;
  const state = openState;
  // The button that was hovered has just been replaced, so it will never
  // report the pointer leaving; without this its hint would stay on screen
  // over the result of the click.
  hover = null;
  setMapPreview(null);

  if (open.kind === 'airport') {
    fillAirportCard(open.airport, state);
    updateRadial(airportActions(open.airport, state));
  } else {
    // A route with nothing flying it any more has nothing left to act on.
    if (ops.rotationsServing(state, open.a, open.b).length === 0) {
      const message = notice;
      hideMapMenu();
      notice = message;
      return;
    }
    fillRouteCard(open.a, open.b, state);
    updateRadial(routeActions(open.a, open.b, state));
  }
  renderHint();
}

/**
 * First-refusal handler, same shape as ui/routeBuilder.ts's own
 * `handleRouteBuilderMouseDown`: returns whether this module consumed the
 * click, so main.ts knows not to start a pan. An airport wins over a route
 * (a point is a smaller, more precise target than a line).
 */
export function handleMapMenuMouseDown(event: MouseEvent, state: SimState): boolean {
  const airport = findNearestAirport(event.clientX, event.clientY);
  if (airport) {
    hideCompetitionTooltip();
    openAirportMenu(airport, state);
    return true;
  }

  const route = findNearestOwnRoute(event.clientX, event.clientY, state);
  if (route) {
    hideCompetitionTooltip();
    openRouteMenu(route.origin, route.dest, state, event.clientX, event.clientY);
    return true;
  }

  return false;
}

/** Whether the info card and ring are showing, so the hover tooltip can stay out of their way. */
export function isMapMenuOpen(): boolean {
  return open !== null;
}

export function handleMapMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open) hideMapMenu();
}
