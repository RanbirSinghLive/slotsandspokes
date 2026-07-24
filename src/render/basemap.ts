import { geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopology from '../../data/world-110m.json';
import { projection } from './projection';

// The downloaded file is TopoJSON: a compact format that stores shared
// borders once instead of duplicating them for every country that touches
// them. `feature()` from topojson-client expands one named object back out
// into ordinary GeoJSON, which is the format d3.geoPath knows how to draw.
// "land" is a single shape covering every landmass, already merged across
// country borders — exactly what we want for a basemap that doesn't care
// about political boundaries yet.
const land = feature(worldTopology as unknown as Topology, (worldTopology as unknown as Topology).objects.land);

const LAND_FILL = '#141824';
const COASTLINE_STROKE = '#2a3040';

/**
 * Draw land and coastlines onto `ctx`. Call this once per frame, after
 * clearing the canvas and before anything else (routes, aircraft) is drawn
 * on top.
 */
export function drawBasemap(ctx: CanvasRenderingContext2D): void {
  // d3.geoPath normally builds an SVG path string, but given a canvas 2D
  // context instead it draws directly by calling moveTo/lineTo/etc. on that
  // context. `projection` supplies the longitude/latitude -> pixel math.
  const path = geoPath(projection, ctx);

  ctx.beginPath();
  path(land);
  ctx.fillStyle = LAND_FILL;
  ctx.fill();
  ctx.strokeStyle = COASTLINE_STROKE;
  ctx.lineWidth = 1;
  ctx.stroke();
}
