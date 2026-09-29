import { airportCapacityPerDay } from './airports';
import type { PackedLeg } from './rotations';
import type { SimState } from './state';

/**
 * Airports by the hour (WEEK-THIRTEEN.md, threads 1 and 2). An airport's
 * room is judged hour by hour across the usable day, on the airline's home
 * clock like every other time in the game (sim/clock.ts): the field's
 * daily capacity spread evenly over OPEN_HOURS, so 07:00 can be full while
 * 13:00 has room.
 *
 * - **Yours** are counted from the schedule: a leg is a takeoff in the hour
 *   it departs and a landing in the hour it arrives.
 * - **Rivals'** have frequencies but no times, so their movements are
 *   spread over the day by RIVAL_PROFILE, heaviest at the morning and
 *   evening peaks, like real carriers. The spread is *water-filled* into
 *   the room your flights leave: hours already full push the rest of a
 *   rival's traffic into the hours that still have some, so rivals take
 *   the peak first and spill into the rest of the day. Because a new
 *   flight of yours only goes where there's room left after them, it
 *   never pushes a rival out of an hour it holds.
 *
 * `airportLoad()` (sim/airports.ts) is the busiest hour's load; congestion
 * delays read the load in the hour a leg departs or lands.
 */

export const FIRST_OPEN_HOUR = 6;
export const OPEN_HOURS = 16;
const HOURS_IN_DAY = 24;

/** Relative rival traffic in each open hour, 06:00 first: two peaks, a midday lull, a quiet late evening. */
const RIVAL_PROFILE = [0.8, 1.3, 1.3, 1.0, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 1.0, 1.3, 1.3, 1.0, 0.7, 0.4];

/** The hour of the day (0–23, home clock) a schedule minute falls in. Schedule minutes can run past midnight. */
export function hourOf(minute: number): number {
  return Math.floor((((minute % 1440) + 1440) % 1440) / 60);
}

/**
 * Takeoffs and landings an hour this airport has room for. The field runs
 * at the same rate at any hour; outside the usable day it's the curfew
 * (sim/curfew.ts) that stops flights, not the room, so those hours never
 * count toward a peak or toward room for new flights.
 */
export function hourlyCapacity(iata: string, _hour: number): number {
  return airportCapacityPerDay(iata) / OPEN_HOURS;
}

function isOpenHour(hour: number): boolean {
  return hour >= FIRST_OPEN_HOUR && hour < FIRST_OPEN_HOUR + OPEN_HOURS;
}

export type AirportHours = {
  /** Your takeoffs and landings in each hour of the day, 0–23. */
  mine: number[];
  /** Rivals' in each hour, spread by RIVAL_PROFILE into the room left by yours. */
  rivals: number[];
  /** Room in each hour. */
  capacity: number[];
};

function movementsByHour(legs: { origin: string; dest: string; departMinute: number; blockMinutes: number }[], iata: string, into: number[]): void {
  for (const leg of legs) {
    if (leg.origin === iata) into[hourOf(leg.departMinute)] += 1;
    if (leg.dest === iata) into[hourOf(leg.departMinute + leg.blockMinutes)] += 1;
  }
}

/** Rivals' daily takeoffs and landings here: each daily frequency is a round trip, one of each at each end. */
function rivalMovements(state: SimState, iata: string): number {
  let movements = 0;
  for (const route of state.competitorRoutes) {
    if (route.origin === iata || route.dest === iata) movements += 2 * route.dailyFrequency;
  }
  return movements;
}

/**
 * Spread `total` over the open hours in proportion to RIVAL_PROFILE, no
 * hour past its `room`: an hour that would overflow is filled and the
 * rest shared among the others, until it all fits. Whatever can't fit
 * anywhere is spread by the profile on top, overloading the field.
 */
function waterFill(total: number, room: number[]): number[] {
  const filled = new Array(HOURS_IN_DAY).fill(0);
  let remaining = total;
  const open = new Set<number>();
  for (let i = 0; i < OPEN_HOURS; i++) if (room[FIRST_OPEN_HOUR + i] > 0) open.add(i);
  while (remaining > 1e-9 && open.size > 0) {
    const weight = [...open].reduce((sum, i) => sum + RIVAL_PROFILE[i], 0);
    // Every hour that this pass's share would overflow is filled to its room;
    // what that leaves is shared out again among the rest on the next pass.
    const overflowing = [...open].filter((i) => (remaining * RIVAL_PROFILE[i]) / weight >= room[FIRST_OPEN_HOUR + i]);
    if (overflowing.length === 0) {
      for (const i of open) filled[FIRST_OPEN_HOUR + i] = (remaining * RIVAL_PROFILE[i]) / weight;
      remaining = 0;
      break;
    }
    for (const i of overflowing) {
      const hour = FIRST_OPEN_HOUR + i;
      filled[hour] = room[hour];
      remaining -= room[hour];
      open.delete(i);
    }
  }
  if (remaining > 1e-9) {
    const weight = RIVAL_PROFILE.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < OPEN_HOURS; i++) filled[FIRST_OPEN_HOUR + i] += (remaining * RIVAL_PROFILE[i]) / weight;
  }
  return filled;
}

/**
 * What the traffic looks like, as one number: every leg's airports and
 * times, every rival route's airports and frequency. When it hasn't
 * changed, neither has any airport's day, so airportHours() can answer
 * from its cache. Much cheaper than building an airport's day, which
 * rivals and the planner ask for thousands of times a day.
 */
function trafficKey(state: SimState): string {
  // The schedule changes by legs added, removed or retimed, and rival
  // routes by being added, removed or re-frequenced: each moves a count or
  // one of these sums (a route's frequency weighted by its place, so a
  // change moves the sum even when another cancels it out).
  let times = 0;
  for (const leg of state.schedule) times += leg.departMinute * 3 + leg.blockMinutes;
  let frequencies = 0;
  for (let i = 0; i < state.competitorRoutes.length; i++) frequencies += state.competitorRoutes[i].dailyFrequency * (i + 1);
  return `${state.schedule.length}:${times}:${state.competitorRoutes.length}:${frequencies}`;
}

// For each state asked about (the game's, and the what-if copies forecasts
// make), its traffic and each airport's day worked out since. A WeakMap, so
// a what-if copy's entry goes when the copy does. Outside SimState: it's a
// memo of a pure function, so it never changes a result, and a save never
// sees it.
const cache = new WeakMap<SimState, { key: string; hours: Map<string, AirportHours> }>();

/** One airport's day by the hour: yours, rivals' and the room in each. */
export function airportHours(state: SimState, iata: string): AirportHours {
  const key = trafficKey(state);
  let entry = cache.get(state);
  if (!entry || entry.key !== key) cache.set(state, (entry = { key, hours: new Map() }));
  let hours = entry.hours.get(iata);
  if (!hours) entry.hours.set(iata, (hours = buildAirportHours(state, iata)));
  return hours;
}

function buildAirportHours(state: SimState, iata: string): AirportHours {
  const capacity = Array.from({ length: HOURS_IN_DAY }, (_, hour) => hourlyCapacity(iata, hour));
  const mine = new Array(HOURS_IN_DAY).fill(0);
  movementsByHour(state.schedule, iata, mine);
  const room = capacity.map((c, hour) => Math.max(0, c - mine[hour]));
  return { mine, rivals: waterFill(rivalMovements(state, iata), room), capacity };
}

/** Every airline's movements in this hour over its room: 1 is full. */
export function hourLoad(hours: AirportHours, hour: number): number {
  if (hours.capacity[hour] <= 0) return 0;
  return (hours.mine[hour] + hours.rivals[hour]) / hours.capacity[hour];
}

/** The average open hour's load: how busy the airport is across the day, not just at its peak. */
export function averageHourLoad(hours: AirportHours): number {
  let total = 0;
  for (let hour = FIRST_OPEN_HOUR; hour < FIRST_OPEN_HOUR + OPEN_HOURS; hour++) total += hourLoad(hours, hour);
  return total / OPEN_HOURS;
}

/** The busiest open hour's load, and which hour it is. */
export function peakHour(hours: AirportHours): { hour: number; load: number } {
  let best = { hour: FIRST_OPEN_HOUR, load: 0 };
  for (let hour = FIRST_OPEN_HOUR; hour < FIRST_OPEN_HOUR + OPEN_HOURS; hour++) {
    const load = hourLoad(hours, hour);
    if (load > best.load) best = { hour, load };
  }
  return best;
}

/** Whole movements still free in an hour: what a new flight can use. Outside the usable day, always room (the curfew is the limit there). */
export function freeInHour(hours: AirportHours, hour: number): number {
  if (!isOpenHour(hour)) return Number.POSITIVE_INFINITY;
  return Math.floor(hours.capacity[hour] - hours.mine[hour] - hours.rivals[hour] + 1e-6);
}

/** Open hours with room for at least one more movement. */
export function hoursWithRoom(hours: AirportHours): number {
  let count = 0;
  for (let hour = FIRST_OPEN_HOUR; hour < FIRST_OPEN_HOUR + OPEN_HOURS; hour++) if (freeInHour(hours, hour) >= 1) count++;
  return count;
}

/** Whole movements free across the usable day. */
export function freeInDay(hours: AirportHours): number {
  let free = 0;
  for (let hour = FIRST_OPEN_HOUR; hour < FIRST_OPEN_HOUR + OPEN_HOURS; hour++) free += Math.max(0, freeInHour(hours, hour));
  return free;
}

/**
 * The first airport and hour these new legs would overfill, counting the
 * legs' own movements together, or null when every one fits. `minute` is
 * the schedule minute of the earliest of this rotation's movements in
 * that hour, so a caller searching for a later start knows how far to
 * move it to clear the hour. `cache` lets a caller trying many start
 * times build each airport's day once.
 */
export function hourlyRoomProblem(
  state: SimState,
  legs: PackedLeg[],
  cache: Map<string, AirportHours> = new Map(),
): { iata: string; hour: number; minute: number } | null {
  const wanted = new Map<string, { iata: string; hour: number; count: number; minute: number }>();
  const add = (iata: string, minute: number) => {
    const hour = hourOf(minute);
    const key = `${iata}@${hour}`;
    const entry = wanted.get(key);
    if (entry) entry.count += 1;
    else wanted.set(key, { iata, hour, count: 1, minute });
  };
  for (const leg of legs) {
    add(leg.origin, leg.departMinute);
    add(leg.dest, leg.departMinute + leg.blockMinutes);
  }
  let first: { iata: string; hour: number; minute: number } | null = null;
  for (const { iata, hour, count, minute } of wanted.values()) {
    let hours = cache.get(iata);
    if (!hours) cache.set(iata, (hours = airportHours(state, iata)));
    if (freeInHour(hours, hour) < count && (!first || minute < first.minute)) first = { iata, hour, minute };
  }
  return first;
}

/** How far a slot's price moves for each whole hour's room its hour is busier (or quieter) than the airport's average hour. */
const HOUR_PRICE_SLOPE = 1.5;

/**
 * How dear a slot in this hour is against the airport's average open
 * hour: busier than average costs more, up to twice; quieter less, down to
 * half. Judged on the gap in load, not the ratio, so at a quiet field the
 * one flight in an hour doesn't make that hour look dear. What makes the
 * peak a trade and not just the obvious place to be.
 */
export function hourPriceMultiplier(hours: AirportHours, hour: number): number {
  return Math.min(2, Math.max(0.5, 1 + HOUR_PRICE_SLOPE * (hourLoad(hours, hour) - averageHourLoad(hours))));
}
