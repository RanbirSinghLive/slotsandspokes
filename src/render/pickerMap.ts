import { geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldTopology from '../../data/world-110m.json';
import { projection } from './projection';

/**
 * The new-game picker's world map (ui/homePicker.ts): flatter than the
 * game map on purpose. Muted land with no lakes or rivers, every airport
 * as a faint dot, the featured homes as bright ones, and the home under
 * the cursor lifted: a ring, its name, and lines to the airports its
 * starting propeller can reach. Drawn only when the cursor moves to a new
 * home or the window resizes, not every frame.
 */

const OCEAN_FILL = '#070a12';
const LAND_FILL = '#1a2133';
const COASTLINE_STROKE = '#2b3550';
const AIRPORT_DOT = 'rgba(160, 172, 200, 0.28)';
const FEATURED_DOT = '#ffd166';
const PINNED_RING = '#ffffff';
const REACH_LINE = 'rgba(255, 209, 102, 0.45)';
const REACH_DOT = '#e8ecf5';
const LABEL_TEXT = '#e8ecf5';
const LABEL_SHADOW = 'rgba(0, 0, 0, 0.85)';

const land = feature(worldTopology as unknown as Topology, (worldTopology as unknown as Topology).objects.land);

export type PickerPoint = { iata: string; lon: number; lat: number };

export type PickerView = {
  airports: PickerPoint[];
  featured: PickerPoint[];
  /** The home under the cursor, with its name and the airports it reaches. */
  lifted: { home: PickerPoint; label: string; reach: PickerPoint[] } | null;
  /** The home clicked, if any: ringed until another is chosen. */
  pinned: PickerPoint | null;
};

function screen(point: PickerPoint): [number, number] | null {
  return projection([point.lon, point.lat]);
}

export function drawPickerMap(ctx: CanvasRenderingContext2D, width: number, height: number, view: PickerView): void {
  ctx.fillStyle = OCEAN_FILL;
  ctx.fillRect(0, 0, width, height);

  const path = geoPath(projection, ctx);
  ctx.beginPath();
  path(land);
  ctx.fillStyle = LAND_FILL;
  ctx.fill();
  ctx.strokeStyle = COASTLINE_STROKE;
  ctx.lineWidth = 0.75;
  ctx.stroke();

  ctx.fillStyle = AIRPORT_DOT;
  for (const airport of view.airports) {
    const at = screen(airport);
    if (!at) continue;
    ctx.beginPath();
    ctx.arc(at[0], at[1], 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // The lifted home's reach: geodesic lines, as every route is drawn.
  if (view.lifted) {
    const { home, reach } = view.lifted;
    ctx.strokeStyle = REACH_LINE;
    ctx.lineWidth = 1;
    for (const other of reach) {
      ctx.beginPath();
      path({ type: 'LineString', coordinates: [[home.lon, home.lat], [other.lon, other.lat]] });
      ctx.stroke();
    }
    ctx.fillStyle = REACH_DOT;
    for (const other of reach) {
      const at = screen(other);
      if (!at) continue;
      ctx.beginPath();
      ctx.arc(at[0], at[1], 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = FEATURED_DOT;
  for (const home of view.featured) {
    const at = screen(home);
    if (!at) continue;
    ctx.beginPath();
    ctx.arc(at[0], at[1], 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (view.pinned) ring(ctx, view.pinned, PINNED_RING, 7);
  if (view.lifted) {
    ring(ctx, view.lifted.home, FEATURED_DOT, 9);
    label(ctx, view.lifted.home, view.lifted.label, width);
  }
}

function ring(ctx: CanvasRenderingContext2D, point: PickerPoint, color: string, radius: number): void {
  const at = screen(point);
  if (!at) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(at[0], at[1], radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** The name beside the lifted home, flipped to its left near the right edge. */
function label(ctx: CanvasRenderingContext2D, point: PickerPoint, text: string, width: number): void {
  const at = screen(point);
  if (!at) return;
  ctx.font = '600 13px ui-monospace, Consolas, monospace';
  const textWidth = ctx.measureText(text).width;
  const flip = at[0] + 14 + textWidth > width - 8;
  const x = flip ? at[0] - 14 - textWidth : at[0] + 14;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = LABEL_SHADOW;
  ctx.strokeText(text, x, at[1]);
  ctx.fillStyle = LABEL_TEXT;
  ctx.fillText(text, x, at[1]);
}
