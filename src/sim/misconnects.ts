import { connectingFlowsAt, connectionQuality, MIN_CONNECT_MINUTES } from './hubs';
import { recordMisconnectNps } from './nps';
import type { ActiveFlight, SimState } from './state';

/**
 * Missed connections: a flight that lands at a hub late enough that its
 * connecting passengers can't make the departure they were booked on.
 *
 * The connecting flows (sim/hubs.ts) are booked on the schedule's times:
 * a passenger from A to B is on the departure to B that best meets their
 * arrival from A. When the arrival actually lands with less than
 * MIN_CONNECT_MINUTES to that departure, or after it has left, those
 * passengers miss it. The airline rebooks them on a later flight and
 * pays for their care in between, and they rate the late flight like a
 * cancellation. Onward on the same plane is a through flight: it waits
 * for them, so it never misconnects.
 *
 * How many ride each arrival is the flow's day spread over the flights
 * in from A (one direction is half the flow), never more than the
 * flight carried. Aggregate flows, not individual passengers (CLAUDE.md).
 *
 * This is what banking risks: a tight wave turns a late inbound into
 * missed connections, so a banked hub wants turn buffer (sim/turnBuffer.ts)
 * and an on-time fleet more than a rolling one does.
 */

/**
 * The rebooking and care paid per passenger who misses a connection: the
 * same published rule as a stranded passenger's (sim/crisis.ts's
 * CARE_PER_PASSENGER), written out because importing it here closes an
 * import cycle through step.ts.
 */
export const MISCONNECT_COST_PER_PASSENGER = 120;
/** What a missed connection does to the late flight's NPS score, per passenger, relative to an ordinary one: rated about like a cancellation. */
export const MISCONNECT_NPS_POINTS = -100;
/** Days of missed connections kept per hub, for the Hubs card. */
export const MISCONNECT_DAYS = 7;
/** Missed connections kept for the ticker. */
const MISCONNECT_LOG_LENGTH = 10;

export type Misconnect = {
  hub: string;
  /** Where the late flight came from. */
  from: string;
  /** Passengers who missed their onward flight. */
  passengers: number;
  lateMinutes: number;
  cost: number;
  simMinute: number;
};

/**
 * Passengers on this flight who missed their connection at its
 * destination, with the onward airport each was heading for. Pure: reads
 * the state as the flight lands, before it leaves the active list.
 */
export function missedConnections(state: SimState, flight: ActiveFlight, flightPassengers: number): { passengers: number; onward: string[] } {
  const lateMinutes = flight.arriveMinute - flight.scheduledArriveMinute;
  if (lateMinutes <= 0 || flightPassengers <= 0) return { passengers: 0, onward: [] };
  const leg = state.schedule.find((scheduled) => scheduled.legId === flight.legId);
  if (!leg) return { passengers: 0, onward: [] };
  const hub = flight.dest;
  const flows = connectingFlowsAt(state, hub).filter((flow) => flow.a === flight.origin || flow.b === flight.origin);
  if (flows.length === 0) return { passengers: 0, onward: [] };

  // Schedule minutes, home clock: when it should have landed, and when it did.
  const scheduledLanding = leg.departMinute + leg.blockMinutes;
  const actualLanding = scheduledLanding + lateMinutes;
  const arrivalsFromOrigin = state.schedule.filter((other) => other.origin === flight.origin && other.dest === hub).length;
  const gone = new Set([...state.completedToday, ...state.activeFlights.map((active) => active.legId)]);

  let missed = 0;
  const onward: string[] = [];
  for (const flow of flows) {
    const to = flow.a === flight.origin ? flow.b : flow.a;
    // The departure these passengers were booked on: the best one out from their scheduled landing.
    let booked: { legId: string; tail: string; departMinute: number } | null = null;
    let bestQuality = 0;
    for (const departure of state.schedule) {
      if (departure.origin !== hub || departure.dest !== to) continue;
      const wait = departure.departMinute - scheduledLanding;
      const quality = departure.tail === leg.tail && wait >= 0 ? 1 : connectionQuality(wait);
      if (quality > bestQuality) {
        bestQuality = quality;
        booked = departure;
      }
    }
    // No connection that day (they took a long wait or an overnight), or a through flight, which waits.
    if (!booked || booked.tail === leg.tail) continue;
    const madeIt = !gone.has(booked.legId) && booked.departMinute - actualLanding >= MIN_CONNECT_MINUTES;
    if (madeIt) continue;
    missed += flow.passengers / 2 / Math.max(1, arrivalsFromOrigin);
    onward.push(to);
  }
  return { passengers: Math.min(flightPassengers, Math.round(missed)), onward };
}

/**
 * Settle a landing's missed connections: pay the rebooking, mark down the
 * late flight's NPS, and count them at the hub. Called from step.ts as
 * each flight lands.
 */
export function settleMisconnects(state: SimState, flight: ActiveFlight, flightPassengers: number): void {
  const { passengers } = missedConnections(state, flight, flightPassengers);
  if (passengers <= 0) return;
  const cost = passengers * MISCONNECT_COST_PER_PASSENGER;
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.overhead += cost;
  state.todayMargin -= cost;
  recordMisconnectNps(state, flight.origin, flight.dest, (passengers / flightPassengers) * MISCONNECT_NPS_POINTS);

  const days = ((state.misconnectDaysByHub ??= {})[flight.dest] ??= [0]);
  days[days.length - 1] += passengers;
  const log = (state.misconnectLog ??= []);
  log.push({ hub: flight.dest, from: flight.origin, passengers, lateMinutes: flight.arriveMinute - flight.scheduledArriveMinute, cost, simMinute: state.simMinute });
  if (log.length > MISCONNECT_LOG_LENGTH) log.shift();
}

/** At rollover: start a new day at every hub, keeping MISCONNECT_DAYS, and forget a hub with none. */
export function rollMisconnects(state: SimState): void {
  const byHub = state.misconnectDaysByHub;
  if (!byHub) return;
  for (const [hub, days] of Object.entries(byHub)) {
    const kept = [...days, 0].slice(-MISCONNECT_DAYS);
    if (kept.every((count) => count === 0)) delete byHub[hub];
    else byHub[hub] = kept;
  }
}

/** Passengers who missed a connection at this hub over the last MISCONNECT_DAYS days, today included. */
export function misconnectsAt(state: SimState, hub: string): number {
  return (state.misconnectDaysByHub?.[hub] ?? []).reduce((total, count) => total + count, 0);
}
