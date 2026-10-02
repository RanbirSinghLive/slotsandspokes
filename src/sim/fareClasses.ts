import { CABIN_PRICE, CABIN_VALUE } from './cabins';
import type { SegmentName } from './timeOfDay';

/**
 * Fare classes (WEEK-FOURTEEN.md, stage 2): revenue management. A route's
 * base fare sells as three classes, Saver, Flex and Full, each a share of
 * the seats (`RouteSettings.fareClasses`; Full has what the other two
 * leave). Passengers book in the order they really do, leisure first
 * (planning ahead), then VFR, then business (late), each buying the
 * cheapest class still open, as many as are willing at its price
 * (sim/choiceModel.ts's segmentShareAt()). When a class sells out, those
 * willing to pay the next one up buy up; the rest don't fly with you. So:
 *
 *   - Saver fills the plane with leisure travellers who'd never pay Flex,
 *     but a Saver still open when business books is sold to people who'd
 *     have paid Full ("dilution");
 *   - closing Saver early (fewer Saver seats) makes later travellers pay
 *     more, but seats held for business that never come fly empty.
 *
 * Worked out per flight in one pass (sellSeats()), no booking simulation:
 * deterministic, and cheap enough for the forecasts that run it many
 * times a day.
 */

export type FareClass = 'saver' | 'flex' | 'full';

/** Each class's price as a share of the route's base fare. */
export const CLASS_PRICE: Record<FareClass, number> = { saver: 0.75, flex: 1, full: 1.4 };
export const CLASS_ORDER: FareClass[] = ['saver', 'flex', 'full'];
export const CLASS_NAMES: Record<FareClass, string> = { saver: 'Saver', flex: 'Flex', full: 'Full' };

/** A route's seat split: Saver's and Flex's shares of the seats; Full has the rest. */
export type FareClassSettings = {
  saverShare: number;
  flexShare: number;
  /** Saver's price as a share of the fare, in place of CLASS_PRICE's, while a seat sale runs (sim/seatSale.ts). */
  saverPrice?: number;
};

/**
 * Where a route starts until it's set: a fifth Saver, most Flex, a fifth
 * held for late, full-fare buyers. Chosen on 18 seeds a home with the
 * headless player tuning each route's Saver weekly: starting at 30% Saver
 * left more business travellers paying Saver (Toronto $30M, Halifax 16/18
 * busts) than starting at 20% (Toronto $42M, Halifax 13/18).
 */
export const DEFAULT_FARE_CLASSES: FareClassSettings = { saverShare: 0.2, flexShare: 0.6 };

/** The order passengers book in: who plans ahead first, business last. */
export const BOOKING_ORDER: SegmentName[] = ['leisure', 'vfr', 'business'];

/** What a flight's sale came to, by class and by what happened to people. */
export type FareClassTally = {
  flights: number;
  sold: Record<FareClass, number>;
  /** Flights whose Saver seats all sold. */
  saverSoldOut: number;
  /** Passengers who bought a dearer class because a cheaper one had sold out. */
  boughtUp: number;
  /** Business travellers who found Saver still open and paid it. */
  diluted: number;
  /** Business travellers who wanted a seat and found the plane full. */
  businessTurnedAway: number;
  /** Seats sold in the business cabin (sim/cabins.ts). */
  cabinSold?: number;
};

export function emptyTally(): FareClassTally {
  return { flights: 0, sold: { saver: 0, flex: 0, full: 0 }, saverSoldOut: 0, boughtUp: 0, diluted: 0, businessTurnedAway: 0 };
}

export function addTally(into: FareClassTally, from: FareClassTally): void {
  into.flights += from.flights;
  for (const fareClass of CLASS_ORDER) into.sold[fareClass] += from.sold[fareClass];
  into.saverSoldOut += from.saverSoldOut;
  into.boughtUp += from.boughtUp;
  into.diluted += from.diluted;
  into.businessTurnedAway += from.businessTurnedAway;
  if (from.cabinSold) into.cabinSold = (into.cabinSold ?? 0) + from.cabinSold;
}

export type SeatSale = {
  /** Passengers carried, connecting and recaptured included. */
  passengers: number;
  /** What they paid, before rivals' yield and the airline's perks: the sum of each one's class price. */
  fares: number;
  /** Passengers who wanted a seat and found the plane full. */
  spilled: number;
  /** Passengers taken from the market's recapture pool into spare seats. */
  recaptured: number;
  tally: FareClassTally;
};

export type SeatSaleInput = {
  /** Economy seats that can be sold: the plane's at the load-factor ceiling. */
  seats: number;
  /** Business cabin seats that can be sold (sim/cabins.ts); none without a cabin. */
  businessSeats?: number;
  baseFare: number;
  /** This flight's share of the market's demand (sim/timeOfDay.ts's split by hour). */
  demand: number;
  /** Each segment's share of that demand (sim/marketCharacter.ts). */
  mix: Record<SegmentName, number>;
  /** A segment's booking share at a price (sim/choiceModel.ts's segmentShareAt()). */
  shareAt: (segment: SegmentName, price: number) => number;
  /** Connecting passengers for this flight: booked through the network, they take seats first, cheapest class first. */
  connecting: number;
  /** Passengers waiting from earlier full flights on the market, who take spare seats at the base fare. */
  recapturable: number;
  classes: FareClassSettings;
};

/** Sell one flight's seats (see the module comment). */
export function sellSeats(input: SeatSaleInput): SeatSale {
  const saverSeats = Math.max(0, Math.min(1, input.classes.saverShare)) * input.seats;
  const flexSeats = Math.max(0, Math.min(1 - Math.min(1, input.classes.saverShare), input.classes.flexShare)) * input.seats;
  const left: Record<FareClass, number> = { saver: saverSeats, flex: flexSeats, full: Math.max(0, input.seats - saverSeats - flexSeats) };
  const price = (fareClass: FareClass) =>
    input.baseFare * (fareClass === 'saver' && input.classes.saverPrice !== undefined ? input.classes.saverPrice : CLASS_PRICE[fareClass]);
  const tally = emptyTally();
  tally.flights = 1;
  let cabinLeft = Math.max(0, input.businessSeats ?? 0);
  let fares = 0;
  let passengers = 0;

  // Connecting passengers first, booked early through the network: the
  // cheapest class still open, at its price. So a through trip is built
  // from cheap seats where they're open, and the split decides what a
  // connection pays.
  let connecting = Math.min(input.connecting, input.seats);
  for (const fareClass of CLASS_ORDER) {
    const take = Math.min(left[fareClass], connecting);
    left[fareClass] -= take;
    connecting -= take;
    passengers += take;
    fares += take * price(fareClass);
    tally.sold[fareClass] += take;
  }

  // Then each segment in booking order, cheapest open class first.
  const stillWanting: Record<SegmentName, number> = { leisure: 0, vfr: 0, business: 0 };
  for (const segment of BOOKING_ORDER) {
    const pool = input.demand * input.mix[segment];
    if (pool <= 0) continue;
    let booked = 0;
    let firstOpen: FareClass | null = null;
    let lastWilling = 0;
    // Business travellers take the cabin first, as many as find it worth its price.
    if (segment === 'business' && cabinLeft > 1e-9) {
      const willing = pool * input.shareAt(segment, (input.baseFare * CABIN_PRICE) / CABIN_VALUE);
      const take = Math.min(cabinLeft, willing);
      cabinLeft -= take;
      booked += take;
      fares += take * input.baseFare * CABIN_PRICE;
      tally.cabinSold = take;
    }
    for (const fareClass of CLASS_ORDER) {
      if (left[fareClass] <= 1e-9) continue;
      firstOpen ??= fareClass;
      const willing = pool * input.shareAt(segment, price(fareClass));
      lastWilling = willing;
      const take = Math.min(left[fareClass], Math.max(0, willing - booked));
      if (take <= 0) continue;
      left[fareClass] -= take;
      booked += take;
      fares += take * price(fareClass);
      tally.sold[fareClass] += take;
      if (fareClass !== firstOpen) tally.boughtUp += take;
      if (segment === 'business' && fareClass === 'saver') tally.diluted += take;
    }
    passengers += booked;
    // Arriving to a plane already full, they'd have flown at the base fare.
    if (firstOpen === null) lastWilling = pool * input.shareAt(segment, input.baseFare);
    stillWanting[segment] = Math.max(0, lastWilling - booked);
  }
  if (saverSeats > 0 && left.saver <= 1e-9) tally.saverSoldOut = 1;

  // A full plane spills whoever still wanted a seat; spare seats take the market's waiting passengers.
  const spare = Math.max(0, left.saver + left.flex + left.full);
  const full = spare <= 1e-9;
  const spilled = full ? stillWanting.leisure + stillWanting.vfr + stillWanting.business : 0;
  if (full) tally.businessTurnedAway = stillWanting.business;
  const recaptured = full ? 0 : Math.min(spare, input.recapturable);
  passengers += recaptured;
  fares += recaptured * input.baseFare;
  return { passengers, fares, spilled, recaptured, tally };
}
