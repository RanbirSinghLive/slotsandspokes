import airportsData from '../../data/airports.json';
import airportCharacter from '../../data/airport-character.json';
import { dayIndex } from './clock';
import { marketMix } from './marketCharacter';
import type { SimState } from './state';
import type { SegmentName } from './timeOfDay';

/**
 * Seasons (WEEK-FOURTEEN.md, stage 5): how many of each segment want to
 * fly, through the year. Day 0 of the game is 1 January, and the year
 * repeats every 365 days, as the weather's does (sim/weather.ts).
 *
 * Each segment's demand is 1 on an ordinary day, raised or lowered by a
 * few bumps around the calendar (a bump's height at its day, fading over
 * about its width in days either side):
 *   - **leisure** peaks in July and at Christmas, and is low in late
 *     January and November;
 *   - **business** dips in August and hard over the holidays, and is a
 *     little up in the autumn;
 *   - **VFR** peaks at Christmas and in summer.
 * A **sun route** (one end warm and worth a holiday, the other cold)
 * flips leisure: its peak is winter, January to March, and summer is
 * slack.
 *
 * It scales the travellers who want to fly on a day, in every flight and
 * forecast (sim/economy.ts's flightResult()), not the market's growth
 * (sim/marketDemand.ts): a quiet August doesn't shrink the market.
 *
 * **South of the equator** the year runs six months out of step: an
 * airport's seasonal bumps are read SOUTH_SHIFT_DAYS later, so Sydney's
 * summer peak is January, while the holidays (Christmas) stay on their
 * dates. A market takes each end's half: two
 * southern ends are wholly southern, a route across the equator half and
 * half. A sun route follows the winter of its cold end, where its
 * travellers live.
 */

/** A rise or fall around a day. A holiday stays on its date in both hemispheres; a season's bump moves six months south of the equator. */
type Bump = { day: number; width: number; size: number; holiday?: true };

const DAYS_PER_YEAR = 365;

const CURVES: Record<SegmentName | 'sunLeisure', Bump[]> = {
  leisure: [
    { day: 196, width: 35, size: 0.25 }, // mid-July
    { day: 357, width: 7, size: 0.2, holiday: true }, // Christmas
    { day: 25, width: 20, size: -0.15 }, // late January
    { day: 320, width: 15, size: -0.08 }, // November
  ],
  sunLeisure: [
    { day: 45, width: 40, size: 0.35 }, // mid-February
    { day: 357, width: 7, size: 0.2, holiday: true }, // Christmas
    { day: 200, width: 35, size: -0.15 }, // summer
  ],
  business: [
    { day: 222, width: 18, size: -0.25 }, // August
    { day: 362, width: 8, size: -0.4, holiday: true }, // the holidays
    { day: 280, width: 30, size: 0.05 }, // autumn
  ],
  vfr: [
    { day: 358, width: 9, size: 0.45, holiday: true }, // Christmas
    { day: 200, width: 30, size: 0.15 }, // summer
  ],
};

/** A warm end is nearer the equator than this latitude, and a cold end further than COLD_LATITUDE, either side of it. */
const WARM_LATITUDE = 30.5;
const COLD_LATITUDE = 38;
/** Half a year: the southern hemisphere's seasons against the northern's. */
const SOUTH_SHIFT_DAYS = 182;

const latitudeByIata = new Map((airportsData as Array<{ iata: string; lat: number }>).map((airport) => [airport.iata, airport.lat]));
const leisureByIata = new Map(
  Object.entries(airportCharacter as Record<string, { leisure?: number } | string>)
    .filter(([key, value]) => key !== '_about' && typeof value === 'object')
    .map(([iata, value]) => [iata, (value as { leisure?: number }).leisure ?? 0]),
);

/** Days from `a` to `b` round the year, the short way. */
function daysApart(a: number, b: number): number {
  const gap = Math.abs(a - b) % DAYS_PER_YEAR;
  return Math.min(gap, DAYS_PER_YEAR - gap);
}

/** A curve on a day: south of the equator, the seasons' bumps are read half a year on and the holidays where they are. */
function curveAt(bumps: Bump[], dayOfYear: number, southern = false): number {
  return (
    1 +
    bumps.reduce((sum, bump) => {
      const day = southern && !bump.holiday ? dayOfYear + SOUTH_SHIFT_DAYS : dayOfYear;
      return sum + bump.size * Math.exp(-((daysApart(day, bump.day) / bump.width) ** 2));
    }, 0)
  );
}

/** The cold end of a sun route (a warm end worth a holiday and a cold one), or null when the market isn't one. */
function sunRouteColdEnd(a: string, b: string): string | null {
  const [latA, latB] = [latitudeByIata.get(a), latitudeByIata.get(b)];
  if (latA === undefined || latB === undefined) return null;
  const [warm, cold] = Math.abs(latA) < Math.abs(latB) ? [a, b] : [b, a];
  const [warmLat, coldLat] = Math.abs(latA) < Math.abs(latB) ? [latA, latB] : [latB, latA];
  return Math.abs(warmLat) < WARM_LATITUDE && Math.abs(coldLat) > COLD_LATITUDE && (leisureByIata.get(warm) ?? 0) >= 1 ? cold : null;
}

/** A warm end worth a holiday and a cold one: its leisure peaks in the cold end's winter. */
export function isSunRoute(a: string, b: string): boolean {
  return sunRouteColdEnd(a, b) !== null;
}

function isSouthern(iata: string): boolean {
  return (latitudeByIata.get(iata) ?? 0) < 0;
}

/** Each segment's demand on a day of the year, as a share of an ordinary day's. */
export function seasonFactorsOn(a: string, b: string, dayOfYear: number): Record<SegmentName, number> {
  // Each end's half, in its own hemisphere.
  const both = (bumps: Bump[]) => (curveAt(bumps, dayOfYear, isSouthern(a)) + curveAt(bumps, dayOfYear, isSouthern(b))) / 2;
  const coldEnd = sunRouteColdEnd(a, b);
  return {
    business: both(CURVES.business),
    leisure: coldEnd ? curveAt(CURVES.sunLeisure, dayOfYear, isSouthern(coldEnd)) : both(CURVES.leisure),
    vfr: both(CURVES.vfr),
  };
}

export function dayOfYear(state: SimState): number {
  return ((dayIndex(state) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
}

/** Today's seasonal factors for a market's segments. */
export function seasonFactors(state: SimState, a: string, b: string): Record<SegmentName, number> {
  return seasonFactorsOn(a, b, dayOfYear(state));
}

/** A market's whole demand on a day of the year against an ordinary day: its segments' factors weighted by its mix. */
export function marketSeasonOn(a: string, b: string, day: number): number {
  const mix = marketMix(a, b);
  const factors = seasonFactorsOn(a, b, day);
  return mix.business * factors.business + mix.leisure * factors.leisure + mix.vfr * factors.vfr;
}

/** A market's year at a glance, for the route view: today's level, and the busiest and quietest days. */
export function marketSeasonOutlook(state: SimState, a: string, b: string): { now: number; peakDay: number; peak: number; lowDay: number; low: number } {
  let peakDay = 0;
  let lowDay = 0;
  let peak = -Infinity;
  let low = Infinity;
  for (let day = 0; day < DAYS_PER_YEAR; day += 1) {
    const level = marketSeasonOn(a, b, day);
    if (level > peak) [peak, peakDay] = [level, day];
    if (level < low) [low, lowDay] = [level, day];
  }
  return { now: marketSeasonOn(a, b, dayOfYear(state)), peakDay, peak, lowDay, low };
}
