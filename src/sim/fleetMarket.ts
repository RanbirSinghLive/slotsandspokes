import fleetMarketData from '../../data/fleet-market.json';

/**
 * One available airframe in the acquisition market — hand-authored, same
 * spirit as data/competitors.json: a fixed, small set of individually named
 * aircraft (not randomly generated or replenished), each either bought
 * outright or leased once, then gone from the list. Two listings per type
 * across the week-four aircraft ladder (data/aircraft-types.json) — this
 * models several distinct used airframes per type, not a type catalog of
 * its own.
 *
 * `ageYears` sets pricing here (older airframes are cheaper to buy or
 * lease) and is also copied onto the resulting `Aircraft` record at
 * acquisition (ui/fleetMarket.ts) to feed one of step.ts's three delay
 * causes — the same number doing double duty as a price signal and a
 * reliability one, not two separate fields to keep in sync.
 *
 * `leadTimeDays` (week eight) is how long the airframe takes to become
 * operational after it's paid for: inspection, the delivery flight,
 * registration, getting crews on type. Before this, a $42M widebody was
 * flying the instant you clicked Buy while four pilots took ten days,
 * which had the expensive irreversible commitment be the one with no
 * wait.
 *
 * Authored *against* age on purpose. An old airframe is cheap **and**
 * quick — it's sitting on a ramp somewhere and its owner wants rid of it —
 * while a young one is dear and slow, because everyone else wants it too.
 * That's what stops "buy the oldest thing you can afford" from being the
 * flat answer it currently is: the cheap option now wins on price and
 * speed and loses on reliability, since ageYears feeds the delay roll.
 */
export type FleetListing = {
  registration: string;
  typeCode: string;
  ageYears: number;
  buyPrice: number;
  leasePricePerDay: number;
  leadTimeDays: number;
};

/**
 * A fresh, independent copy of the market listings — same reasoning as
 * sim/schedule.ts's loadSchedule(): each game gets its own mutable array
 * (state.fleetMarket), so buying an aircraft in one game can never remove
 * it from another's, and nothing mutates this module's own data directly.
 */
export function loadFleetMarket(): FleetListing[] {
  return (fleetMarketData as FleetListing[]).map((listing) => ({ ...listing }));
}

/**
 * An airframe paid for but not yet operational. Deliberately the same
 * shape as sim/crew.ts's PendingHire — a commitment already charged to
 * Cash, plus the minute it lands — because "Grow" is becoming one
 * pipeline of things bought and waited for, and a second queue that
 * worked differently would just be a second thing to keep in sync.
 *
 * Holds everything needed to build the Aircraft on arrival rather than a
 * reference back to the listing, since the listing is removed from
 * `state.fleetMarket` at order time (nobody else can buy it now) and
 * `SimState` has to survive a JSON round trip with no shared references.
 */
export type PendingDelivery = {
  id: string;
  registration: string;
  typeCode: string;
  ageYears: number;
  ownership: 'owned' | 'leased';
  /** Zero for an owned airframe; the daily charge starts on arrival, not at order. */
  leaseCostPerDay: number;
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
 * Order `listing`. The full purchase price is charged **now**, at order,
 * not on arrival — no deposit schedule, since CLAUDE.md defers financing,
 * and paying up front is what makes lead time cost something real rather
 * than being a free wait. A lease costs nothing up front; its daily charge
 * begins when the aircraft actually arrives, which is why
 * `leaseCostPerDay` rides along here instead of being applied yet.
 *
 * Returns the queued delivery so the caller can report the arrival date.
 */
export function orderAircraft(
  state: { cash: number; simMinute: number; pendingDeliveries: PendingDelivery[]; fleetMarket: FleetListing[] },
  listing: FleetListing,
  ownership: 'owned' | 'leased',
): PendingDelivery {
  if (ownership === 'owned') state.cash -= listing.buyPrice;

  const delivery: PendingDelivery = {
    id: nextDeliveryId(state.pendingDeliveries),
    registration: listing.registration,
    typeCode: listing.typeCode,
    ageYears: listing.ageYears,
    ownership,
    leaseCostPerDay: ownership === 'leased' ? listing.leasePricePerDay : 0,
    orderedAtMinute: state.simMinute,
    availableAtMinute: state.simMinute + listing.leadTimeDays * MINUTES_PER_DAY,
  };
  state.pendingDeliveries.push(delivery);

  // Off the market at order, not at arrival: it's yours the moment you pay
  // for it, and this is also what stops the same airframe being ordered
  // twice while it's in transit.
  const index = state.fleetMarket.findIndex((l) => l.registration === listing.registration);
  if (index !== -1) state.fleetMarket.splice(index, 1);

  return delivery;
}

/**
 * Turn any delivery that has come due into a real Aircraft. Called once
 * per simulated day from step.ts's rollover, alongside the crew arrivals
 * it deliberately mirrors.
 *
 * The airframe arrives **unbased and unpositioned** (`atAirport: null`),
 * exactly as a Fleet Market purchase used to arrive instantly: it joins
 * the pool on the Fleet tab, and confirming its first rotation is what
 * places it and sets its base. Nothing about basing changed here — only
 * when the aircraft shows up.
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
      atAirport: null,
      activeLegId: null,
      groundSinceMinute: state.simMinute,
      ownership: delivery.ownership,
      leaseCostPerDay: delivery.leaseCostPerDay,
      ageYears: delivery.ageYears,
      baseAirport: null,
    });
    state.pendingDeliveries.splice(i, 1);
    arrived.push(delivery);
  }

  return arrived;
}
