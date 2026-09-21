import airportsData from '../../data/airports.json';
import { projection } from './projection';
import { dailyDeparturesAt, airportLevel, isSlotControlled, slotsOwned, slotsTotal } from '../sim/airports';
import { worstPoolShareByBase } from '../sim/utilisation';
import { getMapPreview } from './preview';
import { pipCount, unmetDemandByAirport } from '../sim/unmetDemand';
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
   * gate constraint some airports have (Billy Bishop's YTZ, LaGuardia's
   * perimeter/gate rules), modeled the same crude "hard limit" way range
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
// stretch of the ring to the right of the dot, where the label sits.
const PIP_RADIUS = 1.7;
const PIP_ORBIT_OFFSET = 9;
const PIP_FIRST_ANGLE_DEG = 40;
const PIP_LAST_ANGLE_DEG = 320;
const PIP_HOLLOW = '#9aa3b8';
const PIP_SPILLED = '#ffb347';

const MARKER_RADIUS = 3;
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
const CAPACITY_RING_RED = '#ff8080';
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
 * Draw a dot plus IATA code for every airport, sized and coloured by how
 * much of an airline you are there, with a capacity ring at every base
 * showing how full its pooled aircraft-day budget is.
 *
 * Overlapping labels still aren't solved (WEEK-ONE.md says so
 * explicitly) — this draws every label at a fixed offset and lets them
 * collide if they collide.
 */
export function drawAirports(ctx: CanvasRenderingContext2D, state: SimState): void {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';

  // Computed once for the whole map rather than per airport — it's a
  // single pass over the fleet either way, so there's no reason to repeat
  // it 19 times. Keyed by IATA; the unbased pool comes back keyed under
  // '' (sim/utilisation.ts's own convention), which no real airport code
  // can ever collide with, so it's naturally excluded from every lookup
  // below without needing a separate check.
  const worstShareByIata = worstPoolShareByBase(state);
  // With a menu button hovered: where each ring would land if it were
  // pressed, drawn as a dashed arc just outside the real one.
  const unmetByIata = unmetDemandByAirport(state);
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

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = served ? MARKER_FILL : UNSERVED_FILL;
    ctx.fill();

    ctx.fillStyle = served ? SERVED_LABEL_FILL : LABEL_FILL;
    ctx.fillText(airport.iata, x + radius + 4, y);
  }
}

// How close a click/hover needs to land to an airport's projected point
// to count as hitting it — shared by every consumer that needs to hit-test
// a screen point against the airport list (the route builder's arm/aim
// gesture, week eight's click-for-detail), so the two can never disagree
// about how forgiving the target is.
const HIT_RADIUS_PX = 14;

/**
 * Which airport (if any) is under a screen point, within HIT_RADIUS_PX.
 * Originally lived in ui/routeBuilder.ts as a private helper; moved here
 * (week eight) once a second consumer needed the identical hit-test —
 * this is where "given a point, which airport" actually belongs, not in
 * the module that happens to have used it first.
 */
export function findNearestAirport(screenX: number, screenY: number): Airport | null {
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
  return nearest;
}

/** Re-exported for the hover tooltip, which wants the same numbers the dots encode. */
export function airportPresence(state: SimState, iata: string) {
  const departures = dailyDeparturesAt(state, iata);
  return {
    departures,
    level: airportLevel(departures),
    slotControlled: isSlotControlled(iata),
    slotsOwned: slotsOwned(state, iata),
    slotsTotal: slotsTotal(iata),
  };
}
