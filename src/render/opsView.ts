/**
 * The map's Ops lens: the extra operating detail drawn over
 * the map (larger planes with trails and tails, grounded planes and
 * cancelled legs, fare-gap ticks, crew and slot chips, route width by
 * volume, hub badges). Off, the map is the plain network; on, it is the
 * control-room version of the same map, with routes coloured by on-time.
 * main.ts's setLens() turns it on exactly when the Ops lens is picked, so
 * it is a view choice, not in `SimState` and not part of a save.
 *
 * Every renderer that adds operating detail asks `isOpsView()` and draws
 * nothing extra when it is false, so the base map never changes.
 */
let on = false;

export function isOpsView(): boolean {
  return on;
}

export function setOpsView(next: boolean): void {
  on = next;
}
