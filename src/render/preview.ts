import type { PoolEffect } from '../sim/utilisation';

/**
 * What the map should show for the radial button currently under the
 * pointer: the same change the button would make, drawn before it is made.
 * Lives in the render layer because the map, the pool bars and the base
 * rings all read it, and none of them may write to `SimState`. The map
 * menu (ui/mapMenu.ts) is the only writer.
 *
 * A preview is never state and never saved; it exists only while a button
 * is hovered.
 */

export type RoutePreview = {
  origin: string;
  dest: string;
  /** add: green, remove: red dashed, change: amber. */
  kind: 'add' | 'remove' | 'change';
};

export type MapPreview = {
  /** How pool bookings would change, for the bars and the base rings. */
  effects: PoolEffect[];
  /** Routes to draw emphasised on the map. */
  routes: RoutePreview[];
};

let current: MapPreview | null = null;

export function setMapPreview(preview: MapPreview | null): void {
  current = preview;
}

export function getMapPreview(): MapPreview | null {
  return current;
}
