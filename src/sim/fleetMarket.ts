import fleetMarketData from '../../data/fleet-market.json';

/**
 * One row of the Fleet Market: what a new aircraft of one size class
 * costs. There is one listing per class in data/aircraft-types.json and
 * stock never runs out, so buying a second propeller is the same click as
 * buying the first. This is a fixed price list, not part of `SimState`.
 *
 * `leadTimeDays` is how long the aircraft takes to become operational
 * after it's paid for. It used to be weeks and shaped the opening of the
 * game; it is zero now (the aircraft arrives the moment it is ordered),
 * and stays a data field so it can be tuned.
 */
export type FleetListing = {
  typeCode: string;
  buyPrice: number;
  leasePricePerDay: number;
  leadTimeDays: number;
};

/** The price list, one entry per aircraft class, smallest first. */
export function loadFleetCatalogue(): FleetListing[] {
  return (fleetMarketData as FleetListing[]).map((listing) => ({ ...listing }));
}

/**
 * An aircraft paid for but not yet operational. Deliberately the same
 * shape as sim/crew.ts's PendingHire — a commitment already charged to
 * Cash, plus the minute it lands.
 *
 * Holds everything needed to build the Aircraft on arrival, since
 * `SimState` has to survive a JSON round trip with no shared references.
 */
export type PendingDelivery = {
  id: string;
  /** The tail the aircraft will carry, chosen at order time so it is unique from then on. */
  registration: string;
  typeCode: string;
  ageYears: number;
  ownership: 'owned' | 'leased';
  /** Zero for an owned aircraft; the daily charge starts on arrival, not at order. */
  leaseCostPerDay: number;
  /** Where the aircraft is based and parked when it arrives; null leaves it unbased. */
  baseAirport: string | null;
  orderedAtMinute: number;
  availableAtMinute: number;
};

const MINUTES_PER_DAY = 1440;

/** Same "one counter, own namespace" scheme as sim/schedule.ts's nextLegId(). */
function nextDeliveryId(deliveries: PendingDelivery[]): string {
  const numbers = deliveries.map((d) => Number(d.id.split('-').pop())).filter((n) => !Number.isNaN(n));
  return `delivery-${(numbers.length > 0 ? Math.max(...numbers) : 0) + 1}`;
}

/**
 * The next free tail for this class: the class's first letter plus a
 * three-digit counter (`C-P001`, `C-R002`), counting both aircraft already
 * flying and ones still on order so two orders placed the same day can
 * never collide.
 */
function nextTail(typeCode: string, tailsInUse: string[]): string {
  const prefix = `C-${typeCode[0]}`;
  const numbers = tailsInUse
    .filter((tail) => tail.startsWith(prefix))
    .map((tail) => Number(tail.slice(prefix.length)))
    .filter((n) => !Number.isNaN(n));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * Order one aircraft of `listing`'s class. The full purchase price is
 * charged **now**, at order, not on arrival — no deposit schedule, since
 * CLAUDE.md defers financing. A lease costs nothing up front; its daily
 * charge begins when the aircraft actually arrives, which is why
 * `leaseCostPerDay` rides along here instead of being applied yet.
 *
 * `baseAirport` is where the aircraft will be based and parked on arrival
 * (the map menu orders from an airport, so it starts there). Returns the
 * queued delivery so the caller can report the arrival date.
 */
export function orderAircraft(
  state: {
    cash: number;
    simMinute: number;
    pendingDeliveries: PendingDelivery[];
    aircraft: Array<{ tail: string }>;
  },
  listing: FleetListing,
  ownership: 'owned' | 'leased',
  baseAirport: string | null = null,
): PendingDelivery {
  if (ownership === 'owned') state.cash -= listing.buyPrice;

  const tailsInUse = [...state.aircraft.map((a) => a.tail), ...state.pendingDeliveries.map((d) => d.registration)];
  const delivery: PendingDelivery = {
    id: nextDeliveryId(state.pendingDeliveries),
    registration: nextTail(listing.typeCode, tailsInUse),
    typeCode: listing.typeCode,
    ageYears: 0,
    ownership,
    leaseCostPerDay: ownership === 'leased' ? listing.leasePricePerDay : 0,
    baseAirport,
    orderedAtMinute: state.simMinute,
    availableAtMinute: state.simMinute + listing.leadTimeDays * MINUTES_PER_DAY,
  };
  state.pendingDeliveries.push(delivery);

  return delivery;
}

/**
 * Turn any delivery that has come due into a real Aircraft. Called once
 * per simulated day from step.ts's rollover, alongside the crew arrivals
 * it deliberately mirrors.
 *
 * The aircraft arrives parked at the airport it was ordered from and
 * based there. An order with no airport (`baseAirport: null`) arrives
 * unbased and unpositioned, and confirming its first rotation is what
 * places it and sets its base.
 *
 * Rolls no randomness, so the balance sweep's constant-draws-per-day
 * guarantee is untouched (see WEEK-SEVEN.md).
 */
export function resolveDeliveries(state: {
  simMinute: number;
  aircraft: Array<{
    tail: string;
    typeCode: string;
    status: 'ground' | 'airborne';
    atAirport: string | null;
    activeLegId: string | null;
    groundSinceMinute: number;
    ownership: 'owned' | 'leased';
    leaseCostPerDay: number;
    ageYears: number;
    baseAirport: string | null;
  }>;
  pendingDeliveries: PendingDelivery[];
}): PendingDelivery[] {
  const arrived: PendingDelivery[] = [];

  for (let i = state.pendingDeliveries.length - 1; i >= 0; i--) {
    const delivery = state.pendingDeliveries[i];
    if (state.simMinute < delivery.availableAtMinute) continue;

    state.aircraft.push({
      tail: delivery.registration,
      typeCode: delivery.typeCode,
      status: 'ground',
      atAirport: delivery.baseAirport ?? null,
      activeLegId: null,
      groundSinceMinute: state.simMinute,
      ownership: delivery.ownership,
      leaseCostPerDay: delivery.leaseCostPerDay,
      ageYears: delivery.ageYears,
      baseAirport: delivery.baseAirport ?? null,
    });
    state.pendingDeliveries.splice(i, 1);
    arrived.push(delivery);
  }

  return arrived;
}
