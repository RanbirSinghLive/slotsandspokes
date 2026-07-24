import aircraftTypesData from '../../data/aircraft-types.json';
import { scheduleLegs, type ScheduleLeg } from './schedule';

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
  completedToday: string[];
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
 */
export function createInitialState(tails: string[]): SimState {
  const aircraft: Aircraft[] = tails.map((tail) => {
    const firstLeg = earliestLegFor(tail, scheduleLegs);
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
    completedToday: [],
  };
}
