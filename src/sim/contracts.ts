import airportsData from '../../data/airports.json';
import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { dayIndex } from './clock';
import { marketDistanceNm, potentialDailyDemand } from './demand';
import { actualDailyDemand, currentPotentialDemand, VIRGIN_MARKET_PDEW } from './marketDemand';
import { marketNps } from './nps';
import { bestRangeNm, networkAirports } from './reach';
import { addRivalFlight } from './competitors';
import { grantedCountries, homeCountry, legRights, rivalHomeCountry } from './rights';
import { nextRandom } from './rng';
import { trailingMarketOtp } from './routeOtp';
import { legsServingMarket, marketKey, recommendedFare } from './schedule';
import { rivalSlotQuote } from './slots';
import { hungerByAirport } from './serviceLevel';
import type { SimState } from './state';
import { earnStanding, loseStanding, standingOf } from './standing';
import { buyerKey, buyerTypeOf, CONTRACT_STREAM_SALT, eligibleRivals, frequencyOf, settleTender, TENDER_OPEN_DAYS, type Bid } from './tenders';

/**
 * Contracts (WEEK-ELEVEN.md, thread 6): route incentives for
 * underserved airports, like the US Essential Air Service or a province's
 * route-development fund. They are the game's balance lever for a weak
 * home: Halifax, whose markets are thin, gets more and bigger offers than
 * New York.
 *
 * - **An offer** is for one market from the airline's network to an
 *   underserved small community in reach: fly it at least once a day each way,
 *   and the contract pays so much a day for a term, and sends riders
 *   who wouldn't otherwise fly (civil servants, medical travel). Unclaimed
 *   for OFFER_OPEN_DAYS it lapses. It starts the day after the market is
 *   first flown.
 * - **Strict terms.** The riders scale with the route's performance
 *   against higher bars than ordinary passengers hold it to
 *   (performanceFactor()), and half the payment is a bonus earned the
 *   same way (paymentShare()): taxpayers' money buys reliability.
 * - **Renewal, graduation or the snap-back.** In the last
 *   RENEWAL_WINDOW_DAYS the buyer's terms show (renewalTerms()): the first
 *   term's pay scaled by the buyer's mood and by graduation(), how much of
 *   the route's gap to its potential the market has not yet built. Left
 *   alone it renews on those terms. A market that has grown to stand on its
 *   own ends with nothing lost; a buyer left too unhappy ends it, the
 *   market's built-up demand (sim/marketDemand.ts) drops by SNAP_BACK_SHARE
 *   and the route goes out to tender again. A subsidised route is weaker
 *   than it looked, so taking one is a bet on building something that
 *   survives it.
 *
 * Sizes vary by seed and by the home's weakness (homeWeakness()), worked
 * out from the data, not from a measured rating, which contracts
 * themselves would move.
 */

export type ContractStatus = 'offered' | 'active' | 'ended' | 'lapsed';

export type Contract = {
  id: number;
  /** The market: `a` is the network end it was offered from, `b` the underserved airport. */
  a: string;
  b: string;
  /** What the contract pays a day at full performance. */
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
  /** The airline's bid on the open tender (sim/tenders.ts); once awarded, `paymentPerDay` and `ridersPerDay` are the bid's. */
  bid?: Bid;
  /** Flights a day each way the contract asks for: 1 unless the awarded bid was for 2. */
  frequency?: 1 | 2;
  /** The last day a contested tender is decided. */
  tenderEndsDay?: number;
  /** The day the tender was awarded to the airline; it then has until `offerEndsDay` to start flying. */
  awardedDay?: number;
  /** The rival airline that won the tender instead. */
  lostTo?: string;
  /** The airline turned the tender down (declineContract()); it lapsed at once. */
  declined?: boolean;
  /** The buyer's mood, 0 to 100, moving slowly with performance; absent means SATISFACTION_START. */
  satisfaction?: number;
  /** Consecutive days the buyer has been sad, for the takeover window. */
  sadDays?: number;
  /** While a rival is circling a sad buyer: the day the window closes and the rival that will take the contract. */
  takeoverEndsDay?: number;
  takeoverBy?: string;
  /** What the contract paid and sent riders at when it first started, which renewals scale from without compounding. */
  basePaymentPerDay?: number;
  baseRidersPerDay?: number;
  /** The airline's counter on its renewal, set in the renewal window. */
  renewalAsk?: number;
};

export type Face = 'happy' | 'neutral' | 'sad';

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
/** A new contract is not judged until it has run this long, since the first two weeks of flying a worn plane say little about the route. */
export const GRACE_DAYS = 14;
/** Completion is smoothed with this many imagined flights that all landed, so one grounded day on a small sample does not zero the contract. */
const COMPLETION_PRIOR_FLIGHTS = 10;

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

/** The contract's first GRACE_DAYS: paid in full, and flown days neither lift nor lower the buyer's mood. */
export function inGrace(state: SimState, contract: Contract): boolean {
  return contract.startedDay !== undefined && dayIndex(state) - contract.startedDay < GRACE_DAYS;
}

/**
 * How well the route meets the contract's terms, 0 to 1: the worst of its
 * on-time, completion and NPS against the strict bars. Before there are
 * enough flights to judge, full.
 */
export function performanceFactor(state: SimState, contract: Contract): number {
  if (inGrace(state, contract)) return 1;
  const trailing = trailingMarketOtp(state, contract.a, contract.b, JUDGED_DAYS);
  const flights = trailing.arrived + trailing.cancelled;
  if (trailing.otp === null || flights === 0) return 1;
  const completion = (trailing.arrived + COMPLETION_PRIOR_FLIGHTS) / (flights + COMPLETION_PRIOR_FLIGHTS);
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

/** A new contract starts neutral-to-warm. */
export const SATISFACTION_START = 60;
export const HAPPY_FROM = 70;
export const SAD_BELOW = 40;
/** Each day moves the mood this share of the way to the day's mark: about a 30-day average. */
const SATISFACTION_WEIGHT = 1 / 30;
/** A health authority takes a missed day twice as hard. */
const HEALTH_MISSED_DAY_WEIGHT = 1 / 15;
/** Standing with a buyer: earned by finishing a term, lost by a bad one or a takeover (sim/standing.ts). */
const STANDING_HAPPY_TERM = 12;
const STANDING_NEUTRAL_TERM = 4;
const STANDING_BAD_TERM = 8;
const STANDING_LOST_TO_RIVAL = 15;
/** A happy buyer's raise on renewal grows by up to this much at full standing. */
const STANDING_RAISE = 0.1;

export function satisfactionOf(contract: Contract): number {
  return contract.satisfaction ?? SATISFACTION_START;
}

export function faceOf(contract: Contract): Face {
  const score = satisfactionOf(contract);
  return score >= HAPPY_FROM ? 'happy' : score < SAD_BELOW ? 'sad' : 'neutral';
}

/**
 * One day's mood move: the day's performance as a mark out of 100, or 0 for
 * a day not flown both ways (the buyer notices a missed day more than a late one).
 */
function updateSatisfaction(contract: Contract, dayMark: number): void {
  const score = satisfactionOf(contract);
  const weight = dayMark === 0 && buyerTypeOf(contract) === 'health' ? HEALTH_MISSED_DAY_WEIGHT : SATISFACTION_WEIGHT;
  contract.satisfaction = score + (dayMark - score) * weight;
  contract.sadDays = faceOf(contract) === 'sad' ? (contract.sadDays ?? 0) + 1 : 0;
}

/** A term's average performance, the renewal test; full before any day was judged. */
export function averagePerformance(contract: Contract): number {
  return contract.performanceDays ? (contract.performanceSum ?? 0) / contract.performanceDays : 1;
}

/** Days before the term ends in which renewal terms show and can be countered. */
export const RENEWAL_WINDOW_DAYS = 30;
/** A happy buyer pays up to this much more on renewal, a sad one up to SAD_MAX_CUT less. */
const HAPPY_MAX_RAISE = 0.15;
const SAD_MAX_CUT = 0.25;
/** A happy buyer lets the airline counter this far above the terms; any buyer lets it go down to MIN_COUNTER_RATIO. */
const COUNTER_EXTRA = 0.1;
const MIN_COUNTER_RATIO = 0.7;
/** Below this mood at the end of a term, the buyer puts the route out to tender again. */
export const RETENDER_BELOW = 20;
/** The market has built this share of its gap to potential when the buyer's need is gone. */
const GRADUATE_AT = 0.7;
/** At this graduation or below the buyer no longer needs a contract and the term simply ends. */
const GRADUATED_BELOW = 0.25;

export type RenewalTerms = {
  /** `graduated`: the market stands on its own, `retender`: the buyer is too unhappy to renew. */
  outcome: 'renew' | 'graduated' | 'retender';
  /** 1 while the market still needs the subsidy, falling to 0 as it builds. */
  graduation: number;
  priceMultiplier: number;
  paymentPerDay: number;
  ridersPerDay: number;
  /** The range the airline may counter within. */
  minAsk: number;
  maxAsk: number;
};

/**
 * How much of the buyer's original need is left, 1 to 0: the market's
 * built-up demand has closed this share of the gap between a market
 * nobody serves and its potential. A route that has grown to stand on its
 * own no longer needs a subsidy, so the buyer pays and sends less.
 */
export function graduation(state: SimState, contract: Contract): number {
  const gap = currentPotentialDemand(state, contract.a, contract.b) - VIRGIN_MARKET_PDEW;
  if (gap <= 0) return 1;
  const progress = Math.min(1, Math.max(0, (actualDailyDemand(state, contract.a, contract.b) - VIRGIN_MARKET_PDEW) / gap));
  return Math.max(0, 1 - progress / GRADUATE_AT);
}

/**
 * What the buyer would renew on if the term ended today: the first term's
 * pay (not compounded from earlier renewals) times graduation times a
 * mood multiplier, from -25% when the buyer is at its saddest to +15% at
 * its happiest.
 */
export function renewalTerms(state: SimState, contract: Contract): RenewalTerms {
  const base = contract.basePaymentPerDay ?? contract.paymentPerDay;
  const baseRiders = contract.baseRidersPerDay ?? contract.ridersPerDay;
  const mood = satisfactionOf(contract);
  const priceMultiplier =
    mood >= HAPPY_FROM ? 1 + ((HAPPY_MAX_RAISE + (STANDING_RAISE * standingOf(state, buyerKey(contract))) / 100) * (mood - HAPPY_FROM)) / (100 - HAPPY_FROM) : mood >= SAD_BELOW ? 1 : 1 - (SAD_MAX_CUT * (SAD_BELOW - mood)) / SAD_BELOW;
  const left = graduation(state, contract);
  const paymentPerDay = Math.round((base * left * priceMultiplier) / 100) * 100;
  return {
    outcome: left < GRADUATED_BELOW ? 'graduated' : mood < RETENDER_BELOW ? 'retender' : 'renew',
    graduation: left,
    priceMultiplier,
    paymentPerDay,
    ridersPerDay: Math.max(1, Math.round(baseRiders * left)),
    minAsk: Math.ceil((paymentPerDay * MIN_COUNTER_RATIO) / 100) * 100,
    maxAsk: faceOf(contract) === 'happy' ? Math.round((paymentPerDay * (1 + COUNTER_EXTRA)) / 100) * 100 : paymentPerDay,
  };
}

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

/** Counter the renewal terms inside the renewal window; unanswered, the contract renews on the terms. */
export function counterRenewal(state: SimState, contractId: number, askPerDay: number): Outcome {
  const contract = contractsOf(state).find((c) => c.id === contractId);
  if (!contract || contract.status !== 'active') return { ok: false, reason: 'That contract is not running' };
  if ((contract.endsDay ?? Infinity) - dayIndex(state) > RENEWAL_WINDOW_DAYS) return { ok: false, reason: `Renewal opens ${RENEWAL_WINDOW_DAYS} days before the term ends` };
  const terms = renewalTerms(state, contract);
  const ask = Math.round(askPerDay / 100) * 100;
  if (terms.outcome !== 'renew') return { ok: false, reason: 'The buyer is not renewing' };
  if (ask > terms.maxAsk) return { ok: false, reason: `Over the most the buyer will pay, $${terms.maxAsk}/day` };
  if (ask < terms.minAsk) return { ok: false, reason: `Under the lowest ask, $${terms.minAsk}/day` };
  contract.renewalAsk = ask;
  return { ok: true, message: `Renewal ask $${ask}/day` };
}

/** Consecutive sad days before an eligible rival starts circling. */
export const TAKEOVER_AFTER_SAD_DAYS = 14;
/** Days the airline has to win the buyer back or cut its price once a rival circles. */
export const TAKEOVER_WINDOW_DAYS = 14;
/** The cut the airline may offer to keep a circled contract, as a share of today's pay. */
export const TAKEOVER_MIN_COUNTER = 0.7;
export const TAKEOVER_MAX_COUNTER = 0.9;

export function takeoverOpen(contract: Contract): boolean {
  return contract.status === 'active' && contract.takeoverEndsDay !== undefined;
}

/** Keep a circled contract by cutting its pay; the cut also lowers the base renewals scale from. The sad streak starts over. */
export function counterTakeover(state: SimState, contractId: number, askPerDay: number): Outcome {
  const contract = contractsOf(state).find((c) => c.id === contractId);
  if (!contract || !takeoverOpen(contract)) return { ok: false, reason: 'No rival is circling that contract' };
  const ask = Math.round(askPerDay / 100) * 100;
  const lowest = Math.ceil((contract.paymentPerDay * TAKEOVER_MIN_COUNTER) / 100) * 100;
  const highest = Math.floor((contract.paymentPerDay * TAKEOVER_MAX_COUNTER) / 100) * 100;
  if (ask < lowest) return { ok: false, reason: `Under the lowest cut, $${lowest}/day` };
  if (ask > highest) return { ok: false, reason: `Not enough of a cut to keep the buyer, $${highest}/day at most` };
  const share = ask / contract.paymentPerDay;
  contract.basePaymentPerDay = Math.round(((contract.basePaymentPerDay ?? contract.paymentPerDay) * share) / 100) * 100;
  contract.paymentPerDay = ask;
  contract.takeoverEndsDay = undefined;
  contract.takeoverBy = undefined;
  contract.sadDays = 0;
  return { ok: true, message: `Kept · $${ask}/day` };
}

/** The rival opens the contract's market, or adds a flight if it already flies it. */
function rivalOpensMarket(state: SimState, code: string, a: string, b: string): void {
  const key = marketKey(a, b);
  const existing = state.competitorRoutes.find((route) => route.code === code && marketKey(route.origin, route.dest) === key);
  if (existing) {
    addRivalFlight(state, existing);
    return;
  }
  const home = state.competitorRoutes.find((route) => route.code === code);
  if (!home) return;
  state.competitorRoutes.push({
    airline: home.airline,
    code,
    origin: a,
    dest: b,
    dailyFrequency: 1,
    fare: recommendedFare(a, b),
    baseFare: recommendedFare(a, b),
    openedAtMinute: state.simMinute,
    slotFeesPerDay: rivalSlotQuote(state, a, b) ?? 0,
    homeCountry: rivalHomeCountry(state.competitorRoutes, code),
  });
}

/**
 * Daily, for a running contract: a buyer sad for TAKEOVER_AFTER_SAD_DAYS
 * draws an eligible rival, who has until the window closes. A buyer that
 * recovers closes it; otherwise the rival takes the contract at the full
 * rate, opens the market and the airline takes the snap-back. Whether the
 * contract was taken.
 */
function rollTakeover(state: SimState, contract: Contract, today: number): boolean {
  if (contract.takeoverEndsDay !== undefined) {
    if (faceOf(contract) !== 'sad') {
      contract.takeoverEndsDay = undefined;
      contract.takeoverBy = undefined;
      return false;
    }
    if (today < contract.takeoverEndsDay) return false;
    const code = contract.takeoverBy ?? '';
    contract.status = 'ended';
    contract.lostTo = code;
    contract.takeoverEndsDay = undefined;
    loseStanding(state, buyerKey(contract), STANDING_LOST_TO_RIVAL);
    const key = marketKey(contract.a, contract.b);
    const built = state.marketDemand[key];
    if (built !== undefined) state.marketDemand[key] = built * (1 - SNAP_BACK_SHARE);
    rivalOpensMarket(state, code, contract.a, contract.b);
    return true;
  }
  if ((contract.sadDays ?? 0) < TAKEOVER_AFTER_SAD_DAYS) return false;
  const rivals = eligibleRivals(state, contract);
  if (rivals.length === 0) return false;
  state.contractSeed ??= state.rngSeed ^ CONTRACT_STREAM_SALT;
  const [roll, next] = nextRandom(state.contractSeed);
  state.contractSeed = next;
  contract.takeoverBy = rivals[Math.min(rivals.length - 1, Math.floor(roll * rivals.length))];
  contract.takeoverEndsDay = today + TAKEOVER_WINDOW_DAYS;
  return false;
}

export function contractsOf(state: SimState): Contract[] {
  return state.contracts ?? [];
}

/**
 * Turn down a tender not yet awarded: it lapses now, so it drops off the
 * Contracts screen and the pipeline. No standing is lost; declining is
 * only saying no early, and an untaken offer lapses the same way.
 */
export function declineContract(state: SimState, contractId: number): Outcome {
  const contract = contractsOf(state).find((c) => c.id === contractId);
  if (!contract || contract.status !== 'offered') return { ok: false, reason: 'That tender is closed' };
  if (contract.awardedDay !== undefined) return { ok: false, reason: 'Already awarded to you' };
  contract.status = 'lapsed';
  contract.declined = true;
  return { ok: true, message: `Declined · ${contract.a}–${contract.b}` };
}

/**
 * Switch tenders off or back on. Off, no new tenders are offered or put
 * back out (a buyer that ends unhappy just ends) and the open ones not
 * yet awarded are declined; running contracts and awarded tenders carry
 * on. Offers draw from their own stream, so this moves no other roll.
 */
export function setContractsOff(state: SimState, off: boolean): void {
  state.contractsOff = off || undefined;
  if (!off) return;
  for (const contract of contractsOf(state)) if (contract.status === 'offered' && contract.awardedDay === undefined) declineContract(state, contract.id);
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
  if (state.contractsOff) {
    state.nextContractOfferDay = today + OFFER_INTERVAL_DAYS;
    return;
  }
  const weakness = homeWeakness(state.homeAirport);
  const hunger = hungerByAirport(state);
  const range = bestRangeNm(state);
  const home = homeCountry(state);
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
      // An offer the airline's own country's rights bar (two US airports for a Canadian carrier) could never be flown.
      if (!legRights(home, a, b, grantedCountries(state)).ok) continue;
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
      tenderEndsDay: today + TENDER_OPEN_DAYS,
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
  const retenders: Contract[] = [];
  for (const contract of contractsOf(state)) {
    const key = marketKey(contract.a, contract.b);
    if (contract.status === 'offered') {
      const legs = legsServingMarket(contract.a, contract.b, state.schedule);
      settleTender(state, contract, legs >= 2);
      if (contract.status !== 'offered') continue;
      if (contract.awardedDay !== undefined && legs >= 2 * frequencyOf(contract)) {
        contract.status = 'active';
        contract.basePaymentPerDay = contract.paymentPerDay;
        contract.baseRidersPerDay = contract.ridersPerDay;
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
    if (landedYesterday < 2 * frequencyOf(contract)) updateSatisfaction(contract, 0);
    if (landedYesterday >= 2 * frequencyOf(contract)) {
      const performance = performanceFactor(state, contract);
      if (!inGrace(state, contract)) updateSatisfaction(contract, performance * 100);
      contract.performanceSum = (contract.performanceSum ?? 0) + performance;
      contract.performanceDays = (contract.performanceDays ?? 0) + 1;
      const payment = Math.round(contract.paymentPerDay * paymentShare(performance));
      state.cash += payment;
      state.todayRevenue += payment;
      state.todayMargin += payment;
      state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + payment;
      (state.todayBonusByMarket ??= {})[key] = (state.todayBonusByMarket[key] ?? 0) + payment;
      contract.paidTotal += payment;
    }

    if (rollTakeover(state, contract, today)) continue;

    if (today >= (contract.endsDay ?? today)) {
      // Renewed on the buyer's terms unless the airline countered inside the
      // band; a market that has grown to stand on its own just ends, and a
      // buyer too unhappy to renew ends it, snaps the market back and puts
      // the route out to tender again.
      const terms = renewalTerms(state, contract);
      const mood = satisfactionOf(contract);
      if (mood >= HAPPY_FROM) earnStanding(state, buyerKey(contract), STANDING_HAPPY_TERM);
      else if (mood >= SAD_BELOW) earnStanding(state, buyerKey(contract), STANDING_NEUTRAL_TERM);
      else loseStanding(state, buyerKey(contract), STANDING_BAD_TERM);
      if (terms.outcome === 'renew') {
        const counter = contract.renewalAsk;
        contract.renewals = (contract.renewals ?? 0) + 1;
        contract.paymentPerDay = counter !== undefined && counter >= terms.minAsk && counter <= terms.maxAsk ? counter : terms.paymentPerDay;
        contract.ridersPerDay = terms.ridersPerDay;
        contract.renewalAsk = undefined;
        contract.endsDay = today + contract.termDays;
        contract.performanceSum = 0;
        contract.performanceDays = 0;
      } else {
        contract.status = 'ended';
        if (terms.outcome === 'retender') {
          const built = state.marketDemand[key];
          if (built !== undefined) state.marketDemand[key] = built * (1 - SNAP_BACK_SHARE);
          if (!state.contractsOff) retenders.push(contract);
        }
      }
    }
  }
  for (const old of retenders) {
    state.contracts!.push({
      id: (state.nextContractId ??= 1),
      a: old.a,
      b: old.b,
      paymentPerDay: old.basePaymentPerDay ?? old.paymentPerDay,
      ridersPerDay: old.baseRidersPerDay ?? old.ridersPerDay,
      termDays: old.termDays,
      offeredDay: today,
      offerEndsDay: today + OFFER_OPEN_DAYS,
      tenderEndsDay: today + TENDER_OPEN_DAYS,
      status: 'offered',
      paidTotal: 0,
    });
    state.nextContractId += 1;
  }

  // Keep the running and offered ones, and only the last few finished.
  const open = contractsOf(state).filter((c) => c.status === 'offered' || c.status === 'active');
  const finished = contractsOf(state).filter((c) => c.status === 'ended' || c.status === 'lapsed').slice(-HISTORY_KEPT);
  if (state.contracts) state.contracts = [...open, ...finished].sort((x, y) => x.id - y.id);

  if (today >= (state.nextContractOfferDay ?? 0)) makeOffers(state, false);
}
