import { calendarDay, calendarDayOfYear, DAYS_PER_YEAR } from '../sim/clock';
import type { SimState } from '../sim/state';

/**
 * How the page writes money: whole dollars with thousands separators,
 * and a true minus sign before the dollar sign for a loss ("−$1,250").
 * One function, so every panel writes it the same way.
 */
export function money(amount: number): string {
  return `${amount < 0 ? '−' : ''}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * Money at a glance, for ticker lines and cards: "$950", "$22k", "$1.4M".
 * Rounded, so it's for reading, not for sums; money() is the exact figure.
 */
export function shortMoney(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const size = Math.abs(amount);
  if (size >= 999_500) return `${sign}$${(size / 1_000_000).toFixed(size >= 10_000_000 ? 0 : 1)}M`;
  if (size >= 1_000) return `${sign}$${Math.round(size / 1_000)}k`;
  return `${sign}$${Math.round(size)}`;
}

const FIRST_YEAR = 2027;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/**
 * A game day's calendar date. Day 0 is the start date the player chose
 * (sim/clock.ts), in 2027. Every year is 365 days, as the sim's is, so the
 * date shown always matches the season being played: no 29 February.
 */
function calendarDate(state: SimState, day: number): { year: number; month: number; date: number } {
  const daysSinceFirstJanuary = calendarDay(state, day);
  const year = FIRST_YEAR + Math.floor(daysSinceFirstJanuary / DAYS_PER_YEAR);
  const dayOfYear = calendarDayOfYear(state, day);
  let month = 0;
  while (month < 11 && dayOfYear >= MONTH_STARTS[month + 1]) month += 1;
  return { year, month, date: dayOfYear - MONTH_STARTS[month] + 1 };
}

/** A game day as a short date: "May 14". */
export function gameDate(state: SimState, day: number): string {
  const { month, date } = calendarDate(state, day);
  return `${MONTH_NAMES[month]} ${date}`;
}

/** A game day with its year, for the clock: "May 14, 2027". */
export function gameDateWithYear(state: SimState, day: number): string {
  const { year, month, date } = calendarDate(state, day);
  return `${MONTH_NAMES[month]} ${date}, ${year}`;
}
