import { ancillaryPerPassenger, ancillaryPriceDrag } from './ancillaries';
import { LOAD_FACTOR, RECAPTURE_RATE } from './economy';
import { executiveLoadFactorBonus, executiveYieldMultiplier } from './executives';
import { airlineCalled, LADDER, tiersClimbed } from './ladder';
import { brandEdge, nameYieldMultiplier } from './nps';
import { positionEdge } from './brand';
import type { SegmentName } from './timeOfDay';
import type { SimState } from './state';

/**
 * Innovations (WEEK-TEN.md, thread 2): airline programmes the ladder
 * (sim/ladder.ts) makes available and the player then chooses to adopt.
 * Climbing a tier doesn't hand them out; it lets the player buy them. Each
 * has a lasting effect, and each is priced so it pays back only on an
 * airline big enough to use it (CLAUDE.md, the game's philosophy: nothing
 * gives a permanent edge cheaply).
 *
 * Two ways to pay: a one-off price at adoption, or a running cost charged
 * at every rollover (sim/step.ts) for as long as the programme runs.
 * Adopted for good: there's no way to drop one, so a running cost is a
 * commitment.
 *
 * The effects are read where they apply, through `innovationPerks()`, so
 * every place that books a flight or judges a market sees the same thing.
 */

export type InnovationId = 'online-booking' | 'younger-airframes' | 'crew-academy' | 'loyalty-scheme' | 'winglets' | 'codeshare-feed' | SpoilageLevelId;
export type SpoilageLevelId = 'spoilage-1' | 'spoilage-2' | 'spoilage-3' | 'spoilage-4' | 'spoilage-5';

export type Innovation = {
  id: InnovationId;
  name: string;
  /** What it does, at a glance: "Yield +4%". */
  summary: string;
  /** What it does, in full, for the (i) beside it. */
  description: string;
  /** The ladder tier whose climbing opens it (sim/ladder.ts's tier id). */
  openedBy: string;
  /** Paid once, on adoption. */
  oneOffPrice: number;
  /** What it costs to run once adopted, in words ("2% of revenue a day"), or null. */
  runningCost: string | null;
};

/** Online booking: passengers who book direct pay this much more per ticket, with no agent's cut. */
export const DIRECT_BOOKING_YIELD = 1.04;
/** Younger airframes: years a heavy check takes off each plane leased, down to MIN_REFURBISHED_AGE. */
export const REFURBISHMENT_YEARS = 8;
export const MIN_REFURBISHED_AGE = 5;
/** Crew academy: hiring and retraining crews (sim/crews.ts) take this share of the time. */
export const CREW_ACADEMY_TIME_FACTOR = 0.5;
/** Loyalty scheme: the share of turned-away passengers who wait for a later flight, instead of RECAPTURE_RATE. */
export const LOYALTY_RECAPTURE_RATE = 0.6;
/** Loyalty scheme: how much of the money on the table (sim/attractiveness.ts) members keep from a rival. */
export const LOYALTY_KEEPS = 0.25;
/** Loyalty scheme: points and upkeep, as a share of each day's revenue. */
export const LOYALTY_COST_SHARE = 0.02;
/** Winglet retrofits: fuel burned per flight is multiplied by this. */
export const WINGLET_FUEL_FACTOR = 0.9;
/** Codeshare feed: connecting passengers at every hub are multiplied by this. */
export const CODESHARE_FEED_FACTOR = 1.3;
/** Codeshare feed: the partner's fee, a day. */
export const CODESHARE_COST_PER_DAY = 6000;

/** Spoilage management: each level lets planes sell this much more of their seats. */
export const SPOILAGE_STEP = 0.01;
/** No mix of programmes and executives sells more than this share of a plane's seats. */
export const LOAD_FACTOR_CEILING = 0.9;
/** One-off prices of the five spoilage levels; deliberately steep, so only a big airline gains by buying them. */
const SPOILAGE_PRICES = [3_000_000, 5_000_000, 8_000_000, 12_000_000, 18_000_000];
const SPOILAGE_LEVELS: SpoilageLevelId[] = ['spoilage-1', 'spoilage-2', 'spoilage-3', 'spoilage-4', 'spoilage-5'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Level 1 to 5 of spoilage management: each needs the one before it. */
function spoilageLevel(level: number): Innovation {
  const points = Math.round(SPOILAGE_STEP * 100);
  return {
    id: SPOILAGE_LEVELS[level - 1],
    name: `Spoilage mgmt ${ROMAN[level - 1]}`,
    summary: `Seats sold +${points} point`,
    description: `Spoilage management: unsold seats are spoiled stock: they can't be sold after the door closes. Better overbooking and last-minute selling let every plane sell ${points} point more of its seats, ${Math.round(LOAD_FACTOR * 100)}% before any programme. Level ${level} of 5; each needs the one before it. With a commercial officer's help, no airline passes ${Math.round(LOAD_FACTOR_CEILING * 100)}%.`,
    // The first three open with the international tier, the last two only at the top.
    openedBy: level <= 3 ? 'international' : 'global',
    oneOffPrice: SPOILAGE_PRICES[level - 1],
    runningCost: null,
  };
}

export const INNOVATIONS: Innovation[] = [
  {
    id: 'online-booking',
    name: 'Online booking',
    summary: `Yield +${Math.round((DIRECT_BOOKING_YIELD - 1) * 100)}%`,
    description: `Sell tickets on your own website: no agent's cut, so every ticket earns ${Math.round((DIRECT_BOOKING_YIELD - 1) * 100)}% more.`,
    openedBy: 'regional',
    oneOffPrice: 400_000,
    runningCost: null,
  },
  {
    id: 'younger-airframes',
    name: 'Younger airframes',
    summary: `New leases ${REFURBISHMENT_YEARS} yrs younger`,
    description: `A heavy-check deal with the lessor: every plane you lease from now on is refurbished ${REFURBISHMENT_YEARS} years younger (not below ${MIN_REFURBISHED_AGE}), so it runs late, breaks down and disappoints less. You pay the younger airframe's rate.`,
    openedBy: 'regional',
    oneOffPrice: 300_000,
    runningCost: null,
  },
  {
    id: 'crew-academy',
    name: 'Crew academy',
    summary: 'Hiring and retraining 2× faster',
    description: `Train your own crews: hiring and retraining them take half the time, so a new plane or a new type is crewed sooner.`,
    openedBy: 'start-up',
    oneOffPrice: 150_000,
    runningCost: null,
  },
  {
    id: 'loyalty-scheme',
    name: 'Loyalty scheme',
    summary: `Recapture ${Math.round(LOYALTY_RECAPTURE_RATE * 100)}% · rivals see −${Math.round(LOYALTY_KEEPS * 100)}%`,
    description: `Members wait for your next flight: ${Math.round(LOYALTY_RECAPTURE_RATE * 100)}% of the passengers a full flight turns away rebook with you, not ${Math.round(RECAPTURE_RATE * 100)}%. And they stick: rivals see ${Math.round(LOYALTY_KEEPS * 100)}% less money to be made on your routes.`,
    openedBy: 'network',
    oneOffPrice: 500_000,
    runningCost: `${Math.round(LOYALTY_COST_SHARE * 100)}% of revenue`,
  },
  {
    id: 'winglets',
    name: 'Winglet retrofits',
    summary: `Fuel burn −${Math.round((1 - WINGLET_FUEL_FACTOR) * 100)}%`,
    description: `Retrofit winglets across the fleet: every flight burns ${Math.round((1 - WINGLET_FUEL_FACTOR) * 100)}% less fuel, for good.`,
    openedBy: 'network',
    oneOffPrice: 800_000,
    runningCost: null,
  },
  {
    id: 'codeshare-feed',
    name: 'Codeshare feed',
    summary: `Connecting pax +${Math.round((CODESHARE_FEED_FACTOR - 1) * 100)}%`,
    description: `A partner airline sells your connections on its own flights: ${Math.round((CODESHARE_FEED_FACTOR - 1) * 100)}% more connecting passengers at every hub.`,
    openedBy: 'international',
    oneOffPrice: 0,
    runningCost: `$${CODESHARE_COST_PER_DAY.toLocaleString()}/day`,
  },
  spoilageLevel(1),
  spoilageLevel(2),
  spoilageLevel(3),
  spoilageLevel(4),
  spoilageLevel(5),
];

export function innovationById(id: string): Innovation | undefined {
  return INNOVATIONS.find((innovation) => innovation.id === id);
}

export function isAdopted(state: SimState, id: InnovationId): boolean {
  return state.adoptedInnovations?.includes(id) ?? false;
}

/** Whether the ladder has opened it: the tier that opens it is climbed. */
export function innovationOpen(state: SimState, innovation: Innovation): boolean {
  const tierIndex = LADDER.findIndex((tier) => tier.id === innovation.openedBy);
  return tierIndex !== -1 && tiersClimbed(state) > tierIndex;
}

/** Why it can't be adopted right now, or null if it can. */
export function adoptBlockedReason(state: SimState, innovation: Innovation): string | null {
  if (isAdopted(state, innovation.id)) return 'Running';
  const spoilageIndex = SPOILAGE_LEVELS.indexOf(innovation.id as SpoilageLevelId);
  if (spoilageIndex > 0 && !isAdopted(state, SPOILAGE_LEVELS[spoilageIndex - 1])) return `Needs ${INNOVATIONS.find((i) => i.id === SPOILAGE_LEVELS[spoilageIndex - 1])?.name}`;
  if (!innovationOpen(state, innovation)) {
    const tierIndex = LADDER.findIndex((tier) => tier.id === innovation.openedBy);
    const becomes = LADDER[tierIndex + 1];
    return `Opens as ${becomes ? airlineCalled(becomes) : 'a bigger airline'}`;
  }
  if (state.cash < innovation.oneOffPrice) return `Needs $${innovation.oneOffPrice.toLocaleString()} cash`;
  return null;
}

/** Adopt it: pay the one-off price and start the effect. */
export function adoptInnovation(state: SimState, id: InnovationId): { ok: true; message: string } | { ok: false; reason: string } {
  const innovation = innovationById(id);
  if (!innovation) return { ok: false, reason: 'Unknown innovation.' };
  const blocked = adoptBlockedReason(state, innovation);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= innovation.oneOffPrice;
  state.adoptedInnovations = [...(state.adoptedInnovations ?? []), id];
  // Fuel burn is a number the cost model already reads, so winglets set
  // it once rather than being asked for on every flight.
  if (id === 'winglets') state.fuelEfficiencyMultiplier *= WINGLET_FUEL_FACTOR;
  return { ok: true, message: `${innovation.name} adopted.` };
}

/**
 * What the airline brings to booking on one market beyond fare and
 * frequency, as plain numbers: what flightResult() (sim/economy.ts)
 * takes. Its name there (sim/nps.ts), and the adopted programmes' effects.
 */
export type BookingPerks = {
  /** How far its NPS here pulls passengers from a typical rival, in booking utility. */
  brandEdge: number;
  /** How much more each segment prefers it to a rival for its brand position (sim/brand.ts). */
  positionEdge: Record<SegmentName, number>;
  /** Multiplies every ticket's revenue. */
  yieldMultiplier: number;
  /** The share of its seats a plane can sell (spoilage management and a commercial officer lift it). */
  loadFactor: number;
  /** Share of turned-away passengers who wait for a later flight. */
  recaptureRate: number;
  /** Fee revenue per passenger on this market (sim/ancillaries.ts). */
  ancillaryPerPassenger: number;
  /** Dollars the fee adds to the price each segment compares (sim/ancillaries.ts). */
  ancillaryPriceDrag: Record<SegmentName, number>;
};

export function bookingPerks(state: SimState, origin: string, dest: string): BookingPerks {
  return {
    brandEdge: brandEdge(state, origin, dest),
    positionEdge: positionEdge(state),
    // Online booking, a revenue-management CCO (sim/executives.ts), and the airline's name (sim/nps.ts).
    yieldMultiplier: (isAdopted(state, 'online-booking') ? DIRECT_BOOKING_YIELD : 1) * executiveYieldMultiplier(state) * nameYieldMultiplier(state, origin, dest),
    loadFactor: loadFactorCap(state),
    recaptureRate: isAdopted(state, 'loyalty-scheme') ? LOYALTY_RECAPTURE_RATE : RECAPTURE_RATE,
    ancillaryPerPassenger: ancillaryPerPassenger(state, origin, dest),
    ancillaryPriceDrag: ancillaryPriceDrag(state, origin, dest),
  };
}

/** The share of its seats a plane of this airline can sell: the base, spoilage management levels, and a CCO, never past the ceiling. */
export function loadFactorCap(state: SimState): number {
  const levels = SPOILAGE_LEVELS.filter((id) => isAdopted(state, id)).length;
  return Math.min(LOAD_FACTOR_CEILING, LOAD_FACTOR + levels * SPOILAGE_STEP + executiveLoadFactorBonus(state));
}

/** How much of the money on the table the loyalty scheme keeps from rivals, 0 without one. */
export function loyaltyKeeps(state: SimState): number {
  return isAdopted(state, 'loyalty-scheme') ? LOYALTY_KEEPS : 0;
}

/** Connecting passengers at every hub are multiplied by this. */
export function connectingFeedMultiplier(state: SimState): number {
  return isAdopted(state, 'codeshare-feed') ? CODESHARE_FEED_FACTOR : 1;
}

/** The age a plane leased from a listing this old arrives at. */
export function leasedAge(state: SimState, listedAgeYears: number): number {
  if (!isAdopted(state, 'younger-airframes')) return listedAgeYears;
  // Never younger than the floor, and never older than it was listed.
  return Math.max(Math.min(listedAgeYears, MIN_REFURBISHED_AGE), listedAgeYears - REFURBISHMENT_YEARS);
}

/** What one innovation costs a day to run, given the day's revenue: zero for a one-off. */
export function runningCostOf(id: InnovationId, dayRevenue: number): number {
  if (id === 'loyalty-scheme') return LOYALTY_COST_SHARE * Math.max(0, dayRevenue);
  if (id === 'codeshare-feed') return CODESHARE_COST_PER_DAY;
  return 0;
}

/** What the adopted programmes cost today, given the day's revenue. Charged at rollover. */
export function runningCostForDay(state: SimState, dayRevenue: number): number {
  return INNOVATIONS.filter((innovation) => isAdopted(state, innovation.id)).reduce((sum, innovation) => sum + runningCostOf(innovation.id, dayRevenue), 0);
}

/** Hiring and retraining crews take this share of their usual time (sim/crews.ts). */
export function crewTrainingTimeFactor(state: SimState): number {
  return isAdopted(state, 'crew-academy') ? CREW_ACADEMY_TIME_FACTOR : 1;
}
