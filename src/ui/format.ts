/**
 * How the page writes money: whole dollars with thousands separators,
 * and a true minus sign before the dollar sign for a loss ("−$1,250").
 * One function, so every panel writes it the same way.
 */
export function money(amount: number): string {
  return `${amount < 0 ? '−' : ''}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}
