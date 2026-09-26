import type { MapPreview, RoutePreview } from '../sim/playerActions';

/**
 * What the map should show for the radial button currently under the
 * pointer: the same change the button would make, drawn before it is made.
 * Lives in the render layer because the map, the pool bars and the base
 * rings all read it, and none of them may write to `SimState`. The map
 * menu (ui/mapMenu.ts) is the only writer.
 *
 * A preview is never state and never saved; it exists only while a button
 * is hovered. Its shape is sim/playerActions.ts's, since each action's
 * preview function builds one.
 */

export type { MapPreview, RoutePreview };

let current: MapPreview | null = null;

export function setMapPreview(preview: MapPreview | null): void {
  current = preview;
}

export function getMapPreview(): MapPreview | null {
  return current;
}
