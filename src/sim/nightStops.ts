import { hourlyRoomProblem } from './hours';
import { summarizeMarket } from './marketSummary';
import { lineCheckMinutes } from './mxChecks';
import { marketKey, type ScheduleLeg } from './schedule';
import type { Aircraft, SimState } from './state';
import { rotationsForTail, scheduledTurnMinutes, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE } from './utilisation';

/**
 * Night stops (WEEK-FOURTEEN.md, stage 4). A plane that sleeps at an
 * outstation instead of at base: its out-and-back to that station is
 * split, the flight home leaving at the start of the day and the flight
 * out at the end. The station gets an early departure into the hub (the
 * morning wave, for connections) and a late one back.
 *
 * It costs, every night:
 *   - the crew's hotel (HOTEL_PER_CREW for each crew the plane flies with);
 *   - the line check (sim/mxChecks.ts): there's no hangar at the station,
 *     so the night leaves a deferred item, unless the plane has a
 *     contracted check there at CONTRACT_CHECK_PER_HOUR of its work.
 *
 * A night stop isn't a setting: it's what the schedule says. A plane whose
 * day ends at an outstation and starts there is on a night stop.
 */

const HOTEL_PER_CREW: Record<string, number> = { PROP: 200, REGIONAL: 250, NARROWBODY: 400, WIDEBODY: 900 };
export const CONTRACT_CHECK_PER_HOUR = 300;

function legsOf(state: SimState, tail: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
}

/** The station a plane sleeps at, if its day ends away from base where it starts: null at base. */
export function nightStopStation(state: SimState, tail: string): string | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = legsOf(state, tail);
  if (!aircraft?.baseAirport || legs.length < 2) return null;
  const last = legs[legs.length - 1];
  return last.dest !== aircraft.baseAirport && legs[0].origin === last.dest ? last.dest : null;
}

export function hotelPerNight(state: SimState, aircraft: Aircraft): number {
  const crews = Math.max(1, state.crewDay?.crewsByTail[aircraft.tail] ?? 1);
  return (HOTEL_PER_CREW[aircraft.typeCode] ?? HOTEL_PER_CREW.PROP) * crews;
}

export function contractCheckPerNight(state: SimState, aircraft: Aircraft): number {
  return Math.round((lineCheckMinutes(state, aircraft) / 60) * CONTRACT_CHECK_PER_HOUR);
}

/** A night stop's cost a night: the hotel, plus the contracted check when the plane has one. */
export function nightStopCostPerNight(state: SimState, aircraft: Aircraft, contracted = aircraft.contractedLineCheck === true): number {
  return hotelPerNight(state, aircraft) + (contracted ? contractCheckPerNight(state, aircraft) : 0);
}

/**
 * The night's costs, at the midnight rollover, for every plane sleeping
 * at its night-stop station: the hotel under crew, a contracted check
 * under maintenance. Returns the tails that had a contracted check, for
 * the line check that follows.
 */
export function chargeNightStops(state: SimState): Set<string> {
  const contracted = new Set<string>();
  for (const aircraft of state.aircraft) {
    const station = nightStopStation(state, aircraft.tail);
    if (!station || aircraft.atAirport !== station || aircraft.status !== 'ground') continue;
    const hotel = hotelPerNight(state, aircraft);
    const check = aircraft.contractedLineCheck ? contractCheckPerNight(state, aircraft) : 0;
    state.cash -= hotel + check;
    state.todayCost += hotel + check;
    state.todayMargin -= hotel + check;
    state.todayCostByCategory.crew += hotel;
    state.todayCostByCategory.maintenance += check;
    if (aircraft.contractedLineCheck) contracted.add(aircraft.tail);
  }
  return contracted;
}

export type NightStopPlan = {
  ok: boolean;
  reason: string | null;
  station: string;
  /** The two legs as they'd be: home in the morning, out in the evening. */
  morning: ScheduleLeg | null;
  evening: ScheduleLeg | null;
  /** Every leg of the plane's day as it'd be: the two above and its other flying, moved later if it had to be. */
  moved: ScheduleLeg[];
  /** The markets' margin a day, against now, at today's demand (sim/marketSummary.ts). */
  marginChangePerDay: number;
  /** What a night there costs, with the contracted check. */
  costPerNight: number;
};

/**
 * Plan sleeping a plane at the far end of one of its out-and-backs
 * (base → station → base): the flight home moved to leave the station at
 * the start of the day, the plane's other flying pushed later if it must
 * be to fit behind it, and the flight out after the last arrival. All of
 * it has to fit inside 06:00–22:00 with its turns, with room in its hours.
 * The forecast is the whole network's margin, against now.
 */
export function planNightStop(state: SimState, tail: string, legIds: string[]): NightStopPlan {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = legsOf(state, tail).filter((leg) => legIds.includes(leg.legId));
  const station = legs[0]?.dest ?? '';
  const blank: NightStopPlan = { ok: false, reason: null, station, morning: null, evening: null, moved: [], marginChangePerDay: 0, costPerNight: 0 };
  const fail = (reason: string): NightStopPlan => ({ ...blank, reason });
  if (!aircraft?.baseAirport) return fail('No base.');
  if (nightStopStation(state, tail)) return fail(`Already sleeps at ${nightStopStation(state, tail)}`);
  if (legs.length !== 2 || legs[0].origin !== aircraft.baseAirport || legs[1].dest !== aircraft.baseAirport || legs[1].origin !== station) {
    return fail('Only an out-and-back from base can become a night stop.');
  }
  const out = legs[0];
  const home = legs[1];
  const others = legsOf(state, tail).filter((leg) => !legIds.includes(leg.legId));

  // The flight home first thing; the plane's other flying moves later
  // (whole, keeping its turns) if it would start before it's back.
  const morningDepart = USABLE_DAY_START_MINUTE;
  const morningArrive = morningDepart + home.blockMinutes;
  const firstOther = others[0];
  const push = firstOther ? Math.max(0, morningArrive + scheduledTurnMinutes(state, home.origin, home.dest) - firstOther.departMinute) : 0;
  const shifted = others.map((leg) => ({ ...leg, departMinute: leg.departMinute + Math.ceil(push / 5) * 5 }));
  const lastOther = shifted[shifted.length - 1];
  const eveningDepart = lastOther ? lastOther.departMinute + lastOther.blockMinutes + scheduledTurnMinutes(state, lastOther.origin, lastOther.dest) : morningArrive + scheduledTurnMinutes(state, home.origin, home.dest);
  if (eveningDepart + out.blockMinutes > USABLE_DAY_END_MINUTE) return fail(`No room: out at ${hhmm(eveningDepart)} would land past the 22:00 curfew`);

  const morning = { ...home, departMinute: morningDepart };
  const evening = { ...out, departMinute: eveningDepart };
  const moved = [morning, evening, ...shifted];
  const room = hourlyRoomProblem(state, moved, new Map(), [...legs, ...others]);
  if (room) return fail(`${room.iata} ${String(room.hour).padStart(2, '0')}:00 full`);

  // The whole network's margin, not just this route's: a flight into the
  // hub first thing feeds connections on other routes (sim/hubs.ts).
  const byId = new Map(moved.map((leg) => [leg.legId, leg]));
  const after = { ...state, schedule: state.schedule.map((leg) => byId.get(leg.legId) ?? leg) };
  const marginChangePerDay = networkMargin(after) - networkMargin(state);
  return { ok: true, reason: null, station, morning, evening, moved, marginChangePerDay: Math.round(marginChangePerDay), costPerNight: nightStopCostPerNight(state, aircraft, true) };
}

/** Every flown market's margin a day, summed (sim/marketSummary.ts). */
function networkMargin(state: SimState): number {
  let total = 0;
  for (const key of new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))) {
    const settings = state.routeSettings[key];
    if (!settings) continue;
    const [a, b] = key.split('-');
    total += summarizeMarket(a, b, state, settings).margin;
  }
  return total;
}

/** Make the night stop, with the contracted check on (it can be switched off on the plane). */
export function startNightStop(state: SimState, tail: string, legIds: string[]): { ok: true; message: string } | { ok: false; reason: string } {
  const plan = planNightStop(state, tail, legIds);
  if (!plan.ok || !plan.morning || !plan.evening) return { ok: false, reason: plan.reason ?? 'It can’t sleep there.' };
  const byId = new Map(plan.moved.map((leg) => [leg.legId, leg.departMinute]));
  for (const leg of state.schedule) {
    const minute = byId.get(leg.legId);
    if (minute !== undefined) leg.departMinute = minute;
  }
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  aircraft.contractedLineCheck = true;
  return { ok: true, message: `${tail} sleeps at ${plan.station} · ${hhmm(plan.morning.departMinute)} in, ${hhmm(plan.evening.departMinute)} out` };
}

/**
 * Bring it home at night again: the evening flight out keeps its time and
 * the morning flight home follows it straight back, as the out-and-back it
 * was, if that's home by 22:00. Tonight it still sleeps at the station; it
 * flies the new shape from tomorrow, when its first flight leaves base.
 */
export function endNightStop(state: SimState, tail: string): { ok: true; message: string } | { ok: false; reason: string } {
  const station = nightStopStation(state, tail);
  if (!station) return { ok: false, reason: 'Not on a night stop.' };
  const legs = legsOf(state, tail);
  const home = legs[0];
  const out = legs[legs.length - 1];
  const homeDepart = out.departMinute + out.blockMinutes + scheduledTurnMinutes(state, out.origin, out.dest);
  if (homeDepart + home.blockMinutes > USABLE_DAY_END_MINUTE) return { ok: false, reason: `Back at ${hhmm(homeDepart + home.blockMinutes)} · past the 22:00 curfew · move the evening flight earlier` };
  home.departMinute = homeDepart;
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  delete aircraft.contractedLineCheck;
  return { ok: true, message: `${tail} sleeps at base again · ${station} out ${hhmm(out.departMinute)}, back ${hhmm(homeDepart + home.blockMinutes)}` };
}

export function setContractedCheck(state: SimState, tail: string, on: boolean): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || !nightStopStation(state, tail)) return { ok: false, reason: 'Not on a night stop.' };
  if (on) aircraft.contractedLineCheck = true;
  else delete aircraft.contractedLineCheck;
  return { ok: true, message: `${tail} line check at ${nightStopStation(state, tail)} ${on ? 'contracted' : 'skipped'}` };
}

/** Every out-and-back from base this plane flies that could become a night stop, with its plan. */
export function nightStopOptions(state: SimState, tail: string): NightStopPlan[] {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft?.baseAirport || nightStopStation(state, tail)) return [];
  return rotationsForTail(state, tail)
    .filter((rotation) => rotation.legs.length === 2 && rotation.closed && rotation.legs[0].origin === aircraft.baseAirport)
    .map((rotation) => planNightStop(state, tail, rotation.legs.map((leg) => leg.legId)));
}

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
