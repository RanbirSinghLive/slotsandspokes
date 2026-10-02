import aircraftTypesData from '../../data/aircraft-types.json';
import { legCostBreakdown, type EconomyAircraftType } from './economy';
import { airlineFuelPrice } from './fuelPrice';
import { computeBlockMinutes } from './schedule';
import type { Aircraft, SimState } from './state';

/**
 * Ferrying a stranded plane home. A plane can end the day away from base,
 * for instance when the curfew cancels its last flight home, and stay
 * there overnight. If none of its rotations leave from where it sits (they
 * were moved to another plane, or removed), it would never fly again. So,
 * before the day starts (06:00 home time), it flies home empty: the
 * flight's block and departure costs, no passengers, back at base for its
 * first rotation. A plane whose rotations do leave from where it is flies
 * them as scheduled and gets home that way.
 *
 * Run at every minute of the night (sim/step.ts), so a plane stranded by a
 * change made overnight is home by morning too.
 */

const typesByCode = new Map((aircraftTypesData as Array<EconomyAircraftType & { code: string; cruiseKts: number }>).map((type) => [type.code, type]));

/** How many ferries the log keeps, for the ticker. */
const FERRY_LOG_LENGTH = 10;

export function ferryStrandedPlanes(state: SimState): void {
  for (const aircraft of state.aircraft) {
    const at = aircraft.atAirport;
    if (!aircraft.baseAirport || !at || at === aircraft.baseAirport || aircraft.status !== 'ground') continue;
    if (aircraft.rebase || aircraft.returningOnDay !== undefined) continue;
    if (state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    // Its day starts where it sits (a night stop, or a plane that will fly
    // home from here first thing): it isn't stranded.
    const first = state.schedule.filter((leg) => leg.tail === aircraft.tail).sort((a, b) => a.departMinute - b.departMinute)[0];
    if (first && first.origin === at) continue;
    ferryHome(state, aircraft);
  }
}

/** Fly a plane home to its base empty, now: one flight's block and departure costs, logged for the ticker. Also how a plane on a night stop gets home for its heavy check (sim/mxChecks.ts). */
export function ferryHome(state: SimState, aircraft: Aircraft): void {
  const base = aircraft.baseAirport;
  const at = aircraft.atAirport;
  const type = typesByCode.get(aircraft.typeCode);
  if (!base || !at || at === base || !type) return;
  const cost = legCostBreakdown(computeBlockMinutes(at, base, type.cruiseKts), type, airlineFuelPrice(state), state.fuelEfficiencyMultiplier);
  const total = cost.fuel + cost.blockNonFuel + cost.departure;
  state.cash -= total;
  state.todayCost += total;
  state.todayMargin -= total;
  state.todayCostByCategory.fuel += cost.fuel;
  state.todayCostByCategory.blockNonFuel += cost.blockNonFuel;
  state.todayCostByCategory.departure += cost.departure;
  aircraft.atAirport = base;
  aircraft.groundSinceMinute = state.simMinute;
  const log = (state.ferryLog ??= []);
  log.push({ tail: aircraft.tail, from: at, to: base, cost: Math.round(total), simMinute: state.simMinute });
  if (log.length > FERRY_LOG_LENGTH) log.shift();
}
