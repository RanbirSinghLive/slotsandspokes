import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { classOpen } from './ladder';
import { cashNeededToLease, leaseRateFor } from './leasing';
import { crewPlan } from './crewPlan';
import { airportHours, freeInDay } from './hours';
import { dailyDeparturesAt } from './airports';
import { spillingMarkets } from './unmetDemand';
import { aircraftUtilisation } from './utilisation';
import type { SimState } from './state';

/**
 * "What's holding you back": the single biggest thing in the way of growth
 * right now, named from numbers the sim already computes. A read-only
 * look at `state`: it changes nothing, rolls no dice and reads no clock,
 * so asking for it can never move a game number.
 *
 * Checked in order, first match wins, hard walls before soft ones:
 *   1. the home hub has no room left for another daily pair (sim/slots.ts)
 *   2. a base is short of crews for the planes it has coming (sim/crewPlan.ts)
 *   3. a market spills demand and every plane is already flying a rotation
 *   4. no cash for the next plane
 *   5. a plane flies a small share of its usable day (sim/utilisation.ts)
 */

/** Where clicking the line should go; the same shapes as ui/selection.ts. */
export type BottleneckTarget =
  | { kind: 'airport'; iata: string }
  | { kind: 'aircraft'; tail: string }
  | { kind: 'crews' }
  | { kind: 'money' }
  | { kind: 'fleet' };

export type Bottleneck = {
  kind: 'slots' | 'crews' | 'aircraft' | 'cash' | 'utilisation';
  text: string;
  target: BottleneckTarget;
};

/** A plane flying under this share of the usable day is spare capacity worth naming. */
const LOW_UTILISATION_SHARE = 0.4;

/** Cash needed to lease the cheapest class the airline can lease yet; null when none is open. */
function cheapestPlaneCash(state: SimState): number | null {
  const prices = AIRCRAFT_CLASSES.filter((cls) => classOpen(state, cls.code)).map((cls) => cashNeededToLease(leaseRateFor(cls.code)));
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function biggestBottleneck(state: SimState): Bottleneck | null {
  const home = state.homeAirport;
  if (state.schedule.length === 0 || !home) return null;

  // 1. Slots: no room for even one more pair at the home hub.
  if (freeInDay(airportHours(state, home)) < 2) {
    return {
      kind: 'slots',
      text: `HOLD · ${home} slots full · ${dailyDeparturesAt(state, home)} departures a day`,
      target: { kind: 'airport', iata: home },
    };
  }

  // 2. Crews: the first base whose next plane in would arrive short.
  for (const base of crewPlan(state)) {
    const short = base.classes.reduce((worst, cls) => Math.max(worst, ...cls.entries.map((entry) => entry.short), 0), 0);
    if (short > 0) {
      return { kind: 'crews', text: `HOLD · ${base.iata} crews short · ${short} for next plane`, target: { kind: 'crews' } };
    }
  }

  const utilisations = state.aircraft.map((plane) => aircraftUtilisation(state, plane.tail));
  const freePlane = utilisations.some((u) => u.legs === 0);
  const spilling = spillingMarkets(state);

  // 3. Aircraft: demand is being turned away and no plane is idle.
  if (spilling.size > 0 && !freePlane) {
    return {
      kind: 'aircraft',
      text: `HOLD · no free aircraft · ${spilling.size} ${spilling.size === 1 ? 'market' : 'markets'} spilling`,
      target: { kind: 'fleet' },
    };
  }

  // 4. Cash: no free plane to fly it, and not enough for the next lease.
  const needed = cheapestPlaneCash(state);
  if (!freePlane && needed !== null && state.cash < needed) {
    return {
      kind: 'cash',
      text: `HOLD · cash $${Math.round(state.cash / 1000)}k · next plane needs $${Math.round(needed / 1000)}k`,
      target: { kind: 'money' },
    };
  }

  // 5. Utilisation: the least-worked plane that flies at all.
  const slack = utilisations.filter((u) => u.legs > 0 && u.share < LOW_UTILISATION_SHARE).sort((a, b) => a.share - b.share)[0];
  if (slack) {
    return {
      kind: 'utilisation',
      text: `HOLD · ${slack.tail} flies ${Math.round(slack.share * 100)}% of its day · add a rotation`,
      target: { kind: 'aircraft', tail: slack.tail },
    };
  }

  return null;
}
