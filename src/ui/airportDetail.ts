import { findNearestAirport, airportPresence, type Airport } from '../render/airports';
import { utilisationByBase } from '../sim/utilisation';
import { getSelectedTail } from './fleetSelection';
import type { SimState } from '../sim/state';

/**
 * Click an airport with no plane selected, get the airport — the other
 * half of the mapmodes/outliner pitch (WEEK-EIGHT.md). Before this, an
 * airport was purely a route-builder target: it did nothing at all unless
 * a tail was already selected, in which case clicking it armed a route.
 * That left "what's actually going on at YHZ" answerable only by digging
 * through the Fleet and Airports tabs and cross-referencing by IATA code.
 *
 * Deliberately read-only. Slot purchase and base assignment already have
 * a real home (the Airports and Fleet tabs); duplicating those controls
 * here would mean two places that can buy a slot, which is exactly the
 * kind of drift CLAUDE.md's "single source of truth" instinct warns
 * against. This shows what's there; acting on it still means switching
 * tabs, the same way the alert strip points at a tab rather than growing
 * its own copy of every tab's controls.
 *
 * Whether a click here is "ours" to handle is decided entirely by
 * `getSelectedTail()`: a tail selected means the route builder owns every
 * click (arm/aim/confirm), so this module has to yield to it rather than
 * fight over the same gesture. main.ts's canvas mousedown handler gives
 * the route builder first refusal for exactly this reason — see its own
 * comment — and only calls into this module once that's said no.
 */

const MAX_MARKET_ROWS = 6;
const POPOVER_OFFSET_PX = 16;

const popoverEl = document.querySelector<HTMLElement>('#airport-detail-popover')!;
const titleEl = document.querySelector<HTMLElement>('#airport-detail-title')!;
const presenceEl = document.querySelector<HTMLElement>('#airport-detail-presence')!;
const basedEl = document.querySelector<HTMLElement>('#airport-detail-based')!;
const marketsEl = document.querySelector<HTMLElement>('#airport-detail-markets')!;

let openIata: string | null = null;

export function hideAirportDetail(): void {
  popoverEl.hidden = true;
  openIata = null;
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

function showAirportDetail(airport: Airport, state: SimState, screenX: number, screenY: number): void {
  openIata = airport.iata;
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
