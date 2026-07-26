import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, drawAirports } from './airports';
import { scheduleLegs } from '../sim/schedule';
import { competitors } from '../sim/choiceModel';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const DEFAULT_STROKE = '#3a4258';
const COMPETITOR_STROKE = '#e05a5a';
const DIMMED_ALPHA = 0.35;

/**
 * Same bidirectional market-pair key every other "market" concept in this
 * codebase uses (render/routes.ts, sim/schedule.ts's marketKey(), etc.) —
 * duplicated locally rather than imported, matching the existing pattern
 * of a small local copy per file rather than a shared utility.
 */
function marketKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

const ownRoutes = new Map<string, { origin: string; dest: string }>();
for (const leg of scheduleLegs) {
  const key = marketKey(leg.origin, leg.dest);
  if (!ownRoutes.has(key)) ownRoutes.set(key, { origin: leg.origin, dest: leg.dest });
}

const competitorRoutesByAirline = new Map<string, Map<string, { origin: string; dest: string }>>();
for (const c of competitors) {
  const key = marketKey(c.origin, c.dest);
  const forAirline = competitorRoutesByAirline.get(c.airline) ?? new Map();
  if (!forAirline.has(key)) forAirline.set(key, { origin: c.origin, dest: c.dest });
  competitorRoutesByAirline.set(c.airline, forAirline);
}

const allCompetitorMarketKeys = new Set<string>();
const allMarketRoutes = new Map<string, { origin: string; dest: string }>(ownRoutes);
for (const forAirline of competitorRoutesByAirline.values()) {
  for (const [key, route] of forAirline) {
    allCompetitorMarketKeys.add(key);
    if (!allMarketRoutes.has(key)) allMarketRoutes.set(key, route);
  }
}

/**
 * Every airline with at least one competitor entry, sorted — exported so
 * main.ts can populate the per-airline selector without duplicating
 * data/competitors.json's shape or re-deriving this list itself.
 */
export function competitorAirlines(): string[] {
  return [...competitorRoutesByAirline.keys()].sort();
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  path: ReturnType<typeof geoPath>,
  origin: string,
  dest: string,
  strokeStyle: string,
  alpha: number,
): void {
  const originAirport = airportsByIata.get(origin);
  const destAirport = airportsByIata.get(dest);
  if (!originAirport || !destAirport) return;

  const line: LineString = {
    type: 'LineString',
    coordinates: [
      [originAirport.lon, originAirport.lat],
      [destAirport.lon, destAirport.lat],
    ],
  };

  ctx.beginPath();
  path(line);
  ctx.strokeStyle = strokeStyle;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * The "Competition" map mode. Two states, chosen by `selectedAirline`:
 *
 * - `null` (aggregate, the default): every market either you or a
 *   competitor serves gets drawn — red if a competitor is on it (whether
 *   or not you also fly it), your own default color otherwise. This is
 *   deliberately not "highlight red on top of your own network": a
 *   competitor-exclusive market (one they fly that you don't) is drawn
 *   too, in red, since it's exactly the kind of thing this view exists to
 *   surface — an open market you aren't in yet, or one already spoken for.
 * - a specific airline name: your own network dims to context, and only
 *   that airline's own routes draw in the competitor color — literally
 *   "their route map," including whichever of their routes overlap with
 *   yours and whichever don't.
 */
export function drawCompetitionLayer(ctx: CanvasRenderingContext2D, selectedAirline: string | null): void {
  const path = geoPath(projection, ctx);

  if (selectedAirline === null) {
    for (const [key, { origin, dest }] of allMarketRoutes) {
      const hasCompetitor = allCompetitorMarketKeys.has(key);
      drawLine(ctx, path, origin, dest, hasCompetitor ? COMPETITOR_STROKE : DEFAULT_STROKE, 1);
    }
  } else {
    for (const { origin, dest } of ownRoutes.values()) {
      drawLine(ctx, path, origin, dest, DEFAULT_STROKE, DIMMED_ALPHA);
    }
    const forAirline = competitorRoutesByAirline.get(selectedAirline);
    if (forAirline) {
      for (const { origin, dest } of forAirline.values()) {
        drawLine(ctx, path, origin, dest, COMPETITOR_STROKE, 1);
      }
    }
  }

  ctx.globalAlpha = 1;
  drawAirports(ctx);
}
