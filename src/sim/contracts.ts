import airportsData from '../../data/airports.json';
import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { dayIndex } from './clock';
import { marketDistanceNm, potentialDailyDemand } from './demand';
import { marketNps } from './nps';
import { bestRangeNm, networkAirports } from './reach';
import { nextRandom } from './rng';
import { trailingMarketOtp } from './routeOtp';
import { legsServingMarket, marketKey } from './schedule';
import { hungerByAirport } from './serviceLevel';
import type { SimState } from './state';

/**
 * Government contracts (WEEK-ELEVEN.md, thread 6): route incentives for
 * underserved airports, like the US Essential Air Service or a province's
 * route-development fund. They are the game's balance lever for a weak
 * home: Halifax, whose markets are thin, gets more and bigger offers than
 * New York.
 *
 * - **An offer** is for one market from the airline's network to an
 *   underserved small community in reach: fly it at least once a day each way,
 *   and the government pays so much a day for a term, and sends riders
 *   who wouldn't otherwise fly (civil servants, medical travel). Unclaimed
 *   for OFFER_OPEN_DAYS it lapses. It starts the day after the market is
 *   first flown.
 * - **Strict terms.** The riders scale with the route's performance
 *   against higher bars than ordinary passengers hold it to
 *   (performanceFactor()), and half the payment is a bonus earned the
 *   same way (paymentShare()): taxpayers' money buys reliability.
 * - **Renewal or the snap-back.** A term kept up to the terms on average
 *   (RENEW_MIN_PERFORMANCE) is renewed smaller (RENEWAL_SIZE), up to
 *   MAX_RENEWALS times: subsidies taper. Otherwise, or finally, the riders
 *   and the payment stop and the market's built-up demand
 *   (sim/marketDemand.ts) drops by SNAP_BACK_SHARE: a subsidised route is
 *   weaker than it looked, so taking one is a bet on building something
 *   that survives it.
 *
 * Sizes vary by seed and by the home's weakness (homeWeakness()), worked
 * out from the data rather than from the headless-rated difficulty
 * (data/home-difficulty.json), which contracts themselves move.
 */

export type ContractStatus = 'offered' | 'active' | 'ended' | 'lapsed';

export type Contract = {
  id: number;
  /** The market: `a` is the network end it was offered from, `b` the underserved airport. */
  a: string;
  b: string;
  /** What the government pays a day at full performance. */
  paymentPerDay: number;
  /** Extra riders a day at full performance, contracted to you. */
  ridersPerDay: number;
  termDays: number;
  offeredDay: number;
  /** The last day it can be started. */
  offerEndsDay: number;
  startedDay?: number;
  /** The day the term ends. */
  endsDay?: number;
  status: ContractStatus;
  /** Everything it has paid so far. */
  paidTotal: number;
  /** Performance summed over the days of this term it was judged, for renewal. */
  performanceSum?: number;
  performanceDays?: number;
  /** How many times it has been renewed. */
  renewals?: number;
};

const OFFER_OPEN_DAYS = 30;
const OFFER_INTERVAL_DAYS = 45;
const MIN_TERM_DAYS = 90;
const TERM_SPREAD_DAYS = 60;
/** At a median home, before the seed's variation. */
const BASE_PAYMENT_PER_DAY = 2500;
const BASE_RIDERS_PER_DAY = 12;
/** Each offer's size is this much either side of its home's. */
const SIZE_VARIATION = 0.3;
/** The far end must be at least this starved for service (sim/serviceLevel.ts). */
const MIN_HUNGER = 0.5;
/**
 * And a small community: these programmes exist for places the market
 * alone won't serve, not for New York, which at the start of a game is
 * as "starved" as anywhere since no airline flies it yet.
 */
const MAX_FAR_END_POPULATION = 800_000;
/** How much of a market's built-up demand goes when its contract ends. */
export const SNAP_BACK_SHARE = 0.4;
/** The weakness scale's ends: a median home is 1. */
const MIN_WEAKNESS = 0.5;
const MAX_WEAKNESS = 4;
/** A term's average performance at which the contract is renewed rather than ended. */
export const RENEW_MIN_PERFORMANCE = 0.5;
/** Each renewal's payment and riders against the term before: subsidies taper. */
const RENEWAL_SIZE = 0.75;
/** After this many renewals it ends whatever the performance. */
const MAX_RENEWALS = 3;
/** Mixed into the game's seed to start the contracts' own random stream. */
const CONTRACT_STREAM_SALT = 0x5eed_c0de;
/** Finished contracts kept to show in Head office. */
const HISTORY_KEPT = 8;

// The strict terms: full at the first number, nothing at the second,
// straight lines between.
// Stricter than ordinary passengers, whose demand only stalls at 40%
// on-time (sim/routeOtp.ts), but reachable: a starting fleet with no turn
// buffer runs about 45% on-time and earns almost nothing, and one given
// buffers and young planes earns it all.
const OTP_FULL = 0.8;
const OTP_NONE = 0.45;
const COMPLETION_FULL = 0.95;
const COMPLETION_NONE = 0.8;
const NPS_FULL = 10;
const NPS_NONE = -10;
/** The share of the daily payment guaranteed whatever the performance; the rest is earned by it. */
const GUARANTEED_SHARE = 0.5;
/** Judged over two weeks, like a contract's monthly review, not flight by flight. */
const JUDGED_DAYS = 14;

type AirportSpec = { iata: string; population: number };
const allIatas = (airportsData as AirportSpec[]).map((airport) => airport.iata);
const populationByIata = new Map((airportsData as AirportSpec[]).map((airport) => [airport.iata, airport.population]));
const PROPELLER_RANGE_NM = AIRCRAFT_CLASSES[0].rangeNm;

/** A home's best markets a Propeller reaches, summed: how much there is to fly from it at the start. */
function homeStrength(iata: string): number {
  return allIatas
    .filter((other) => other !== iata && marketDistanceNm(iata, other) <= PROPELLER_RANGE_NM)
    .map((other) => potentialDailyDemand(iata, other))
    .sort((x, y) => y - x)
    .slice(0, 5)
    .reduce((sum, demand) => sum + demand, 0);
}

let medianStrength: number | null = null;

/**
 * How weak a home is against the median airport with markets in a
 * Propeller's reach: 1 at the median, up to MAX_WEAKNESS for the
 * thinnest, down to MIN_WEAKNESS for the strongest. Static data, so worked out once.
 */
export function homeWeakness(iata: string): number {
  if (medianStrength === null) {
    const strengths = allIatas.map(homeStrength).filter((s) => s > 0).sort((x, y) => x - y);
    medianStrength = strengths[Math.floor(strengths.length / 2)] ?? 1;
  }
  const strength = homeStrength(iata);
  return strength > 0 ? Math.min(MAX_WEAKNESS, Math.max(MIN_WEAKNESS, medianStrength / strength)) : MAX_WEAKNESS;
}

function lerp01(value: number, none: number, full: number): number {
  return Math.min(1, Math.max(0, (value - none) / (full - none)));
}

/**
 * How well the route meets the contract's terms, 0 to 1: the worst of its
 * on-time, completion and NPS against the strict bars. Before there are
 * enough flights to judge, full.
 */
export function performanceFactor(state: SimState, contract: Contract): number {
  const trailing = trailingMarketOtp(state, contract.a, contract.b, JUDGED_DAYS);
  const flights = trailing.arrived + trailing.cancelled;
  if (trailing.otp === null || flights === 0) return 1;
  const completion = trailing.arrived / flights;
  return Math.min(
    lerp01(trailing.otp, OTP_NONE, OTP_FULL),
    lerp01(completion, COMPLETION_NONE, COMPLETION_FULL),
    lerp01(marketNps(state, contract.a, contract.b), NPS_NONE, NPS_FULL),
  );
}

/**
 * The share of a contract's daily payment earned at a given performance:
 * a guaranteed base for flying it both ways, the rest a bonus for
 * performance, the way real route contracts split a guarantee from an
 * incentive. Without the base, a starting fleet of old planes on a packed
 * day (about 20% on-time) earned nothing, and a weak home went under as
 * if there were no contract at all.
 */
export function paymentShare(performance: number): number {
  return GUARANTEED_SHARE + (1 - GUARANTEED_SHARE) * performance;
}

/** A term's average performance, the renewal test; full before any day was judged. */
export function averagePerformance(contract: Contract): number {
  return contract.performanceDays ? (contract.performanceSum ?? 0) / contract.performanceDays : 1;
}

export function contractsOf(state: SimState): Contract[] {
  return state.contracts ?? [];
}

function runningOn(state: SimState, a: string, b: string): Contract | undefined {
  const key = marketKey(a, b);
  return contractsOf(state).find((c) => c.status === 'active' && marketKey(c.a, c.b) === key);
}

/**
 * Contract riders a day on this market today: the running contract's
 * riders at its performance, or none. They are the airline's own
 * customers, so booking treats them like connecting passengers
 * (sim/economy.ts's flightResult()): no share lost to rivals.
 */
export function contractRiders(state: SimState, a: string, b: string): number {
  const contract = runningOn(state, a, b);
  return contract ? contract.ridersPerDay * performanceFactor(state, contract) : 0;
}

/** The offered or running contract on this market, for the views. */
export function contractOn(state: SimState, a: string, b: string): Contract | undefined {
  const key = marketKey(a, b);
  return contractsOf(state).find((c) => (c.status === 'active' || c.status === 'offered') && marketKey(c.a, c.b) === key);
}

/** How many offers to make now: more for a weak home, at the start and every interval after. */
function offersToMake(weakness: number, atStart: boolean): number {
  if (atStart) return weakness >= 2 ? 3 : weakness >= 1.2 ? 2 : 1;
  return weakness >= 2 ? 2 : 1;
}

/**
 * Offer contracts on markets from the network to underserved airports in
 * reach that nobody offers or flies yet, picked by seed. Called when the
 * game starts (sim/homes.ts's chooseHome()) and every OFFER_INTERVAL_DAYS.
 */
export function makeOffers(state: SimState, atStart: boolean): void {
  const today = dayIndex(state);
  const weakness = homeWeakness(state.homeAirport);
  const hunger = hungerByAirport(state);
  const range = bestRangeNm(state);
  const taken = new Set(contractsOf(state).filter((c) => c.status === 'offered' || c.status === 'active').map((c) => marketKey(c.a, c.b)));
  const known = new Set(state.knownAirports);
  const candidates: { a: string; b: string }[] = [];
  for (const a of networkAirports(state)) {
    for (const b of state.knownAirports) {
      if (a === b || !known.has(a) || (hunger.get(b) ?? 0) < MIN_HUNGER) continue;
      if ((populationByIata.get(b) ?? Infinity) > MAX_FAR_END_POPULATION) continue;
      const key = marketKey(a, b);
      if (taken.has(key) || legsServingMarket(a, b, state.schedule) > 0) continue;
      if (marketDistanceNm(a, b) > range || potentialDailyDemand(a, b) <= 0) continue;
      candidates.push({ a, b });
    }
  }
  candidates.sort((x, y) => marketKey(x.a, x.b).localeCompare(marketKey(y.a, y.b)));

  state.contracts ??= [];
  // Contracts draw from their own stream, begun from the game's seed, so
  // offering them leaves every other roll in the game (weather, rivals,
  // breakdowns) as it would have been: a game that takes none plays out
  // exactly as one without contracts.
  state.contractSeed ??= state.rngSeed ^ CONTRACT_STREAM_SALT;
  for (let n = offersToMake(weakness, atStart); n > 0 && candidates.length > 0; n--) {
    const [pickRoll, s1] = nextRandom(state.contractSeed);
    const [sizeRoll, s2] = nextRandom(s1);
    const [termRoll, s3] = nextRandom(s2);
    state.contractSeed = s3;
    const [pick] = candidates.splice(Math.floor(pickRoll * candidates.length), 1);
    // Nothing else offered on the same far airport this round.
    for (let i = candidates.length - 1; i >= 0; i--) if (candidates[i].b === pick.b) candidates.splice(i, 1);
    const size = weakness * (1 - SIZE_VARIATION + 2 * SIZE_VARIATION * sizeRoll);
    state.contracts.push({
      id: (state.nextContractId ??= 1),
      a: pick.a,
      b: pick.b,
      paymentPerDay: Math.round((BASE_PAYMENT_PER_DAY * size) / 100) * 100,
      ridersPerDay: Math.max(4, Math.round(BASE_RIDERS_PER_DAY * size)),
      termDays: MIN_TERM_DAYS + Math.floor(termRoll * (TERM_SPREAD_DAYS + 1)),
      offeredDay: today,
      offerEndsDay: today + OFFER_OPEN_DAYS,
      status: 'offered',
      paidTotal: 0,
    });
    state.nextContractId += 1;
  }
  state.nextContractOfferDay = today + OFFER_INTERVAL_DAYS;
}

/**
 * Once a day at rollover, after the day's charges: offers flown start,
 * offers left too long lapse, running contracts pay for yesterday (if it
 * flew both ways, at yesterday's performance), and finished ones end and
 * snap their market's demand back. New offers every OFFER_INTERVAL_DAYS.
 */
export function rollDailyContracts(state: SimState): void {
  const today = dayIndex(state);
  for (const contract of contractsOf(state)) {
    const key = marketKey(contract.a, contract.b);
    if (contract.status === 'offered') {
      if (legsServingMarket(contract.a, contract.b, state.schedule) >= 2) {
        contract.status = 'active';
        contract.startedDay = today;
        contract.endsDay = today + contract.termDays;
      } else if (today > contract.offerEndsDay) {
        contract.status = 'lapsed';
      }
      continue;
    }
    if (contract.status !== 'active') continue;

    // Paid for a day it flew both ways: yesterday's landings on the market.
    const history = state.onTimeHistoryByMarket[key];
    const landedYesterday = history?.arrived[history.arrived.length - 1] ?? 0;
    if (landedYesterday >= 2) {
      const performance = performanceFactor(state, contract);
      contract.performanceSum = (contract.performanceSum ?? 0) + performance;
      contract.performanceDays = (contract.performanceDays ?? 0) + 1;
      const payment = Math.round(contract.paymentPerDay * paymentShare(performance));
      state.cash += payment;
      state.todayRevenue += payment;
      state.todayMargin += payment;
      state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + payment;
      contract.paidTotal += payment;
    }

    if (today >= (contract.endsDay ?? today)) {
      // Kept up to the terms, it's renewed smaller, and nothing snaps back
      // yet; let slip, or tapered out, it ends and the market snaps back.
      if (averagePerformance(contract) >= RENEW_MIN_PERFORMANCE && (contract.renewals ?? 0) < MAX_RENEWALS) {
        contract.renewals = (contract.renewals ?? 0) + 1;
        contract.paymentPerDay = Math.round((contract.paymentPerDay * RENEWAL_SIZE) / 100) * 100;
        contract.ridersPerDay = Math.max(1, Math.round(contract.ridersPerDay * RENEWAL_SIZE));
        contract.endsDay = today + contract.termDays;
        contract.performanceSum = 0;
        contract.performanceDays = 0;
      } else {
        contract.status = 'ended';
        const built = state.marketDemand[key];
        if (built !== undefined) state.marketDemand[key] = built * (1 - SNAP_BACK_SHARE);
      }
    }
  }

  // Keep the running and offered ones, and only the last few finished.
  const open = contractsOf(state).filter((c) => c.status === 'offered' || c.status === 'active');
  const finished = contractsOf(state).filter((c) => c.status === 'ended' || c.status === 'lapsed').slice(-HISTORY_KEPT);
  if (state.contracts) state.contracts = [...open, ...finished].sort((x, y) => x.id - y.id);

  if (today >= (state.nextContractOfferDay ?? 0)) makeOffers(state, false);
}
