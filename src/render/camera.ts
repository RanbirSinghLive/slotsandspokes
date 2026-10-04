import { baselineScale, mapSize, projection } from './projection';

/**
 * The map's camera: where the shared projection is looking and how far in.
 * Pan, zoom and "keep what the player was looking at" live here, so the input
 * code (main.ts) only decides what the player meant and the drawing code never
 * needs to know how the view got where it is. Every function changes the
 * projection and nothing else; the caller draws.
 */

// Zoomed all the way out shows most of the world, which a widebody's reach
// can now open up (fog by reach, sim/reach.ts).
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 20;

/**
 * Zoom by `factor`, keeping the geographic point under map pixel (x, y) where it is.
 *
 * Changing `projection.scale()` alone would zoom toward the map's reference
 * point, not toward the pointer, and the whole map would slide sideways. So:
 * find the [longitude, latitude] under the point *before* the change, apply the
 * new scale, see where that same point lands *after*, and nudge `translate` by
 * the difference.
 */
export function zoomAt(x: number, y: number, factor: number): void {
  const geoUnderPoint = projection.invert?.([x, y]);
  if (!geoUnderPoint) return;
  const clampedScale = Math.min(Math.max(projection.scale() * factor, baselineScale * MIN_ZOOM), baselineScale * MAX_ZOOM);
  projection.scale(clampedScale);
  const [driftedX, driftedY] = projection(geoUnderPoint)!;
  const [tx, ty] = projection.translate();
  projection.translate([tx + (x - driftedX), ty + (y - driftedY)]);
}

/** Slide the map by (dx, dy) pixels from where its translate was when a drag began. */
export function panFrom(start: [number, number], dx: number, dy: number): void {
  projection.translate([start[0] + dx, start[1] + dy]);
}

/** Slide the map by (dx, dy) pixels from where it is now. */
export function panBy(dx: number, dy: number): void {
  const [tx, ty] = projection.translate();
  projection.translate([tx + dx, ty + dy]);
}

/** What the player is looking at, so a resize that only changes the box can keep it. */
export type View = { zoom: number; centre: [number, number] };

export function currentView(): View | null {
  const { width, height } = mapSize();
  const centre = projection.invert?.([width / 2, height / 2]);
  return centre && width > 0 ? { zoom: projection.scale() / baselineScale, centre } : null;
}

/** Put `view` back, centred in a `width` x `height` box, after the projection was refitted. */
export function restoreView(view: View, width: number, height: number): void {
  projection.scale(baselineScale * view.zoom);
  const [x, y] = projection(view.centre)!;
  panBy(width / 2 - x, height / 2 - y);
}
