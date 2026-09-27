import { dayIndex } from './clock';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';

/**
 * Crews (WEEK-TEN.md, thread 9): something to optimise on the map, not in
 * a tab. Crews live at crew bases, the airports where the airline bases
 * planes, and three things follow.
 *
 * **Crew hours** (the second bar beside each base's plane pools). A
 * plane's duty day runs from an hour before its first departure to its
 * last landing, and is flown by the crews it gets, one after another.
 * Every plane first gets the fewest crews its duty can be flown by
 * within a LEGAL_SHIFT_MINUTES shift; a plane that can't get them is
 * grounded for the day (its flights cancel, cause "crew"). Spare crews
 * then go to the longest shifts, down to IDEAL_SHIFT_MINUTES. Crews left
 * over stand by at STANDBY_COST_PER_DAY. So the trade is hiring ahead of
 * growth (idle crews cost money) against hiring after (a new plane sits,
 * or the bar turns red and flights cancel). Flying crews' pay stays in
 * each flight's block-hour cost, as it always was.
 *
 * **Hiring** is an action at the base, with a lead time
 * (HIRE_LEAD_DAYS) and a recruiting fee per crew. Crews can be let go.
 *
 * **Fatigue.** A leg flown late in a long shift is flown by a tired crew:
 * it runs later and passengers rate it lower (sim/nps.ts's service
 * component). Fresh for the first FRESH_SHIFT_MINUTES of a shift, fully
 * tired FATIGUE_SPAN_MINUTES after that. A turn tighter than
 * TIGHT_TURN_MINUTES tires a crew as much as TIGHT_TURN_TIRING_MINUTES
 * more duty. The levers are ones already on the map: turn buffers, how
 * full a plane's day is, and how many crews its base has.
 *
 * **Crew bases.** Basing a plane at an airport without one opens a base,
 * for CREW_BASE_FEE (sim/playerActions.ts's lease); it starts with no
 * crews, so the plane waits for the first hires.
 */

export const IDEAL_SHIFT_MINUTES = 8 * 60;
export const LEGAL_SHIFT_MINUTES = 13 * 60;
/** Reporting before the first departure, counted in a plane's duty day. */
export const REPORT_MINUTES = 60;
/**
 * Fresh for a whole ideal shift: a properly crewed day shouldn't tire
 * anyone; short crews (longer shifts) and tight turns do. Tiring from
 * seven hours cost a careful Toronto year about 40% over twelve seeds, as
 * small delays pushed days over the player's cancellation thresholds.
 */
export const FRESH_SHIFT_MINUTES = IDEAL_SHIFT_MINUTES;
export const FATIGUE_SPAN_MINUTES = 4 * 60;
/**
 * A turn shorter than this (MIN_TURN_MINUTES plus ten, so a turn with no
 * buffer) tires a crew as if it had flown TIGHT_TURN_TIRING_MINUTES more.
 * Counting every turn under 45 minutes as an hour's more duty made most
 * crews exhausted by mid-shift and cut a careful Toronto year by
 * three-quarters: delays knocked on into curfew cancellations.
 */
export const TIGHT_TURN_MINUTES = 40;
export const TIGHT_TURN_TIRING_MINUTES = 20;
/**
 * A fully tired crew makes a leg's rolled delay this much longer. Kept
 * small, so fatigue costs mostly NPS: extra delay knocks on down a
 * plane's day into curfew cancellations, and at 1.25 or more it cost a
 * careful airline a third or more of its year.
 */
export const FATIGUE_DELAY_MULTIPLIER = 1.1;
export const HIRE_LEAD_DAYS = 7;
export const HIRE_FEE_PER_CREW = 10_000;
export const STANDBY_COST_PER_DAY = 250;
export const CREW_BASE_FEE = 100_000;
/** Crews the home base starts with: enough for the starting plane's full day at ideal shifts. */
export const STARTING_CREWS = 2;

export type CrewBase = {
  crews: number;
  /** Crews being recruited, and the day each batch starts. */
  hiring: { count: number; readyDay: number }[];
};

export type CrewDay = {
  /** Crews each plane flies with today, by tail; 0 for a plane grounded for want of crew. */
  crewsByTail: Record<string, number>;
  /** When each flying plane's duty day starts, home-local minute of day, by tail. */
  dutyStartByTail: Record<string, number>;
};

function legsOf(state: SimState, tail: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
}

/** A plane's duty day in minutes: report time plus first departure to last landing. 0 for a plane with nothing to fly. */
export function dutyMinutes(state: SimState, tail: string): number {
  const legs = legsOf(state, tail);
  if (legs.length === 0) return 0;
  const last = legs[legs.length - 1];
  return REPORT_MINUTES + last.departMinute + last.blockMinutes - legs[0].departMinute;
}

function crewsFor(duty: number, shift: number): number {
  return duty <= 0 ? 0 : Math.ceil(duty / shift);
}

/** Every crew base, by IATA. */
export function crewBases(state: SimState): Record<string, CrewBase> {
  return state.crewBases ?? {};
}

/** Crews a base needs for its planes at ideal shifts, and at the legal minimum. */
export function crewNeed(state: SimState, iata: string): { ideal: number; minimum: number; dutyHours: number } {
  let ideal = 0;
  let minimum = 0;
  let duty = 0;
  for (const aircraft of state.aircraft) {
    if (aircraft.baseAirport !== iata) continue;
    const minutes = dutyMinutes(state, aircraft.tail);
    duty += minutes;
    ideal += crewsFor(minutes, IDEAL_SHIFT_MINUTES);
    minimum += crewsFor(minutes, LEGAL_SHIFT_MINUTES);
  }
  return { ideal, minimum, dutyHours: duty / 60 };
}

/** Crew hours at a base, for its bar: duty booked against what its crews can fly at ideal shifts. */
export function crewHours(state: SimState, iata: string): { booked: number; available: number; arriving: number } {
  const base = crewBases(state)[iata];
  return {
    booked: crewNeed(state, iata).dutyHours,
    available: ((base?.crews ?? 0) * IDEAL_SHIFT_MINUTES) / 60,
    arriving: ((base?.hiring.reduce((sum, batch) => sum + batch.count, 0) ?? 0) * IDEAL_SHIFT_MINUTES) / 60,
  };
}

/**
 * Make sure every airport with planes has a base. Only a save from before
 * crews lacks one (a lease opens a base itself), so a base made here
 * starts with the crews its planes need for fresh shifts: loading an old
 * game mustn't ground its fleet.
 */
export function ensureCrewBases(state: SimState): void {
  const bases = (state.crewBases ??= {});
  for (const aircraft of state.aircraft) {
    const iata = aircraft.baseAirport;
    if (!iata || bases[iata]) continue;
    bases[iata] = { crews: crewNeed(state, iata).ideal, hiring: [] };
  }
}

/** Open a crew base with no crews (a lease at a new airport does this). */
export function openCrewBase(state: SimState, iata: string, crews = 0): void {
  const bases = (state.crewBases ??= {});
  if (!bases[iata]) bases[iata] = { crews, hiring: [] };
}

/** Recruit crews at a base: paid now, flying from HIRE_LEAD_DAYS on. */
export function hireCrews(state: SimState, iata: string, count: number): { ok: true; message: string } | { ok: false; reason: string } {
  const base = crewBases(state)[iata];
  if (!base) return { ok: false, reason: `No crew base at ${iata}.` };
  if (count < 1) return { ok: false, reason: 'Hire at least one crew.' };
  const fee = count * HIRE_FEE_PER_CREW;
  if (state.cash < fee) return { ok: false, reason: `Needs $${fee.toLocaleString()} on hand.` };
  state.cash -= fee;
  const readyDay = dayIndex(state) + HIRE_LEAD_DAYS;
  base.hiring.push({ count, readyDay });
  return { ok: true, message: `${count} crew${count === 1 ? '' : 's'} hired at ${iata} for $${fee.toLocaleString()}, flying from day ${readyDay}.` };
}

/** Let crews go at a base: they stop costing standby at once. */
export function releaseCrews(state: SimState, iata: string, count: number): { ok: true; message: string } | { ok: false; reason: string } {
  const base = crewBases(state)[iata];
  if (!base || base.crews < count || count < 1) return { ok: false, reason: 'Not that many crews there.' };
  base.crews -= count;
  return { ok: true, message: `${count} crew${count === 1 ? '' : 's'} let go at ${iata}.` };
}

/**
 * The day's crewing, at rollover: hires that have come due join, then
 * each base shares its crews out (the minimum to every plane first, then
 * spares to the longest shifts), planes that can't be crewed are grounded,
 * and crews left over are charged standby. Returns the standby cost.
 */
export function rollDailyCrews(state: SimState): number {
  ensureCrewBases(state);
  const today = dayIndex(state);
  const day: CrewDay = { crewsByTail: {}, dutyStartByTail: {} };
  const grounded: string[] = [];
  let standby = 0;

  for (const [iata, base] of Object.entries(crewBases(state))) {
    for (const batch of base.hiring.filter((b) => b.readyDay <= today)) base.crews += batch.count;
    base.hiring = base.hiring.filter((b) => b.readyDay > today);

    const planes = state.aircraft
      .filter((aircraft) => aircraft.baseAirport === iata)
      .map((aircraft) => ({ tail: aircraft.tail, duty: dutyMinutes(state, aircraft.tail) }))
      .filter((plane) => plane.duty > 0);
    let left = base.crews;
    // The minimum first, in fleet order, so which plane waits is stable.
    for (const plane of planes) {
      const minimum = crewsFor(plane.duty, LEGAL_SHIFT_MINUTES);
      if (left >= minimum) {
        day.crewsByTail[plane.tail] = minimum;
        left -= minimum;
      } else {
        day.crewsByTail[plane.tail] = 0;
        grounded.push(plane.tail);
      }
    }
    // Then one spare at a time to whichever flying plane has the longest shift.
    while (left > 0) {
      const flying = planes.filter((plane) => day.crewsByTail[plane.tail] > 0 && day.crewsByTail[plane.tail] < crewsFor(plane.duty, IDEAL_SHIFT_MINUTES));
      if (flying.length === 0) break;
      const longest = flying.reduce((a, b) => (b.duty / day.crewsByTail[b.tail] > a.duty / day.crewsByTail[a.tail] ? b : a));
      day.crewsByTail[longest.tail] += 1;
      left -= 1;
    }
    standby += left * STANDBY_COST_PER_DAY;
    for (const plane of planes) {
      const first = legsOf(state, plane.tail)[0];
      day.dutyStartByTail[plane.tail] = first.departMinute - REPORT_MINUTES;
    }
  }

  state.crewDay = day;
  state.groundedTails = grounded;
  return standby;
}

/**
 * How tired the crew flying this leg is, 0 (fresh) to 1: how far into its
 * shift the leg lands, less FRESH_SHIFT_MINUTES, over FATIGUE_SPAN_MINUTES,
 * with every tight turn earlier in the shift counting as more duty. A
 * plane's crews split its duty day into equal shifts.
 */
export function legFatigue(state: SimState, leg: ScheduleLeg): number {
  const crews = state.crewDay?.crewsByTail[leg.tail] ?? 0;
  const start = state.crewDay?.dutyStartByTail[leg.tail];
  if (crews <= 0 || start === undefined) return 0;
  const shift = dutyMinutes(state, leg.tail) / crews;
  const intoDuty = leg.departMinute + leg.blockMinutes - start;
  const shiftIndex = Math.min(crews - 1, Math.floor((leg.departMinute - start) / shift));
  const shiftStart = start + shiftIndex * shift;
  let intoShift = intoDuty - shiftIndex * shift;
  // Tight turns earlier in this shift tire the crew as if they'd flown longer.
  const legs = legsOf(state, leg.tail);
  for (let i = 1; i < legs.length; i++) {
    const turn = legs[i];
    if (turn.departMinute < shiftStart || turn.departMinute > leg.departMinute) continue;
    const previous = legs[i - 1];
    if (turn.departMinute - (previous.departMinute + previous.blockMinutes) < TIGHT_TURN_MINUTES) intoShift += TIGHT_TURN_TIRING_MINUTES;
  }
  return Math.min(1, Math.max(0, (intoShift - FRESH_SHIFT_MINUTES) / FATIGUE_SPAN_MINUTES));
}
