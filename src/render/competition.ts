import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, drawAirports } from './airports';
import { scheduleLegs } from '../sim/schedule';
import { competitors } from '../sim/choiceModel';

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

// Three, and only three, states a market can be in relative to whichever
// competitor set is currently being considered (either "any competitor,"
// for the aggregate view, or one specific airline's own routes) — see
// drawCompetitionLayer(). Amber reuses the same "this already exists/is
// served" meaning it carries in ui/routeBuilder.ts's new-route highlight
// and render/demand.ts's served-halo, rather than inventing a fourth,
// unrelated color for "both of us fly this."
const OWN_ONLY_STROKE = '#3a4258';
const COMPETITOR_ONLY_STROKE = '#e05a5a';
const BOTH_STROKE = '#ffd166';

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
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * The "Competition" map mode. `selectedAirline` picks which competitor
 * set is being compared against your own network: `null` means "any
 * competitor" (the aggregate view); a specific airline name means just
 * that one carrier's routes. Either way, every market that either side
 * flies falls into exactly one of three states, each its own color:
 *
 * - **Yours only** — the competitor set doesn't serve it at all.
 * - **Theirs only** — a market you don't fly, but they do. Drawn just as
 *   visibly as your own routes, deliberately: a competitor-exclusive
 *   market (like Trillium Air's YYZ-YOW, which you don't fly) is exactly
 *   the kind of open-or-contested market this view exists to surface,
 *   not background noise to dim out.
 * - **Both** — a market you're already head-to-head on.
 *
 * Selecting a specific airline answers "show me their route map" (both
 * their shared and exclusive markets, in one glance) without needing a
 * separate dimmed/highlighted treatment — the three-color split already
 * does that job.
 */
export function drawCompetitionLayer(ctx: CanvasRenderingContext2D, selectedAirline: string | null): void {
  const path = geoPath(projection, ctx);

  const competitorMarketKeys =
    selectedAirline === null ? allCompetitorMarketKeys : new Set(competitorRoutesByAirline.get(selectedAirline)?.keys() ?? []);
  const competitorRoutes =
    selectedAirline === null ? allMarketRoutes : (competitorRoutesByAirline.get(selectedAirline) ?? new Map());

  const everyMarketKey = new Set<string>([...ownRoutes.keys(), ...competitorMarketKeys]);

  for (const key of everyMarketKey) {
    const route = ownRoutes.get(key) ?? competitorRoutes.get(key);
    if (!route) continue;

    const flownByOwn = ownRoutes.has(key);
    const flownByCompetitor = competitorMarketKeys.has(key);
    const stroke = flownByOwn && flownByCompetitor ? BOTH_STROKE : flownByCompetitor ? COMPETITOR_ONLY_STROKE : OWN_ONLY_STROKE;

    drawLine(ctx, path, route.origin, route.dest, stroke);
  }

  drawAirports(ctx);
}
