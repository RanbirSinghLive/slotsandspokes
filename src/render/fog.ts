import { geoCircle, geoPath } from 'd3-geo';
import { drawSheet, mapGesture, projection, sheetStillFits, snapshotView, withSheetClip, type ViewSnapshot } from './projection';
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
 *
 * The sheet is rebuilt only when what it shows changes (the canvas size,
 * a pan or zoom, the reach, the airports opened up): `fogSignature`.
 * Rebuilding it every frame, a projected circle per airport, took about
 * three-quarters of a frame for a grown airline.
 */

const FOG_COLOR = 'rgba(3, 5, 9, 0.62)';
const KNOWN_DISC_NM = 45;
const FOG_MAX_RADIUS_DEG = 40;
const NM_PER_DEGREE = 60;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const fogCanvas = document.createElement('canvas');
const fogCtx = fogCanvas.getContext('2d')!;
/** What the cached sheet was drawn for; a change means a rebuild. */
let fogSignature = '';
let fogView: ViewSnapshot | null = null;

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

  const reach = bestRangeNm(state);
  const network = [...networkAirports(state)].sort();
  const margin = mapGesture.margin;
  // The view itself is not part of the signature: sheetStillFits() decides whether the sheet can be moved instead (projection.ts).
  const signature = [main.width, main.height, scale, margin, reach, network.join(','), state.knownAirports.join(',')].join('|');
  const reusable = signature === fogSignature && fogView !== null && sheetStillFits(fogView, margin, cssWidth, cssHeight);
  if (!reusable) {
    fogSignature = signature;
    rebuildFog(main.width, main.height, scale, cssWidth, cssHeight, margin, reach, network, state.knownAirports);
    fogView = snapshotView();
  }
  if (fogView) drawSheet(ctx, fogCanvas, fogView, margin, cssWidth, cssHeight);
}

function rebuildFog(width: number, height: number, scale: number, cssWidth: number, cssHeight: number, margin: number, reach: number, network: string[], known: string[]): void {
  const sheetWidth = Math.ceil(width * (1 + 2 * margin));
  const sheetHeight = Math.ceil(height * (1 + 2 * margin));
  if (fogCanvas.width !== sheetWidth || fogCanvas.height !== sheetHeight) {
    fogCanvas.width = sheetWidth;
    fogCanvas.height = sheetHeight;
  }
  const marginX = margin * cssWidth;
  const marginY = margin * cssHeight;
  fogCtx.setTransform(scale, 0, 0, scale, marginX * scale, marginY * scale);
  fogCtx.globalCompositeOperation = 'source-over';
  fogCtx.clearRect(-marginX, -marginY, cssWidth + 2 * marginX, cssHeight + 2 * marginY);
  fogCtx.fillStyle = FOG_COLOR;
  fogCtx.fillRect(-marginX, -marginY, cssWidth + 2 * marginX, cssHeight + 2 * marginY);

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

  withSheetClip(margin, cssWidth, cssHeight, () => {
    for (const iata of network) hole(iata, reach);
    for (const iata of known) hole(iata, KNOWN_DISC_NM);
  });
}
