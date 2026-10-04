/**
 * The map's Ops view: a switch for the extra operating detail drawn over
 * the map (larger planes with trails and tails, grounded planes and
 * cancelled legs, fare-gap ticks, crew and slot chips, route width by
 * volume, hub badges). Off, the map is the plain network; on, it is the
 * control-room version of the same map. It is a view preference, like the
 * airport filter, so it is not in `SimState` and not part of a save; the
 * choice is remembered in localStorage.
 *
 * Every renderer that adds operating detail asks `isOpsView()` and draws
 * nothing extra when it is false, so the base map never changes.
 */
const STORAGE_KEY = 'slotsandspokes-ops-view';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let on = readStored();

export function isOpsView(): boolean {
  return on;
}

export function setOpsView(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Private windows can refuse storage; the switch still works for this visit.
  }
}
