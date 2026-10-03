import { geoMercator, type GeoProjection } from 'd3-geo';
import type { Polygon } from 'geojson';

/**
 * The rectangle of the real world visible on screen at the start,
 * centred on the player's home city and built as a GeoJSON polygon.
 * Corners are [longitude, latitude] pairs: longitude first, which trips
 * everyone up the first time because it's the opposite of the "lat, lon"
 * order most maps quote in.
 *
 * The game starts from a chosen city anywhere in the world
 * (sim/homes.ts), so the fitted box is centred on it:
 * HOME_VIEW_HALF_WIDTH_DEG either side in longitude and
 * HOME_VIEW_HALF_HEIGHT_DEG above and below, 30 by 15 degrees.
 *
 * The ring is listed clockwise (as seen on an ordinary lon-x/lat-y plot):
 * bottom-left, top-left, top-right, bottom-right, back to start. d3-geo
 * treats geometry as living on a sphere, and it decides which side of a
 * ring is the "inside" from the direction you wind it, the opposite
 * convention from flat GeoJSON tools, which expect counter-clockwise. Wind
 * it the wrong way and d3 measures the bounds of everywhere *except* this
 * box, which renders as the entire globe.
 */
const HOME_VIEW_HALF_WIDTH_DEG = 15;
const HOME_VIEW_HALF_HEIGHT_DEG = 7.5;

function homeViewBounds(lon: number, lat: number): Polygon {
  const west = lon - HOME_VIEW_HALF_WIDTH_DEG;
  const east = lon + HOME_VIEW_HALF_WIDTH_DEG;
  const south = Math.max(-80, lat - HOME_VIEW_HALF_HEIGHT_DEG);
  const north = Math.min(80, lat + HOME_VIEW_HALF_HEIGHT_DEG);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    ],
  };
}

/**
 * The single shared projection instance. Nothing else in the codebase may
 * construct a d3.geoProjection — everything that needs to turn a
 * [longitude, latitude] pair into a screen [x, y] pixel imports this.
 */
export const projection: GeoProjection = geoMercator();

/**
 * The projection's `scale` right after the most recent fit — the "100% zoom"
 * baseline. Pan/zoom code uses this to clamp how far in or out the player is
 * allowed to go, as a multiple of the zoom level that exactly frames the home
 * region, rather than as some arbitrary fixed number.
 */
export let baselineScale = 1;

/**
 * Refit the projection so the view around `home` exactly fills a
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
export function fitProjection(width: number, height: number, home: { lon: number; lat: number }): void {
  projection.fitSize([width, height], homeViewBounds(home.lon, home.lat));
  baselineScale = projection.scale();
  projection.clipExtent([
    [0, 0],
    [width, height],
  ]);
}

/**
 * Fit the whole inhabited world into a `width` x `height` canvas, kept
 * `inset` pixels in from each edge: the new-game picker's view
 * (ui/homePicker.ts), drawn through this same projection, as every map in
 * the game is.
 */
export function fitWorld(width: number, height: number, inset: { top: number; right: number; bottom: number; left: number }): void {
  // Two corners, not a ring: a ring 350° wide is ambiguous on a sphere, but
  // two points' projected bounds are just the box between them. Antarctica
  // and the far Arctic are left off; no airport is there.
  projection.fitExtent(
    [
      [inset.left, inset.top],
      [width - inset.right, height - inset.bottom],
    ],
    { type: 'MultiPoint', coordinates: [[-170, 72], [180, -50]] },
  );
  baselineScale = projection.scale();
  projection.clipExtent([
    [0, 0],
    [width, height],
  ]);
}
