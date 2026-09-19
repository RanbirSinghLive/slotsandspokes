import { findNearestAirport, airportPresence, type Airport } from '../render/airports';
import { utilisationByBase } from '../sim/utilisation';
import { buySlot, canBuySlot, isSlotControlled, nextSlotPrice, slotsOwned, slotsTotal } from '../sim/airports';
import { getSelectedTail } from './fleetSelection';
import { armRouteBuilderAt } from './routeBuilder';
import type { SimState } from '../sim/state';

/**
 * Click an airport with no plane selected, get the airport — and now, get
 * to act on it too.
 *
 * This started deliberately read-only (WEEK-EIGHT.md): slot purchase and
 * base assignment already had a home in the Airports and Fleet tabs, and
 * duplicating those controls here risked two places that could drift out
 * of sync. What changed isn't that worry, it's the shape of the fix — the
 * radial menu below calls the exact same sim functions those tabs call
 * (`buySlot`, setting `aircraft.baseAirport`) and, for routes, arms the
 * exact same route-builder state machine a Fleet-panel selection would
 * (`armRouteBuilderAt`, in ui/routeBuilder.ts). Nothing about what a route
 * or a slot purchase *means* is reimplemented here — this is a second door
 * into the same room, not a second room. That's what makes it safe to add
 * without reopening the single-source-of-truth problem the original
 * read-only design was guarding against.
 *
 * Whether a click here is "ours" to handle is still decided entirely by
 * `getSelectedTail()`: a tail selected means the route builder owns every
 * click (arm/aim/confirm), so this module yields to it rather than fight
 * over the same gesture. main.ts's canvas mousedown handler gives the
 * route builder first refusal for exactly this reason — see its own
 * comment — and only calls into this module once that's said no.
 */

const MAX_MARKET_ROWS = 6;
const POPOVER_OFFSET_PX = 16;
const PICKER_OFFSET_PX = 16;
const RADIAL_RADIUS_PX = 46;
const RADIAL_EDGE_MARGIN_PX = 20;

const PLANE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
const HOME_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
const TICKET_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';

const popoverEl = document.querySelector<HTMLElement>('#airport-detail-popover')!;
const titleEl = document.querySelector<HTMLElement>('#airport-detail-title')!;
const presenceEl = document.querySelector<HTMLElement>('#airport-detail-presence')!;
const basedEl = document.querySelector<HTMLElement>('#airport-detail-based')!;
const marketsEl = document.querySelector<HTMLElement>('#airport-detail-markets')!;
const radialMenuEl = document.querySelector<HTMLDivElement>('#airport-radial-menu')!;
const pickerEl = document.querySelector<HTMLDivElement>('#airport-radial-picker')!;
const pickerTitleEl = document.querySelector<HTMLElement>('#airport-radial-picker-title')!;
const pickerListEl = document.querySelector<HTMLElement>('#airport-radial-picker-list')!;

let openIata: string | null = null;
// Cached so a button click (buySlot, base assignment) can redraw the same
// card and menu in place afterward without main.ts having to re-trigger a
// click — see refresh() below.
let openAirport: Airport | null = null;
let openState: SimState | null = null;
let openScreenX = 0;
let openScreenY = 0;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function hideAirportDetail(): void {
  popoverEl.hidden = true;
  radialMenuEl.hidden = true;
  pickerEl.hidden = true;
  openIata = null;
  openAirport = null;
  openState = null;
}

/**
 * Same fixed-offset-then-clamp positioning ui/routeBuilder.ts's own
 * popover uses (its `positionPopover()`) — not shared code, since it's
 * ten lines with nothing else in common between the two modules, but the
 * same approach on purpose so every map popover behaves identically
 * near a screen edge.
 */
function positionPopover(screenX: number, screenY: number): void {
  popoverEl.style.left = `${screenX + POPOVER_OFFSET_PX}px`;
  popoverEl.style.top = `${screenY + POPOVER_OFFSET_PX}px`;

  const rect = popoverEl.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0) popoverEl.style.left = `${screenX + POPOVER_OFFSET_PX - overflowX - 8}px`;
  if (overflowY > 0) popoverEl.style.top = `${screenY + POPOVER_OFFSET_PX - overflowY - 8}px`;
}

function positionPicker(): void {
  pickerEl.style.left = `${openScreenX + PICKER_OFFSET_PX}px`;
  pickerEl.style.top = `${openScreenY + PICKER_OFFSET_PX}px`;

  const rect = pickerEl.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0) pickerEl.style.left = `${openScreenX + PICKER_OFFSET_PX - overflowX - 8}px`;
  if (overflowY > 0) pickerEl.style.top = `${openScreenY + PICKER_OFFSET_PX - overflowY - 8}px`;
}

/** Redraw the card and the radial menu in place — used after an action changes something they show (a slot bought, a base set). */
function refresh(): void {
  if (openAirport && openState) showAirportDetail(openAirport, openState, openScreenX, openScreenY);
}

function showPicker(title: string, options: { label: string; onClick: () => void }[]): void {
  pickerTitleEl.textContent = title;
  pickerListEl.innerHTML = '';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'airport-radial-picker-option';
    button.textContent = option.label;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      option.onClick();
    });
    pickerListEl.appendChild(button);
  }
  pickerEl.hidden = false;
  positionPicker();
}

function showPickerMessage(text: string): void {
  pickerTitleEl.textContent = text;
  pickerListEl.innerHTML = '';
  pickerEl.hidden = false;
  positionPicker();
}

/**
 * "Add Route" needs a plane whose base either already matches this airport
 * or isn't set yet — the exact same rule ui/routeBuilder.ts enforces at
 * confirm time (a rotation starts and ends at its base; an unset base gets
 * adopted from wherever the first rotation starts). Filtering to that set
 * here means the picker never offers a plane that would just get refused
 * two clicks later.
 */
function startAddRoute(airport: Airport, state: SimState): void {
  const candidates = state.aircraft.filter((a) => a.baseAirport === airport.iata || a.baseAirport === null);

  if (candidates.length === 0) {
    showPickerMessage(`No plane can fly from here yet — base one at ${airport.iata} first, or free one up in the Fleet tab.`);
    return;
  }

  if (candidates.length === 1) {
    armRouteBuilderAt(airport, candidates[0].tail);
    hideAirportDetail();
    return;
  }

  showPicker(
    'Add a route — pick a plane',
    candidates.map((a) => ({
      label: `${a.tail} · ${a.typeCode}${a.baseAirport ? '' : ' (unassigned)'}`,
      onClick: () => {
        armRouteBuilderAt(airport, a.tail);
        hideAirportDetail();
      },
    })),
  );
}

function startBaseHere(airport: Airport, state: SimState): void {
  if (state.aircraft.length === 0) {
    showPickerMessage('No aircraft in the fleet yet — buy one in the Fleet Market first.');
    return;
  }

  showPicker(
    'Base an aircraft here — pick a plane',
    state.aircraft.map((a) => ({
      label: `${a.tail} · ${a.typeCode} — now ${a.baseAirport ?? 'unassigned'}`,
      onClick: () => {
        a.baseAirport = airport.iata;
        pickerEl.hidden = true;
        refresh();
      },
    })),
  );
}

type RadialAction = {
  label: string;
  iconSvg: string;
  disabled: boolean;
  onClick: () => void;
};

function buildRadialActions(airport: Airport, state: SimState): RadialAction[] {
  const actions: RadialAction[] = [
    {
      label: 'Add a route from here',
      iconSvg: PLANE_ICON_SVG,
      disabled: false,
      onClick: () => startAddRoute(airport, state),
    },
    {
      label: 'Base an aircraft here',
      iconSvg: HOME_ICON_SVG,
      disabled: state.aircraft.length === 0,
      onClick: () => startBaseHere(airport, state),
    },
  ];

  if (isSlotControlled(airport.iata)) {
    const owned = slotsOwned(state, airport.iata);
    const total = slotsTotal(airport.iata) ?? 0;
    const soldOut = owned >= total;
    actions.push({
      label: soldOut ? 'All slots held' : `Buy a slot — ${money(nextSlotPrice(state, airport.iata))}`,
      iconSvg: TICKET_ICON_SVG,
      disabled: soldOut || !canBuySlot(state, airport.iata),
      onClick: () => {
        buySlot(state, airport.iata);
        refresh();
      },
    });
  }

  return actions;
}

/**
 * Lays the buttons out on a circle centred on the airport's own screen
 * point, evenly spaced starting from 12 o'clock, then clamps each one's
 * *absolute* position (not the angle) to stay on screen — good enough near
 * a map edge, where a slightly flattened circle is a fair trade for a
 * button that's actually clickable.
 */
function showRadialMenu(airport: Airport, state: SimState, screenX: number, screenY: number): void {
  const actions = buildRadialActions(airport, state);
  const mapWidth = document.querySelector<HTMLCanvasElement>('#map')!.getBoundingClientRect().width;

  radialMenuEl.innerHTML = '';
  radialMenuEl.style.left = `${screenX}px`;
  radialMenuEl.style.top = `${screenY}px`;

  const angleStep = (2 * Math.PI) / actions.length;
  actions.forEach((action, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const dx = clamp(Math.cos(angle) * RADIAL_RADIUS_PX, RADIAL_EDGE_MARGIN_PX - screenX, mapWidth - screenX - RADIAL_EDGE_MARGIN_PX);
    const dy = clamp(
      Math.sin(angle) * RADIAL_RADIUS_PX,
      RADIAL_EDGE_MARGIN_PX - screenY,
      window.innerHeight - screenY - RADIAL_EDGE_MARGIN_PX,
    );

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'airport-radial-button';
    button.title = action.label;
    button.setAttribute('aria-label', action.label);
    button.innerHTML = action.iconSvg;
    button.disabled = action.disabled;
    button.style.left = `${dx}px`;
    button.style.top = `${dy}px`;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action.onClick();
    });
    radialMenuEl.appendChild(button);
  });

  radialMenuEl.hidden = false;
}

function showAirportDetail(airport: Airport, state: SimState, screenX: number, screenY: number): void {
  openIata = airport.iata;
  openAirport = airport;
  openState = state;
  openScreenX = screenX;
  openScreenY = screenY;
  titleEl.textContent = `${airport.iata} — ${airport.name}`;

  const presence = airportPresence(state, airport.iata);
  const slotLine = presence.slotControlled
    ? ` · slots ${presence.slotsOwned}/${presence.slotsTotal}${presence.departures > presence.slotsOwned ? ' (over)' : ''}`
    : '';
  presenceEl.textContent = `${presence.level} · ${presence.departures} departure${presence.departures === 1 ? '' : 's'}/day${slotLine}`;
  presenceEl.classList.toggle('airport-detail-over', presence.slotControlled && presence.departures > presence.slotsOwned);

  const basedTails = state.aircraft.filter((a) => a.baseAirport === airport.iata).map((a) => a.tail);
  if (basedTails.length === 0) {
    basedEl.textContent = 'No aircraft based here.';
  } else {
    const base = utilisationByBase(state).find((b) => b.base === airport.iata);
    const utilisationText = base ? ` — ${Math.round(base.share * 100)}% utilised, ${base.spareAircraft.toFixed(2)} spare` : '';
    basedEl.textContent = `Based: ${basedTails.join(', ')}${utilisationText}`;
  }

  // Every market this airport touches, either direction, with how many
  // legs serve it — the same bidirectional "market" definition
  // render/routes.ts and sim/schedule.ts's marketKey() already use, just
  // grouped by "the other end" instead of collapsed to one dot on the map.
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

  popoverEl.hidden = false;
  positionPopover(screenX, screenY);
  showRadialMenu(airport, state, screenX, screenY);
}

/**
 * First-refusal handler, same shape as ui/routeBuilder.ts's own
 * `handleRouteBuilderMouseDown` — returns whether this module consumed
 * the click, so main.ts knows not to start a pan. Only ever reached once
 * the route builder has already said no (see this module's own top
 * comment for why a selected tail always wins).
 */
export function handleAirportDetailMouseDown(event: MouseEvent, state: SimState): boolean {
  if (getSelectedTail()) return false; // a plane is selected — that gesture belongs to the route builder, not this
  const clicked = findNearestAirport(event.clientX, event.clientY);
  if (!clicked) return false;
  showAirportDetail(clicked, state, event.clientX, event.clientY);
  return true;
}

export function handleAirportDetailKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && openIata) hideAirportDetail();
}
