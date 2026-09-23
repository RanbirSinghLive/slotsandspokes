import { geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopology from '../../data/world-110m.json';
import lakesGeoJson from '../../data/lakes.json';
import { projection } from './projection';

// The downloaded file is TopoJSON: a compact format that stores shared
// borders once instead of duplicating them for every country that touches
// them. `feature()` from topojson-client expands one named object back out
// into ordinary GeoJSON, which is the format d3.geoPath knows how to draw.
// "land" is a single shape covering every landmass, already merged across
// country borders — exactly what we want for a basemap that doesn't care
// about political boundaries yet.
const land = feature(worldTopology as unknown as Topology, (worldTopology as unknown as Topology).objects.land);

// Plain GeoJSON, not TopoJSON: lakes don't share borders with each other
// the way countries do, so there's no shared-edge compression to gain from
// the extra format (see src/headless/buildLakes.ts for where this comes
// from). d3.geoPath draws a FeatureCollection just as directly as land's
// expanded-out TopoJSON above.
const lakes = lakesGeoJson as FeatureCollection<Geometry>;

// Land and water were too close in brightness to read as two different
// things at low display brightness — the whole point of a basemap that
// isn't decoration. Land is now roughly twice as bright as the page's own
// near-black background (the "ocean," showing through wherever nothing is
// drawn), which clears the WCAG "distinct UI graphics" contrast bar
// (~3:1) instead of sitting around 1.9:1 as before.
const LAND_FILL = '#28324a';
const COASTLINE_STROKE = '#4d5b7a';
// Lakes render as the same near-black as the ocean around the continents —
// a hole punched in the land rather than a third, competing color — so
// "this is water" reads the same way whether it's the sea or a lake.
const LAKE_FILL = '#05070c';

/**
 * Draw land, its coastline, and major lakes onto `ctx`. Call this once per
 * frame, after clearing the canvas and before anything else (routes,
 * aircraft) is drawn on top.
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
}
