import { FIRST_OPEN_HOUR, hourOf, OPEN_HOURS } from './hours';

/**
 * When people want to fly (WEEK-THIRTEEN.md, thread 3). Each passenger
 * segment (sim/choiceModel.ts) has a curve over the usable day, on the
 * airline's home clock: how well a departure in that hour suits it, 1
 * being an ordinary hour.
 *
 * - **Business** wants the first wave out and the evening back: peaks at
 *   07:00 and 17:00, little interest at midday or late.
 * - **Leisure** barely minds, a little happier mid-morning to afternoon.
 * - **VFR** (visiting friends and relatives) leans to midday and evening.
 *
 * Two things read the curves:
 *
 *   1. **A market's passengers split by hour** (`flightDemandShare()`):
 *      of the demand for your flights on a market, each flight gets a
 *      share weighted by how well its hour suits the whole mix, so the
 *      07:00 flight fills first and the 13:00 one carries fewer.
 *   2. **Timing counts in the choice against rivals and staying home**
 *      (`segmentTimeFit()`): your offering's frequency is worth its
 *      flights times how well their hours suit that segment, against a
 *      rival's spread over the day by the same profile as its slots
 *      (sim/hours.ts). An all-off-peak schedule wins fewer business
 *      travellers than the same number of peak flights.
 *
 * So the peak is worth having, and an off-peak slot (cheaper, and
 * available at a full hub) still pays, mostly on leisure passengers.
 */

export type SegmentName = 'business' | 'leisure' | 'vfr';

/** Each segment's appeal by open hour, 06:00 first. */
const CURVES: Record<SegmentName, number[]> = {
  business: [1.3, 1.7, 1.6, 1.1, 0.8, 0.6, 0.6, 0.6, 0.7, 1.0, 1.4, 1.6, 1.4, 0.9, 0.5, 0.3],
  leisure: [0.8, 0.9, 1.0, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9, 0.8],
  vfr: [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.2, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.0, 0.8, 0.6],
};

/** A flight outside the usable day (a long-haul night departure) suits nobody much. */
const NIGHT_APPEAL = 0.4;

/** A rival's flights are spread by the slot profile (sim/hours.ts): the appeal each segment gets from them, averaged that way. */
const RIVAL_PROFILE = [0.8, 1.3, 1.3, 1.0, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 1.0, 1.3, 1.3, 1.0, 0.7, 0.4];

function appeal(segment: SegmentName, hour: number): number {
  const index = hour - FIRST_OPEN_HOUR;
  if (index < 0 || index >= OPEN_HOURS) return NIGHT_APPEAL;
  return CURVES[segment][index];
}

const rivalAppeal: Record<SegmentName, number> = Object.fromEntries(
  (Object.keys(CURVES) as SegmentName[]).map((segment) => {
    const weight = RIVAL_PROFILE.reduce((sum, w) => sum + w, 0);
    return [segment, RIVAL_PROFILE.reduce((sum, w, i) => sum + w * CURVES[segment][i], 0) / weight];
  }),
) as Record<SegmentName, number>;

/**
 * How well a set of departure times suits one segment, against a rival
 * spread over the day: 1 is as well as a rival's, below 1 worse. What
 * multiplies an offering's frequency in the choice model. With no times
 * given (a caller that doesn't know them), 1.
 */
export function segmentTimeFit(segment: SegmentName, departMinutes: number[] | undefined): number {
  if (!departMinutes || departMinutes.length === 0) return 1;
  const mean = departMinutes.reduce((sum, minute) => sum + appeal(segment, hourOf(minute)), 0) / departMinutes.length;
  return 1 + TIME_FIT_STRENGTH * (mean / rivalAppeal[segment] - 1);
}

/**
 * How much of a schedule's timing edge (or shortfall) against a rival's
 * counts in the choice. At full strength the planner's morning-heavy
 * schedule, which a player gets without trying, doubled a year's profit;
 * timing should matter at the margin, where the Gantt works.
 */
const TIME_FIT_STRENGTH = 0.35;

/** How well an hour suits the whole passenger mix, weighted by each segment's share of demand. */
export function mixAppeal(hour: number, shares: Record<SegmentName, number>): number {
  return (Object.keys(CURVES) as SegmentName[]).reduce((sum, segment) => sum + shares[segment] * appeal(segment, hour), 0);
}

/**
 * This flight's share of the demand for all of your flights on its market:
 * its hour's appeal to the passenger mix over the sum of every flight's,
 * times its `crowding` weight (crowdingWeight() below). `marketDepartMinutes`
 * are all of your departures on the market, both directions, this one
 * included. Evenly split when there are none.
 */
export function flightDemandShare(departMinute: number, marketDepartMinutes: number[], shares: Record<SegmentName, number>, crowding = 1): number {
  if (marketDepartMinutes.length === 0) return crowding;
  const total = marketDepartMinutes.reduce((sum, minute) => sum + mixAppeal(hourOf(minute), shares), 0);
  return crowding * (total > 0 ? mixAppeal(hourOf(departMinute), shares) / total : 1 / marketDepartMinutes.length);
}

/** Your own departures this close together, the same way on the same market, crowd each other. */
export const CROWDING_WINDOW_MINUTES = 60;

/**
 * Crowding: a flight leaving close to another of yours, the same way on
 * the same market, is wanted by the same passengers, so the two split one
 * hour's travellers rather than each drawing its own. A flight's weight
 * is 1 over (1 plus, for each such neighbour, how close it is: 1 at the
 * same minute, nothing at CROWDING_WINDOW_MINUTES or more). Two at the same
 * minute carry one flight's passengers between them; half an hour apart,
 * about 1⅓ flights'; an hour apart, two. So spreading a route's
 * departures across the day pays.
 */
export function crowdingWeight(
  flight: { origin: string; dest: string; departMinute: number; legId?: string },
  legs: { origin: string; dest: string; departMinute: number; legId: string }[],
): number {
  let crowd = 0;
  for (const other of legs) {
    if (other.origin !== flight.origin || other.dest !== flight.dest || other.legId === flight.legId) continue;
    const apart = Math.abs(other.departMinute - flight.departMinute);
    crowd += Math.max(0, 1 - apart / CROWDING_WINDOW_MINUTES);
  }
  return 1 / (1 + crowd);
}
