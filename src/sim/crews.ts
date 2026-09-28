import { AIRCRAFT_CLASSES, classByCode } from './aircraftClasses';
import { crewTrainingTimeFactor } from './innovations';
import { dayIndex } from './clock';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';

/**
 * Crews (WEEK-TEN.md, thread 9): something to optimise on the map, not in
 * a tab. Crews live at crew bases, the airports where the airline bases
 * planes, and three things follow.
 *
 * **Crew hours** (the thin bar under each class's plane pool). A
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
 * **Crews are rated for one aircraft class** and fly only that class's
 * planes. Bigger classes cost more (CREW_CLASS_SCALE on the hiring fee and
 * standby). **Hiring** is an action at the base, with a lead time
 * (HIRE_LEAD_DAYS) and a fee per crew; **retraining** moves crews to
 * another class for RETRAIN_COST_SHARE of a hire there, taking
 * RETRAIN_DAYS, during which they fly nothing. Crews can be let go.
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
/** Retraining a crew onto another class takes this long, during which it flies nothing. */
export const RETRAIN_DAYS = 10;
/** Retraining costs this share of a new hire in the class it's retrained for. */
export const RETRAIN_COST_SHARE = 0.5;
/** A Propeller crew's hiring fee and standby a day; bigger classes cost CREW_CLASS_SCALE times as much. */
export const HIRE_FEE_PER_CREW = 10_000;
export const STANDBY_COST_PER_DAY = 250;
export const CREW_CLASS_SCALE: Record<string, number> = { PROP: 1, REGIONAL: 1.5, NARROWBODY: 2, WIDEBODY: 3 };
export const CREW_BASE_FEE = 100_000;
/** Propeller crews the home base starts with: enough for the starting plane's full day at ideal shifts. */
export const STARTING_CREWS = 2;
/** Crews a newly leased plane's full day needs at the legal shift: what the lease's crew advice and the crew planner (sim/crewPlan.ts) leave room for. */
export const CREWS_PER_NEW_PLANE = 2;
/** The starting plane's class, which the home base's first crews are rated for. */
export const STARTING_CREW_CLASS = 'PROP';

export type CrewBase = {
  /** Crews rated for each aircraft class, by class code. */
  crewsByClass: Record<string, number>;
  /** Crews being recruited, and the day each batch starts. */
  hiring: { classCode: string; count: number; readyDay: number }[];
  /** Crews away retraining for another class (already out of `from`), and the day they're back. */
  retraining: { from: string; classCode: string; count: number; readyDay: number }[];
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

/** A crew's hiring fee in this class. */
export function hireFee(classCode: string): number {
  return HIRE_FEE_PER_CREW * (CREW_CLASS_SCALE[classCode] ?? 1);
}

/** What a crew of this class costs a day standing by. */
export function standbyCost(classCode: string): number {
  return STANDBY_COST_PER_DAY * (CREW_CLASS_SCALE[classCode] ?? 1);
}

/** What retraining a crew for this class costs. */
export function retrainFee(classCode: string): number {
  return Math.round(hireFee(classCode) * RETRAIN_COST_SHARE);
}

/** Days until a crew hired today flies: shorter with a crew academy (sim/innovations.ts). */
export function hireLeadDays(state: SimState): number {
  return Math.max(1, Math.round(HIRE_LEAD_DAYS * crewTrainingTimeFactor(state)));
}

/** Days a crew is away retraining: shorter with a crew academy. */
export function retrainDays(state: SimState): number {
  return Math.max(1, Math.round(RETRAIN_DAYS * crewTrainingTimeFactor(state)));
}

/** Every crew base, by IATA. */
export function crewBases(state: SimState): Record<string, CrewBase> {
  return state.crewBases ?? {};
}

/** Crews of this class a base has now. */
export function crewsOf(base: CrewBase | undefined, classCode: string): number {
  // `?.` on crewsByClass too: a base from an older save lacks it until ensureCrewBases() runs.
  return base?.crewsByClass?.[classCode] ?? 0;
}

/** Crews of this class on their way to a base: hired, or retraining for it. */
export function crewsArriving(base: CrewBase | undefined, classCode: string): number {
  if (!base) return 0;
  return (
    (base.hiring ?? []).filter((batch) => batch.classCode === classCode).reduce((sum, batch) => sum + batch.count, 0) +
    (base.retraining ?? []).filter((batch) => batch.classCode === classCode).reduce((sum, batch) => sum + batch.count, 0)
  );
}

/** Crews of one class a base's planes need at ideal shifts and at the legal minimum, and the duty hours booked. */
export function crewNeed(state: SimState, iata: string, classCode: string): { ideal: number; minimum: number; dutyHours: number } {
  let ideal = 0;
  let minimum = 0;
  let duty = 0;
  for (const aircraft of state.aircraft) {
    if (aircraft.baseAirport !== iata || aircraft.typeCode !== classCode) continue;
    const minutes = dutyMinutes(state, aircraft.tail);
    duty += minutes;
    ideal += crewsFor(minutes, IDEAL_SHIFT_MINUTES);
    minimum += crewsFor(minutes, LEGAL_SHIFT_MINUTES);
  }
  return { ideal, minimum, dutyHours: duty / 60 };
}

/**
 * One class's crew hours: duty booked against what its crews fly at ideal
 * shifts, at one base or (with no `iata`) across every base. The thin bar
 * under each plane pool (ui/poolBars.ts). `short` when crews are below the
 * legal minimum somewhere, so planes are grounded.
 */
export function crewShare(state: SimState, classCode: string, iata?: string): { share: number; short: boolean } | null {
  let booked = 0;
  let available = 0;
  let short = false;
  let any = false;
  for (const [base, crewBase] of Object.entries(crewBases(state))) {
    if (iata !== undefined && base !== iata) continue;
    const need = crewNeed(state, base, classCode);
    const crews = crewsOf(crewBase, classCode);
    if (need.dutyHours === 0 && crews === 0) continue;
    any = true;
    booked += need.dutyHours;
    available += (crews * IDEAL_SHIFT_MINUTES) / 60;
    if (crews < need.minimum) short = true;
  }
  if (!any) return null;
  return { share: available > 0 ? booked / available : booked > 0 ? 2 : 0, short };
}

/**
 * Bring a crew base up to date: a base from before crews were rated by
 * class gets its crews shared out to the classes its planes fly (the rest
 * to the starting class), and any airport with planes but no base gets
 * one crewed for them. Only an old save needs either: loading one mustn't
 * ground its fleet.
 */
export function ensureCrewBases(state: SimState): void {
  const bases = (state.crewBases ??= {});
  for (const [iata, base] of Object.entries(bases)) {
    const legacy = base as unknown as { crews?: number; hiring: { classCode?: string; count: number; readyDay: number }[] };
    if (base.crewsByClass !== undefined && legacy.crews === undefined) continue;
    let left = legacy.crews ?? 0;
    const crewsByClass: Record<string, number> = {};
    for (const cls of AIRCRAFT_CLASSES) {
      const give = Math.min(left, crewNeed(state, iata, cls.code).ideal);
      if (give > 0) crewsByClass[cls.code] = give;
      left -= give;
    }
    if (left > 0) crewsByClass[STARTING_CREW_CLASS] = (crewsByClass[STARTING_CREW_CLASS] ?? 0) + left;
    bases[iata] = {
      crewsByClass,
      hiring: legacy.hiring.map((batch) => ({ classCode: batch.classCode ?? STARTING_CREW_CLASS, count: batch.count, readyDay: batch.readyDay })),
      retraining: [],
    };
  }
  for (const aircraft of state.aircraft) {
    const iata = aircraft.baseAirport;
    if (!iata || bases[iata]) continue;
    const crewsByClass: Record<string, number> = {};
    for (const cls of AIRCRAFT_CLASSES) {
      const ideal = crewNeed(state, iata, cls.code).ideal;
      if (ideal > 0) crewsByClass[cls.code] = ideal;
    }
    bases[iata] = { crewsByClass, hiring: [], retraining: [] };
  }
}

/** Open a crew base with no crews (a lease at a new airport does this). */
export function openCrewBase(state: SimState, iata: string): void {
  const bases = (state.crewBases ??= {});
  if (!bases[iata]) bases[iata] = { crewsByClass: {}, hiring: [], retraining: [] };
}

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

function crewsWord(count: number, classCode: string): string {
  const name = classByCode(classCode)?.name ?? classCode;
  return `${count} ${name} crew${count === 1 ? '' : 's'}`;
}

/** Recruit crews rated for a class at a base: paid now, flying after the hiring lead time. */
export function hireCrews(state: SimState, iata: string, classCode: string, count: number): Outcome {
  const base = crewBases(state)[iata];
  if (!base) return { ok: false, reason: `No crew base at ${iata}.` };
  if (count < 1) return { ok: false, reason: 'Hire at least one crew.' };
  const fee = count * hireFee(classCode);
  if (state.cash < fee) return { ok: false, reason: `Needs $${fee.toLocaleString()} on hand.` };
  state.cash -= fee;
  const readyDay = dayIndex(state) + hireLeadDays(state);
  base.hiring.push({ classCode, count, readyDay });
  return { ok: true, message: `${crewsWord(count, classCode)} hired · ${iata} · $${fee.toLocaleString()} · ready day ${readyDay}` };
}

/** Retrain crews for another class: they leave `from` now, and fly `to` once retrained. Cheaper than hiring, slower. */
export function retrainCrews(state: SimState, iata: string, from: string, to: string, count: number): Outcome {
  const base = crewBases(state)[iata];
  if (!base) return { ok: false, reason: `No crew base at ${iata}.` };
  if (from === to) return { ok: false, reason: 'They already fly that class.' };
  if (count < 1 || crewsOf(base, from) < count) return { ok: false, reason: 'Not that many crews there.' };
  const fee = count * retrainFee(to);
  if (state.cash < fee) return { ok: false, reason: `Needs $${fee.toLocaleString()} on hand.` };
  state.cash -= fee;
  base.crewsByClass[from] -= count;
  const readyDay = dayIndex(state) + retrainDays(state);
  base.retraining.push({ from, classCode: to, count, readyDay });
  const toName = classByCode(to)?.name ?? to;
  return { ok: true, message: `${crewsWord(count, from)} retraining to ${toName} · ${iata} · $${fee.toLocaleString()} · ready day ${readyDay}` };
}

/** Let crews of a class go at a base: they stop costing standby at once. */
export function releaseCrews(state: SimState, iata: string, classCode: string, count: number): Outcome {
  const base = crewBases(state)[iata];
  if (!base || crewsOf(base, classCode) < count || count < 1) return { ok: false, reason: 'Not that many crews there.' };
  base.crewsByClass[classCode] -= count;
  return { ok: true, message: `${crewsWord(count, classCode)} released · ${iata}` };
}

/**
 * The day's crewing, at rollover: hires and retraining that have come due
 * join their class, then each base shares each class's crews among that
 * class's planes (the minimum to every plane first, then spares to the
 * longest shifts), planes that can't be crewed are grounded, and crews
 * left over are charged standby at their class's rate. Returns the
 * standby cost.
 */
export function rollDailyCrews(state: SimState): number {
  ensureCrewBases(state);
  const today = dayIndex(state);
  const day: CrewDay = { crewsByTail: {}, dutyStartByTail: {} };
  const grounded: string[] = [];
  let standby = 0;

  for (const [iata, base] of Object.entries(crewBases(state))) {
    for (const batch of [...base.hiring, ...base.retraining].filter((b) => b.readyDay <= today)) {
      base.crewsByClass[batch.classCode] = crewsOf(base, batch.classCode) + batch.count;
    }
    base.hiring = base.hiring.filter((b) => b.readyDay > today);
    base.retraining = base.retraining.filter((b) => b.readyDay > today);

    for (const cls of AIRCRAFT_CLASSES) {
      const planes = state.aircraft
        .filter((aircraft) => aircraft.baseAirport === iata && aircraft.typeCode === cls.code)
        .map((aircraft) => ({ tail: aircraft.tail, duty: dutyMinutes(state, aircraft.tail) }))
        .filter((plane) => plane.duty > 0);
      let left = crewsOf(base, cls.code);
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
      standby += left * standbyCost(cls.code);
      for (const plane of planes) {
        const first = legsOf(state, plane.tail)[0];
        day.dutyStartByTail[plane.tail] = first.departMinute - REPORT_MINUTES;
      }
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
