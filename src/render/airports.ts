import airportsData from '../../data/airports.json';
import { projection } from './projection';
import { dailyDeparturesAt, airportLevel, isSlotControlled, slotsOwned, slotsTotal } from '../sim/airports';
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
   * own code, e.g. `"DH8400"`) allowed to operate here — a real runway/
   * gate constraint some airports have (Billy Bishop's YTZ, LaGuardia's
   * perimeter/gate rules), modeled the same crude "hard limit" way range
   * already is. Absent means unconstrained. See `sim/schedule.ts`'s
   * `isAircraftTypeAllowedAt()` for how this gets checked.
   */
  maxAircraftType?: string;
};

export const airports: Airport[] = airportsData;

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

// Slot-controlled fields get an outer ring: amber while you hold slots to
// spare, red the moment departures exceed them. Grey when you hold none,
// which is the state a new game starts in and reads as "you'd have to buy
// in here."
const SLOT_RING_FREE = '#ffd166';
const SLOT_RING_OVER = '#ff8080';
const SLOT_RING_NONE = '#5b6480';

function presenceRadius(departures: number): number {
  if (departures === 0) return MARKER_RADIUS;
  return MARKER_RADIUS + Math.min(MAX_PRESENCE_RADIUS_BONUS, Math.log2(1 + departures) * PRESENCE_RADIUS_SCALE);
}

/**
 * Draw a dot plus IATA code for every airport, sized and coloured by how
 * much of an airline you are there, with a slot ring at the two fields
 * that are slot-controlled.
 *
 * Overlapping labels still aren't solved (WEEK-ONE.md says so
 * explicitly) — this draws every label at a fixed offset and lets them
 * collide if they collide.
 */
export function drawAirports(ctx: CanvasRenderingContext2D, state: SimState): void {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';

  for (const airport of airports) {
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

    if (isSlotControlled(airport.iata)) {
      const owned = slotsOwned(state, airport.iata);
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, 2 * Math.PI);
      ctx.strokeStyle = departures > owned ? SLOT_RING_OVER : owned > 0 ? SLOT_RING_FREE : SLOT_RING_NONE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = served ? MARKER_FILL : UNSERVED_FILL;
    ctx.fill();

    ctx.fillStyle = served ? SERVED_LABEL_FILL : LABEL_FILL;
    ctx.fillText(airport.iata, x + radius + 4, y);
  }
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
