import aircraftTypesData from '../../data/aircraft-types.json';
import { loadSchedule, type ScheduleLeg } from './schedule';

export type AircraftStatus = 'ground' | 'airborne';

export type Aircraft = {
  tail: string;
  typeCode: string;
  status: AircraftStatus;
  atAirport: string | null;
  activeLegId: string | null;
};

export type ActiveFlight = {
  legId: string;
  tail: string;
  origin: string;
  dest: string;
  departMinute: number;
  arriveMinute: number;
};

export type SimState = {
  simMinute: number;
  cash: number;
  aircraft: Aircraft[];
  activeFlights: ActiveFlight[];
  /**
   * This game's own copy of the daily schedule — a fresh array from
   * sim/schedule.ts's loadSchedule(), independent of any other game's copy
   * and of the unedited template. step() reads departure times from here,
   * not from a module-level constant, specifically so the M8 schedule
   * editor's edits actually change what the sim does: mutate
   * `state.schedule[i].departMinute` and the very next tick sees it.
   */
  schedule: ScheduleLeg[];
  completedToday: string[];
  todayRevenue: number;
  todayCost: number;
  todayMargin: number;
  /**
   * The entire state of sim/rng.ts's seeded random number generator. Not
   * used yet — nothing under sim/ calls nextRandom() until the M9 delay
   * mechanic exists — but it lives here, in `state`, from the start rather
   * than as a module-level variable, so that whenever step() does start
   * asking "how late is this flight," the answer stays deterministic and
   * reproducible: same state in, same state out, same as every other field
   * here.
   */
  rngSeed: number;
};

// Only one aircraft type exists so far, so every aircraft record uses it.
const aircraftType = (aircraftTypesData as { code: string }[])[0];

function earliestLegFor(tail: string, legs: ScheduleLeg[]): ScheduleLeg {
  const legsForTail = legs.filter((leg) => leg.tail === tail);
  const [first] = [...legsForTail].sort((a, b) => a.departMinute - b.departMinute);
  if (!first) {
    throw new Error(`No scheduled legs found for tail ${tail}`);
  }
  return first;
}

/**
 * Build the state the world starts in at simMinute 0. Each requested tail
 * starts on the ground wherever its earliest scheduled leg departs from —
 * that's what WEEK-ONE.md means by "start it somewhere overnight."
 *
 * Only `tails` come to life as Aircraft records. step() matches schedule
 * legs against `state.aircraft` by tail, so a leg belonging to a tail that
 * isn't in `tails` simply never finds an aircraft to apply to and is
 * silently skipped. That's how M4 runs "one aircraft" out of the full
 * three-aircraft schedule without step() needing any special-case logic —
 * M5 turns the rest on by passing more tails here.
 *
 * `rngSeed` defaults to a fixed constant rather than something like
 * `Date.now()` — a default that changes every run would make two calls to
 * createInitialState produce different worlds for no reason you asked for,
 * which is exactly what determinism is supposed to rule out. Pass a
 * different seed explicitly (the M7 headless runner will want to, to
 * compare different random delay patterns run over run).
 */
export function createInitialState(tails: string[], rngSeed: number = 1): SimState {
  const schedule = loadSchedule();

  const aircraft: Aircraft[] = tails.map((tail) => {
    const firstLeg = earliestLegFor(tail, schedule);
    return {
      tail,
      typeCode: aircraftType.code,
      status: 'ground',
      atAirport: firstLeg.origin,
      activeLegId: null,
    };
  });

  return {
    simMinute: 0,
    cash: 0,
    aircraft,
    activeFlights: [],
    schedule,
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    rngSeed,
  };
}
