/**
 * Which half of the Fleet screen is showing: the Gantt (every plane's day)
 * or the Market (the lessor's shelf and leases on order). Remembered in
 * this browser so the screen opens where the player left it; a link that
 * means one half, such as a schedule alert or the HUD market chip, sets it
 * before opening Fleet.
 */

import { getSelection, select } from './selection';

export type FleetView = 'gantt' | 'market';

const FLEET_VIEW_KEY = 'airgame.fleetView';

function loadFleetView(): FleetView {
  try {
    return localStorage.getItem(FLEET_VIEW_KEY) === 'market' ? 'market' : 'gantt';
  } catch {
    // Storage can be blocked; the Gantt is the default.
    return 'gantt';
  }
}

let current: FleetView = loadFleetView();

export function fleetView(): FleetView {
  return current;
}

export function setFleetView(next: FleetView): void {
  current = next;
  try {
    localStorage.setItem(FLEET_VIEW_KEY, next);
  } catch {
    // Not remembered; fine.
  }
}

const listeners: (() => void)[] = [];

/** Called when openFleet() switches the half of a Fleet screen already showing, so the page rebuilds it. */
export function onFleetViewChange(listener: () => void): void {
  listeners.push(listener);
}

/** Open Fleet on one half: selects Fleet, or rebuilds it when it is already showing. */
export function openFleet(view: FleetView): void {
  const changed = current !== view;
  setFleetView(view);
  if (getSelection().kind !== 'fleet') select({ kind: 'fleet' });
  else if (changed) for (const listener of listeners) listener();
}
