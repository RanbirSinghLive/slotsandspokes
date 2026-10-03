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

const GAME_START_UTC_MS = Date.UTC(2027, 0, 1);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A game day as a short date: day 0 is 1 January 2027 (main.ts's clock), so day 133 is "May 14". */
export function gameDate(day: number): string {
  const date = new Date(GAME_START_UTC_MS + day * 86_400_000);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
