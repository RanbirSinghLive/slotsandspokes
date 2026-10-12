import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { dutyStretches } from './crews';
import type { SimState } from './state';

/**
 * Pairings (a read-out, no rules): the stretches of duty
 * the current schedule asks of crews, as a crew scheduler would list them.
 * A pairing is one plane's run of legs from report to release, split where
 * the plane waits at its own base long enough for a crew change
 * (sim/crews.ts's dutyStretches()). Nothing here decides who flies: it
 * reads the schedule and says which pairings are efficient.
 *
 * A pairing is a `day` pairing when it starts and ends at the plane's base
 * inside the daytime window, `late` when it ends in the evening, `night`
 * when any of its duty falls in the night window, and `away` when it
 * starts or ends somewhere other than base. Its credit ratio is block time over duty
 * time: the share of a crew's duty spent flying, so a low ratio means
 * crews paid to wait.
 */

/** Daytime window, minutes of the home-local day: duty inside it is a day pairing. */
export const DAY_WINDOW_START = 6 * 60;
export const LATE_START = 19 * 60;
export const NIGHT_START = 22 * 60;

export type PairingKind = 'day' | 'late' | 'night' | 'away';

export type Pairing = {
  tail: string;
  classCode: string;
  base: string;
  /** Home-local minute of day, report time included. */
  start: number;
  end: number;
  dutyMinutes: number;
  blockMinutes: number;
  /** Block time over duty time, 0 to 1. */
  creditRatio: number;
  /** The airports flown through in order, base first: "YYZ·YUL·YYZ". */
  route: string[];
  kind: PairingKind;
};

export type PairingBase = {
  iata: string;
  classCode: string;
  pairings: Pairing[];
  dutyHours: number;
  blockHours: number;
  creditRatio: number;
  night: number;
  late: number;
  away: number;
  /** Crews the planes in this group fly with today (sim/crews.ts), 0 before the first rollover. */
  crews: number;
};

export function pairingKind(start: number, end: number, atBase: boolean): PairingKind {
  if (!atBase) return 'away';
  if (start < DAY_WINDOW_START || end > NIGHT_START) return 'night';
  if (end > LATE_START) return 'late';
  return 'day';
}

/** Every pairing the schedule drives, grouped by base and aircraft class, those with the lowest credit ratio first. */
export function pairingsBySchedule(state: SimState): PairingBase[] {
  const groups = new Map<string, PairingBase>();
  for (const aircraft of state.aircraft) {
    const base = aircraft.baseAirport;
    if (!base) continue;
    for (const stretch of dutyStretches(state, aircraft.tail)) {
      const first = stretch.legs[0];
      const last = stretch.legs[stretch.legs.length - 1];
      const block = stretch.legs.reduce((sum, leg) => sum + leg.blockMinutes, 0);
      const duty = stretch.end - stretch.start;
      const pairing: Pairing = {
        tail: aircraft.tail,
        classCode: aircraft.typeCode,
        base,
        start: stretch.start,
        end: stretch.end,
        dutyMinutes: duty,
        blockMinutes: block,
        creditRatio: duty > 0 ? block / duty : 0,
        route: [first.origin, ...stretch.legs.map((leg) => leg.dest)],
        kind: pairingKind(stretch.start, stretch.end, first.origin === base && last.dest === base),
      };
      const key = `${base}|${aircraft.typeCode}`;
      let group = groups.get(key);
      if (!group) {
        group = { iata: base, classCode: aircraft.typeCode, pairings: [], dutyHours: 0, blockHours: 0, creditRatio: 0, night: 0, late: 0, away: 0, crews: 0 };
        groups.set(key, group);
      }
      group.pairings.push(pairing);
    }
  }
  const order = (code: string) => AIRCRAFT_CLASSES.findIndex((cls) => cls.code === code);
  const planesCounted = new Set<string>();
  return [...groups.values()]
    .map((group) => {
      group.dutyHours = group.pairings.reduce((sum, p) => sum + p.dutyMinutes, 0) / 60;
      group.blockHours = group.pairings.reduce((sum, p) => sum + p.blockMinutes, 0) / 60;
      group.creditRatio = group.dutyHours > 0 ? group.blockHours / group.dutyHours : 0;
      group.night = group.pairings.filter((p) => p.kind === 'night').length;
      group.late = group.pairings.filter((p) => p.kind === 'late').length;
      group.away = group.pairings.filter((p) => p.kind === 'away').length;
      for (const p of group.pairings) {
        if (planesCounted.has(p.tail)) continue;
        planesCounted.add(p.tail);
        group.crews += state.crewDay?.crewsByTail[p.tail] ?? 0;
      }
      group.pairings.sort((a, b) => a.creditRatio - b.creditRatio || a.tail.localeCompare(b.tail) || a.start - b.start);
      return group;
    })
    .sort((a, b) => a.iata.localeCompare(b.iata) || order(a.classCode) - order(b.classCode));
}
