import { dayIndex } from './clock';
import {
  closeCrewBase as closeCrewBaseRule,
  closeMxBase as closeMxBaseRule,
  contractCost,
  CREW_BASE_PER_DAY,
  crewBaseBlocked,
  crewBaseCloseBlocked,
  hasCrewBase,
  hasMxBase,
  MX_BASE_FEE,
  MX_BASE_PER_DAY,
  mxBaseBlocked,
  mxBaseCloseBlocked,
  mxBaseList,
  openCrewBaseAt as openCrewBaseRule,
  openMxBase as openMxBaseRule,
  outstationCheck,
  setOutstationCheck as setOutstationCheckRule,
  type OutstationCheck,
} from './bases';
import {
  CREW_BASE_FEE,
  crewBases,
  CREWS_PER_NEW_PLANE,
  crewNeed,
  crewsArriving,
  crewsOf,
  hireCrews,
  hireFee,
  hireLeadDays,
  IDEAL_SHIFT_MINUTES,
  releaseCrews,
  retrainCrews,
  retrainDays,
  retrainFee,
  standbyCost,
} from './crews';
import airportsData from '../../data/airports.json';
import {
  appointBlockedReason,
  appointedCandidate,
  appointExecutive,
  candidatesForRole,
  dismissExecutive,
  EXECUTIVE_ROLES,
  executiveLeaseMultiplier,
  ROLE_LABELS,
  type ExecutiveCandidate,
  type ExecutiveRole,
} from './executives';
import { AIRCRAFT_CLASSES, classByCode, classRank, pluralClassName } from './aircraftClasses';
import { applyHubStyleChange, planHubStyleChange } from './hubs';
import { HUB_STYLES, type HubStyle } from './hubStyle';
import { buyHedge, HEDGE_TERMS, hedgeQuote, type HedgeQuote } from './fuelPrice';
import {
  adoptBlockedReason,
  adoptInnovation as adoptInnovationRule,
  INNOVATIONS,
  isAdopted,
  leasedAge,
  type Innovation,
  type InnovationId,
} from './innovations';
import { cashNeededToLease, LEASE_RESERVE_DAYS, leaseRateFor, loadLeaseRates } from './leasing';
import { inboundAt, orderLease } from './fleetTiming';
import { startSeatSale as startSeatSaleRule } from './seatSale';
import { SEASON_DAYS, SEASONAL_PREMIUM } from './seasonalLease';
import { deferredItems, heavyBankedMinutes, heavyCheckDueIn, heavyCheckOpen, heavyCheckWorkMinutes, tonightCheck } from './mxChecks';
import { rebaseOptions, rebasePlane, type RebaseOption } from './rebase';
import { cabinGainPerDay, cabinOf, cancelRefit as cancelRefitRule, orderRefit as orderRefitRule, refitBlockedReason, refitCost, refitDays, type Cabin } from './cabins';
import { commitRetime, planRetime, type RetimePlan } from './retime';
import { daysUntilNextListing, listingsOf, returnBlockedReason, returnFee, returnLease, takeListing, type MarketListing } from './market';
import { airlineCalled, classOpen, tierThatOpens } from './ladder';
import { actualDailyDemand, currentPotentialDemand } from './marketDemand';
import { revealReach } from './reach';
import { applyRotation, candidateTailsAt, planRotation, type RotationPlan, type RotationStop } from './rotations';
import { isAircraftTypeAllowedAt, legsServingMarket, marketKey } from './schedule';
import type { SimState } from './state';
import { applyTurnBufferChange, planTurnBufferChange } from './turnBuffer';
import { allRotations, type PoolEffect, type Rotation } from './utilisation';

/**
 * What a player can do to the network, as plain operations on `SimState`
 * with no DOM in sight. The map menu (ui/mapMenu.ts) and the side panel
 * call these through ui/routeActions.ts, and the headless player calls
 * them directly, so both play by exactly the same rules.
 *
 * Every "change" comes as a pair: a `preview…` that says whether it can be
 * done and, if not, why in words the player can act on (the menu shows
 * that as the disabled button's hover text), and an `apply…` that does it.
 * They share one code path so a button can never be enabled for something
 * that then refuses.
 *
 * Nothing here decides what a rotation *is* or whether it fits: planning
 * and committing are sim/rotations.ts's planRotation() and applyRotation(),
 * the same functions the draw-a-route gesture uses. This module only
 * chooses which plane and which rotation to hand them.
 *
 * The unit of change is one flight. A route with three flights a day is
 * three rotations, and "upgauge" moves one of them up a class per click,
 * "add a flight" adds one, "remove a flight" removes one. That keeps every
 * click small, reversible by the opposite click, and never all-or-nothing.
 */

/** A route to draw emphasised while a change is previewed. */
export type RoutePreview = {
  origin: string;
  dest: string;
  /** add: green, remove: red dashed, change: amber. */
  kind: 'add' | 'remove' | 'change';
};

/**
 * What a change would do, for the map to draw before it is made
 * (render/preview.ts holds the one being hovered).
 */
export type MapPreview = {
  /** How pool bookings would change, for the bars and the base rings. */
  effects: PoolEffect[];
  /** Routes to draw emphasised on the map. */
  routes: RoutePreview[];
};

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

const airports = airportsData as RotationStop[];

function airportOf(iata: string): RotationStop {
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
    legs: legs.length,
    demandTotal: actualDailyDemand(state, a, b),
    demandNow: Math.round(actualDailyDemand(state, a, b) / legCount),
    demandPotential: Math.round(currentPotentialDemand(state, a, b) / legCount),
    seatsPerFlight: Math.round(seats / legCount),
    flightsEachWay: Math.round(legsServingMarket(a, b, state.schedule) / 2),
  };
}

export type MarketPnlHistory = { revenue: number[]; cost: number[]; margin: number[] };

/**
 * This market's own recent daily Revenue/Cost/Margin (sim/pnlHistory.ts),
 * the route-card equivalent of the sidebar's network-wide "Last 7 Days"
 * charts (ui/pnlHistory.ts). Margin isn't stored on `state` separately —
 * a market's margin is exactly its own revenue minus its own cost, so
 * it's computed here rather than kept a third time.
 */
export function marketPnlHistory(state: SimState, a: string, b: string): MarketPnlHistory {
  const key = marketKey(a, b);
  const revenue = state.revenueHistoryByMarket[key] ?? [];
  const cost = state.costHistoryByMarket[key] ?? [];
  return { revenue, cost, margin: revenue.map((r, i) => r - (cost[i] ?? 0)) };
}

const MULTI_STOP_REASON = 'Flown as part of a multi-stop rotation. Remove that rotation in the Fleet tab to change this route.';

/**
 * Why a plane in `code` can't take a there-and-back, in words a player can
 * act on. Range, airport-size and full-airport failures are quoted as they
 * are; anything else is aircraft capacity, and that has one fix.
 */
function explainFailure(error: string, className: string, baseIata: string): string {
  if (/range|too large|no slots left/.test(error)) return error;
  return `Every ${className} at ${baseIata} full · lease another there`;
}

/**
 * Take one rotation out of the schedule. A market left with no flights at
 * all loses its settings (fare, stance, turn buffer), so
 * reopening it later starts fresh.
 *
 * A flight already airborne on one of these legs is unaffected:
 * ActiveFlight carries its own copy of the leg (sim/state.ts), so it
 * finishes the sector it's on and simply has nothing to fly next.
 */
export function removeRotation(state: SimState, rotation: Rotation): void {
  for (const leg of rotation.legs) {
    const index = state.schedule.indexOf(leg);
    if (index !== -1) state.schedule.splice(index, 1);
  }

  // Checked after every leg is gone, not as each one goes, so a rotation
  // that flies the same market twice doesn't decide the market is orphaned
  // while its own second leg is still in the array.
  for (const leg of rotation.legs) {
    if (legsServingMarket(leg.origin, leg.dest, state.schedule) > 0) continue;
    delete state.routeSettings[marketKey(leg.origin, leg.dest)];
  }
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
    return { ok: false, reason: `No ${className} based at ${base.iata} · lease one there` };
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
  applyRotation(state, preview.tail, preview.plan);
  return { ok: true, message: `Added a ${preview.className} flight on ${a}–${b} (${preview.tail}).` };
}

export function previewRemoveFlight(state: SimState, a: string, b: string): Outcome<{ rotation: Rotation; preview: MapPreview }> {
  const { roundTrips } = summariseMarket(state, a, b);
  if (roundTrips.length === 0) return { ok: false, reason: MULTI_STOP_REASON };
  if (roundTrips.length === 1) return { ok: false, reason: 'Last flight · use Remove route' };
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
  removeRotation(state, preview.rotation);
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
    return { ok: false, reason: `No ${target.name} based at ${base.iata} · lease one there` };
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
  applyRotation(state, preview.tail, preview.plan);

  const verb = direction === 1 ? 'Upgauged' : 'Downgauged';
  return { ok: true, message: `${verb} one flight on ${a}–${b}: ${preview.fromName} to ${preview.toName} (${preview.tail}).` };
}

// --- Turn buffer -----------------------------------------------------------

/** The route's current turn buffer in minutes. */
export function currentTurnBuffer(state: SimState, a: string, b: string): number {
  return state.routeSettings[marketKey(a, b)]?.turnBufferMinutes ?? 0;
}

/**
 * Whether this route's buffer can be set to `minutes`, and what that would
 * do to the base's pools (sim/turnBuffer.ts does the actual planning).
 */
export function previewTurnBuffer(state: SimState, a: string, b: string, minutes: number): Outcome<{ preview: MapPreview; moved: number }> {
  if (currentTurnBuffer(state, a, b) === minutes) return { ok: false, reason: `Already +${minutes} min.` };
  const plan = planTurnBufferChange(state, a, b, minutes);
  if (!plan.ok) return plan;
  return { ok: true, moved: plan.moved, preview: { effects: plan.effects, routes: [{ origin: a, dest: b, kind: 'change' }] } };
}

export function setTurnBuffer(state: SimState, a: string, b: string, minutes: number): Outcome<{ message: string }> {
  const result = applyTurnBufferChange(state, a, b, minutes);
  if (!result.ok) return result;
  const movedNote = result.moved > 0 ? ` ${result.moved} rotation${result.moved === 1 ? '' : 's'} moved to another plane to make room.` : '';
  return { ok: true, message: `${a}–${b} turn buffer set to +${minutes} min after each flight.${movedNote}` };
}

// --- Hub style ------------------------------------------------------------

/** Whether this airport can switch to `style`, and what that does to the pools (sim/hubs.ts plans it). */
export function previewHubStyle(state: SimState, iata: string, style: HubStyle): Outcome<{ preview: MapPreview; moved: number }> {
  const plan = planHubStyleChange(state, iata, style);
  if (!plan.ok) return plan;
  return { ok: true, moved: plan.moved, preview: { effects: plan.effects, routes: [] } };
}

export function setHubStyle(state: SimState, iata: string, style: HubStyle): Outcome<{ message: string }> {
  const result = applyHubStyleChange(state, iata, style);
  if (!result.ok) return result;
  const movedNote = result.moved > 0 ? ` ${result.moved} rotation${result.moved === 1 ? '' : 's'} moved to another plane to make room.` : '';
  return { ok: true, message: `${iata} now runs as ${HUB_STYLES[style].name}.${movedNote}` };
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
  for (const rotation of rotations) removeRotation(state, rotation);
  return { ok: true, message: `Removed ${a}–${b} (${rotations.length} flight${rotations.length === 1 ? '' : 's'}).` };
}

// --- Adding a plane ---------------------------------------------------------

export type PlaneOption = {
  code: string;
  name: string;
  seats: number;
  /** The airframe a lease would take (sim/market.ts), or null when none of this class is listed. */
  listing: MarketListing | null;
  /** How many of this class are listed in all. */
  listed: number;
  disabledReason?: string;
  /** One more plane in this class's pool at this airport, for the hover preview. */
  preview?: MapPreview;
};

function days(count: number): string {
  return `${count} day${count === 1 ? '' : 's'}`;
}

/**
 * The airframe a listing becomes once leased: the same one, unless the
 * airline has younger airframes (sim/innovations.ts), which refurbish it
 * on the way out at the younger airframe's rate, or an aircraft-finance
 * CFO (sim/executives.ts), who gets the rate down.
 */
function asLeased(state: SimState, listing: MarketListing): MarketListing {
  const ageYears = leasedAge(state, listing.ageYears);
  const rate = ageYears === listing.ageYears ? listing.leasePricePerDay : leaseRateFor(listing.typeCode, ageYears);
  const leasePricePerDay = Math.round(rate * executiveLeaseMultiplier(state));
  if (ageYears === listing.ageYears && leasePricePerDay === listing.leasePricePerDay) return listing;
  return { ...listing, ageYears, leasePricePerDay };
}

/**
 * One choice per class: the next airframe the shared lessor has listed
 * (sim/market.ts), as the airline would get it, or why there isn't one
 * to take.
 */
export function planeOptions(state: SimState, iata: string): PlaneOption[] {
  return loadLeaseRates().map((rate) => {
    const cls = classByCode(rate.typeCode)!;
    const listings = listingsOf(state, rate.typeCode);
    const listing = listings[0] ? asLeased(state, listings[0]) : null;
    let disabledReason: string | undefined;
    if (!isAircraftTypeAllowedAt(iata, rate.typeCode)) {
      disabledReason = `Too large to operate at ${iata}.`;
    } else if (!classOpen(state, rate.typeCode)) {
      // Earned on the ladder (sim/ladder.ts), not on a date.
      const opener = tierThatOpens(rate.typeCode);
      disabledReason = `${pluralClassName(cls.name)} open when you become ${opener ? airlineCalled(opener) : 'a bigger airline'}: see Goals.`;
    } else if (!listing) {
      disabledReason = `No ${cls.name} on the market. The next arrives in ${days(daysUntilNextListing(state, rate.typeCode))}, first come first served.`;
    } else if (!hasCrewBase(state, iata)) {
      // Planes are based only where crews live (sim/bases.ts).
      disabledReason = `No crew base at ${iata}: open one on the Crews tab.`;
    } else if (state.cash < cashNeededToLease(listing.leasePricePerDay)) {
      disabledReason = `Needs $${cashNeededToLease(listing.leasePricePerDay).toLocaleString()} on hand (${LEASE_RESERVE_DAYS} days of lease) to lease this ${cls.name}.`;
    }
    return {
      code: cls.code,
      name: cls.name,
      seats: cls.seats,
      listing,
      listed: listings.length,
      disabledReason,
      preview: disabledReason ? undefined : { effects: [{ base: iata, classCode: cls.code, minutes: 0, planes: 1 }], routes: [] },
    };
  });
}

/** Lease the next listed plane of this class. It arrives immediately, based and parked at `iata`. */
export function leasePlane(state: SimState, iata: string, typeCode: string, seasonal = false): Outcome<{ message: string }> {
  const option = planeOptions(state, iata).find((o) => o.code === typeCode);
  if (!option) return { ok: false, reason: 'Unknown aircraft class.' };
  if (option.disabledReason) return { ok: false, reason: option.disabledReason };
  const listing = takeListing(state, typeCode);
  if (!listing) return { ok: false, reason: `No ${option.name} on the market.` };

  const standing = asLeased(state, listing);
  // For the season (sim/seasonalLease.ts): dearer a day, and back by itself.
  const leased = seasonal ? { ...standing, leasePricePerDay: Math.round(standing.leasePricePerDay * SEASONAL_PREMIUM) } : standing;
  const arrivesDay = orderLease(state, leased, iata, seasonal ? SEASON_DAYS : undefined);
  revealReach(state);
  const crewNote = crewAdvice(state, iata, typeCode);
  const refurbished = leased.ageYears === listing.ageYears ? '' : `, refurbished from ${listing.ageYears}`;
  return {
    ok: true,
    message:
      `${option.name} leased at ${iata}${seasonal ? ` for ${SEASON_DAYS} days` : ''}: ${leased.ageYears} yrs old${refurbished}, $${leased.leasePricePerDay.toLocaleString()}/day from its delivery on day ${arrivesDay}.` +
      (crewNote ? ` ${crewNote}` : ''),
  };
}

/** Remove every flight one plane flies, so it can go back to the lessor (or fly something else). */
export function clearPlane(state: SimState, tail: string): Outcome<{ message: string }> {
  const rotations = allRotations(state).filter((rotation) => rotation.tail === tail);
  if (rotations.length === 0) return { ok: false, reason: `${tail} has no flights.` };
  for (const rotation of rotations) removeRotation(state, rotation);
  return { ok: true, message: `Removed ${tail}'s ${rotations.length} flight${rotations.length === 1 ? '' : 's'}.` };
}

/** Planes based here that could go back to the lessor now, and the ones that can't with why. */
export function returnOptions(state: SimState, iata: string): { tail: string; name: string; fee: number; saves: number; ageYears: number; blocked: string | null }[] {
  return state.aircraft
    .filter((aircraft) => aircraft.baseAirport === iata && aircraft.returningOnDay === undefined && aircraft.rebase === undefined)
    .map((aircraft) => ({
      tail: aircraft.tail,
      name: classByCode(aircraft.typeCode)?.name ?? aircraft.typeCode,
      fee: returnFee(aircraft),
      saves: aircraft.leaseCostPerDay,
      ageYears: aircraft.ageYears,
      blocked: returnBlockedReason(state, aircraft) ?? (state.cash < returnFee(aircraft) ? `Needs $${returnFee(aircraft).toLocaleString()} on hand.` : null),
    }));
}

export function returnPlane(state: SimState, tail: string): Outcome<{ message: string }> {
  return returnLease(state, tail);
}

/** Check and price moving a rotation to a new start, and optionally another plane of its type (sim/retime.ts). */
export function planRetimeRotation(state: SimState, legIds: string[], toTail: string, startMinute: number): RetimePlan {
  return planRetime(state, legIds, toTail, startMinute);
}

/** Move a rotation to a new start, and optionally another plane of its type (sim/retime.ts). */
export function retimeRotation(state: SimState, legIds: string[], toTail: string, startMinute: number): Outcome<{ message: string }> {
  return commitRetime(state, legIds, toTail, startMinute);
}

/** Every other crew base a plane could ferry to (sim/rebase.ts), with its cost and crews there. */
export function rebaseOptionsFor(state: SimState, tail: string): { blocked: string | null; options: RebaseOption[] } {
  return rebaseOptions(state, tail);
}

/** Ferry a plane with no flights to another crew base; the new base's crew need is added to the message. */
export function rebasePlaneTo(state: SimState, tail: string, to: string): Outcome<{ message: string }> {
  const result = rebasePlane(state, tail, to);
  if (!result.ok) return result;
  const typeCode = state.aircraft.find((a) => a.tail === tail)?.typeCode ?? '';
  const crewNote = crewAdvice(state, to, typeCode);
  return { ok: true, message: result.message + (crewNote ? ` · ${crewNote}` : '') };
}

// --- Maintenance checks ------------------------------------------------------

export type HeavyCheckReadout = {
  tail: string;
  typeCode: string;
  base: string | null;
  deferred: number;
  dueIn: number;
  /** Whether nights at base are counting toward it yet. */
  open: boolean;
  bankedHours: number;
  workHours: number;
  /** Grounded for it, having gone too far overdue. */
  inCheck: boolean;
  lastNight: 'checked' | 'cleared' | 'short' | 'contracted' | 'away' | null;
};

/** Every plane's checks (sim/mxChecks.ts), for the Mtc screen, soonest due first. */
export function heavyCheckReadouts(state: SimState): HeavyCheckReadout[] {
  return state.aircraft
    .map((aircraft) => ({
      tail: aircraft.tail,
      typeCode: aircraft.typeCode,
      base: aircraft.baseAirport,
      deferred: deferredItems(aircraft),
      dueIn: heavyCheckDueIn(aircraft),
      open: heavyCheckOpen(aircraft),
      bankedHours: Math.round((heavyBankedMinutes(aircraft) / 60) * 10) / 10,
      workHours: heavyCheckWorkMinutes(aircraft.typeCode) / 60,
      inCheck: state.aogs.some((event) => event.tail === aircraft.tail && event.check),
      lastNight: state.lastNightChecks?.[aircraft.tail] ?? null,
    }))
    .sort((a, b) => a.dueIn - b.dueIn);
}

// --- Seat sales --------------------------------------------------------------

/** Start a seven-day seat sale on a route (sim/seatSale.ts). */
export function startSeatSale(state: SimState, a: string, b: string): Outcome<{ message: string }> {
  return startSeatSaleRule(state, a, b);
}

// --- Cabins --------------------------------------------------------------------

export type RefitOption = {
  /** The cabin a refit would fit: the other one. */
  to: Cabin;
  cost: number;
  days: number;
  /** What the plane's markets would make a day with it, against now (sim/cabins.ts's forecast). */
  gainPerDay: number;
  blocked: string | null;
};

/** The refit on offer for a plane (sim/cabins.ts), or null for one that can't have a business cabin. */
export function refitOptionFor(state: SimState, tail: string): RefitOption | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || refitDays(aircraft.typeCode) === 0) return null;
  const to: Cabin = cabinOf(aircraft) === 'business' ? 'economy' : 'business';
  return {
    to,
    cost: refitCost(aircraft),
    days: refitDays(aircraft.typeCode),
    gainPerDay: cabinGainPerDay(state, tail, to),
    blocked: refitBlockedReason(state, aircraft, to),
  };
}

export function orderRefit(state: SimState, tail: string, cabin: Cabin): Outcome<{ message: string }> {
  return orderRefitRule(state, tail, cabin);
}

export function cancelRefit(state: SimState, tail: string): Outcome<{ message: string }> {
  return cancelRefitRule(state, tail);
}

// --- Innovations --------------------------------------------------------------

export type InnovationOption = Innovation & {
  adopted: boolean;
  /** Why it can't be adopted now, or null if it can. */
  blocked: string | null;
};

/** Every innovation (sim/innovations.ts), with whether it's running and why it can't be adopted yet. */
export function innovationOptions(state: SimState): InnovationOption[] {
  return INNOVATIONS.map((innovation) => ({
    ...innovation,
    adopted: isAdopted(state, innovation.id),
    blocked: isAdopted(state, innovation.id) ? null : adoptBlockedReason(state, innovation),
  }));
}

export function adoptInnovation(state: SimState, id: InnovationId): Outcome<{ message: string }> {
  return adoptInnovationRule(state, id);
}

// --- Fuel hedging --------------------------------------------------------------

/** A quote for each hedge length on offer (sim/fuelPrice.ts). */
export function hedgeOptions(state: SimState): HedgeQuote[] {
  return HEDGE_TERMS.map((days) => hedgeQuote(state, days));
}

export function hedgeFuel(state: SimState, days: number): Outcome<{ message: string }> {
  return buyHedge(state, days);
}

// --- Executives ------------------------------------------------------------------

export type ExecutiveOption = ExecutiveCandidate & {
  appointed: boolean;
  /** Why they can't be appointed now, or null if they can. */
  blocked: string | null;
};

/** Each chair (sim/executives.ts): who holds it, and every candidate with why they can't be hired yet. */
export function executiveOptions(state: SimState): { role: ExecutiveRole; label: string; holder: ExecutiveCandidate | null; hiredDay: number | null; candidates: ExecutiveOption[] }[] {
  return EXECUTIVE_ROLES.map((role) => {
    const holder = appointedCandidate(state, role) ?? null;
    const appointment = state.executives[role];
    return {
      role,
      label: ROLE_LABELS[role],
      holder,
      hiredDay: appointment ? dayIndex(state, appointment.hiredAtMinute) : null,
      candidates: candidatesForRole(role).map((candidate) => ({
        ...candidate,
        appointed: holder?.id === candidate.id,
        blocked: holder?.id === candidate.id ? null : appointBlockedReason(state, candidate),
      })),
    };
  });
}

export function appointExecutiveById(state: SimState, candidateId: string): Outcome<{ message: string }> {
  return appointExecutive(state, candidateId);
}

export function letExecutiveGo(state: SimState, role: ExecutiveRole): Outcome<{ message: string }> {
  return dismissExecutive(state, role);
}

// --- Crews -----------------------------------------------------------------------


/** A nudge when a base has fewer crews of a class (here or on their way) than its planes need. */
function crewAdvice(state: SimState, iata: string, classCode: string): string | null {
  const need = crewNeed(state, iata, classCode);
  const base = crewBases(state)[iata];
  const have = crewsOf(base, classCode) + crewsArriving(base, classCode);
  // Every plane of this class on its way needs its own crews.
  const inbound = inboundAt(state, iata, classCode).length * CREWS_PER_NEW_PLANE;
  if (have >= need.minimum + inbound) return null;
  const name = classByCode(classCode)?.name ?? classCode;
  return `${iata} short of ${name} crews for it · hire or retrain now to join by delivery`;
}


export type ClassCrewReadout = {
  classCode: string;
  name: string;
  crews: number;
  /** Hired or retraining for this class, not yet flying. */
  arriving: number;
  /** Crews its planes here need at ideal shifts, and at the legal minimum. */
  ideal: number;
  minimum: number;
  bookedHours: number;
  availableHours: number;
  hireFee: number;
  retrainFee: number;
  standbyPerDay: number;
  /** Whether the ladder has opened this class to the airline (sim/ladder.ts), so its crews can be hired. */
  open: boolean;
};

export type CrewReadout = {
  classes: ClassCrewReadout[];
  leadDays: number;
  retrainDays: number;
};

/**
 * A base's crews, class by class, for the airport view: every class it
 * has planes or crews in, plus every class the ladder has opened (so crews
 * can be hired ahead of the first plane). Null where there is no base.
 */
export function crewReadout(state: SimState, iata: string): CrewReadout | null {
  const base = crewBases(state)[iata];
  if (!base) return null;
  const classes = AIRCRAFT_CLASSES.map((cls) => {
    const need = crewNeed(state, iata, cls.code);
    const crews = crewsOf(base, cls.code);
    return {
      classCode: cls.code,
      name: cls.name,
      crews,
      arriving: crewsArriving(base, cls.code),
      ideal: need.ideal,
      minimum: need.minimum,
      bookedHours: need.dutyHours,
      availableHours: (crews * IDEAL_SHIFT_MINUTES) / 60,
      hireFee: hireFee(cls.code),
      retrainFee: retrainFee(cls.code),
      standbyPerDay: standbyCost(cls.code),
      open: classOpen(state, cls.code),
    };
  }).filter((c) => c.open || c.crews > 0 || c.arriving > 0 || c.bookedHours > 0);
  return { classes, leadDays: hireLeadDays(state), retrainDays: retrainDays(state) };
}

export function hireCrewsAt(state: SimState, iata: string, classCode: string, count: number): Outcome<{ message: string }> {
  if (!classOpen(state, classCode)) return { ok: false, reason: 'That class isn\'t open to the airline yet.' };
  return hireCrews(state, iata, classCode, count);
}

export function retrainCrewsAt(state: SimState, iata: string, from: string, to: string, count: number): Outcome<{ message: string }> {
  if (!classOpen(state, to)) return { ok: false, reason: 'That class isn\'t open to the airline yet.' };
  return retrainCrews(state, iata, from, to, count);
}

export function releaseCrewsAt(state: SimState, iata: string, classCode: string, count: number): Outcome<{ message: string }> {
  return releaseCrews(state, iata, classCode, count);
}

/** A base the airline has, for the Crews and Mtc tabs: planes based there, its running cost, and whether it can close. */
export type BaseReadout = { iata: string; name: string; planes: number; perDay: number; closeBlocked: string | null };

/** An airport a base could open at: every known airport without one, with why not if it can't. */
export type BaseCandidate = { iata: string; name: string; blocked: string | null };

const airportNames = new Map((airportsData as { iata: string; name: string }[]).map((airport) => [airport.iata, airport.name]));
const nameOf = (iata: string) => airportNames.get(iata) ?? iata;

function basedHere(state: SimState, iata: string): number {
  return state.aircraft.filter((aircraft) => aircraft.baseAirport === iata).length;
}

export function crewBaseReadout(state: SimState): { bases: BaseReadout[]; candidates: BaseCandidate[]; fee: number; perDay: number } {
  const bases = Object.keys(crewBases(state)).map((iata) => ({
    iata,
    name: nameOf(iata),
    planes: basedHere(state, iata),
    perDay: iata === state.homeAirport ? 0 : CREW_BASE_PER_DAY,
    closeBlocked: crewBaseCloseBlocked(state, iata),
  }));
  const candidates = state.knownAirports.filter((iata) => !hasCrewBase(state, iata)).map((iata) => ({ iata, name: nameOf(iata), blocked: crewBaseBlocked(state, iata) }));
  return { bases, candidates, fee: CREW_BASE_FEE, perDay: CREW_BASE_PER_DAY };
}

/**
 * The maintenance bases, the airports one could open at, and the
 * stations where planes sleep tonight without one: each with its setting
 * and what a contracted night costs there.
 */
export function mxBaseReadout(state: SimState): {
  bases: BaseReadout[];
  candidates: BaseCandidate[];
  stations: { iata: string; name: string; planes: number; check: OutstationCheck; contractPerNight: number }[];
  fee: number;
  perDay: number;
} {
  const bases = mxBaseList(state).map((iata) => ({
    iata,
    name: nameOf(iata),
    planes: basedHere(state, iata),
    perDay: iata === state.homeAirport ? 0 : MX_BASE_PER_DAY,
    closeBlocked: mxBaseCloseBlocked(state, iata),
  }));
  const candidates = state.knownAirports.filter((iata) => !hasMxBase(state, iata)).map((iata) => ({ iata, name: nameOf(iata), blocked: mxBaseBlocked(state, iata) }));
  const sleeping = new Map<string, { planes: number; work: number }>();
  for (const aircraft of state.aircraft) {
    const tonight = tonightCheck(state, aircraft.tail);
    if (!tonight || hasMxBase(state, tonight.station)) continue;
    const entry = sleeping.get(tonight.station) ?? { planes: 0, work: 0 };
    sleeping.set(tonight.station, { planes: entry.planes + 1, work: entry.work + tonight.work });
  }
  const stations = [...sleeping].map(([iata, { planes, work }]) => ({ iata, name: nameOf(iata), planes, check: outstationCheck(state, iata), contractPerNight: contractCost(work) }));
  return { bases, candidates, stations, fee: MX_BASE_FEE, perDay: MX_BASE_PER_DAY };
}

export function openCrewBaseAt(state: SimState, iata: string): Outcome<{ message: string }> {
  return openCrewBaseRule(state, iata);
}

export function closeCrewBaseAt(state: SimState, iata: string): Outcome<{ message: string }> {
  return closeCrewBaseRule(state, iata);
}

export function openMxBaseAt(state: SimState, iata: string): Outcome<{ message: string }> {
  return openMxBaseRule(state, iata);
}

export function closeMxBaseAt(state: SimState, iata: string): Outcome<{ message: string }> {
  return closeMxBaseRule(state, iata);
}

export function setStationCheck(state: SimState, iata: string, check: OutstationCheck): Outcome<{ message: string }> {
  return setOutstationCheckRule(state, iata, check);
}
