import { contractCost, hasMxBase, outstationCheck } from './bases';
import { lineCheckMinutes } from './mxChecks';
import type { ScheduleLeg } from './schedule';
import type { Aircraft, SimState } from './state';
import { scheduledTurnMinutes, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE } from './utilisation';

/**
 * Night stops (WEEK-SIXTEEN.md, stage 2): a plane that sleeps at the far
 * end of one of its out-and-backs instead of at its base, for an early
 * flight into base and a late one out.
 *
 * **It's the schedule's shape, not a setting.** A plane whose day starts
 * at a station away from base and ends there is on a night stop at it
 * (nightStopStation()). The Gantt's drag makes one (sim/retime.ts): an
 * out-and-back dragged past either end of the day wraps round, its flight
 * home leaving the station at 06:00 and its flight out at the end of the
 * day; a half pushed past its own end of the day wraps back.
 *
 * **It never moves other flying.** The wrap fits the plane's day as it
 * stands or isn't made: the flight home has to land before the plane's
 * first departure with a turn, and the flight out has to leave after its
 * last arrival and land WRAP_SLACK_MINUTES before the curfew.
 *
 * **What a night there costs:** the crew's hotel (HOTEL_PER_CREW for each
 * crew the plane flies with), and the line check by sim/bases.ts's rule:
 * free at a maintenance base, contracted or deferred anywhere else.
 *
 * **When it breaks** (the flight out cancelled, or held by the curfew),
 * the plane sleeps at base and the morning flight from the station is
 * cancelled for want of a plane (step.ts's "position"): one flight lost,
 * and the plane flies the rest of its day from base.
 */

export const HOTEL_PER_CREW: Record<string, number> = { PROP: 200, REGIONAL: 250, NARROWBODY: 400, WIDEBODY: 900 };
/** A wrapped flight out lands this long before the curfew, so an ordinary delay doesn't cancel it. */
export const WRAP_SLACK_MINUTES = 30;

function legsOf(state: SimState, tail: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
}

/** The station a plane sleeps at, if its day starts away from base where it ends: null for a plane that sleeps at base. */
export function nightStopStation(state: SimState, tail: string): string | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = legsOf(state, tail);
  if (!aircraft?.baseAirport || legs.length < 2) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  return first.origin !== aircraft.baseAirport && last.dest === first.origin ? first.origin : null;
}

/** The night stop's two flights: home in the morning, out in the evening. Null for a plane not on one. */
export function nightStopLegs(state: SimState, tail: string): { morning: ScheduleLeg; evening: ScheduleLeg } | null {
  if (!nightStopStation(state, tail)) return null;
  const legs = legsOf(state, tail);
  return { morning: legs[0], evening: legs[legs.length - 1] };
}

export function hotelPerNight(state: SimState, aircraft: Aircraft): number {
  const crews = Math.max(1, state.crewDay?.crewsByTail[aircraft.tail] ?? 1);
  return (HOTEL_PER_CREW[aircraft.typeCode] ?? HOTEL_PER_CREW.PROP) * crews;
}

/** A night at the station: the hotel, and the check where it's contracted. */
export function nightStopCostPerNight(state: SimState, aircraft: Aircraft, station: string): number {
  const check = !hasMxBase(state, station) && outstationCheck(state, station) === 'contract' ? contractCost(lineCheckMinutes(state, aircraft)) : 0;
  return hotelPerNight(state, aircraft) + check;
}

/**
 * The hotels, at the midnight rollover, for every plane sleeping at its
 * night-stop station. (Its line check is judged with every other plane's,
 * sim/mxChecks.ts.)
 */
export function chargeNightStops(state: SimState): void {
  for (const aircraft of state.aircraft) {
    const station = nightStopStation(state, aircraft.tail);
    if (!station || aircraft.status !== 'ground' || aircraft.atAirport !== station) continue;
    const hotel = hotelPerNight(state, aircraft);
    state.cash -= hotel;
    state.todayCost += hotel;
    state.todayCostByCategory.crew += hotel;
    state.todayMargin -= hotel;
  }
}

export type WrapPlan = { ok: true; legs: ScheduleLeg[]; station: string } | { ok: false; reason: string };

/** Minutes since home midnight as a clock time. */
function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Wrap an out-and-back from base (base → station → base) into a night
 * stop: the flight home at 06:00, the flight out as late as it can leave
 * and still land WRAP_SLACK_MINUTES before the curfew. Nothing else on the
 * plane moves, so both have to fit round its other flying.
 */
export function planWrap(state: SimState, legIds: string[]): WrapPlan {
  const legs = state.schedule.filter((leg) => legIds.includes(leg.legId)).sort((a, b) => a.departMinute - b.departMinute);
  const tail = legs[0]?.tail;
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!tail || !aircraft?.baseAirport) return { ok: false, reason: 'No base.' };
  const base = aircraft.baseAirport;
  if (legs.length !== 2 || legs[0].origin !== base || legs[1].dest !== base || legs[0].dest !== legs[1].origin) {
    return { ok: false, reason: 'Only an out-and-back from base wraps into a night stop' };
  }
  const existing = nightStopStation(state, tail);
  if (existing) return { ok: false, reason: `Already sleeps at ${existing}` };
  const [out, home] = legs;
  const station = out.dest;
  const others = legsOf(state, tail).filter((leg) => !legIds.includes(leg.legId));

  const morning = { ...home, departMinute: USABLE_DAY_START_MINUTE };
  const morningBack = morning.departMinute + morning.blockMinutes + scheduledTurnMinutes(state, home.origin, home.dest);
  if (others[0] && others[0].departMinute < morningBack) {
    return { ok: false, reason: `Back from ${station} at ${hhmm(morningBack)} · needs ${tail}'s first departure ${hhmm(morningBack)} or later` };
  }
  const latest = Math.floor((USABLE_DAY_END_MINUTE - WRAP_SLACK_MINUTES - out.blockMinutes) / 5) * 5;
  const lastOther = others[others.length - 1];
  const earliest = lastOther ? lastOther.departMinute + lastOther.blockMinutes + scheduledTurnMinutes(state, lastOther.origin, lastOther.dest) : morningBack;
  if (earliest > latest) {
    return { ok: false, reason: `Out to ${station} would land after ${hhmm(USABLE_DAY_END_MINUTE - WRAP_SLACK_MINUTES)} · needs ${tail}'s last arrival by ${hhmm(latest - scheduledTurnMinutes(state, base, station))}` };
  }
  return { ok: true, legs: [morning, { ...out, departMinute: latest }], station };
}

/**
 * Bring a night stop home: the two flights rejoined as an out-and-back at
 * base. It goes at `preferStart` (where it sat before it was wrapped) when
 * that fits, else in the latest gap in the plane's day that holds it, the
 * end of the day first, so a full evening doesn't stop it coming home.
 */
export function planUnwrap(state: SimState, tail: string, preferStart?: number): WrapPlan {
  const pair = nightStopLegs(state, tail);
  if (!pair) return { ok: false, reason: 'Not on a night stop' };
  const { morning, evening } = pair;
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const base = aircraft?.baseAirport;
  const others = legsOf(state, tail).filter((leg) => leg !== morning && leg !== evening);
  const turnOut = scheduledTurnMinutes(state, evening.origin, evening.dest);
  const turnAfter = scheduledTurnMinutes(state, morning.origin, morning.dest);
  const length = evening.blockMinutes + turnOut + morning.blockMinutes;

  // Each wait at base between the plane's other flying, where the round trip could sit: its earliest and latest start.
  const gaps: { earliest: number; latest: number }[] = [];
  for (let i = 0; i <= others.length; i++) {
    const before = others[i - 1];
    const after = others[i];
    if ((before && before.dest !== base) || (after && after.origin !== base)) continue;
    const earliest = before ? before.departMinute + before.blockMinutes + scheduledTurnMinutes(state, before.origin, before.dest) : USABLE_DAY_START_MINUTE;
    const closes = after ? after.departMinute - turnAfter : USABLE_DAY_END_MINUTE;
    const latest = Math.floor((Math.min(closes, USABLE_DAY_END_MINUTE) - length) / 5) * 5;
    if (earliest <= latest) gaps.push({ earliest, latest });
  }
  if (gaps.length === 0) return { ok: false, reason: `No room at ${base ?? 'base'} for the round trip · every wait in ${tail}'s day is too short` };
  const preferred = preferStart === undefined ? undefined : gaps.find((gap) => preferStart >= gap.earliest && preferStart <= gap.latest);
  const start = preferred ? Math.round(preferStart! / 5) * 5 : gaps[gaps.length - 1].latest;
  const out = { ...evening, departMinute: start };
  const home = { ...morning, departMinute: start + evening.blockMinutes + turnOut };
  return { ok: true, legs: [out, home], station: evening.dest };
}

/**
 * Whether a plane's day joins up: each flight leaves from where the one
 * before landed, and the first from where the last landed (where it
 * sleeps). A retime that breaks it (a night stop's flight out dragged
 * into the middle of the day) is refused.
 */
export function chainProblem(legs: ScheduleLeg[]): string | null {
  const sorted = [...legs].sort((a, b) => a.departMinute - b.departMinute);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].origin !== sorted[i - 1].dest) return `${sorted[i].origin}→${sorted[i].dest} would leave ${sorted[i].origin} with the plane at ${sorted[i - 1].dest}`;
  }
  return null;
}
