import { airports, type Airport } from '../render/airports';
import { AIRCRAFT_CLASSES, classByCode, classRank } from '../sim/aircraftClasses';
import { isAircraftTypeAllowedAt, legsServingMarket, marketKey } from '../sim/schedule';
import { allRotations, type Rotation } from '../sim/utilisation';
import { cashNeededToLease, LEASE_RESERVE_DAYS, leaseAircraft, loadLeaseRates } from '../sim/leasing';
import { revealReach } from '../sim/reach';
import { actualDailyDemand, currentPotentialDemand } from '../sim/marketDemand';
import { candidateTailsAt, commitRotation, planRotation, type RotationPlan } from './routeBuilder';
import { removeRotation } from './panels';
import type { SimState } from '../sim/state';
import type { MapPreview } from '../render/preview';

/**
 * What the map menu (ui/mapMenu.ts) can do to the network, as plain
 * operations on `SimState` with no DOM in sight. Every "change" comes as a
 * pair: a `preview…` that says whether it can be done and, if not, why in
 * words the player can act on (the menu shows that as the disabled
 * button's hover text), and an `apply…` that does it. They share one code
 * path so a button can never be enabled for something that then refuses.
 *
 * Nothing here decides what a rotation *is* or whether it fits: planning
 * and committing are ui/routeBuilder.ts's planRotation() and
 * commitRotation(), the same functions the draw-a-route gesture uses. This
 * module only chooses which plane and which rotation to hand them.
 *
 * The unit of change is one flight. A route with three flights a day is
 * three rotations, and "upgauge" moves one of them up a class per click,
 * "add a flight" adds one, "remove a flight" removes one. That keeps every
 * click small, reversible by the opposite click, and never all-or-nothing.
 */

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

function airportOf(iata: string): Airport {
  return airports.find((a) => a.iata === iata)!;
}

function typeCodeOf(state: SimState, tail: string): string {
  return state.aircraft.find((a) => a.tail === tail)?.typeCode ?? '';
}

// --- Reading a route -------------------------------------------------

/** Every rotation, on any plane, that flies a leg of this market. */
export function rotationsServing(state: SimState, a: string, b: string): Rotation[] {
  const key = marketKey(a, b);
  return allRotations(state).filter((r) => r.legs.some((leg) => marketKey(leg.origin, leg.dest) === key));
}

/** A plain there-and-back: base, other end, base. The only kind these buttons change. */
function isRoundTrip(rotation: Rotation, a: string, b: string): boolean {
  return rotation.closed && rotation.airports.length === 3 && marketKey(rotation.airports[0], rotation.airports[1]) === marketKey(a, b);
}

function latest(rotations: Rotation[]): Rotation {
  return rotations.reduce((best, r) => (r.departMinute > best.departMinute ? r : best));
}

export type MarketSummary = {
  rotations: Rotation[];
  roundTrips: Rotation[];
  /** How many flights a day are flown in each class, smallest class first. */
  byClass: { code: string; name: string; count: number }[];
};

export function summariseMarket(state: SimState, a: string, b: string): MarketSummary {
  const rotations = rotationsServing(state, a, b);
  const roundTrips = rotations.filter((r) => isRoundTrip(r, a, b));

  const counts = new Map<string, number>();
  for (const r of rotations) {
    const code = typeCodeOf(state, r.tail);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const byClass = [...counts.entries()]
    .sort((x, y) => classRank(x[0]) - classRank(y[0]))
    .map(([code, count]) => ({ code, name: classByCode(code)?.name ?? code, count }));

  return { rotations, roundTrips, byClass };
}

/** The airport the planes flying this route are based at, or null when nothing flies it. */
export function routeBase(state: SimState, a: string, b: string): string | null {
  const { rotations, roundTrips } = summariseMarket(state, a, b);
  const model = roundTrips.length > 0 ? latest(roundTrips) : rotations[0];
  return model ? model.airports[0] : null;
}

/** Demand and seats for one flight on this market, the same numbers the draw-a-route tooltip shows. */
export function marketReadout(state: SimState, a: string, b: string) {
  const legs = state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === marketKey(a, b));
  const legCount = Math.max(legs.length, 1);
  const seats = legs.reduce((total, leg) => total + (classByCode(typeCodeOf(state, leg.tail))?.seats ?? 0), 0);
  return {
    demandNow: Math.round(actualDailyDemand(state, a, b) / legCount),
    demandPotential: Math.round(currentPotentialDemand(state, a, b) / legCount),
    seatsPerFlight: Math.round(seats / legCount),
    flightsEachWay: Math.round(legsServingMarket(a, b, state.schedule) / 2),
  };
}

const MULTI_STOP_REASON = 'Flown as part of a multi-stop rotation. Remove that rotation in the Fleet tab to change this route.';

/**
 * Why a plane in `code` can't take a there-and-back, in words a player can
 * act on. Range and airport-size failures are quoted as they are; anything
 * else is capacity, and capacity has one fix.
 */
function explainFailure(error: string, className: string, baseIata: string): string {
  if (/range|too large/.test(error)) return error;
  return `Every ${className} at ${baseIata} is full. Tap ${baseIata}, then Plane, to add another.`;
}

// --- Frequency ---------------------------------------------------------

export function previewAddFlight(
  state: SimState,
  a: string,
  b: string,
): Outcome<{ tail: string; plan: RotationPlan; className: string; preview: MapPreview }> {
  const { roundTrips } = summariseMarket(state, a, b);
  if (roundTrips.length === 0) return { ok: false, reason: MULTI_STOP_REASON };

  const model = latest(roundTrips);
  const base = airportOf(model.airports[0]);
  const other = airportOf(model.airports[1]);
  const typeCode = typeCodeOf(state, model.tail);
  const className = classByCode(typeCode)?.name ?? typeCode;

  const tails = candidateTailsAt(state, base.iata).filter((tail) => typeCodeOf(state, tail) === typeCode);
  if (tails.length === 0) {
    return { ok: false, reason: `No ${className} is based at ${base.iata}. Tap ${base.iata}, then Plane, to add one.` };
  }

  let firstError = '';
  for (const tail of tails) {
    const plan = planRotation([base], other, tail, state);
    if (!plan.error) {
      const preview: MapPreview = {
        effects: [{ base: base.iata, classCode: typeCode, minutes: plan.rotationMinutes }],
        routes: [{ origin: a, dest: b, kind: 'add' }],
      };
      return { ok: true, tail, plan, className, preview };
    }
    firstError ||= plan.error;
  }
  return { ok: false, reason: explainFailure(firstError, className, base.iata) };
}

export function addFlight(state: SimState, a: string, b: string): Outcome<{ message: string }> {
  const preview = previewAddFlight(state, a, b);
  if (!preview.ok) return preview;
  commitRotation(state, preview.tail, preview.plan);
  return { ok: true, message: `Added a ${preview.className} flight on ${a}–${b} (${preview.tail}).` };
}

export function previewRemoveFlight(state: SimState, a: string, b: string): Outcome<{ rotation: Rotation; preview: MapPreview }> {
  const { roundTrips } = summariseMarket(state, a, b);
  if (roundTrips.length === 0) return { ok: false, reason: MULTI_STOP_REASON };
  if (roundTrips.length === 1) return { ok: false, reason: 'This is the last flight. Use Remove route to delete the route.' };
  const rotation = latest(roundTrips);
  const preview: MapPreview = {
    effects: [{ base: rotation.airports[0], classCode: typeCodeOf(state, rotation.tail), minutes: -rotation.minutes }],
    routes: [{ origin: a, dest: b, kind: 'change' }],
  };
  return { ok: true, rotation, preview };
}

export function removeFlight(state: SimState, a: string, b: string): Outcome<{ message: string }> {
  const preview = previewRemoveFlight(state, a, b);
  if (!preview.ok) return preview;
  removeRotation(preview.rotation, state);
  return { ok: true, message: `Removed a flight from ${a}–${b}.` };
}

// --- Gauge ---------------------------------------------------------------

/**
 * Move one flight up (`direction` 1) or down (-1) a class. Upgauging picks
 * the smallest-class flight on the route, downgauging the largest, so
 * repeated clicks even the route out rather than piling changes on one
 * flight. The flight moves to a plane of the next class based at the same
 * airport, chosen the same way a new route chooses its plane: first one
 * whose plan actually fits.
 *
 * Planned against the schedule *without* the flight being moved, since
 * that flight is about to stop using its old plane's day.
 */
export function previewGauge(
  state: SimState,
  a: string,
  b: string,
  direction: 1 | -1,
): Outcome<{ rotation: Rotation; tail: string; plan: RotationPlan; fromName: string; toName: string; preview: MapPreview }> {
  const { roundTrips } = summariseMarket(state, a, b);
  if (roundTrips.length === 0) return { ok: false, reason: MULTI_STOP_REASON };

  const ranked = roundTrips.map((r) => ({ rotation: r, rank: classRank(typeCodeOf(state, r.tail)) }));
  const chosen = ranked
    .filter((r) => r.rank === (direction === 1 ? Math.min(...ranked.map((x) => x.rank)) : Math.max(...ranked.map((x) => x.rank))))
    .map((r) => r.rotation);
  const rotation = latest(chosen);

  const fromClass = AIRCRAFT_CLASSES[classRank(typeCodeOf(state, rotation.tail))];
  const target = AIRCRAFT_CLASSES[classRank(fromClass.code) + direction];
  if (!target) {
    return { ok: false, reason: direction === 1 ? 'Already flying the largest class.' : 'Already flying the smallest class.' };
  }

  const base = airportOf(rotation.airports[0]);
  const other = airportOf(rotation.airports[1]);
  const tails = candidateTailsAt(state, base.iata).filter((tail) => typeCodeOf(state, tail) === target.code);
  if (tails.length === 0) {
    return { ok: false, reason: `No ${target.name} is based at ${base.iata}. Tap ${base.iata}, then Plane, to add one.` };
  }

  const withoutIt = { ...state, schedule: state.schedule.filter((leg) => !rotation.legs.includes(leg)) } as SimState;
  let firstError = '';
  for (const tail of tails) {
    const plan = planRotation([base], other, tail, withoutIt);
    if (!plan.error) {
      const preview: MapPreview = {
        effects: [
          { base: base.iata, classCode: fromClass.code, minutes: -rotation.minutes },
          { base: base.iata, classCode: target.code, minutes: plan.rotationMinutes },
        ],
        routes: [{ origin: a, dest: b, kind: 'change' }],
      };
      return { ok: true, rotation, tail, plan, fromName: fromClass.name, toName: target.name, preview };
    }
    firstError ||= plan.error;
  }
  return { ok: false, reason: explainFailure(firstError, target.name, base.iata) };
}

export function applyGauge(state: SimState, a: string, b: string, direction: 1 | -1): Outcome<{ message: string }> {
  const preview = previewGauge(state, a, b, direction);
  if (!preview.ok) return preview;

  for (const leg of preview.rotation.legs) {
    const index = state.schedule.indexOf(leg);
    if (index !== -1) state.schedule.splice(index, 1);
  }
  commitRotation(state, preview.tail, preview.plan);

  const verb = direction === 1 ? 'Upgauged' : 'Downgauged';
  return { ok: true, message: `${verb} one flight on ${a}–${b}: ${preview.fromName} to ${preview.toName} (${preview.tail}).` };
}

// --- Removing a route -----------------------------------------------------

/** What removing the whole route would free, for the hover preview. */
export function previewRemoveRoute(state: SimState, a: string, b: string): Outcome<{ preview: MapPreview }> {
  const rotations = rotationsServing(state, a, b);
  if (rotations.length === 0) return { ok: false, reason: 'Nothing flies this route.' };
  return {
    ok: true,
    preview: {
      effects: rotations.map((rotation) => ({
        base: rotation.airports[0],
        classCode: typeCodeOf(state, rotation.tail),
        minutes: -rotation.minutes,
      })),
      routes: [{ origin: a, dest: b, kind: 'remove' }],
    },
  };
}

export function removeRoute(state: SimState, a: string, b: string): Outcome<{ message: string }> {
  const rotations = rotationsServing(state, a, b);
  if (rotations.length === 0) return { ok: false, reason: 'Nothing flies this route.' };
  for (const rotation of rotations) removeRotation(rotation, state);
  return { ok: true, message: `Removed ${a}–${b} (${rotations.length} flight${rotations.length === 1 ? '' : 's'}).` };
}

// --- Adding a plane ---------------------------------------------------------

export type PlaneOption = {
  code: string;
  name: string;
  seats: number;
  leasePerDay: number;
  disabledReason?: string;
  /** One more plane in this class's pool at this airport, for the hover preview. */
  preview?: MapPreview;
};

export function planeOptions(state: SimState, iata: string): PlaneOption[] {
  return loadLeaseRates().map((rate) => {
    const cls = classByCode(rate.typeCode)!;
    let disabledReason: string | undefined;
    if (!isAircraftTypeAllowedAt(iata, rate.typeCode)) disabledReason = `Too large to operate at ${iata}.`;
    else if (state.cash < cashNeededToLease(rate.leasePricePerDay)) {
      disabledReason = `Needs $${cashNeededToLease(rate.leasePricePerDay).toLocaleString()} on hand (${LEASE_RESERVE_DAYS} days of lease) to lease a ${cls.name}.`;
    }
    return {
      code: cls.code,
      name: cls.name,
      seats: cls.seats,
      leasePerDay: rate.leasePricePerDay,
      disabledReason,
      preview: disabledReason ? undefined : { effects: [{ base: iata, classCode: cls.code, minutes: 0, planes: 1 }], routes: [] },
    };
  });
}

/** Lease one plane of this class. It arrives immediately, based and parked at `iata`. */
export function leasePlane(state: SimState, iata: string, typeCode: string): Outcome<{ message: string }> {
  const option = planeOptions(state, iata).find((o) => o.code === typeCode);
  if (!option) return { ok: false, reason: 'Unknown aircraft class.' };
  if (option.disabledReason) return { ok: false, reason: option.disabledReason };

  const aircraft = leaseAircraft(state, typeCode, iata);
  revealReach(state);
  return { ok: true, message: `${option.name} leased at ${iata} for $${option.leasePerDay.toLocaleString()}/day (${aircraft.tail}).` };
}
