import airportsData from '../../data/airports.json';
import aircraftTypesData from '../../data/aircraft-types.json';
import zonesData from '../../data/airspace-zones.json';
import { calendarDayOfYear, dayIndex } from './clock';
import { difficultySettings } from './difficulty';
import { greatCircleDistanceNm } from './geo';
import { nextRandom } from './rng';
import type { SimState } from './state';

/**
 * Airspace closures: a circle of sky that is shut for days or months, from
 * a wildfire, a volcano's ash or a conflict. Flights whose route would cross
 * it fly round it instead, so the leg is longer for as long as the closure
 * lasts; a flight to or from an airport inside it cannot operate.
 *
 * They are physical and temporary, and apply to every airline. Which
 * countries may fly or overfly where is a different layer (sim/rights.ts).
 *
 * Rolled once a day at rollover. The rolls come from the closures' own
 * stream (`state.airspaceSeed`), apart from `rngSeed`, so a game whose
 * routes never meet a closure plays exactly as it did without them.
 */

export type ClosureKind = 'wildfire' | 'ash' | 'conflict';

export type AirspaceClosure = {
  id: number;
  kind: ClosureKind;
  name: string;
  lat: number;
  lon: number;
  radiusNm: number;
  /** The day it was announced; a conflict is announced ahead of its start. */
  announcedDay: number;
  /** The first day it is closed. */
  startDay: number;
  /** The first day it is open again. */
  endDay: number;
};

type Zone = {
  name: string;
  kind: ClosureKind;
  lat: number;
  lon: number;
  radiusNm: [number, number];
  /** Closures a year at Medium. */
  perYear: number;
  /** [first, last] day of the year it can start; may wrap the new year. */
  season?: [number, number];
  days: [number, number];
  noticeDays: number;
};

const zones = zonesData as Zone[];
const airports = airportsData as Array<{ iata: string; lat: number; lon: number }>;
const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]));
const aircraftTypes = new Map(
  (aircraftTypesData as Array<{ code: string; rangeNm: number; cruiseKts: number }>).map((type) => [type.code, type]),
);

const EARTH_RADIUS_NM = 3440.065;
const STREAM_SALT = 0x41525350;
/** At most this many closures announced or running at once. */
export const MAX_CLOSURES = 3;
/** The waypoint a detour bends through sits this far outside the circle, as a share of its radius. */
const DETOUR_MARGIN = 1.15;
/** A closure shows on the map and in the ticker only if one of your airports is within this of its edge. */
const RELEVANT_REACH_NM = 600;

/** The closures in force today; announced ones not yet started are left out. */
export function activeClosures(state: SimState): AirspaceClosure[] {
  const today = dayIndex(state);
  return (state.airspaceClosures ?? []).filter((closure) => closure.startDay <= today && today < closure.endDay);
}

/** Closures announced but not yet in force. */
export function announcedClosures(state: SimState): AirspaceClosure[] {
  const today = dayIndex(state);
  return (state.airspaceClosures ?? []).filter((closure) => today < closure.startDay);
}

/** Whether a closure is near enough to the airline's airports to be worth drawing and announcing. */
export function closureIsRelevant(state: SimState, closure: AirspaceClosure): boolean {
  const reach = closure.radiusNm + RELEVANT_REACH_NM;
  return state.knownAirports.some((iata) => {
    const airport = airportByIata.get(iata);
    return !!airport && greatCircleDistanceNm(airport, closure) <= reach;
  });
}

/** Expire finished closures, then maybe announce a new one. Called once a day from step.ts. */
export function rollDailyAirspace(state: SimState): void {
  const today = dayIndex(state);
  state.airspaceClosures = (state.airspaceClosures ?? []).filter((closure) => today < closure.endDay);
  state.airspaceSeed ??= state.rngSeed ^ STREAM_SALT;
  state.nextClosureId ??= 1;

  const settings = difficultySettings(state);
  const dayOfYear = calendarDayOfYear(state, today);

  // One roll per zone every day, whether or not it can start, so the stream
  // is the same length for every game.
  zones.forEach((zone) => {
    const [chanceRoll, afterChance] = nextRandom(state.airspaceSeed!);
    const [sizeRoll, afterSize] = nextRandom(afterChance);
    const [lengthRoll, afterLength] = nextRandom(afterSize);
    state.airspaceSeed = afterLength;

    if (today < settings.closureFirstDay) return;
    if (state.airspaceClosures!.length >= MAX_CLOSURES || alreadyListed(state, zone)) return;
    if (zone.season) {
      const [first, last] = zone.season;
      const inSeason = first <= last ? dayOfYear >= first && dayOfYear <= last : dayOfYear >= first || dayOfYear <= last;
      if (!inSeason) return;
    }
    // The yearly chance spread over the days of its season (or the year).
    const seasonDays = zone.season ? seasonLength(zone.season) : 365;
    if (chanceRoll >= (zone.perYear / seasonDays) * settings.closureRateMultiplier) return;

    const radiusNm = Math.round(zone.radiusNm[0] + sizeRoll * (zone.radiusNm[1] - zone.radiusNm[0]));
    const days = Math.round(zone.days[0] + lengthRoll * (zone.days[1] - zone.days[0]));
    const startDay = today + zone.noticeDays;
    state.airspaceClosures!.push({
      id: state.nextClosureId!++,
      kind: zone.kind,
      name: zone.name,
      lat: zone.lat,
      lon: zone.lon,
      radiusNm,
      announcedDay: today,
      startDay,
      endDay: startDay + days,
    });
  });
}

function alreadyListed(state: SimState, zone: Zone): boolean {
  return (state.airspaceClosures ?? []).some((closure) => closure.name === zone.name);
}

function seasonLength([first, last]: [number, number]): number {
  return first <= last ? last - first + 1 : 365 - first + last + 1;
}

type Vector = [number, number, number];

function toVector(point: { lat: number; lon: number }): Vector {
  const lat = (point.lat * Math.PI) / 180;
  const lon = (point.lon * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

function fromVector([x, y, z]: Vector): { lat: number; lon: number } {
  return { lat: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI };
}

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vector, k: number): Vector => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vector): Vector => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The angle between two unit vectors, in radians. */
function angleBetween(a: Vector, b: Vector): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

export type Detour = {
  /** The waypoint the flight bends through, [lon, lat]. */
  via: [number, number];
  /** Nautical miles flown beyond the direct route. */
  extraNm: number;
};

/**
 * What a closure does to a route: nothing (null), or a detour through one
 * waypoint just outside the circle, on whichever side is shorter. A route
 * with an end inside the circle is the caller's to refuse (see
 * `airportInClosure`); here it counts as no detour.
 */
export function detourAround(
  origin: { lat: number; lon: number },
  dest: { lat: number; lon: number },
  closure: AirspaceClosure,
): Detour | null {
  const a = toVector(origin);
  const b = toVector(dest);
  const centre = toVector(closure);
  const radius = closure.radiusNm / EARTH_RADIUS_NM;
  const total = angleBetween(a, b);
  if (total < 1e-6) return null;
  if (angleBetween(a, centre) < radius || angleBetween(b, centre) < radius) return null;

  const normal = norm(cross(a, b));
  const alongOffset = dot(normal, centre);
  // Where the circle's centre falls on the route's great circle.
  const foot = norm(sub(centre, scale(normal, alongOffset)));
  const footBetween = Math.abs(angleBetween(a, foot) + angleBetween(foot, b) - total) < 1e-6;
  const closest = footBetween ? Math.asin(Math.min(1, Math.abs(alongOffset))) : Math.min(angleBetween(a, centre), angleBetween(b, centre));
  if (closest >= radius) return null;

  // Straight out from the centre, either side of the route.
  const tangent = norm(sub(normal, scale(centre, dot(normal, centre))));
  const offset = radius * DETOUR_MARGIN;
  const candidates = [1, -1].map((side) => add(scale(centre, Math.cos(offset)), scale(tangent, side * Math.sin(offset))));
  const lengths = candidates.map((via) => (angleBetween(a, via) + angleBetween(via, b)) * EARTH_RADIUS_NM);
  const best = lengths[0] <= lengths[1] ? 0 : 1;
  const direct = total * EARTH_RADIUS_NM;
  const via = fromVector(candidates[best]);
  return { via: [via.lon, via.lat], extraNm: Math.max(0, lengths[best] - direct) };
}

/** Whether an airport sits inside a closure running today. */
export function airportInClosure(state: SimState, iata: string): AirspaceClosure | null {
  const airport = airportByIata.get(iata);
  if (!airport) return null;
  return activeClosures(state).find((closure) => greatCircleDistanceNm(airport, closure) < closure.radiusNm) ?? null;
}

export type LegAirspace =
  | { kind: 'clear' }
  /** An end is inside a closure, or the detour is more than the plane can fly. */
  | { kind: 'blocked'; reason: string }
  | { kind: 'detour'; via: [number, number]; extraMinutes: number; closure: AirspaceClosure };

const detourCache = new Map<string, Detour | null>();

/** What today's closures do to one leg flown by one aircraft type. */
export function legAirspace(state: SimState, origin: string, dest: string, typeCode: string): LegAirspace {
  const closures = activeClosures(state);
  if (closures.length === 0) return { kind: 'clear' };
  const from = airportByIata.get(origin);
  const to = airportByIata.get(dest);
  if (!from || !to) return { kind: 'clear' };

  const inside = airportInClosure(state, origin) ?? airportInClosure(state, dest);
  if (inside) return { kind: 'blocked', reason: inside.name };

  let worst: { detour: Detour; closure: AirspaceClosure } | null = null;
  for (const closure of closures) {
    const key = `${origin}|${dest}|${closure.id}|${closure.radiusNm}`;
    if (!detourCache.has(key)) {
      if (detourCache.size > 2000) detourCache.clear();
      detourCache.set(key, detourAround(from, to, closure));
    }
    const detour = detourCache.get(key);
    if (detour && (!worst || detour.extraNm > worst.detour.extraNm)) worst = { detour, closure };
  }
  if (!worst) return { kind: 'clear' };

  const type = aircraftTypes.get(typeCode);
  if (!type) return { kind: 'clear' };
  const flownNm = greatCircleDistanceNm(from, to) + worst.detour.extraNm;
  if (flownNm > type.rangeNm) return { kind: 'blocked', reason: `${worst.closure.name} detour beyond range` };
  return {
    kind: 'detour',
    via: worst.detour.via,
    extraMinutes: Math.round((worst.detour.extraNm / type.cruiseKts) * 60),
    closure: worst.closure,
  };
}

/** The closure in words, for the ticker and the alert strip. */
export function closureLine(closure: AirspaceClosure, today: number): string {
  const label = closure.kind === 'ash' ? 'ash' : closure.kind === 'wildfire' ? 'smoke' : 'conflict';
  if (today < closure.startDay) return `AIRSPACE · ${closure.name} closes in ${closure.startDay - today}d · ${Math.round(closure.radiusNm)} nm · ${label}`;
  return `AIRSPACE CLOSED · ${closure.name} · ${Math.round(closure.radiusNm)} nm · ${closure.endDay - today}d left`;
}
