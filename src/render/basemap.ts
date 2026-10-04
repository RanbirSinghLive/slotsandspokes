import { geoGraticule, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopology from '../../data/world-110m.json';
import lakesGeoJson from '../../data/lakes.json';
import riversGeoJson from '../../data/rivers.json';
import { drawSheet, mapGesture, projection, sheetStillFits, snapshotView, withSheetClip, type ViewSnapshot } from './projection';
import { airports, isAirportKnown } from './airports';

// The downloaded file is TopoJSON: a compact format that stores shared
// borders once instead of duplicating them for every country that touches
// them. `feature()` from topojson-client expands one named object back out
// into ordinary GeoJSON, which is the format d3.geoPath knows how to draw.
// "land" is a single shape covering every landmass, already merged across
// country borders — exactly what we want for a basemap that doesn't care
// about political boundaries yet.
let land = feature(worldTopology as unknown as Topology, (worldTopology as unknown as Topology).objects.land);

// Plain GeoJSON, not TopoJSON: lakes don't share borders with each other
// the way countries do, so there's no shared-edge compression to gain from
// the extra format (see src/headless/buildLakes.ts for where this comes
// from). d3.geoPath draws a FeatureCollection just as directly as land's
// expanded-out TopoJSON above.
const lakes = lakesGeoJson as FeatureCollection<Geometry>;

// A hand-curated handful of rivers (src/headless/buildRivers.ts), the
// world's biggest plus a few regional ones for this game's own starting
// area — real geography the map otherwise has nothing to show for between
// "landmass" and "airport dots." Also plain GeoJSON, same reasoning as
// lakes above.
const rivers = riversGeoJson as FeatureCollection<Geometry>;

// Land and water were too close in brightness to read as two different
// things at low display brightness — the whole point of a basemap that
// isn't decoration. Land is now roughly twice as bright as the page's own
// near-black background (the "ocean," showing through wherever nothing is
// drawn), which clears the WCAG "distinct UI graphics" contrast bar
// (~3:1) instead of sitting around 1.9:1 as before.
const LAND_FILL = '#2b3754';
const COASTLINE_STROKE = '#4d5b7a';
// Lakes render as the same near-black as the ocean around the continents —
// a hole punched in the land rather than a third, competing color — so
// "this is water" reads the same way whether it's the sea or a lake.
const LAKE_FILL = '#05070c';
// The ocean is a soft vertical gradient instead of the bare page color, so
// the coast doesn't meet a hard black edge; the shallows are a few wide,
// faint strokes under the coastline that read as a glow.
const OCEAN_TOP = '#0a1424';
const OCEAN_BOTTOM = '#05070c';
const SHALLOWS_STROKE = '96, 140, 200';
const GRATICULE_STROKE = 'rgba(120, 150, 200, 0.07)';

// Natural Earth 50m land replaces the 110m shape once it has loaded
// (src/headless/buildLand50.ts). It is a separate chunk fetched after the
// first frame, so the first-load bundle only carries the 110m data.
let fineLandLoaded = false;
function loadFineLand(): void {
  if (fineLandLoaded) return;
  fineLandLoaded = true;
  import('../../data/land-50m.json').then((module) => {
    const topology = module.default as unknown as Topology;
    land = feature(topology, topology.objects.land);
    basemapSignature = '';
  }).catch(() => {
    // Offline or blocked: the 110m shape stays, which is still a complete map.
    fineLandLoaded = false;
  });
}

/**
 * Draw land, its coastline, major lakes, and a few rivers onto `ctx`. Call
 * this once per frame, after clearing the canvas and before anything else
 * (routes, aircraft) is drawn on top.
 */
/**
 * The land, lakes and rivers are drawn to a cached canvas and copied onto
 * the map each frame; they're only redrawn when the view changes (a pan,
 * a zoom or a resize: `basemapSignature`).
 */
const basemapCanvas = document.createElement('canvas');
const basemapCtx = basemapCanvas.getContext('2d')!;
let basemapSignature = '';
let basemapView: ViewSnapshot | null = null;

export function drawBasemap(ctx: CanvasRenderingContext2D): void {
  const main = ctx.canvas;
  if (main.width === 0 || main.height === 0) return;
  const scale = ctx.getTransform().a;
  const cssWidth = main.width / scale;
  const cssHeight = main.height / scale;
  const margin = mapGesture.margin;
  // The view itself (pan, zoom) is not part of the signature: sheetStillFits() decides whether the picture can be moved instead.
  const signature = [main.width, main.height, scale, margin, knownAirportCount()].join('|');
  const reusable = signature === basemapSignature && basemapView !== null && sheetStillFits(basemapView, margin, cssWidth, cssHeight);
  if (!reusable) {
    basemapSignature = signature;
    const sheetWidth = Math.ceil(main.width * (1 + 2 * margin));
    const sheetHeight = Math.ceil(main.height * (1 + 2 * margin));
    if (basemapCanvas.width !== sheetWidth || basemapCanvas.height !== sheetHeight) {
      basemapCanvas.width = sheetWidth;
      basemapCanvas.height = sheetHeight;
    }
    const marginX = margin * cssWidth;
    const marginY = margin * cssHeight;
    basemapCtx.setTransform(scale, 0, 0, scale, marginX * scale, marginY * scale);
    basemapCtx.clearRect(-marginX, -marginY, cssWidth + 2 * marginX, cssHeight + 2 * marginY);
    withSheetClip(margin, cssWidth, cssHeight, () => paintBasemap(basemapCtx, cssWidth, cssHeight, marginX, marginY));
    basemapView = snapshotView();
  }
  if (basemapView) drawSheet(ctx, basemapCanvas, basemapView, margin, cssWidth, cssHeight);
}

function paintBasemap(ctx: CanvasRenderingContext2D, cssWidth: number, cssHeight: number, marginX: number, marginY: number): void {
  // d3.geoPath normally builds an SVG path string, but given a canvas 2D
  // context instead it draws directly by calling moveTo/lineTo/etc. on that
  // context. `projection` supplies the longitude/latitude -> pixel math.
  const path = geoPath(projection, ctx);
  loadFineLand();

  const ocean = ctx.createLinearGradient(0, 0, 0, cssHeight);
  ocean.addColorStop(0, OCEAN_TOP);
  ocean.addColorStop(1, OCEAN_BOTTOM);
  ctx.fillStyle = ocean;
  ctx.fillRect(-marginX, -marginY, cssWidth + 2 * marginX, cssHeight + 2 * marginY);

  ctx.beginPath();
  path(geoGraticule().step([10, 10])());
  ctx.strokeStyle = GRATICULE_STROKE;
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.beginPath();
  path(land);
  ctx.lineJoin = 'round';
  for (const [lineWidth, alpha] of [[9, 0.03], [5, 0.05], [2.5, 0.08]]) {
    ctx.strokeStyle = `rgba(${SHALLOWS_STROKE}, ${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.fillStyle = LAND_FILL;
  ctx.fill();
  ctx.strokeStyle = COASTLINE_STROKE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Drawn after land, one lake at a time rather than as a single combined
  // path, so each lake gets its own coastline stroke instead of one lake's
  // outline bleeding into a neighboring lake's fill on shared pixels.
  for (const lake of lakes.features as Feature<Geometry>[]) {
    ctx.beginPath();
    path(lake);
    ctx.fillStyle = LAKE_FILL;
    ctx.fill();
    ctx.strokeStyle = COASTLINE_STROKE;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // Rivers are lines, not shapes — stroked only, no fill call — in the
  // same void color as lake and ocean water, so a river reads as "water
  // cutting across the land" rather than a third, unrelated color.
  ctx.strokeStyle = LAKE_FILL;
  ctx.lineWidth = Math.min(2.5, Math.max(1.2, Math.pow(projection.scale() / 800, 0.4)));
  for (const river of rivers.features as Feature<Geometry>[]) {
    ctx.beginPath();
    path(river);
    ctx.stroke();
  }
  paintCityGlow(ctx);
}

function knownAirportCount(): number {
  let count = 0;
  for (const airport of airports) if (isAirportKnown(airport.iata)) count++;
  return count;
}

// Cities as a warm glow on the land, sized by metro population and growing
// as the map zooms in, so the map shows where people are before any route
// does. Only known airports glow: an unknown city would give away the fog.
const CITY_GLOW_RGB = '255, 196, 120';

function paintCityGlow(ctx: CanvasRenderingContext2D): void {
  const zoomFactor = Math.min(2.4, Math.max(0.8, Math.pow(projection.scale() / 800, 0.35)));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const airport of airports) {
    if (!isAirportKnown(airport.iata)) continue;
    const at = projection([airport.lon, airport.lat]);
    if (!at) continue;
    const radius = (7 + 11 * Math.sqrt(airport.population / 1_000_000)) * zoomFactor;
    const glow = ctx.createRadialGradient(at[0], at[1], 0, at[0], at[1], radius);
    glow.addColorStop(0, `rgba(${CITY_GLOW_RGB}, 0.8)`);
    glow.addColorStop(0.45, `rgba(${CITY_GLOW_RGB}, 0.3)`);
    glow.addColorStop(1, `rgba(${CITY_GLOW_RGB}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(at[0] - radius, at[1] - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}
