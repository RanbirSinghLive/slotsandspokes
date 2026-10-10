import { executiveCargoMultiplier } from './executives';
import airportsData from '../../data/airports.json';
import goodsData from '../../data/cargo-goods.json';
import cargoData from '../../data/airport-cargo.json';
import { marketDistanceNm } from './demand';
import { legsServingMarket } from './schedule';
import type { SimState } from './state';

/**
 * Cargo: goods that match. Every airport produces some goods and needs
 * others (data/airport-cargo.json), and a flight earns freight money when
 * what its origin produces is what its destination needs. None of this
 * reads passenger demand: a fishing town can be a rich origin and a big
 * city a poor one.
 *
 * - **A good** has a rate (dollars per tonne per nautical mile), a daily
 *   volume at a middling airport, a shelf life and a handling type.
 * - **A lane** is one good moving from an airport that produces it to one
 *   that needs it. Its volume is the smaller of the two ends' daily
 *   volumes, split between your flights on the pair and any rivals.
 * - **Belly only for now**: a flight carries freight in the hold left
 *   after passenger bags, so cargo rides flights you already fly.
 * - **Edges fade**: an unmet need pays a shortage premium. Serving it
 *   fills the need and the premium decays back to the base rate; stop
 *   serving it and the premium returns (`rollDailyCargo()`).
 *
 * The rules live here; the UI only reads them (ui/inspector/airport.ts,
 * render/cargo.ts).
 */

type AirportSpec = { iata: string; population: number };
const populationByIata = new Map((airportsData as AirportSpec[]).map((a) => [a.iata, a.population]));

export type Handling = 'general' | 'cold' | 'bulky';

export type CargoGood = {
  id: string;
  name: string;
  /** Dollars per tonne per nautical mile, before the shortage premium. */
  ratePerTonneNm: number;
  /** Tonnes a day a middling airport makes or needs of it. */
  baseTonnes: number;
  /** Hours it keeps; null when it doesn't spoil. */
  shelfHours: number | null;
  handling: Handling;
};

export const CARGO_GOODS: CargoGood[] = goodsData.goods as CargoGood[];
const goodsById = new Map(CARGO_GOODS.map((good) => [good.id, good]));
const HANDLING_PER_TONNE = goodsData.handlingPerTonne as Record<Handling, number>;

export function cargoGood(id: string): CargoGood {
  const good = goodsById.get(id);
  if (!good) throw new Error(`cargoGood: unknown good ${id}`);
  return good;
}

export type AirportCargo = { produces: string[]; needs: string[] };

// --- What an airport produces and needs ----------------------------------

const authored = cargoData as unknown as Record<string, AirportCargo | string>;

/** A small stable number from a code, so an unlisted airport always gets the same default. */
function codeHash(iata: string): number {
  let hash = 0;
  for (const char of iata) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}

/** Pick `count` different entries from `pool`, starting at a point the code decides. */
function pickFrom(pool: string[], iata: string, count: number, offset = 0): string[] {
  const start = codeHash(iata) + offset;
  const picked: string[] = [];
  for (let i = 0; picked.length < count && i < pool.length * 2; i++) {
    const choice = pool[(start + i * 3) % pool.length];
    if (!picked.includes(choice)) picked.push(choice);
  }
  return picked;
}

const DEFAULT_MAKES = ['autoparts', 'electronics', 'produce', 'textiles', 'medical', 'minerals', 'parcels'];
const DEFAULT_METRO_NEEDS = ['produce', 'seafood', 'electronics', 'medical'];
const DEFAULT_TOWN_NEEDS = ['electronics', 'medical', 'produce', 'seafood'];

/**
 * An airport nobody wrote a profile for: big cities make parcels and need
 * fresh food, small remote places need supplies and produce, and the rest
 * of the middle makes one thing and needs two. Only a guess from size, so
 * the authored list wins wherever the real trade is known.
 */
function defaultCargo(iata: string): AirportCargo {
  const population = populationByIata.get(iata) ?? 0;
  if (population >= 2_000_000) return { produces: ['parcels', ...pickFrom(DEFAULT_MAKES.filter((id) => id !== 'parcels'), iata, 1)], needs: pickFrom(DEFAULT_METRO_NEEDS, iata, 2) };
  if (population >= 300_000) return { produces: pickFrom(DEFAULT_MAKES, iata, 1), needs: pickFrom(DEFAULT_TOWN_NEEDS, iata, 2, 1) };
  return { produces: pickFrom(['seafood', 'minerals', 'produce'], iata, 1), needs: ['supplies', ...pickFrom(['produce', 'medical'], iata, 1)] };
}

/**
 * A big city consumes more kinds of goods than a small one: one more need
 * from a million people, two more from five million, chosen from what it
 * neither makes nor already needs. Without it a pair of cities seldom
 * had anything in common to ship.
 */
function withMetroNeeds(iata: string, cargo: AirportCargo): AirportCargo {
  const population = populationByIata.get(iata) ?? 0;
  const extra = population >= 5_000_000 ? 2 : population >= 1_000_000 ? 1 : 0;
  if (extra === 0) return cargo;
  const unused = CARGO_GOODS.map((good) => good.id).filter((id) => !cargo.produces.includes(id) && !cargo.needs.includes(id));
  return { produces: cargo.produces, needs: [...cargo.needs, ...pickFrom(unused, iata, extra, 5)] };
}

const cargoCache = new Map<string, AirportCargo>();

export function airportCargo(iata: string): AirportCargo {
  let cargo = cargoCache.get(iata);
  if (!cargo) {
    const profile = authored[iata];
    cargo = withMetroNeeds(iata, profile && typeof profile === 'object' ? profile : defaultCargo(iata));
    cargoCache.set(iata, cargo);
  }
  return cargo;
}

/** An airport's size as a multiplier on a good's base volume: 0.5 for a village, 2 for a megacity. */
function sizeFactor(iata: string): number {
  const population = populationByIata.get(iata) ?? 20_000;
  return Math.max(0.5, Math.min(2, 0.5 + 0.5 * Math.log10(Math.max(1, population) / 20_000)));
}

/** Tonnes a day this airport makes of a good: its specialty (the first listed) a half more. */
export function producedTonnes(iata: string, goodId: string): number {
  const produces = airportCargo(iata).produces;
  const index = produces.indexOf(goodId);
  if (index < 0) return 0;
  return cargoGood(goodId).baseTonnes * sizeFactor(iata) * (index === 0 ? 1.5 : 1);
}

/** Tonnes a day this airport needs of a good; a small remote place needs more per head than a city does. */
export function neededTonnes(iata: string, goodId: string): number {
  if (!airportCargo(iata).needs.includes(goodId)) return 0;
  const remote = (populationByIata.get(iata) ?? 0) < 100_000 ? 1.5 : 1;
  return cargoGood(goodId).baseTonnes * sizeFactor(iata) * remote;
}

// --- Lanes ----------------------------------------------------------------

export type Lane = {
  good: CargoGood;
  from: string;
  to: string;
  /** Tonnes a day the two ends can match: the smaller of what one makes and the other needs. */
  tonnes: number;
};

/** Every good the origin produces that the destination needs, biggest earner first. */
export function lanesBetween(from: string, to: string): Lane[] {
  const lanes: Lane[] = [];
  for (const id of airportCargo(from).produces) {
    const tonnes = Math.min(producedTonnes(from, id), neededTonnes(to, id));
    if (tonnes > 0) lanes.push({ good: cargoGood(id), from, to, tonnes });
  }
  return lanes.sort((x, y) => laneValuePerTonne(y) - laneValuePerTonne(x));
}

function laneValuePerTonne(lane: Lane): number {
  return lane.good.ratePerTonneNm * (lane.good.shelfHours ? 0.9 : 1);
}

/**
 * What a lane would pay a day if every tonne it can match flew, at the
 * base rate and with no rival: the figure the airport view ranks partners
 * by. Not what a flight earns, which is capped by its hold.
 */
export function laneDollarsPerDay(lane: Lane): number {
  const distance = marketDistanceNm(lane.from, lane.to);
  return lane.tonnes * lane.good.ratePerTonneNm * distance - lane.tonnes * HANDLING_PER_TONNE[lane.good.handling];
}

/** What a pair's matched lanes would pay a day both ways (laneDollarsPerDay()), for ranking markets. */
export function pairCargoDollarsPerDay(a: string, b: string): number {
  return [...lanesBetween(a, b), ...lanesBetween(b, a)].reduce((total, lane) => total + laneDollarsPerDay(lane), 0);
}

/** An airport's best matched partners among `candidates`, by daily dollars both ways. */
export function bestCargoPartners(iata: string, candidates: string[], limit: number): { partner: string; dollarsPerDay: number; goods: string[] }[] {
  const partners: { partner: string; dollarsPerDay: number; goods: string[] }[] = [];
  for (const partner of candidates) {
    if (partner === iata) continue;
    const lanes = [...lanesBetween(iata, partner), ...lanesBetween(partner, iata)];
    if (lanes.length === 0) continue;
    const dollarsPerDay = lanes.reduce((total, lane) => total + laneDollarsPerDay(lane), 0);
    partners.push({ partner, dollarsPerDay, goods: lanes.map((lane) => lane.good.id) });
  }
  return partners.sort((x, y) => y.dollarsPerDay - x.dollarsPerDay).slice(0, limit);
}

/**
 * How well matched an airport is to the rest, for the map: the daily
 * tonnes it could ship plus the daily tonnes it could take in, at the
 * going rate. Used to size and rank airports on the Cargo lens.
 */
export function airportCargoVolume(iata: string): { makes: number; needs: number } {
  const cargo = airportCargo(iata);
  return {
    makes: cargo.produces.reduce((total, id) => total + producedTonnes(iata, id), 0),
    needs: cargo.needs.reduce((total, id) => total + neededTonnes(iata, id), 0),
  };
}

// --- Belly capacity, shortage and a flight's freight ----------------------

const BELLY_TONNES_PER_SEAT = 0.02;
const BAG_TONNES_PER_PASSENGER = 0.01;
/** The extra a good pays when nobody is serving its need: +60% at the start, fading to nothing as you fill it. */
export const MAX_SHORTAGE_PREMIUM = 0.6;
/** How much of today's satisfaction a day adds to the running figure; the rest of it is yesterday's. */
const SATISFACTION_DAILY_WEIGHT = 0.3;
/** Perishables lose up to this share of their value if they spend their whole shelf life in transit. */
const MAX_SPOILAGE = 0.5;

/** Tonnes of hold left after passengers' bags. */
export function bellyTonnes(seats: number, passengers: number): number {
  return Math.max(0, seats * BELLY_TONNES_PER_SEAT - passengers * BAG_TONNES_PER_PASSENGER);
}

const producedKey = (iata: string, goodId: string) => `P:${goodId}@${iata}`;
const needKey = (iata: string, goodId: string) => `N:${goodId}@${iata}`;

/** The shortage premium on a good's need at an airport: how far above the base rate it pays today, 0 to MAX_SHORTAGE_PREMIUM. */
export function shortagePremium(state: SimState, iata: string, goodId: string): number {
  return MAX_SHORTAGE_PREMIUM * (1 - (state.cargoSatisfaction?.[needKey(iata, goodId)] ?? 0));
}

/** A share of the lane left to you: your flights on the pair against the rivals' daily frequencies. */
function yourShareOfMarket(state: SimState, origin: string, dest: string): number {
  const yours = legsServingMarket(origin, dest, state.schedule);
  const rivals = state.competitorRoutes
    .filter((route) => (route.origin === origin && route.dest === dest) || (route.origin === dest && route.dest === origin))
    .reduce((total, route) => total + route.dailyFrequency, 0);
  return yours / Math.max(1, yours + rivals);
}

export type CargoLoad = { goodId: string; tonnes: number; revenue: number };
export type FlightCargo = { tonnes: number; revenue: number; loads: CargoLoad[] };

/**
 * Load a flight that has just landed and pay for it. `transitMinutes` is
 * the time from the flight's scheduled departure to its actual arrival,
 * so a late flight spoils more of its fresh cargo (the same delay
 * sim/delays.ts and sim/cascade.ts spread through the day).
 *
 * Tonnes carried are limited by the hold, by this flight's share of the
 * lane, and by what is left of the origin's output and the destination's
 * need today. Revenue is tonnes times rate times distance, with the
 * shortage premium and spoilage, less handling. Mutates `state`: today's
 * tonnes moved and the cargo totals.
 */
export function carryCargo(
  state: SimState,
  flight: { origin: string; dest: string; seats: number; passengers: number; transitMinutes: number },
): FlightCargo {
  const result: FlightCargo = { tonnes: 0, revenue: 0, loads: [] };
  const lanes = lanesBetween(flight.origin, flight.dest);
  if (lanes.length === 0) return result;

  const moved = (state.cargoMovedToday ??= {});
  const distance = marketDistanceNm(flight.origin, flight.dest);
  const share = yourShareOfMarket(state, flight.origin, flight.dest);
  const flightsInDirection = Math.max(1, state.schedule.filter((leg) => leg.origin === flight.origin && leg.dest === flight.dest).length);
  let holdLeft = bellyTonnes(flight.seats, flight.passengers);

  for (const lane of lanes) {
    if (holdLeft <= 0) break;
    const producedBy = producedKey(flight.origin, lane.good.id);
    const neededBy = needKey(flight.dest, lane.good.id);
    const originLeft = producedTonnes(flight.origin, lane.good.id) - (moved[producedBy] ?? 0);
    const destLeft = neededTonnes(flight.dest, lane.good.id) - (moved[neededBy] ?? 0);
    const tonnes = Math.min(holdLeft, (lane.tonnes * share) / flightsInDirection, originLeft, destLeft);
    if (tonnes <= 0) continue;

    const spoilage = lane.good.shelfHours ? MAX_SPOILAGE * Math.min(1, flight.transitMinutes / 60 / lane.good.shelfHours) : 0;
    const price = lane.good.ratePerTonneNm * (1 + shortagePremium(state, flight.dest, lane.good.id)) * (1 - spoilage);
    const revenue = tonnes * price * distance * executiveCargoMultiplier(state) - tonnes * HANDLING_PER_TONNE[lane.good.handling];
    // A load that wouldn't cover its handling (a short hop with cold-chain goods) stays on the ground.
    if (revenue <= 0) continue;

    moved[producedBy] = (moved[producedBy] ?? 0) + tonnes;
    moved[neededBy] = (moved[neededBy] ?? 0) + tonnes;
    holdLeft -= tonnes;
    result.tonnes += tonnes;
    result.revenue += revenue;
    result.loads.push({ goodId: lane.good.id, tonnes, revenue });
  }

  state.todayCargoTonnes = (state.todayCargoTonnes ?? 0) + result.tonnes;
  state.todayCargoRevenue = (state.todayCargoRevenue ?? 0) + result.revenue;
  state.cargoRevenueTotal = (state.cargoRevenueTotal ?? 0) + result.revenue;
  return result;
}

/**
 * At midnight: a need's satisfaction moves toward the share of its volume
 * you moved today (so a premium you keep serving decays and one you leave
 * alone comes back), then the day's tonnes reset. Called from step.ts's
 * rollover, before the day's totals reset.
 */
export function rollDailyCargo(state: SimState): void {
  const moved = state.cargoMovedToday ?? {};
  const satisfaction = state.cargoSatisfaction ?? {};
  const next: Record<string, number> = {};
  const keys = new Set([...Object.keys(satisfaction), ...Object.keys(moved).filter((key) => key.startsWith('N:'))]);
  for (const key of keys) {
    const [goodId, iata] = key.slice(2).split('@');
    const volume = neededTonnes(iata, goodId);
    const filled = volume > 0 ? Math.min(1, (moved[key] ?? 0) / volume) : 0;
    const value = (satisfaction[key] ?? 0) * (1 - SATISFACTION_DAILY_WEIGHT) + filled * SATISFACTION_DAILY_WEIGHT;
    if (value >= 0.01) next[key] = value;
  }
  state.cargoSatisfaction = next;
  state.cargoMovedToday = {};
  state.yesterdayCargoRevenue = state.todayCargoRevenue ?? 0;
  state.yesterdayCargoTonnes = state.todayCargoTonnes ?? 0;
  state.todayCargoRevenue = 0;
  state.todayCargoTonnes = 0;
}
