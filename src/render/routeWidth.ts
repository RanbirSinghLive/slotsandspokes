import aircraftTypesData from '../../data/aircraft-types.json';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { isOpsView } from './opsView';

const seatsByTypeCode = new Map((aircraftTypesData as Array<{ code: string; seats: number }>).map((type) => [type.code, type.seats]));

const MIN_WIDTH_PX = 1;
const MAX_WIDTH_PX = 5;
// Seats a day (both directions) at which a line reaches full width: about
// ten daily flights each way on a 150-seat jet.
const FULL_WIDTH_SEATS = 3000;

/** Seats a day on each of your markets, both directions, from the scheduled legs and the type each tail flies. */
export function seatsADayByMarket(state: SimState): Map<string, number> {
  const seatsByTail = new Map(state.aircraft.map((aircraft) => [aircraft.tail, seatsByTypeCode.get(aircraft.typeCode) ?? 0]));
  const seats = new Map<string, number>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    seats.set(key, (seats.get(key) ?? 0) + (seatsByTail.get(leg.tail) ?? 0));
  }
  return seats;
}

/** Line width for a seats-a-day figure: square-root scale so one more flight matters most on a thin route. */
export function widthForSeats(seatsADay: number): number {
  const share = Math.sqrt(Math.max(0, seatsADay) / FULL_WIDTH_SEATS);
  return Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, MIN_WIDTH_PX + share * (MAX_WIDTH_PX - MIN_WIDTH_PX)));
}

/**
 * Per-market line width in Ops view, or null when it is off so callers
 * keep their own fixed width.
 */
export function routeWidthsByMarket(state: SimState): Map<string, number> | null {
  if (!isOpsView()) return null;
  const widths = new Map<string, number>();
  for (const [key, seats] of seatsADayByMarket(state)) widths.set(key, widthForSeats(seats));
  return widths;
}
