import { geoPath, geoInterpolate } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports, type Airport } from './airports';
import { PLAYER_AIRLINE } from '../sim/airline';
import type { SimState } from '../sim/state';

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
 * One color per airline code, for the hover tooltip's pie chart — a
 * different concern from the three-state OWN/COMPETITOR/BOTH line colors
 * above, since a pie needs to tell *multiple* competitors apart from each
 * other, not just from the player. Hand-picked, no attempt at a generated
 * palette — four airlines is few enough to just name each one. A future
 * airline without an entry here falls back to a plain gray rather than
 * erroring.
 */
const AIRLINE_COLORS: Record<string, string> = {
  [PLAYER_AIRLINE.code]: '#4a90d9',
  CW: '#ffb347',
  TA: '#e05a5a',
  BR: '#b388ff',
};

function colorForAirline(code: string): string {
  return AIRLINE_COLORS[code] ?? '#9aa3b8';
}

/**
 * Same bidirectional market-pair key every other "market" concept in this
 * codebase uses (render/routes.ts, sim/schedule.ts's marketKey(), etc.) —
 * duplicated locally rather than imported, matching the existing pattern
 * of a small local copy per file rather than a shared utility.
 */
function marketKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

// Competitor routes (data/competitors.json) never change at runtime, so
// these stay module-level. The player's own routes are the opposite —
// state.schedule is exactly what the player edits in-session (add/remove a
// route or frequency) — so they're computed fresh per call by
// ownRoutesFrom() below, never cached, the same fix render/routes.ts
// already got: this file used to build `ownRoutes` once at import time
// from the static `scheduleLegs` template, which meant the yours/theirs/
// both coloring, the hover tooltip's frequency counts, and even a brand
// new game's "New Game" reset never actually reflected what the player had
// really built — every one of them kept showing the original 8-market
// template forever, regardless of any in-game edit.
function ownRoutesFrom(state: SimState): Map<string, { origin: string; dest: string }> {
  const routes = new Map<string, { origin: string; dest: string }>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (!routes.has(key)) routes.set(key, { origin: leg.origin, dest: leg.dest });
  }
  return routes;
}

// Week four (M14): competitor routes used to never change at runtime, so
// these were built once at import time from the static data. The
// competitor AI (sim/competitors.ts) can now grow state.competitorRoutes
// mid-game, so these are recomputed fresh from `state` on every call
// instead — the same fix ownRoutesFrom() above already got (see its own
// comment) for the exact same reason: anything built once from a
// snapshot silently stops reflecting reality the moment that snapshot
// changes.
function competitorRoutesByAirlineFrom(state: SimState): Map<string, Map<string, { origin: string; dest: string }>> {
  const byAirline = new Map<string, Map<string, { origin: string; dest: string }>>();
  for (const c of state.competitorRoutes) {
    const key = marketKey(c.origin, c.dest);
    const forAirline = byAirline.get(c.airline) ?? new Map();
    if (!forAirline.has(key)) forAirline.set(key, { origin: c.origin, dest: c.dest });
    byAirline.set(c.airline, forAirline);
  }
  return byAirline;
}

function allCompetitorMarketKeysFrom(byAirline: Map<string, Map<string, { origin: string; dest: string }>>): Set<string> {
  const keys = new Set<string>();
  for (const forAirline of byAirline.values()) {
    for (const key of forAirline.keys()) keys.add(key);
  }
  return keys;
}

/**
 * Every airline with at least one competitor route, sorted — exported so
 * main.ts can populate the per-airline selector without duplicating
 * data/competitors.json's shape or re-deriving this list itself. The
 * roster itself (which airline *names* exist) never grows after game
 * start — the competitor AI only adds routes for the three airlines
 * already in `data/competitors.json`, never invents a new one — so
 * calling this once at startup, as main.ts already does, stays valid
 * for the whole game even though the routes each airline serves keep
 * changing underneath it.
 */
export function competitorAirlines(state: SimState): string[] {
  return [...competitorRoutesByAirlineFrom(state).keys()].sort();
}

/**
 * The markets actually drawn for a given selection — `null` for the
 * aggregate ("any competitor") view, a specific airline name otherwise.
 * Shared by drawCompetitionLayer() and findCompetitionHover() so hit-
 * testing can never test against a market that isn't actually on screen.
 * Takes `ownRoutes` (from ownRoutesFrom(state)) and the freshly-computed
 * `competitorRoutesByAirline`/`allCompetitorMarketKeys` as parameters
 * rather than recomputing any of them itself, since callers that also
 * need strokeFor() would otherwise be computing the same thing twice per
 * call.
 */
function visibleMarkets(
  ownRoutes: Map<string, { origin: string; dest: string }>,
  selectedAirline: string | null,
  competitorRoutesByAirline: Map<string, Map<string, { origin: string; dest: string }>>,
  allCompetitorMarketKeys: Set<string>,
): Map<string, { origin: string; dest: string }> {
  let competitorRoutes: Map<string, { origin: string; dest: string }>;
  let competitorMarketKeys: Set<string>;
  if (selectedAirline === null) {
    competitorRoutes = new Map(ownRoutes);
    for (const forAirline of competitorRoutesByAirline.values()) {
      for (const [key, route] of forAirline) {
        if (!competitorRoutes.has(key)) competitorRoutes.set(key, route);
      }
    }
    competitorMarketKeys = allCompetitorMarketKeys;
  } else {
    competitorRoutes = competitorRoutesByAirline.get(selectedAirline) ?? new Map();
    competitorMarketKeys = new Set(competitorRoutesByAirline.get(selectedAirline)?.keys() ?? []);
  }

  const result = new Map<string, { origin: string; dest: string }>();
  for (const key of new Set([...ownRoutes.keys(), ...competitorMarketKeys])) {
    const route = ownRoutes.get(key) ?? competitorRoutes.get(key);
    if (route) result.set(key, route);
  }
  return result;
}

function strokeFor(
  key: string,
  selectedAirline: string | null,
  ownRoutes: Map<string, { origin: string; dest: string }>,
  competitorRoutesByAirline: Map<string, Map<string, { origin: string; dest: string }>>,
  allCompetitorMarketKeys: Set<string>,
): string {
  const competitorMarketKeys =
    selectedAirline === null ? allCompetitorMarketKeys : new Set(competitorRoutesByAirline.get(selectedAirline)?.keys() ?? []);
  const flownByOwn = ownRoutes.has(key);
  const flownByCompetitor = competitorMarketKeys.has(key);
  return flownByOwn && flownByCompetitor ? BOTH_STROKE : flownByCompetitor ? COMPETITOR_ONLY_STROKE : OWN_ONLY_STROKE;
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
 * The Competition overlay (week four — was an exclusive "mode," now a
 * toggle that *replaces* the Ops base layer's plain route coloring rather
 * than drawing alongside it — see main.ts's render()). `selectedAirline`
 * picks which competitor set is being compared against your own network:
 * `null` means "any competitor" (the aggregate view); a specific airline
 * name means just that one carrier's routes. Either way, every market
 * that either side flies falls into exactly one of three states, each its
 * own color:
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
 *
 * Doesn't draw airports any more — main.ts's base Ops layer always draws
 * them once, regardless of which overlays are on.
 */
export function drawCompetitionLayer(ctx: CanvasRenderingContext2D, selectedAirline: string | null, state: SimState): void {
  const path = geoPath(projection, ctx);
  const ownRoutes = ownRoutesFrom(state);
  const competitorRoutesByAirline = competitorRoutesByAirlineFrom(state);
  const allCompetitorMarketKeys = allCompetitorMarketKeysFrom(competitorRoutesByAirline);

  for (const [key, { origin, dest }] of visibleMarkets(ownRoutes, selectedAirline, competitorRoutesByAirline, allCompetitorMarketKeys)) {
    drawLine(ctx, path, origin, dest, strokeFor(key, selectedAirline, ownRoutes, competitorRoutesByAirline, allCompetitorMarketKeys));
  }
}

export type Operator = { code: string; name: string; color: string; frequency: number };

/**
 * Every airline serving `origin`-`dest` (the player included, if they fly
 * it), each with their total daily frequency on that market — the raw
 * material for the hover tooltip's pie chart. Always the *complete*
 * picture regardless of the map's current airline filter, since knowing
 * "who else is here" is the whole point of hovering a route.
 */
export function operatorsForMarket(origin: string, dest: string, state: SimState): Operator[] {
  const key = marketKey(origin, dest);
  const operators: Operator[] = [];

  const frequency = state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key).length;
  if (frequency > 0) {
    operators.push({ code: PLAYER_AIRLINE.code, name: PLAYER_AIRLINE.name, color: colorForAirline(PLAYER_AIRLINE.code), frequency });
  }

  const competitorFrequencyByCode = new Map<string, { name: string; frequency: number }>();
  for (const c of state.competitorRoutes) {
    if (marketKey(c.origin, c.dest) !== key) continue;
    const existing = competitorFrequencyByCode.get(c.code);
    if (existing) existing.frequency += c.dailyFrequency;
    else competitorFrequencyByCode.set(c.code, { name: c.airline, frequency: c.dailyFrequency });
  }
  for (const [code, { name, frequency }] of competitorFrequencyByCode) {
    operators.push({ code, name, color: colorForAirline(code), frequency });
  }

  return operators;
}

/**
 * Every airline with at least one flight touching `iata` (departing or
 * arriving), summed across all of that airport's markets — the airport-
 * hover equivalent of operatorsForMarket() above.
 */
export function operatorsForAirport(iata: string, state: SimState): Operator[] {
  const frequencyByCode = new Map<string, { name: string; frequency: number }>();

  function add(code: string, name: string, frequency: number): void {
    const existing = frequencyByCode.get(code);
    if (existing) existing.frequency += frequency;
    else frequencyByCode.set(code, { name, frequency });
  }

  for (const leg of state.schedule) {
    if (leg.origin === iata || leg.dest === iata) add(PLAYER_AIRLINE.code, PLAYER_AIRLINE.name, 1);
  }
  for (const c of state.competitorRoutes) {
    if (c.origin === iata || c.dest === iata) add(c.code, c.airline, c.dailyFrequency);
  }

  return [...frequencyByCode.entries()].map(([code, { name, frequency }]) => ({
    code,
    name,
    color: colorForAirline(code),
    frequency,
  }));
}

const AIRPORT_HIT_RADIUS_PX = 8;
const MARKET_HIT_RADIUS_PX = 6;
const ARC_SAMPLE_STEPS = 24;

function distanceToPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Distance in screen pixels from (screenX, screenY) to the geodesic arc
 * between two airports — sampled the same way aircraft.ts positions a
 * flight along its route, since d3.geoPath has no built-in "distance to
 * this path" query. Fine at this scale: a couple dozen samples per arc,
 * at most nine arcs on screen at once.
 */
function distanceToArc(origin: Airport, dest: Airport, screenX: number, screenY: number): number {
  const interpolate = geoInterpolate([origin.lon, origin.lat], [dest.lon, dest.lat]);
  let minDist = Infinity;
  let previous: [number, number] | null = null;

  for (let i = 0; i <= ARC_SAMPLE_STEPS; i++) {
    const [lon, lat] = interpolate(i / ARC_SAMPLE_STEPS);
    const point = projection([lon, lat]);
    if (!point) continue;
    if (previous) {
      minDist = Math.min(minDist, distanceToPointSegment(screenX, screenY, previous[0], previous[1], point[0], point[1]));
    }
    previous = point;
  }

  return minDist;
}

export type CompetitionHover = { type: 'airport'; iata: string } | { type: 'market'; origin: string; dest: string };

/**
 * What's under the cursor on the map, for the hover tooltip: an airport
 * takes priority (a point is a smaller, more precise target than a
 * line), then the nearest visible market arc within its hit radius.
 * `null` if neither is close enough.
 *
 * `includeCompetitors` (week four — was implicitly always true back when
 * this only ran in an exclusive Competition mode) restricts which market
 * arcs count as hoverable to just `ownRoutes` when the Competition
 * overlay is off: competitor-only arcs aren't drawn on screen at all in
 * that case (`main.ts`'s render() draws plain `drawRoutes()` instead of
 * `drawCompetitionLayer()`), so hit-testing against them would let you
 * hover something invisible. Airports stay hoverable either way — they're
 * always drawn, and your own operator info is always fair game.
 */
export function findCompetitionHover(
  screenX: number,
  screenY: number,
  selectedAirline: string | null,
  state: SimState,
  includeCompetitors: boolean,
): CompetitionHover | null {
  let nearestIata: string | null = null;
  let nearestAirportDist = AIRPORT_HIT_RADIUS_PX;
  for (const airport of airports) {
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const dist = Math.hypot(point[0] - screenX, point[1] - screenY);
    if (dist < nearestAirportDist) {
      nearestAirportDist = dist;
      nearestIata = airport.iata;
    }
  }
  if (nearestIata) return { type: 'airport', iata: nearestIata };

  const ownRoutes = ownRoutesFrom(state);
  let marketsToTest = ownRoutes;
  if (includeCompetitors) {
    const competitorRoutesByAirline = competitorRoutesByAirlineFrom(state);
    marketsToTest = visibleMarkets(
      ownRoutes,
      selectedAirline,
      competitorRoutesByAirline,
      allCompetitorMarketKeysFrom(competitorRoutesByAirline),
    );
  }

  let nearestMarket: { origin: string; dest: string } | null = null;
  let nearestMarketDist = MARKET_HIT_RADIUS_PX;
  for (const { origin, dest } of marketsToTest.values()) {
    const originAirport = airportsByIata.get(origin);
    const destAirport = airportsByIata.get(dest);
    if (!originAirport || !destAirport) continue;
    const dist = distanceToArc(originAirport, destAirport, screenX, screenY);
    if (dist < nearestMarketDist) {
      nearestMarketDist = dist;
      nearestMarket = { origin, dest };
    }
  }
  if (nearestMarket) return { type: 'market', origin: nearestMarket.origin, dest: nearestMarket.dest };

  return null;
}

// --- "A competitor just opened a route" flash (week four, M14) ---
//
// The competitor AI (sim/competitors.ts) stamps every route it opens with
// `openedAtMinute`, but *when* that flash should actually play on screen
// is a real-time question, not a sim-time one: at 20x speed a fixed
// sim-minute window would flicker past in milliseconds, and at 1x it
// would linger far longer than intended. So this tracks "have I already
// drawn this route's opening" using wall-clock `performance.now()`
// timestamps kept here in the render layer, not in `state` — the same
// category of transient, UI-owned bookkeeping as ui/routeBuilder.ts's
// builder state or main.ts's `latestFractionalMinute`, never written back.

const FLASH_DURATION_MS = 4000;
const NEW_ROUTE_FLASH_STROKE = '#ffd166'; // same amber "new/highlighted" language as BOTH_STROKE above

type ActiveFlash = { origin: string; dest: string; airline: string; startedAtMs: number };

function competitorRouteIdentity(origin: string, dest: string, code: string): string {
  return `${code}:${marketKey(origin, dest)}`;
}

// Seeded from whatever's already in state.competitorRoutes the first
// time this runs (a fresh page load, or a resumed save with routes the
// AI already opened in a previous session) so those don't all flash at
// once the instant the map first renders — only routes that appear
// *after* that first call are genuinely "new."
let hasSeenInitialCompetitorRoutes = false;
const seenCompetitorRouteKeys = new Set<string>();
let activeFlashes: ActiveFlash[] = [];

function noteNewCompetitorRoutes(state: SimState, nowMs: number): void {
  if (!hasSeenInitialCompetitorRoutes) {
    for (const c of state.competitorRoutes) {
      seenCompetitorRouteKeys.add(competitorRouteIdentity(c.origin, c.dest, c.code));
    }
    hasSeenInitialCompetitorRoutes = true;
    return;
  }

  for (const c of state.competitorRoutes) {
    const id = competitorRouteIdentity(c.origin, c.dest, c.code);
    if (seenCompetitorRouteKeys.has(id)) continue;
    seenCompetitorRouteKeys.add(id);
    activeFlashes.push({ origin: c.origin, dest: c.dest, airline: c.airline, startedAtMs: nowMs });
  }

  if (activeFlashes.length > 0) {
    activeFlashes = activeFlashes.filter((flash) => nowMs - flash.startedAtMs < FLASH_DURATION_MS);
  }
}

/**
 * Draw every currently-active "new competitor route" flash: a pulsing,
 * fading amber arc between the two airports, plus a small label naming
 * the airline, so a route opening reads as *news* the moment it happens
 * rather than a line that was simply always there. Always drawn on the
 * map panel regardless of the Competition/Demand overlay toggles —
 * "a rival just opened a route" is worth surfacing even if you weren't
 * specifically looking at the competitive layer, the same "the map is
 * not decoration" reasoning CLAUDE.md already applies to everything else
 * drawn on it.
 *
 * `noteNewCompetitorRoutes()` (which does the actual diffing against
 * `state.competitorRoutes`) only runs while this is being called, i.e.
 * only while the map panel is actually visible — main.ts's render()
 * simply doesn't call this at all otherwise. A route opened while the
 * player was on a different panel is caught the moment they switch back,
 * rather than being silently missed.
 */
export function drawNewCompetitorRouteFlashes(ctx: CanvasRenderingContext2D, state: SimState, nowMs: number): void {
  noteNewCompetitorRoutes(state, nowMs);
  if (activeFlashes.length === 0) return;

  const path = geoPath(projection, ctx);

  for (const flash of activeFlashes) {
    const originAirport = airportsByIata.get(flash.origin);
    const destAirport = airportsByIata.get(flash.dest);
    if (!originAirport || !destAirport) continue;

    const progress = (nowMs - flash.startedAtMs) / FLASH_DURATION_MS; // 0 (just opened) to 1 (about to expire)
    const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 6); // a few pulses over the flash's lifetime
    const fadeAlpha = 1 - progress;

    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [originAirport.lon, originAirport.lat],
        [destAirport.lon, destAirport.lat],
      ],
    };

    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    ctx.beginPath();
    path(line);
    ctx.strokeStyle = NEW_ROUTE_FLASH_STROKE;
    ctx.lineWidth = 2 + pulse * 2.5;
    ctx.stroke();
    ctx.restore();

    const interpolate = geoInterpolate([originAirport.lon, originAirport.lat], [destAirport.lon, destAirport.lat]);
    const midpoint = projection(interpolate(0.5));
    if (!midpoint) continue;

    ctx.save();
    ctx.globalAlpha = fadeAlpha;
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
    const label = `${flash.airline} opens ${flash.origin}–${flash.dest}`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(midpoint[0] - textWidth / 2 - 6, midpoint[1] - 20, textWidth + 12, 16);
    ctx.fillStyle = NEW_ROUTE_FLASH_STROKE;
    ctx.fillText(label, midpoint[0], midpoint[1] - 8);
    ctx.restore();
  }
}
