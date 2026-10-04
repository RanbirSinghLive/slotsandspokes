import airportsData from '../../data/airports.json';
import { pendingByAirport } from '../sim/fleetTiming';
import { projection } from './projection';
import { dailyDeparturesAt, airportLevel, airportLoad } from '../sim/airports';
import { slotFeesPerDayAt, slotsHeld } from '../sim/slots';
import { worstPoolShareByBase } from '../sim/utilisation';
import { getMapPreview } from './preview';
import { isOpsView } from './opsView';
import type { SimState } from '../sim/state';

export type Airport = {
  iata: string;
  name: string;
  lat: number;
  lon: number;
  utcOffsetMinutes: number;
  population: number;
  /**
   * The largest aircraft type (by `data/aircraft-types.json`'s
   * own code, e.g. `"REGIONAL"`) allowed to operate here — a real runway/
   * gate constraint some airports have (LaGuardia's perimeter/gate
   * rules), modeled the same crude "hard limit" way range
   * already is. Absent means unconstrained. See `sim/schedule.ts`'s
   * `isAircraftTypeAllowedAt()` for how this gets checked.
   */
  maxAircraftType?: string;
};

export const airports: Airport[] = airportsData;

// Fog by reach (sim/reach.ts): only known airports are drawn or can be
// clicked. main.ts hands the list over every frame; a renderer never
// reads it from `state` itself so hit-testing (which has no state) agrees
// with what is on screen. The sim replaces the array whenever the set
// changes (sim/reach.ts), so comparing the reference is enough.
let knownList: string[] | null = null;
let knownSet: Set<string> | null = null;

export function setKnownAirports(list: string[]): void {
  if (list === knownList) return;
  knownList = list;
  knownSet = new Set(list);
}

export function isAirportKnown(iata: string): boolean {
  return knownSet === null || knownSet.has(iata);
}

const MARKER_RADIUS = 3;
// The load at which congestion delays start (sim/delays.ts), and so the
// congestion glow with them.
const CONGESTION_GLOW_ONSET = 0.5;
const MARKER_FILL = '#e8ecf5';
const UNSERVED_FILL = '#5b6480';
const LABEL_FILL = '#9aa3b8';
const SERVED_LABEL_FILL = '#cdd3e0';
const LABEL_FONT = '12px system-ui, sans-serif';
/** The line under an airport with planes or crews on their way, or planes going back. */
const PENDING_FONT = '600 10px system-ui, sans-serif';
const PENDING_GLYPH_PX = 10;
const PENDING_PART_GAP_PX = 6;
/** A top-down airliner, nose up, filled, on a 24 by 24 grid: planes on their way or going back. */
const PLANE_GLYPH = new Path2D(
  'M12 1.5 C13.1 1.5 13.6 3.5 13.6 5.5 V9.2 L22.5 14 V16.3 L13.6 13.6 V18.6 L16.5 20.7 V22.5 L12 21.3 L7.5 22.5 V20.7 L10.4 18.6 V13.6 L1.5 16.3 V14 L10.4 9.2 V5.5 C10.4 3.5 10.9 1.5 12 1.5Z',
);
/** A head and shoulders: crews joining. */
const CREW_GLYPH = new Path2D('M12 2.5 A4.5 4.5 0 1 1 11.99 2.5Z M3.5 22.5 C3.5 16.5 7.5 13.5 12 13.5 C16.5 13.5 20.5 16.5 20.5 22.5Z');
const PENDING_FILL = '#ffd166';
const PENDING_BACKGROUND = 'rgba(10, 14, 24, 0.75)';
const PENDING_HEIGHT_PX = 11;
const PENDING_GAP_PX = 4;

// Presence reads straight off the dots: radius grows with daily departures on a log curve — the same
// diminishing-returns shape the connectivity multiplier itself uses, so
// what you see matches what you earn — and is capped so a mega-hub can't
// swallow its neighbours.
const MAX_PRESENCE_RADIUS_BONUS = 3.5;
const PRESENCE_RADIUS_SCALE = 1.3;

// The capacity ring: a base's utilisation, on the one spot on the map
// where the decision it drives ("does this base need another aircraft")
// lives, the base itself, rather than behind a click.
//
// Same three-colour language as render/mapmodes.ts's route recolouring
// (small local copy, not a shared import — ten lines isn't worth a new
// module, and this module already keeps its own local copies of similarly
// small things). Deliberately re-derived from real thresholds rather than
// invented aesthetics: the arc sweeps from empty to a full circle exactly
// as share goes 0% to 100%, colouring green-to-amber over that same
// range, so "the ring closed" and "the base is full" are the same moment.
// Only past that — share > 1 — does it turn solid red, because that is
// the exact threshold sim/utilisation.ts's utilisationProblems() already
// uses to raise a real alert-strip warning. The ring and the alert can
// never disagree about what "broken" means, because they read the same
// number against the same threshold.
const CAPACITY_RING_GREEN: [number, number, number] = [127, 216, 143];
const CAPACITY_RING_AMBER: [number, number, number] = [255, 209, 102];
export const CAPACITY_RING_RED = '#ff8080';
// Strictly over 100%, the same test the alert strip uses (sim/utilisation.ts):
// a plane booked for exactly its whole day, like a long-haul round trip, is
// full, not over-booked. The small margin absorbs floating-point noise.
const OVER_BOOKED = 1.0001;
const CAPACITY_RING_OVER_LINE_WIDTH = 2.5;
const CAPACITY_RING_LINE_WIDTH = 1.5;

function lerpCapacityColor(t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const r = Math.round(CAPACITY_RING_GREEN[0] + (CAPACITY_RING_AMBER[0] - CAPACITY_RING_GREEN[0]) * clamped);
  const g = Math.round(CAPACITY_RING_GREEN[1] + (CAPACITY_RING_AMBER[1] - CAPACITY_RING_GREEN[1]) * clamped);
  const b = Math.round(CAPACITY_RING_GREEN[2] + (CAPACITY_RING_AMBER[2] - CAPACITY_RING_GREEN[2]) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Green to amber as a pool fills, solid red once it is over-booked. Shared with the pool bars. */
export function capacityColor(share: number): string {
  return share > OVER_BOOKED ? CAPACITY_RING_RED : lerpCapacityColor(share);
}

// Ops view: the same log curve, steeper, so a hub's core reads as a hub; the
// cap still keeps it from covering its spokes' first miles.
const OPS_MAX_PRESENCE_RADIUS_BONUS = 7;
const OPS_PRESENCE_RADIUS_SCALE = 1.9;

function presenceRadius(departures: number): number {
  if (departures === 0) return MARKER_RADIUS;
  const ops = isOpsView();
  const cap = ops ? OPS_MAX_PRESENCE_RADIUS_BONUS : MAX_PRESENCE_RADIUS_BONUS;
  const scale = ops ? OPS_PRESENCE_RADIUS_SCALE : PRESENCE_RADIUS_SCALE;
  return MARKER_RADIUS + Math.min(cap, Math.log2(1 + departures) * scale);
}

/**
 * Draw a dot plus IATA code for every airport, sized and coloured by how
 * much of an airline you are there, with a capacity ring at every base
 * showing how full its pooled aircraft-day budget is.
 *
 * Labels are placed in a second pass, after every dot — see
 * placeLabels() below for how close airports (YUL/YOW, YSJ/YFC) keep
 * their codes from printing on top of each other.
 */
export function drawAirports(ctx: CanvasRenderingContext2D, state: SimState): void {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  const pendingLabels: PendingLabel[] = [];

  // Computed once for the whole map rather than per airport — it's a
  // single pass over the fleet either way, so there's no reason to repeat
  // it 19 times. Keyed by IATA; the unbased pool comes back keyed under
  // '' (sim/utilisation.ts's own convention), which no real airport code
  // can ever collide with, so it's naturally excluded from every lookup
  // below without needing a separate check.
  const worstShareByIata = worstPoolShareByBase(state);
  // With a menu button hovered: where each ring would land if it were
  // pressed, drawn as a dashed arc just outside the real one.
  const previewEffects = getMapPreview()?.effects ?? [];
  const previewShareByIata = previewEffects.length > 0 ? worstPoolShareByBase(state, previewEffects) : null;
  // Planes and crews on their way, and planes going back (sim/fleetTiming.ts).
  const pendingByIata = pendingByAirport(state);
  const badges: Box[] = [];

  for (const airport of airports) {
    if (!isAirportKnown(airport.iata)) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue; // null if the point falls outside the projection's domain
    const [x, y] = point;

    const departures = dailyDeparturesAt(state, airport.iata);
    const served = departures > 0;
    const radius = presenceRadius(departures);

    // A faint halo on anything at Base or Hub level, so the shape of the
    // network reads at a glance without having to compare dot sizes.
    if (airportLevel(departures) === 'Base' || airportLevel(departures) === 'Hub') {
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(232, 236, 245, 0.08)';
      ctx.fill();
    }

    // Congestion glow: a warm halo that appears once the airport is busy
    // enough to start queueing flights (sim/delays.ts's congestion cause)
    // and grows and reddens as it fills. Nothing at all at a quiet field,
    // so it only ever draws the eye to an airport that needs it.
    const load = airportLoad(state, airport.iata);
    if (load > CONGESTION_GLOW_ONSET) {
      const pressure = Math.min(1, (load - CONGESTION_GLOW_ONSET) / (1 - CONGESTION_GLOW_ONSET));
      const glow = ctx.createRadialGradient(x, y, radius, x, y, radius + 6 + 10 * pressure);
      glow.addColorStop(0, `rgba(255, ${Math.round(180 - 110 * pressure)}, 80, ${0.25 + 0.35 * pressure})`);
      glow.addColorStop(1, 'rgba(255, 90, 80, 0)');
      ctx.beginPath();
      ctx.arc(x, y, radius + 6 + 10 * pressure, 0, 2 * Math.PI);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    // Only airports with at least one based aircraft get a ring — nothing
    // to show, and nothing to warn about, anywhere else. The arc sweeps
    // clockwise from 12 o'clock in step with `share`: empty at 0%, a
    // closed circle at exactly 100%. Past that, the ring can't sweep any
    // further (a circle has no "past full"), so the *colour* takes over
    // instead — solid red the instant share exceeds 1, the same threshold
    // that raises a real alert-strip warning, so the two can never
    // disagree about what "broken" means.
    const worstShare = worstShareByIata.get(airport.iata);
    if (worstShare !== undefined) {
      const ringRadius = radius + 2.5;
      const swept = Math.min(worstShare, 1);
      const over = worstShare > OVER_BOOKED;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, -Math.PI / 2, -Math.PI / 2 + swept * 2 * Math.PI);
      ctx.strokeStyle = over ? CAPACITY_RING_RED : lerpCapacityColor(swept);
      ctx.lineWidth = over ? CAPACITY_RING_OVER_LINE_WIDTH : CAPACITY_RING_LINE_WIDTH;
      ctx.stroke();

      const previewShare = previewShareByIata?.get(airport.iata);
      if (previewShare !== undefined && Math.abs(previewShare - worstShare) > 0.005) {
        ctx.save();
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(x, y, ringRadius + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.min(previewShare, 1) * 2 * Math.PI);
        ctx.strokeStyle = capacityColor(previewShare);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = served ? MARKER_FILL : UNSERVED_FILL;
    ctx.fill();


    // What's under way here, as one amber line under the dot: a plane or
    // a crew glyph with the count and the days until the first of them,
    // "✈+1 3d 👤+2 5d ✈−1 8d". Glyphs rather than words keep it short
    // enough to read at a glance.
    const pending = pendingByIata.get(airport.iata);
    if (pending) {
      const days = (n: number) => `${n}d`;
      const parts: { glyph: Path2D; text: string }[] = [];
      if (pending.planesIn) parts.push({ glyph: PLANE_GLYPH, text: `+${pending.planesIn.count} ${days(pending.planesIn.days)}` });
      if (pending.crewsIn) parts.push({ glyph: CREW_GLYPH, text: `+${pending.crewsIn.count} ${days(pending.crewsIn.days)}` });
      if (pending.planesOut) parts.push({ glyph: PLANE_GLYPH, text: `−${pending.planesOut.count} ${days(pending.planesOut.days)}` });
      ctx.save();
      ctx.font = PENDING_FONT;
      const widths = parts.map((part) => PENDING_GLYPH_PX + 2 + ctx.measureText(part.text).width);
      const width = widths.reduce((sum, w) => sum + w, 0) + PENDING_PART_GAP_PX * (parts.length - 1);
      const top = y + radius + PENDING_GAP_PX;
      const left = x - width / 2;
      ctx.fillStyle = PENDING_BACKGROUND;
      ctx.fillRect(left - 3, top - 1, width + 6, PENDING_HEIGHT_PX + 2);
      ctx.fillStyle = PENDING_FILL;
      ctx.textBaseline = 'top';
      let cursor = left;
      parts.forEach((part, i) => {
        ctx.save();
        ctx.translate(cursor, top + (PENDING_HEIGHT_PX - PENDING_GLYPH_PX) / 2);
        ctx.scale(PENDING_GLYPH_PX / 24, PENDING_GLYPH_PX / 24);
        ctx.fill(part.glyph);
        ctx.restore();
        ctx.fillText(part.text, cursor + PENDING_GLYPH_PX + 2, top);
        cursor += widths[i] + PENDING_PART_GAP_PX;
      });
      ctx.restore();
      badges.push({ left: left - 3, top: top - 1, right: left + width + 3, bottom: top + PENDING_HEIGHT_PX + 1 });
    }

    pendingLabels.push({
      iata: airport.iata,
      home: airport.iata === state.homeAirport,
      x,
      y,
      radius,
      served,
      departures,
      population: airport.population,
    });
  }

  const placed = placeLabels(ctx, pendingLabels, badges);
  labelHits = placed;
  const labelBoxes = placed.map((label) => label.box);
  claimedBoxes = isOpsView()
    ? [...labelBoxes, ...badges, ...pendingLabels.map((l) => ({ left: l.x - l.radius, top: l.y - l.radius, right: l.x + l.radius, bottom: l.y + l.radius }))]
    : [];
  drawHoldCue(ctx);
}

// Screen space this frame's airport codes, 'on its way' badges and dots took,
// for the Ops view's route labels to keep clear of (render/opsHub.ts).
let claimedBoxes: Box[] = [];

export function airportClaimedBoxes(): readonly Box[] {
  return claimedBoxes;
}

type PendingLabel = {
  iata: string;
  home: boolean;
  x: number;
  y: number;
  radius: number;
  served: boolean;
  departures: number;
  population: number;
};

export type Box = { left: number; top: number; right: number; bottom: number };

const LABEL_HEIGHT_PX = 12;
const LABEL_GAP_PX = 4;

function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Draw every airport's label without letting two of them overlap.
 *
 * This is a "greedy" label placer: the most important airports claim
 * their spot first (home, then busiest for you, then biggest city), and
 * each later label tries right, left, above and below its dot, taking the
 * first spot that doesn't overlap a label — or a dot — already on the
 * map. Labels are the three-letter code only: the map stays uncluttered,
 * and the name is in the hover card (ui/airportTooltip.ts) and the inspector.
 * If nothing fits, the label isn't drawn at this
 * zoom; the dot is still there, still hoverable, and zooming in pulls the
 * airports far enough apart for it to come back. So the map thins itself
 * by importance as it zooms out. Greedy placement isn't optimal, but it's
 * predictable and cheap, which is what a per-frame renderer needs.
 */
function placeLabels(ctx: CanvasRenderingContext2D, labels: PendingLabel[], obstacles: Box[] = []): { iata: string; box: Box }[] {
  labels.sort((a, b) => Number(b.home) - Number(a.home) || b.departures - a.departures || b.population - a.population);

  // Every dot is an obstacle too, so a label never sits on a neighbour's marker.
  // So is every pending-changes line (see drawAirports()).
  const taken: Box[] = [
    ...labels.map((l) => ({
      left: l.x - l.radius,
      top: l.y - l.radius,
      right: l.x + l.radius,
      bottom: l.y + l.radius,
    })),
    ...obstacles,
  ];

  const half = LABEL_HEIGHT_PX / 2;
  const placedLabels: { iata: string; box: Box }[] = [];
  for (const label of labels) {
    const text = label.iata;
    const offset = label.radius + LABEL_GAP_PX;
    const width = ctx.measureText(text).width;
    // Each candidate is the text's left edge and vertical centre.
    const candidates: [number, number][] = [
      [label.x + offset, label.y], // right (the long-standing default)
      [label.x - offset - width, label.y], // left
      [label.x - width / 2, label.y - offset - half], // above
      [label.x - width / 2, label.y + offset + half], // below
    ];
    for (const [textX, textY] of candidates) {
      const box = { left: textX, top: textY - half, right: textX + width, bottom: textY + half };
      if (taken.some((other) => boxesOverlap(box, other))) continue;
      taken.push(box);
      placedLabels.push({ iata: label.iata, box });
      ctx.fillStyle = label.served || label.home ? SERVED_LABEL_FILL : LABEL_FILL;
      ctx.fillText(text, textX, textY);
      break;
    }
  }
  return placedLabels;
}

// How close a click/hover needs to land to an airport's projected point
// to count as hitting it — shared by every consumer that needs to hit-test
// a screen point against the airport list (the route builder's arm/aim
// gesture, the click-for-detail), so the two can never disagree
// about how forgiving the target is.
/** A fingertip needs a wider target than a cursor: 44px across rather than 28. */
const TOUCH_SCREEN = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const HIT_RADIUS_PX = TOUCH_SCREEN ? 22 : 14;
/** How far past a drawn airport code a touch still counts as on it: the code is only 12px tall. */
const LABEL_HIT_PAD_PX = 12;
/** Where each airport's code was drawn this frame, so a touch on the name selects it like a touch on the dot. */
let labelHits: { iata: string; box: Box }[] = [];
const airportsByCode = new Map(airports.map((airport) => [airport.iata, airport]));

export type AirportHitCandidate = { airport: Airport; distPx: number; ratio: number };

/**
 * Which airport (if any) is under a screen point, within HIT_RADIUS_PX,
 * plus *how* close — `ratio` is `distPx / HIT_RADIUS_PX`, so 0 means dead
 * center and just under 1 means barely inside the tolerance. A caller
 * choosing between an airport and something else with its own hit radius
 * (a route's line, say) can compare each candidate's ratio rather than
 * their raw pixel distances, which aren't comparable against radii that
 * differ — see ui/mapMenu.ts's handleMapMenuMouseDown() and
 * render/competition.ts's findCompetitionHover() for why that comparison
 * matters: without it, "checked first" always beat "closer."
 */
export function nearestAirportCandidate(screenX: number, screenY: number): AirportHitCandidate | null {
  let nearest: Airport | null = null;
  let nearestDistPx = HIT_RADIUS_PX;
  for (const airport of airports) {
    if (!isAirportKnown(airport.iata)) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const distPx = Math.hypot(point[0] - screenX, point[1] - screenY);
    if (distPx < nearestDistPx) {
      nearestDistPx = distPx;
      nearest = airport;
    }
  }
  const onDot = nearest ? { airport: nearest, distPx: nearestDistPx, ratio: nearestDistPx / HIT_RADIUS_PX } : null;
  if (!TOUCH_SCREEN) return onDot;

  // On a touch screen the airport's code counts too. A code is a sure hit, never beaten by a route line under it.
  for (const { iata, box } of labelHits) {
    const inside = screenX >= box.left - LABEL_HIT_PAD_PX && screenX <= box.right + LABEL_HIT_PAD_PX && screenY >= box.top - LABEL_HIT_PAD_PX && screenY <= box.bottom + LABEL_HIT_PAD_PX;
    const airport = airportsByCode.get(iata);
    if (!inside || !airport || !isAirportKnown(iata)) continue;
    if (onDot && onDot.airport.iata === iata) return onDot;
    if (!onDot || onDot.ratio > 0.5) {
      const point = projection([airport.lon, airport.lat]);
      return { airport, distPx: point ? Math.hypot(point[0] - screenX, point[1] - screenY) : 0, ratio: 0.5 };
    }
  }
  return onDot;
}

// The press-and-hold cue (main.ts): a ring that fills around the airport being held.
const HOLD_CUE_DELAY_MS = 120;
let hold: { iata: string; startedMs: number; durationMs: number } | null = null;

/** Start (or, with null, clear) the ring that fills around an airport while it is held. */
export function setAirportHold(iata: string | null, durationMs = 0): void {
  hold = iata ? { iata, startedMs: performance.now(), durationMs } : null;
}

function drawHoldCue(ctx: CanvasRenderingContext2D): void {
  if (!hold) return;
  const airport = airportsByCode.get(hold.iata);
  const point = airport ? projection([airport.lon, airport.lat]) : null;
  const elapsed = performance.now() - hold.startedMs;
  if (!point || elapsed < HOLD_CUE_DELAY_MS) return;
  const progress = Math.min(1, (elapsed - HOLD_CUE_DELAY_MS) / (hold.durationMs - HOLD_CUE_DELAY_MS));
  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(94, 214, 200, 0.25)';
  ctx.beginPath();
  ctx.arc(point[0], point[1], 26, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = '#5ed6c8';
  ctx.beginPath();
  ctx.arc(point[0], point[1], 26, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/**
 * Which airport (if any) is under a screen point, within HIT_RADIUS_PX.
 * Originally lived in ui/routeBuilder.ts as a private helper; moved here
 * once a second consumer needed the identical hit-test —
 * this is where "given a point, which airport" actually belongs, not in
 * the module that happens to have used it first. A thin wrapper around
 * nearestAirportCandidate() above, for the callers (the route builder's
 * arm/aim gesture) that only ever want the nearest airport regardless of
 * anything else on screen, never a ratio to compare it against.
 */
export function findNearestAirport(screenX: number, screenY: number): Airport | null {
  return nearestAirportCandidate(screenX, screenY)?.airport ?? null;
}

/** Re-exported for the hover tooltip, which wants the same numbers the dots encode. */
export function airportPresence(state: SimState, iata: string) {
  const departures = dailyDeparturesAt(state, iata);
  return {
    departures,
    level: airportLevel(departures),
    slotsHeld: slotsHeld(state, iata),
    slotFeesPerDay: slotFeesPerDayAt(state, iata),
  };
}

const SELECTED_RING = '#5ed6c8';
const SELECTED_GLOW = 'rgba(94, 214, 200, 0.25)';
/** Clear of the largest dot and its halo, so the ring reads as a marker rather than part of the dot. */
const SELECTED_RING_RADIUS_PX = 17;

/**
 * The airport the side panel is showing (ui/selection.ts): a teal ring
 * around its dot, in the same colour as a selected route's highlight
 * (render/routes.ts), so the map shows which airport the panel describes.
 */
export function drawSelectedAirport(ctx: CanvasRenderingContext2D, iata: string): void {
  const airport = airports.find((a) => a.iata === iata);
  if (!airport || !isAirportKnown(iata)) return;
  const point = projection([airport.lon, airport.lat]);
  if (!point) return;
  ctx.save();
  for (const [strokeStyle, lineWidth] of [[SELECTED_GLOW, 7], [SELECTED_RING, 2]] as const) {
    ctx.beginPath();
    ctx.arc(point[0], point[1], SELECTED_RING_RADIUS_PX, 0, 2 * Math.PI);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}
