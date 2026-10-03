import airportsData from '../../data/airports.json';
import { dayIndex } from './clock';
import { nextRandom } from './rng';
import { seasonFactors } from './seasons';
import type { SimState } from './state';
import type { SegmentName } from './timeOfDay';

/**
 * Demand events (WEEK-FOURTEEN.md, stage 5): a festival, a conference or
 * a championship final at a city lifts every market touching it for a
 * few days. Each is announced NOTICE_MIN_DAYS to NOTICE_MAX_DAYS ahead, so
 * the player who reads the ticker can add a flight, bring a bigger plane
 * or raise the fare before it starts. Rivals don't plan for them.
 *
 * Rolled once a day at rollover from the seeded stream, on an airport the
 * airline knows (`state.knownAirports`), weighted by population. At most
 * MAX_RUNNING are announced or running at once. Each lifts the segments
 * its kind draws (a festival leisure and VFR, a conference business, a
 * final leisure) by its `lift`, the same way a season does
 * (sim/seasons.ts): today's travellers, not the market's growth.
 */

export type DemandEventKind = 'festival' | 'conference' | 'final';

export type DemandEvent = {
  iata: string;
  kind: DemandEventKind;
  name: string;
  announceDay: number;
  startDay: number;
  /** The last day it runs. */
  endDay: number;
  /** Added to each segment it draws: 0.6 is +60%. */
  lift: number;
};

const DAILY_CHANCE = 1 / 20;
const NOTICE_MIN_DAYS = 10;
const NOTICE_MAX_DAYS = 21;
const MIN_DAYS = 2;
const MAX_DAYS = 5;
const MIN_LIFT = 0.4;
const MAX_LIFT = 1;
const MAX_RUNNING = 3;

const DRAWS: Record<DemandEventKind, SegmentName[]> = {
  festival: ['leisure', 'vfr'],
  conference: ['business'],
  final: ['leisure'],
};
const NAMES: Record<DemandEventKind, string[]> = {
  festival: ['music festival', 'film festival', 'food festival', 'carnival'],
  conference: ['trade show', 'medical congress', 'tech summit', 'auto show'],
  final: ['championship final', 'marathon', 'grand prix', 'all-star game'],
};
const KINDS: DemandEventKind[] = ['festival', 'conference', 'final'];

const populationByIata = new Map((airportsData as Array<{ iata: string; population?: number }>).map((airport) => [airport.iata, airport.population ?? 0]));

function draw(state: SimState): number {
  const [roll, next] = nextRandom(state.rngSeed);
  state.rngSeed = next;
  return roll;
}

/** Once a day at rollover: events that have ended drop off, and maybe one is announced. */
export function rollDailyDemandEvents(state: SimState): void {
  const today = dayIndex(state);
  const events = (state.demandEvents ??= []).filter((event) => event.endDay >= today);
  state.demandEvents = events;
  // Always the same draws, whether or not one is announced, so the rest of the day's stream doesn't shift with it.
  const [chance, pick, kindRoll, notice, length, lift, nameRoll] = [draw(state), draw(state), draw(state), draw(state), draw(state), draw(state), draw(state)];
  if (chance >= DAILY_CHANCE || events.length >= MAX_RUNNING) return;
  const candidates = state.knownAirports.filter((iata) => !events.some((event) => event.iata === iata));
  const total = candidates.reduce((sum, iata) => sum + (populationByIata.get(iata) ?? 0), 0);
  if (total <= 0) return;
  let target = pick * total;
  const iata = candidates.find((code) => (target -= populationByIata.get(code) ?? 0) < 0) ?? candidates[candidates.length - 1];
  const kind = KINDS[Math.floor(kindRoll * KINDS.length) % KINDS.length];
  const startDay = today + NOTICE_MIN_DAYS + Math.floor(notice * (NOTICE_MAX_DAYS - NOTICE_MIN_DAYS + 1));
  events.push({
    iata,
    kind,
    name: NAMES[kind][Math.floor(nameRoll * NAMES[kind].length) % NAMES[kind].length],
    announceDay: today,
    startDay,
    endDay: startDay + MIN_DAYS - 1 + Math.floor(length * (MAX_DAYS - MIN_DAYS + 1)),
    lift: Math.round((MIN_LIFT + lift * (MAX_LIFT - MIN_LIFT)) * 100) / 100,
  });
}

/** Events touching this market, announced or running. */
export function eventsOn(state: SimState, a: string, b: string): DemandEvent[] {
  return (state.demandEvents ?? []).filter((event) => event.iata === a || event.iata === b);
}

/** Whether this event runs today. */
export function eventRunning(state: SimState, event: DemandEvent): boolean {
  const today = dayIndex(state);
  return today >= event.startDay && today <= event.endDay;
}

/**
 * Today's demand for each of a market's segments against an ordinary
 * day: the season (sim/seasons.ts), times any event running at either
 * end. What every flight and forecast sells against (sim/economy.ts).
 */
export function demandFactors(state: SimState, a: string, b: string): Record<SegmentName, number> {
  const factors = seasonFactors(state, a, b);
  for (const event of eventsOn(state, a, b)) {
    if (!eventRunning(state, event)) continue;
    for (const segment of DRAWS[event.kind]) factors[segment] *= 1 + event.lift;
  }
  return factors;
}

/** The segments an event draws, for its line in the ticker and the route view. */
export function eventDraws(kind: DemandEventKind): SegmentName[] {
  return DRAWS[kind];
}
