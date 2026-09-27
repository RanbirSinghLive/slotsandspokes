import airportsData from '../../data/airports.json';
import { crewNeed, IDEAL_SHIFT_MINUTES } from '../sim/crews';
import { projection, baselineScale } from './projection';
import { dailyDeparturesAt, airportLevel, airportLoad } from '../sim/airports';
import { slotFeesPerDayAt, slotsHeld } from '../sim/slots';
import { worstPoolShareByBase } from '../sim/utilisation';
import { getMapPreview } from './preview';
import { pipCount, unmetDemandByAirport, unmetDemandInputs, type AirportUnmet } from '../sim/unmetDemand';
import { hungerByAirport } from '../sim/serviceLevel';
import type { SimState } from '../sim/state';

export type Airport = {
  iata: string;
  name: string;
  lat: number;
  lon: number;
  utcOffsetMinutes: number;
  population: number;
  /**
   * Week four: the largest aircraft type (by `data/aircraft-types.json`'s
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

// Unmet demand, drawn like passengers waiting at a station (sim/unmetDemand.ts
// has the definitions): a ring of small pips around each airport, hollow for
// riders nobody is carrying yet and solid amber for riders being turned away
// on a route you already fly. Solid pips fill the ring first. They skip the
// stretch of the ring to the right of the dot, where the label sits. Drawn
// only while the Demand layer is on.
const PIP_RADIUS = 1.7;
const PIP_ORBIT_OFFSET = 9;
const PIP_FIRST_ANGLE_DEG = 40;
const PIP_LAST_ANGLE_DEG = 320;
const PIP_HOLLOW = '#9aa3b8';
const PIP_SPILLED = '#ffb347';
/**
 * The hunger ring (sim/serviceLevel.ts): a faint dashed ring outside the
 * pips round an airport starved or underserved for service, stronger the
 * hungrier it is. Teal, the colour nothing else on the map uses for
 * warnings, since it marks an opportunity rather than a problem.
 */
const HUNGER_RING_RGB = '94, 214, 196';
const HUNGER_RING_OFFSET = PIP_ORBIT_OFFSET + 5;
/** Below this hunger an airport counts as well served and gets no ring. */
const HUNGER_RING_MIN = 0.25;

const MARKER_RADIUS = 3;
const CREW_MARK_WIDTH = 12;
const CREW_MARK_HEIGHT = 2;
const CREW_MARK_GAP = 3;
const CREW_MARK_TRACK = 'rgba(255, 255, 255, 0.2)';
// The load at which congestion delays start (sim/delays.ts), and so the
// congestion glow with them.
const CONGESTION_GLOW_ONSET = 0.5;
const MARKER_FILL = '#e8ecf5';
const UNSERVED_FILL = '#5b6480';
const LABEL_FILL = '#9aa3b8';
const SERVED_LABEL_FILL = '#cdd3e0';
const LABEL_FONT = '12px system-ui, sans-serif';

// Week six, phase one of moving read-only spatial data out of the menus:
// the Airports tab was a table of IATA codes describing *places*, which
// is about as anti-map as data gets. Presence now reads straight off the
// dots.
//
// Radius grows with daily departures on a log curve — the same
// diminishing-returns shape the connectivity multiplier itself uses, so
// what you see matches what you earn — and is capped so a mega-hub can't
// swallow its neighbours.
const MAX_PRESENCE_RADIUS_BONUS = 3.5;
const PRESENCE_RADIUS_SCALE = 1.3;

// The capacity ring (replaces the old slot ring, week eight deep-dive):
// utilisation was the whole point of the week-seven pivot but had zero
// presence on the map itself — a base's spare capacity only ever showed
// up as a bar in the Fleet tab or text in the route-builder popover, both
// of which need a click to reach. This puts the same number on the one
// spot on the map where the decision it drives ("does this base need
// another aircraft") actually lives: the base itself.
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

function presenceRadius(departures: number): number {
  if (departures === 0) return MARKER_RADIUS;
  return MARKER_RADIUS + Math.min(MAX_PRESENCE_RADIUS_BONUS, Math.log2(1 + departures) * PRESENCE_RADIUS_SCALE);
}

/**
 * The last unmetDemandByAirport() answer and what it was worked out from.
 * It walks every known airport pair, too much to repeat every frame.
 * Its inputs change only when a route or plane changes or a day ends.
 */
let unmetCache: { state: SimState; inputs: string; byIata: Map<string, AirportUnmet> } | null = null;

/**
 * The last hungerByAirport() answer. Hunger moves when seats move (a route,
 * a plane, a rival) or a day ends (demand grows), so this key is enough to
 * redraw it at least once a day without working it out every frame.
 */
let hungerCache: { state: SimState; inputs: string; byIata: Map<string, number> } | null = null;

function cachedHunger(state: SimState): Map<string, number> {
  const rivalFlights = state.competitorRoutes.reduce((total, route) => total + route.dailyFrequency, 0);
  const inputs = `${unmetDemandInputs(state)}|${state.competitorRoutes.length}|${rivalFlights}`;
  if (hungerCache?.state !== state || hungerCache.inputs !== inputs) {
    hungerCache = { state, inputs, byIata: hungerByAirport(state) };
  }
  return hungerCache.byIata;
}

function cachedUnmetDemand(state: SimState): Map<string, AirportUnmet> {
  const inputs = unmetDemandInputs(state);
  if (unmetCache?.state !== state || unmetCache.inputs !== inputs) {
    unmetCache = { state, inputs, byIata: unmetDemandByAirport(state) };
  }
  return unmetCache.byIata;
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
export function drawAirports(ctx: CanvasRenderingContext2D, state: SimState, showUnmetDemand: boolean): void {
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
  // Only with the Demand layer on: always drawn, the pips cluttered every
  // airport all the time with something the player mostly isn't asking about.
  const unmetByIata = showUnmetDemand ? cachedUnmetDemand(state) : new Map<string, never>();
  // How starved each airport is for service, shown with the same layer:
  // most of the map starts starved, so always on it would be noise.
  const hungerByIata = showUnmetDemand ? cachedHunger(state) : new Map<string, number>();
  const previewEffects = getMapPreview()?.effects ?? [];
  const previewShareByIata = previewEffects.length > 0 ? worstPoolShareByBase(state, previewEffects) : null;

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

    const unmet = unmetByIata.get(airport.iata);
    if (unmet) {
      const total = pipCount(unmet.latent);
      const solid = Math.min(total, pipCount(unmet.spilled));
      const orbit = radius + PIP_ORBIT_OFFSET;
      for (let i = 0; i < total; i++) {
        const t = total === 1 ? 0.5 : i / (total - 1);
        const angle = ((PIP_FIRST_ANGLE_DEG + t * (PIP_LAST_ANGLE_DEG - PIP_FIRST_ANGLE_DEG)) * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit, PIP_RADIUS, 0, 2 * Math.PI);
        if (i < solid) {
          ctx.fillStyle = PIP_SPILLED;
          ctx.fill();
        } else {
          ctx.strokeStyle = PIP_HOLLOW;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    const hunger = hungerByIata.get(airport.iata) ?? 0;
    if (hunger >= HUNGER_RING_MIN) {
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, radius + HUNGER_RING_OFFSET, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(${HUNGER_RING_RGB}, ${0.15 + 0.45 * hunger})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = served ? MARKER_FILL : UNSERVED_FILL;
    ctx.fill();

    // A crew base (sim/crews.ts): a short bar under the dot, filling with
    // the duty hours its crews are booked for; red when its planes are
    // grounded for want of crews.
    const crewBase = state.crewBases?.[airport.iata];
    if (crewBase) {
      const need = crewNeed(state, airport.iata);
      const available = crewBase.crews * (IDEAL_SHIFT_MINUTES / 60);
      const share = available > 0 ? need.dutyHours / available : need.dutyHours > 0 ? 2 : 0;
      const barY = y + radius + CREW_MARK_GAP;
      ctx.fillStyle = CREW_MARK_TRACK;
      ctx.fillRect(x - CREW_MARK_WIDTH / 2, barY, CREW_MARK_WIDTH, CREW_MARK_HEIGHT);
      ctx.fillStyle = crewBase.crews < need.minimum ? CAPACITY_RING_RED : capacityColor(share);
      ctx.fillRect(x - CREW_MARK_WIDTH / 2, barY, CREW_MARK_WIDTH * Math.min(1, share), CREW_MARK_HEIGHT);
    }

    pendingLabels.push({
      iata: airport.iata,
      name: airport.name,
      home: airport.iata === state.homeAirport,
      x,
      y,
      radius,
      served,
      departures,
      population: airport.population,
    });
  }

  placeLabels(ctx, pendingLabels, projection.scale() >= baselineScale * NAMES_FOR_ALL_ZOOM);
}

type PendingLabel = {
  iata: string;
  /** The airport's name ("Düsseldorf", "London Heathrow"), shown beside the code where there's room. */
  name: string;
  home: boolean;
  x: number;
  y: number;
  radius: number;
  served: boolean;
  departures: number;
  population: number;
};

type Box = { left: number; top: number; right: number; bottom: number };

const LABEL_HEIGHT_PX = 12;
/**
 * Zoomed in this far past the fit (projection.ts's baselineScale), every
 * airport tries its name beside its code; below it, only home and the
 * airports the airline flies to do, since those are the ones a player
 * reads about in the panel and the ticker.
 */
const NAMES_FOR_ALL_ZOOM = 1.8;
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
 * map. A label tries its long form first, the code and the airport's name
 * ("DUS Düsseldorf"), for home and the airports the airline flies to, or
 * for every airport once zoomed in (`namesForAll`); where that doesn't
 * fit, the code alone. If nothing fits, the label isn't drawn at this
 * zoom; the dot is still there, still hoverable, and zooming in pulls the
 * airports far enough apart for it to come back. So the map thins itself
 * by importance as it zooms out. Greedy placement isn't optimal, but it's
 * predictable and cheap, which is what a per-frame renderer needs.
 */
function placeLabels(ctx: CanvasRenderingContext2D, labels: PendingLabel[], namesForAll: boolean): void {
  labels.sort((a, b) => Number(b.home) - Number(a.home) || b.departures - a.departures || b.population - a.population);

  // Every dot is an obstacle too, so a label never sits on a neighbour's marker.
  const taken: Box[] = labels.map((l) => ({
    left: l.x - l.radius,
    top: l.y - l.radius,
    right: l.x + l.radius,
    bottom: l.y + l.radius,
  }));

  const half = LABEL_HEIGHT_PX / 2;
  for (const label of labels) {
    const texts = label.home || label.served || namesForAll ? [`${label.iata} ${label.name}`, label.iata] : [label.iata];
    const offset = label.radius + LABEL_GAP_PX;
    placing: for (const text of texts) {
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
        ctx.fillStyle = label.served || label.home ? SERVED_LABEL_FILL : LABEL_FILL;
        ctx.fillText(text, textX, textY);
        break placing;
      }
    }
  }
}

// How close a click/hover needs to land to an airport's projected point
// to count as hitting it — shared by every consumer that needs to hit-test
// a screen point against the airport list (the route builder's arm/aim
// gesture, week eight's click-for-detail), so the two can never disagree
// about how forgiving the target is.
const HIT_RADIUS_PX = 14;

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
  return nearest ? { airport: nearest, distPx: nearestDistPx, ratio: nearestDistPx / HIT_RADIUS_PX } : null;
}

/**
 * Which airport (if any) is under a screen point, within HIT_RADIUS_PX.
 * Originally lived in ui/routeBuilder.ts as a private helper; moved here
 * (week eight) once a second consumer needed the identical hit-test —
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
