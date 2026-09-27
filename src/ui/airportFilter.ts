import { networkAirports } from '../sim/reach';
import type { SimState } from '../sim/state';

/**
 * Which airports the map shows (WEEK-NINE.md, thread 12): every airport
 * you know of, only the ones you fly to, or those plus the ones your
 * rivals fly to. A view preference, so it lives here and not in
 * `SimState`, and it isn't saved.
 *
 * main.ts hands visibleAirports() to the renderers in place of the known
 * list (render/airports.ts's setKnownAirports()), so hit-testing and
 * drawing both follow it: what's clickable is what's drawn. Home always
 * shows, even before its first route.
 */

export type AirportFilter = 'all' | 'yours' | 'contested';

let filter: AirportFilter = 'all';
let lastVisible: string[] = [];

export function setAirportFilter(next: AirportFilter): void {
  filter = next;
}

export function airportFilter(): AirportFilter {
  return filter;
}

/**
 * The airports to draw and let the player click, in the known list's order.
 * Returns the same array as last time when nothing changed, since the
 * renderer only rebuilds its lookup when handed a different array.
 */
export function visibleAirports(state: SimState): string[] {
  if (filter === 'all') return state.knownAirports;
  const shown = networkAirports(state);
  shown.add(state.homeAirport);
  if (filter === 'contested') {
    for (const route of state.competitorRoutes) {
      shown.add(route.origin);
      shown.add(route.dest);
    }
  }
  const visible = state.knownAirports.filter((iata) => shown.has(iata));
  const unchanged = visible.length === lastVisible.length && visible.every((iata, i) => iata === lastVisible[i]);
  if (!unchanged) lastVisible = visible;
  return lastVisible;
}
