import aircraftTypesData from '../../data/aircraft-types.json';
import { dayIndex } from './clock';
import { revenuePerFlight } from './controller';
import { marketLoadFactor } from './loadFactor';
import { fleetOrder } from './orders';
import { recordCancellation } from './step';
import { nextRandom } from './rng';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';

/**
 * Crisis days: a severe storm forecast for one of the airline's busy
 * airports, two days out, with a stated chance of arriving. A rare event
 * whose damage scales with the airline, so it is the one moment the
 * player is asked to stop and weigh the network, not a plane.
 *
 * Fly on: if the storm comes, the airport is closed for the day (the
 * ordinary severe-weather closure, sim/weather.ts), every flight from it is
 * cancelled for -80 NPS each, and the airline pays CARE_PER_PASSENGER for
 * each booked passenger it strands. If the storm doesn't come, nothing
 * happens.
 *
 * Waive: cancel the airport's day ahead of time. Passengers are told in
 * time, so the care bill is WAIVER_SHARE of that and the NPS hit is
 * WAIVED_NPS_SCORE a flight, but the day's revenue is lost whether the
 * storm comes or not. So waiving wins when the forecast chance is above
 * `breakEvenChance()`, and the card says so in numbers.
 *
 * What prepares an airline for it is not on this screen: a network with
 * its flying spread over several airports loses a smaller share of its day
 * to one closure than one whose flying runs through a single hub.
 *
 * The fleet's standing order (sim/orders.ts) decides who answers: ask puts
 * the card to the player, protect always flies on, auto waives whenever
 * the forecast is above the break-even. Rolled from its own stream so a
 * game that never meets one plays as it did without them.
 */
export type CrisisStatus = 'forecast' | 'hit' | 'missed';

export type Crisis = {
  id: number;
  airport: string;
  announcedDay: number;
  /** The day the storm would arrive. */
  day: number;
  /** The forecast chance it arrives, 0 to 1. */
  chance: number;
  status: CrisisStatus;
  waived: boolean;
  /** Care bill actually paid, for the record. */
  paid: number;
  /** Flights it cancelled. */
  flights: number;
};

const STREAM_SALT = 0x43524953;
const NOTICE_DAYS = 2;
const FIRST_DAY = 30;
/** A day's chance of a forecast, when one of the airline's airports qualifies. */
const FORECAST_CHANCE_PER_DAY = 1 / 100;
/** An airport qualifies when this many scheduled flights leave it a day. */
export const CRISIS_MIN_DEPARTURES = 4;
export const CARE_PER_PASSENGER = 120;
export const WAIVER_SHARE = 0.25;
const HISTORY_KEPT = 4;
const FALLBACK_LOAD_FACTOR = 0.6;

const seatsByType = new Map((aircraftTypesData as Array<{ code: string; seats: number }>).map((type) => [type.code, type.seats]));

export function crisesOf(state: SimState): Crisis[] {
  return state.crises ?? [];
}

/** The forecast still ahead of us, if any. */
export function openCrisis(state: SimState): Crisis | undefined {
  return crisesOf(state).find((crisis) => crisis.status === 'forecast');
}

function departuresFrom(state: SimState, airport: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => leg.origin === airport && state.aircraft.some((a) => a.tail === leg.tail));
}

function passengersOn(state: SimState, leg: ScheduleLeg): number {
  const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
  const seats = (aircraft && seatsByType.get(aircraft.typeCode)) ?? 0;
  const factor = marketLoadFactor(state, leg.origin, leg.dest).factor ?? FALLBACK_LOAD_FACTOR;
  return Math.round(seats * factor);
}

export type CrisisPreview = {
  flights: number;
  /** Booked passengers the closed day would strand. */
  passengers: number;
  /** Revenue the day's flights from the airport bring in, estimated from recent days. */
  revenue: number;
  /** The care bill if the storm comes and the flights were not waived, and if they were. */
  care: number;
  careWaived: number;
  /** Money lost if the storm comes and nothing was done, and if the day was waived (the same whether it comes or not). */
  lossIfFlyOn: number;
  lossIfWaived: number;
  /** The forecast chance above which waiving costs less on average. */
  breakEven: number;
};

export function previewCrisis(state: SimState, crisis: Crisis): CrisisPreview {
  const legs = departuresFrom(state, crisis.airport);
  const passengers = legs.reduce((sum, leg) => sum + passengersOn(state, leg), 0);
  const revenue = Math.round(legs.reduce((sum, leg) => sum + revenuePerFlight(state, leg), 0));
  const care = passengers * CARE_PER_PASSENGER;
  const careWaived = Math.round(care * WAIVER_SHARE);
  const lossIfFlyOn = revenue + care;
  const lossIfWaived = revenue + careWaived;
  return {
    flights: legs.length,
    passengers,
    revenue,
    care,
    careWaived,
    lossIfFlyOn,
    lossIfWaived,
    breakEven: lossIfFlyOn > 0 ? lossIfWaived / lossIfFlyOn : 1,
  };
}

/** Waiving is cheaper on average once the forecast chance is above the break-even. */
export function shouldWaive(state: SimState, crisis: Crisis): boolean {
  return crisis.chance > previewCrisis(state, crisis).breakEven;
}

export function setCrisisWaived(state: SimState, id: number, waived: boolean): { ok: true } | { ok: false; reason: string } {
  const crisis = crisesOf(state).find((c) => c.id === id);
  if (!crisis || crisis.status !== 'forecast') return { ok: false, reason: 'No such forecast' };
  if (dayIndex(state) >= crisis.day) return { ok: false, reason: 'Too late: the day has begun' };
  crisis.waived = waived;
  return { ok: true };
}

function charge(state: SimState, amount: number): void {
  if (amount <= 0) return;
  state.cash -= amount;
  state.todayCost += amount;
  state.todayCostByCategory.overhead += amount;
  state.todayMargin -= amount;
}

/**
 * Once a day at rollover, before the day's cancellations: settle a
 * forecast whose day has come (the storm arrives or not; a waived day is
 * cancelled and its care bill paid), then maybe forecast a new one.
 */
export function rollDailyCrisis(state: SimState): void {
  const today = dayIndex(state);
  state.crisisSeed ??= state.rngSeed ^ STREAM_SALT;
  state.nextCrisisId ??= 1;
  state.crises ??= [];

  // Always the same draws, so the stream is as long for every game.
  const [forecastRoll, s1] = nextRandom(state.crisisSeed);
  const [pickRoll, s2] = nextRandom(s1);
  const [chanceRoll, s3] = nextRandom(s2);
  const [hitRoll, s4] = nextRandom(s3);
  state.crisisSeed = s4;

  for (const crisis of state.crises) {
    if (crisis.status !== 'forecast' || crisis.day > today) continue;
    if (fleetOrder(state) === 'auto' && !crisis.waived) crisis.waived = shouldWaive(state, crisis);
    const hit = hitRoll < crisis.chance;
    crisis.status = hit ? 'hit' : 'missed';
    const legs = departuresFrom(state, crisis.airport).filter((leg) => !state.cancelledToday.includes(leg.legId));
    const care = legs.reduce((sum, leg) => sum + passengersOn(state, leg), 0) * CARE_PER_PASSENGER;
    // The ordinary severe-weather closure: the cancellation pass after this counts the flights it still has to.
    if (hit) {
      state.weatherByAirport[crisis.airport] = { kind: 'thunderstorm', severity: 'severe', endsAtMinute: state.simMinute + 24 * 60 };
    }
    crisis.flights = hit || crisis.waived ? legs.length : 0;
    if (crisis.waived) {
      for (const leg of legs) {
        state.cancelledToday.push(leg.legId);
        recordCancellation(state, leg, 'waived');
      }
      crisis.paid = Math.round(care * WAIVER_SHARE);
    } else if (hit) {
      crisis.paid = care;
    }
    charge(state, crisis.paid);
  }
  const open = state.crises.filter((c) => c.status === 'forecast');
  const done = state.crises.filter((c) => c.status !== 'forecast').slice(-HISTORY_KEPT);
  state.crises = [...done, ...open].sort((a, b) => a.id - b.id);

  if (state.eventsOff || today < FIRST_DAY || open.length > 0 || forecastRoll >= FORECAST_CHANCE_PER_DAY) return;
  const counts = new Map<string, number>();
  for (const leg of state.schedule) {
    if (state.aircraft.some((a) => a.tail === leg.tail)) counts.set(leg.origin, (counts.get(leg.origin) ?? 0) + 1);
  }
  const eligible = [...counts].filter(([, n]) => n >= CRISIS_MIN_DEPARTURES).map(([iata]) => iata).sort();
  if (eligible.length === 0) return;
  state.crises.push({
    id: state.nextCrisisId++,
    airport: eligible[Math.floor(pickRoll * eligible.length)],
    announcedDay: today,
    day: today + NOTICE_DAYS,
    chance: Math.round((0.5 + chanceRoll * 0.4) * 20) / 20,
    status: 'forecast',
    waived: false,
    paid: 0,
    flights: 0,
  });
}
