import { dayIndex } from './clock';
import { CREW_CLASS_SCALE } from './crews';
import { homeWeakness } from './contracts';
import { nextRandom } from './rng';
import { marketKey, type ScheduleLeg } from './schedule';
import type { ActiveFlight, SimState } from './state';

/**
 * Priority flights ("mandates"): an offer to carry someone who must get
 * there on time, on a route the airline already flies. A touring band, a
 * minister's delegation, a children's wish trip. Announced 14 to 28 days
 * before the first flight, so there is time to line up crews, a spare
 * and a turn buffer; accepted or ignored for free.
 *
 * An accepted one runs for a term. Each flight that leaves on time pays a
 * premium; each that is cancelled or lands more than LATE_MINUTES late
 * costs a penalty, except cancellations by weather or a closed airspace,
 * which nobody could have prevented. A term kept to MIN_TERM_SUCCESS pays a
 * bonus.
 *
 * What priority buys is only crews first (mandatedTails(), read by
 * rollDailyCrews): when crews are short the shortage lands on another
 * plane. There is no curfew or turn-buffer exemption, so protection is a
 * shuffle, not a gift.
 *
 * The premium scales with how weak the home market is (homeWeakness()) and
 * with the plane's class, and offers thin out as the fleet grows, so a
 * small airline can build on them and a large one is not bogged down by
 * them.
 */

export type MandateStatus = 'offered' | 'accepted' | 'ended' | 'lapsed';

export type Mandate = {
  id: number;
  origin: string;
  dest: string;
  /** Home-local minute the flight leaves, as the schedule's `departMinute`. */
  departMinute: number;
  /** Which of STORIES is aboard. */
  story: number;
  offeredDay: number;
  /** The first day it applies; an offer not accepted by then lapses. */
  startDay: number;
  /** The first day it no longer applies. */
  endDay: number;
  status: MandateStatus;
  premium: number;
  penalty: number;
  flown: number;
  failed: number;
  /** Cancelled for weather or closed airspace: neither paid nor charged. */
  waived: number;
  /** Net of premiums, penalties and the bonus so far. */
  netTotal: number;
};

export const STORIES: { who: string; headline: string }[] = [
  { who: 'a touring band and its crew', headline: 'The band has a sold-out show to open' },
  { who: 'a visiting head of government and delegation', headline: 'The delegation has a summit that morning' },
  { who: 'a children\'s wish charity, ten kids and their families', headline: 'The children have waited a year for this trip' },
  { who: 'a national hockey team', headline: 'The team has a championship game that night' },
  { who: 'a touring orchestra and its instruments', headline: 'The orchestra goes on stage at eight' },
  { who: 'a cabinet minister and aides', headline: 'The minister is due at a vote' },
  { who: 'a film crew and the lead actors', headline: 'The crew has one day of light to shoot' },
  { who: 'a medical team carrying a donor organ', headline: 'A surgery is waiting on this flight' },
  { who: 'a celebrity chef and a sold-out cooking class', headline: 'Two hundred guests are booked for the evening' },
];

const STREAM_SALT = 0x4d414e44;
const OFFER_CHANCE_PER_DAY = 1 / 20;
/** Fleet size from which offers thin out: one more plane per this many cuts the chance by a share of itself. */
const THIN_AFTER_PLANES = 4;
const THIN_PER_PLANES = 8;
const FIRST_OFFER_DAY = 10;
const NOTICE_MIN_DAYS = 14;
const NOTICE_MAX_DAYS = 28;
const TERM_MIN_DAYS = 10;
const TERM_MAX_DAYS = 21;
const MAX_OFFERED = 2;
const MAX_ACCEPTED = 3;
const BASE_PREMIUM = 1200;
const PENALTY_TO_PREMIUM = 1.5;
const BONUS_IN_PREMIUMS = 3;
export const LATE_MINUTES = 60;
export const MIN_TERM_SUCCESS = 0.95;
/** The mandated flight is the one on its route nearest the offered time, if it is within this of it: a retime or a turn buffer moves a flight a little, a move to another part of the day drops the commitment. */
const TIME_WINDOW_MINUTES = 120;
const HISTORY_KEPT = 5;
/** Cancellation causes that nobody could have prevented. */
const FORCE_MAJEURE = new Set(['weather', 'airspace']);

export function mandatesOf(state: SimState): Mandate[] {
  return state.mandates ?? [];
}

export function mandateIsActive(state: SimState, mandate: Mandate): boolean {
  const today = dayIndex(state);
  return mandate.status === 'accepted' && mandate.startDay <= today && today < mandate.endDay;
}

/** The leg of the schedule that flies this mandate: the one on its route nearest its time, within the window. */
export function mandatedLeg(state: SimState, mandate: Mandate): ScheduleLeg | undefined {
  let best: ScheduleLeg | undefined;
  for (const leg of state.schedule) {
    if (leg.origin !== mandate.origin || leg.dest !== mandate.dest) continue;
    if (!state.aircraft.some((a) => a.tail === leg.tail)) continue;
    const gap = Math.abs(leg.departMinute - mandate.departMinute);
    if (gap > TIME_WINDOW_MINUTES) continue;
    if (!best || gap < Math.abs(best.departMinute - mandate.departMinute)) best = leg;
  }
  return best;
}

/** Whether an accepted priority flight, running or still to start, is on this market in either direction. */
export function marketHasMandate(state: SimState, a: string, b: string): boolean {
  return mandatesOf(state).some((m) => m.status === 'accepted' && ((m.origin === a && m.dest === b) || (m.origin === b && m.dest === a)));
}

/** The tails flying a mandated leg today: crews are handed to these first. */
export function mandatedTails(state: SimState): Set<string> {
  const tails = new Set<string>();
  const active = mandatesOf(state).filter((mandate) => mandateIsActive(state, mandate));
  if (active.length === 0) return tails;
  for (const mandate of active) {
    const leg = mandatedLeg(state, mandate);
    if (leg) tails.add(leg.tail);
  }
  return tails;
}

/** The active mandate a leg is flying, if any. */
function mandateForLeg(state: SimState, leg: ScheduleLeg): Mandate | undefined {
  return mandatesOf(state).find((mandate) => mandateIsActive(state, mandate) && mandatedLeg(state, mandate) === leg);
}

export function acceptMandate(state: SimState, id: number): { ok: true; message: string } | { ok: false; reason: string } {
  const mandate = mandatesOf(state).find((m) => m.id === id);
  if (!mandate) return { ok: false, reason: 'No such offer.' };
  if (mandate.status !== 'offered') return { ok: false, reason: 'No longer on offer.' };
  if (dayIndex(state) >= mandate.startDay) return { ok: false, reason: 'The offer has lapsed.' };
  if (mandatesOf(state).filter((m) => m.status === 'accepted').length >= MAX_ACCEPTED) return { ok: false, reason: `Already carrying ${MAX_ACCEPTED} priority flights.` };
  mandate.status = 'accepted';
  return { ok: true, message: `Priority flight accepted · ${mandate.origin}-${mandate.dest}` };
}

function settle(state: SimState, mandate: Mandate, amount: number): void {
  const key = marketKey(mandate.origin, mandate.dest);
  state.cash += amount;
  state.todayRevenue += amount;
  state.todayMargin += amount;
  state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + amount;
  mandate.netTotal += amount;
}

/** A mandated flight landed: paid on time, charged if more than LATE_MINUTES late. */
export function settleMandateArrival(state: SimState, flight: ActiveFlight): void {
  const leg = state.schedule.find((l) => l.legId === flight.legId);
  if (!leg) return;
  const mandate = mandateForLeg(state, leg);
  if (!mandate) return;
  if (flight.arriveMinute - flight.scheduledArriveMinute > LATE_MINUTES) {
    mandate.failed += 1;
    settle(state, mandate, -mandate.penalty);
  } else {
    mandate.flown += 1;
    settle(state, mandate, mandate.premium);
  }
}

/** A flight was cancelled: charged, unless weather or a closed airspace did it. */
export function settleMandateCancellation(state: SimState, leg: ScheduleLeg, cause: string): void {
  const mandate = mandateForLeg(state, leg);
  if (!mandate) return;
  if (FORCE_MAJEURE.has(cause)) {
    mandate.waived += 1;
    return;
  }
  mandate.failed += 1;
  settle(state, mandate, -mandate.penalty);
}

/**
 * Once a day at rollover, before the day's cancellations: lapse offers
 * left past their start, charge a day with no matching flight on the
 * schedule, close finished terms (with the bonus when kept), and now and
 * then make an offer.
 */
export function rollDailyMandates(state: SimState): void {
  const today = dayIndex(state);
  state.mandates ??= [];
  state.mandateSeed ??= state.rngSeed ^ STREAM_SALT;
  state.nextMandateId ??= 1;

  for (const mandate of state.mandates) {
    if (mandate.status === 'offered' && today >= mandate.startDay) mandate.status = 'lapsed';
    if (mandate.status !== 'accepted') continue;
    if (mandateIsActive(state, mandate)) {
      const scheduled = mandatedLeg(state, mandate) !== undefined;
      if (!scheduled) {
        mandate.failed += 1;
        settle(state, mandate, -mandate.penalty);
      }
    }
    if (today >= mandate.endDay) {
      mandate.status = 'ended';
      const judged = mandate.flown + mandate.failed;
      if (judged > 0 && mandate.flown / judged >= MIN_TERM_SUCCESS) settle(state, mandate, mandate.premium * BONUS_IN_PREMIUMS);
    }
  }
  const open = state.mandates.filter((m) => m.status === 'offered' || m.status === 'accepted');
  const finished = state.mandates.filter((m) => m.status === 'ended' || m.status === 'lapsed').slice(-HISTORY_KEPT);
  state.mandates = [...open, ...finished].sort((a, b) => a.id - b.id);

  // Always the same draws, whether or not an offer is made, so the stream is as long for every game.
  const [chanceRoll, s1] = nextRandom(state.mandateSeed);
  const [pickRoll, s2] = nextRandom(s1);
  const [storyRoll, s3] = nextRandom(s2);
  const [noticeRoll, s4] = nextRandom(s3);
  const [termRoll, s5] = nextRandom(s4);
  state.mandateSeed = s5;

  if (today < FIRST_OFFER_DAY || state.mandates.filter((m) => m.status === 'offered').length >= MAX_OFFERED) return;
  const thinning = 1 + Math.max(0, state.aircraft.length - THIN_AFTER_PLANES) / THIN_PER_PLANES;
  if (chanceRoll >= OFFER_CHANCE_PER_DAY / thinning) return;

  const taken = new Set(state.mandates.filter((m) => m.status === 'offered' || m.status === 'accepted').map((m) => `${m.origin}|${m.dest}`));
  const candidates = state.schedule
    .filter((leg) => state.aircraft.some((a) => a.tail === leg.tail) && !taken.has(`${leg.origin}|${leg.dest}`))
    .sort((a, b) => a.legId.localeCompare(b.legId));
  if (candidates.length === 0) return;
  const leg = candidates[Math.floor(pickRoll * candidates.length)];
  const plane = state.aircraft.find((a) => a.tail === leg.tail)!;
  const premium = Math.round((BASE_PREMIUM * homeWeakness(state.homeAirport) * (CREW_CLASS_SCALE[plane.typeCode] ?? 1)) / 50) * 50;
  const notice = NOTICE_MIN_DAYS + Math.floor(noticeRoll * (NOTICE_MAX_DAYS - NOTICE_MIN_DAYS + 1));
  const term = TERM_MIN_DAYS + Math.floor(termRoll * (TERM_MAX_DAYS - TERM_MIN_DAYS + 1));
  state.mandates.push({
    id: state.nextMandateId++,
    origin: leg.origin,
    dest: leg.dest,
    departMinute: leg.departMinute,
    story: Math.min(STORIES.length - 1, Math.floor(storyRoll * STORIES.length)),
    offeredDay: today,
    startDay: today + notice,
    endDay: today + notice + term,
    status: 'offered',
    premium,
    penalty: Math.round((premium * PENALTY_TO_PREMIUM) / 50) * 50,
    flown: 0,
    failed: 0,
    waived: 0,
    netTotal: 0,
  });
}
