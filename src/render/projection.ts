import { geoMercator, type GeoProjection } from 'd3-geo';
import type { Polygon } from 'geojson';

/**
 * The rectangle of the real world we want visible on screen, expressed as a
 * GeoJSON polygon. Corners are [longitude, latitude] pairs — longitude first,
 * which trips everyone up the first time because it's the opposite of the
 * "lat, lon" order most maps quote in.
 *
 * Originally just eastern Canada, roughly 42°N–50°N, 80°W–51°W, per
 * WEEK-ONE.md. Widened when the map grew a Labrador airport (YYR, at
 * 53.3°N — north of the old top edge) and two US ones (LGA at 40.8°N,
 * south of the old bottom edge) — 39°N–54°N, 81°W–51°W now, with a
 * couple of degrees of padding on every edge so nothing airport sits
 * flush against the frame.
 *
 * The ring is listed clockwise (as seen on an ordinary lon-x/lat-y plot):
 * bottom-left, top-left, top-right, bottom-right, back to start. d3-geo
 * treats geometry as living on a sphere, and it decides which side of a
 * ring is the "inside" from the direction you wind it — the opposite
 * convention from flat GeoJSON tools, which expect counter-clockwise. Wind
 * it the wrong way and d3 measures the bounds of everywhere *except* this
 * box, which is exactly the bug this comment is here to stop you
 * reintroducing: the first version of this file had the corners in
 * counter-clockwise order, and `fitSize` below dutifully fit the projection
 * to "the whole world minus a small rectangle over eastern Canada," which
 * rendered as the entire globe.
 */
const EASTERN_CANADA_BOUNDS: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-81, 39],
      [-81, 54],
      [-51, 54],
      [-51, 39],
      [-81, 39],
    ],
  ],
};

/**
 * The single shared projection instance. Nothing else in the codebase may
 * construct a d3.geoProjection — everything that needs to turn a
 * [longitude, latitude] pair into a screen [x, y] pixel imports this.
 */
export const projection: GeoProjection = geoMercator();

/**
 * The projection's `scale` right after the most recent fit — the "100% zoom"
 * baseline. Pan/zoom code uses this to clamp how far in or out the player is
 * allowed to go, as a multiple of the zoom level that exactly frames eastern
 * Canada, rather than as some arbitrary fixed number.
 */
export let baselineScale = 1;

/**
 * Refit the projection so EASTERN_CANADA_BOUNDS exactly fills a
 * `width` x `height` canvas, with a little breathing room.
 *
 * What "fitting" means: a projection has two knobs that control where things
 * land on screen — `scale` (how zoomed in it is) and `translate` (where its
 * center point lands in pixels). `fitSize` picks both of those automatically:
 * give it a canvas size and a GeoJSON shape, and it solves for the scale and
 * translate that make that shape fill the canvas as large as possible while
 * still fitting entirely inside it and keeping its true aspect ratio (so
 * countries aren't stretched).
 *
 * We call this once on startup and again every time the canvas resizes,
 * because "fill the canvas" depends on the canvas's current width and height.
 * Resizing therefore also resets any pan/zoom the player had applied — that's
 * a deliberate simplification for now, not an oversight.
 *
 * This also sets `clipExtent` to exactly the canvas's pixel bounds. Some
 * shapes (the night-shading circle in render/terminator.ts is the case that
 * prompted this — it's nearly half the globe) have most of their edge sit
 * thousands of pixels outside the visible area once projected. Canvas
 * renders that correctly regardless, but there's no reason to hand it
 * coordinates that extreme when d3-geo can clip the geometry down to the
 * visible rectangle first — cheaper to rasterize and one less variable if
 * something odd ever does turn up. It's defined in screen pixels, not
 * geography, so it only needs updating on resize — panning and zooming
 * don't change the canvas's own pixel bounds.
 */
export function fitProjection(width: number, height: number): void {
  projection.fitSize([width, height], EASTERN_CANADA_BOUNDS);
  baselineScale = projection.scale();
  projection.clipExtent([
    [0, 0],
    [width, height],
  ]);
}
