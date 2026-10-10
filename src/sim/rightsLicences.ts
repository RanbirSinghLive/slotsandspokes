import airportsData from '../../data/airports.json';
import { dayIndex } from './clock';
import { classOpen, LADDER, tiersClimbed } from './ladder';
import { countryOf, grantedCountries, homeCountry, mayFlyInside } from './rights';
import { trailingMarketOtp } from './routeOtp';
import { marketKey } from './schedule';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';

/**
 * Buying domestic rights in a foreign country (see HOW-IT-WORKS.md). Rights are earned, then paid for, then
 * kept by flying them, so no one grant is a cheap permanent edge:
 *
 *  - Earned: 120 days of international service into the country, at least
 *    two departures a day touching it (14 a week), on time at least 60% of
 *    the time. Cash cannot rush this.
 *  - Bought: a setup fee and a yearly levy, both scaled to the country's
 *    population. Only after the widebody tier, with one licence per tier
 *    climbed from there.
 *  - Kept: they lapse after 60 days with no domestic leg flown there.
 *  - Capped: a weekly ceiling on domestic departures there, starting at 14
 *    and growing 14 for every 90 days held, to 70.
 *
 * Everything is saved in two optional state fields, so no save format change.
 */

export const EARN_DAYS = 120;
export const MIN_DAILY_DEPARTURES = 2;
export const MIN_ON_TIME = 0.6;
export const OTP_WINDOW_DAYS = 30;
export const LAPSE_DAYS = 60;
export const CAP_START_WEEKLY = 14;
export const CAP_STEP_WEEKLY = 14;
export const CAP_STEP_DAYS = 90;
export const CAP_MAX_WEEKLY = 70;
/** Setup fee per million people in the country's airport catchments, with a floor and a ceiling; the yearly levy is a share of it. */
export const SETUP_PER_MILLION_PEOPLE = 60_000;
export const SETUP_MIN = 250_000;
export const SETUP_MAX = 15_000_000;
export const LEVY_SHARE_OF_SETUP_PER_YEAR = 0.15;

const populationByCountry = new Map<string, number>();
for (const airport of airportsData as { iata: string; population: number }[]) {
  const country = countryOf(airport.iata);
  if (country) populationByCountry.set(country, (populationByCountry.get(country) ?? 0) + airport.population);
}

/** The tier whose climb opens widebodies: rights open with it. */
const OPENING_TIER_INDEX = LADDER.findIndex((tier) => tier.opensClasses?.includes('WIDEBODY'));

/** Whether the feature is open yet: shown greyed in the UI until it is. */
export function rightsOpen(state: SimState): boolean {
  return classOpen(state, 'WIDEBODY');
}

/** How many licences the airline may hold now: one once widebodies open, one more per tier climbed after. */
export function licencesAllowed(state: SimState): number {
  return rightsOpen(state) ? Math.max(1, tiersClimbed(state) - OPENING_TIER_INDEX) : 0;
}

/** One-off fee for a country's domestic rights. */
export function setupFee(country: string): number {
  const millions = (populationByCountry.get(country) ?? 0) / 1_000_000;
  return Math.round(Math.min(SETUP_MAX, Math.max(SETUP_MIN, millions * SETUP_PER_MILLION_PEOPLE)) / 1000) * 1000;
}

/** What a held licence costs a year. */
export function yearlyLevy(country: string): number {
  return Math.round(setupFee(country) * LEVY_SHARE_OF_SETUP_PER_YEAR);
}

function licenceFor(state: SimState, country: string) {
  return state.domesticRights?.find((licence) => licence.country === country);
}

/** Weekly domestic departures allowed in a licensed country: 14 to start, 14 more per 90 days held, to 70. */
export function weeklyCap(state: SimState, country: string): number {
  const licence = licenceFor(state, country);
  if (!licence) return 0;
  const steps = Math.floor((dayIndex(state) - licence.sinceDay) / CAP_STEP_DAYS);
  return Math.min(CAP_MAX_WEEKLY, CAP_START_WEEKLY + CAP_STEP_WEEKLY * steps);
}

function bothIn(country: string, leg: { origin: string; dest: string }): boolean {
  return countryOf(leg.origin) === country && countryOf(leg.dest) === country;
}

/** Weekly domestic departures the schedule flies inside a country (the schedule repeats daily). */
export function weeklyDomesticDepartures(schedule: readonly ScheduleLeg[], country: string): number {
  return schedule.filter((leg) => bothIn(country, leg)).length * 7;
}

/** The refusal for a new rotation whose legs would push a licensed country past its cap, or null. */
export function capRefusal(state: SimState, legs: readonly { origin: string; dest: string }[]): string | null {
  for (const licence of state.domesticRights ?? []) {
    const added = legs.filter((leg) => bothIn(licence.country, leg)).length * 7;
    if (added === 0) continue;
    const cap = weeklyCap(state, licence.country);
    const after = weeklyDomesticDepartures(state.schedule, licence.country) + added;
    if (after > cap) return `${licence.country} domestic · ${after}/wk over the cap of ${cap} · the cap grows ${CAP_STEP_WEEKLY} every ${CAP_STEP_DAYS} days held`;
  }
  return null;
}

/** Daily departures that touch `country` from or to somewhere abroad. */
function internationalDeparturesTouching(state: SimState, country: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => {
    const origin = countryOf(leg.origin);
    const dest = countryOf(leg.dest);
    return origin !== undefined && dest !== undefined && origin !== dest && (origin === country || dest === country);
  });
}

/** On-time share over the last month on the airline's routes touching `country`, or null with too few arrivals to judge. */
function onTimeInto(state: SimState, country: string): number | null {
  let arrived = 0;
  let onTime = 0;
  const seen = new Set<string>();
  for (const leg of internationalDeparturesTouching(state, country)) {
    const key = marketKey(leg.origin, leg.dest);
    if (seen.has(key)) continue;
    seen.add(key);
    const trailing = trailingMarketOtp(state, leg.origin, leg.dest, OTP_WINDOW_DAYS);
    arrived += trailing.arrived + trailing.cancelled;
    onTime += trailing.onTime;
  }
  return arrived >= 20 ? onTime / arrived : null;
}

export type RightsStatus = 'locked' | 'earning' | 'offered' | 'held' | 'home';

export type RightsOffer = {
  country: string;
  status: RightsStatus;
  /** Days toward EARN_DAYS. */
  progressDays: number;
  setup: number;
  levyPerYear: number;
  /** Held: weekly domestic departures used and allowed. */
  weeklyUsed?: number;
  weeklyCap?: number;
};

/** Where one foreign country stands: locked until widebodies open, earning, offered, or held. */
export function rightsOffer(state: SimState, country: string): RightsOffer {
  const home = homeCountry(state);
  const base = { country, setup: setupFee(country), levyPerYear: yearlyLevy(country) };
  if (country === home) return { ...base, status: 'home', progressDays: EARN_DAYS };
  const licence = licenceFor(state, country);
  if (licence) {
    return { ...base, status: 'held', progressDays: EARN_DAYS, weeklyUsed: weeklyDomesticDepartures(state.schedule, country), weeklyCap: weeklyCap(state, country) };
  }
  const progressDays = Math.min(EARN_DAYS, state.rightsProgress?.[country] ?? 0);
  if (!rightsOpen(state)) return { ...base, status: 'locked', progressDays };
  return { ...base, status: progressDays >= EARN_DAYS ? 'offered' : 'earning', progressDays };
}

/** Foreign countries the airline has any progress in, or holds, for the Head Office list. */
export function rightsCountries(state: SimState): string[] {
  return [...new Set([...Object.keys(state.rightsProgress ?? {}), ...grantedCountries(state)])].sort();
}

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

/** Why a country's rights can't be bought now, or null when they can. */
export function rightsBlocked(state: SimState, country: string): string | null {
  const offer = rightsOffer(state, country);
  if (offer.status === 'locked') return 'Opens with widebodies';
  if (offer.status === 'home' || offer.status === 'held') return `${country} · already yours`;
  if (offer.status !== 'offered') return `${country} · ${offer.progressDays}/${EARN_DAYS} days of service`;
  const held = state.domesticRights?.length ?? 0;
  if (held >= licencesAllowed(state)) return `${held}/${licencesAllowed(state)} licences held · another opens with the next tier`;
  if (state.cash < offer.setup) return `Setup fee $${offer.setup.toLocaleString('en-US')} · cash short`;
  return null;
}

/** Buy a country's domestic rights: needs the tier, the earned offer, a free licence and the setup fee in cash. */
export function buyRights(state: SimState, country: string): Outcome {
  const blocked = rightsBlocked(state, country);
  if (blocked) return { ok: false, reason: blocked };
  const offer = rightsOffer(state, country);
  state.cash -= offer.setup;
  state.todayCost += offer.setup;
  state.todayCostByCategory.overhead += offer.setup;
  state.todayMargin -= offer.setup;
  const today = dayIndex(state);
  (state.domesticRights ??= []).push({ country, sinceDay: today, lastFlownDay: today });
  return { ok: true, message: `${country} domestic rights · cap ${CAP_START_WEEKLY}/wk` };
}

/** Give a licence back: no refund, and the earned days start again. */
export function dropRights(state: SimState, country: string): Outcome {
  if (!licenceFor(state, country)) return { ok: false, reason: `${country} · not held` };
  state.domesticRights = (state.domesticRights ?? []).filter((licence) => licence.country !== country);
  if (state.rightsProgress) state.rightsProgress[country] = 0;
  return { ok: true, message: `${country} rights returned` };
}

/**
 * Once a day at the rollover: earn days for each country with qualifying
 * service, charge each held licence its daily share of the levy, and lapse
 * the ones not flown. Legs a lapsed licence leaves behind keep flying (the
 * planner only checks new rotations); their connections stop.
 */
export function rollDailyRights(state: SimState): void {
  const home = homeCountry(state);
  if (!home) return;
  const today = dayIndex(state);

  const touched = new Set<string>();
  for (const leg of state.schedule) {
    for (const iata of [leg.origin, leg.dest]) {
      const country = countryOf(iata);
      if (country && country !== home) touched.add(country);
    }
  }
  const progress = (state.rightsProgress ??= {});
  for (const country of touched) {
    if (licenceFor(state, country)) continue;
    // Domestic rights are only worth earning where a bloc or the home country doesn't already give them.
    if (mayFlyInside(home, country)) continue;
    const departures = internationalDeparturesTouching(state, country).length;
    const otp = onTimeInto(state, country);
    const qualifies = departures >= MIN_DAILY_DEPARTURES && otp !== null && otp >= MIN_ON_TIME;
    progress[country] = Math.max(0, Math.min(EARN_DAYS, (progress[country] ?? 0) + (qualifies ? 1 : -1)));
  }
  for (const country of Object.keys(progress)) if (!touched.has(country) && !licenceFor(state, country)) progress[country] = Math.max(0, progress[country] - 1);

  for (const licence of [...(state.domesticRights ?? [])]) {
    if (state.schedule.some((leg) => bothIn(licence.country, leg))) licence.lastFlownDay = today;
    const levy = yearlyLevy(licence.country) / 365;
    state.cash -= levy;
    state.todayCost += levy;
    state.todayCostByCategory.overhead += levy;
    state.todayMargin -= levy;
    if (today - licence.lastFlownDay >= LAPSE_DAYS) {
      state.domesticRights = (state.domesticRights ?? []).filter((held) => held !== licence);
      progress[licence.country] = 0;
    }
  }
}

/** A short note for a barred domestic leg in a country whose rights could be bought, or null when none could. */
export function rightsHint(state: SimState, a: string, b: string): string | null {
  const country = countryOf(a);
  if (!country || country !== countryOf(b)) return null;
  const offer = rightsOffer(state, country);
  if (offer.status === 'offered') return `${country} rights offered · buy in Head office`;
  if (offer.status === 'earning') return `${country} rights · ${offer.progressDays}/${EARN_DAYS}d earned`;
  return null;
}
