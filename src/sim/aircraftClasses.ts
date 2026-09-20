import aircraftTypesData from '../../data/aircraft-types.json';

/**
 * The four aircraft size classes, smallest first. The order of
 * data/aircraft-types.json is the ranking (see sim/schedule.ts), so
 * "one class up" is simply the next entry.
 */
export type AircraftClass = {
  code: string;
  name: string;
  seats: number;
  rangeNm: number;
};

export const AIRCRAFT_CLASSES: AircraftClass[] = aircraftTypesData as AircraftClass[];

/** Position in the size ladder, 0 for the smallest; -1 for an unknown code. */
export function classRank(code: string): number {
  return AIRCRAFT_CLASSES.findIndex((c) => c.code === code);
}

export function classByCode(code: string): AircraftClass | undefined {
  return AIRCRAFT_CLASSES.find((c) => c.code === code);
}
