import { geoCircle, geoPath } from 'd3-geo';
import { projection } from './projection';
import { airports } from './airports';
import { bestRangeNm, networkAirports } from '../sim/reach';
import type { SimState } from '../sim/state';

/**
 * The fog over the part of the world you have not opened up yet. A dark
 * sheet covers the whole map, with holes punched out around:
 *
 * - every airport in your network, out to your reach (the range of your
 *   biggest leased class), so the edge of the clear area *is* how far you
 *   could fly from where you are; and
 * - every airport you know, in a small disc, so a place you have seen
 *   never sits in the dark even after the plane that revealed it is gone.
 *
 * Drawn on an offscreen canvas and composited, because punching holes
 * ("destination-out") on the main canvas would erase the basemap under it.
 * Reach circles are capped at FOG_MAX_RADIUS_DEG: a widebody's 5,500 nm
 * circle covers a third of the globe, and a Mercator map cannot draw a
 * circle that swallows a pole. The airports beyond the cap are still
 * known and still drawn, they just sit in their own small clear disc.
 */

const FOG_COLOR = 'rgba(3, 5, 9, 0.62)';
const KNOWN_DISC_NM = 45;
const FOG_MAX_RADIUS_DEG = 40;
const NM_PER_DEGREE = 60;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const fogCanvas = document.createElement('canvas');
const fogCtx = fogCanvas.getContext('2d')!;

export function drawFog(ctx: CanvasRenderingContext2D, state: SimState): void {
  const main = ctx.canvas;
  const scale = ctx.getTransform().a;
  const cssWidth = main.width / scale;
  const cssHeight = main.height / scale;
  // A map with no area (a tab opened in the background, or a window
  // narrower than the side panel) has nothing to fog — and drawImage()
  // throws on a zero-sized source canvas, which would abort main.ts
  // before the game loop or the home picker had even started.
  if (main.width === 0 || main.height === 0) return;

  if (fogCanvas.width !== main.width || fogCanvas.height !== main.height) {
    fogCanvas.width = main.width;
    fogCanvas.height = main.height;
  }
  fogCtx.setTransform(scale, 0, 0, scale, 0, 0);
  fogCtx.globalCompositeOperation = 'source-over';
  fogCtx.clearRect(0, 0, cssWidth, cssHeight);
  fogCtx.fillStyle = FOG_COLOR;
  fogCtx.fillRect(0, 0, cssWidth, cssHeight);

  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.fillStyle = '#000';
  const path = geoPath(projection, fogCtx);
  const hole = (iata: string, radiusNm: number): void => {
    const airport = airportsByIata.get(iata);
    if (!airport) return;
    const radiusDeg = Math.min(radiusNm / NM_PER_DEGREE, FOG_MAX_RADIUS_DEG);
    fogCtx.beginPath();
    path(geoCircle().center([airport.lon, airport.lat]).radius(radiusDeg)());
    fogCtx.fill();
  };

  const reach = bestRangeNm(state);
  for (const iata of networkAirports(state)) hole(iata, reach);
  for (const iata of state.knownAirports) hole(iata, KNOWN_DISC_NM);

  ctx.drawImage(fogCanvas, 0, 0, cssWidth, cssHeight);
}
