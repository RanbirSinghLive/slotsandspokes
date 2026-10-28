import { dayIndex } from '../../sim/clock';
import { FUEL_PRICE_BASELINE } from '../../sim/fuel';
import {
  activeTranches,
  airlineFuelPrice,
  describeFuelPrice,
  FUEL_COVERS,
  FUEL_DIP_PRICE,
  FUEL_RUNGS,
  FUEL_SURCHARGES,
  FUEL_TERMS,
  fuelPolicyOf,
  hedgedShare,
  premiumRate,
  rungInterval,
  rungPremium,
  termBlocked,
  type FuelPolicy,
} from '../../sim/fuelPrice';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import * as ops from '../routeActions';
import { heading, info, line, titleWithSwitch } from './dom';
import { moneySwitch } from '../screenGroups';

/**
 * The Fuel view: the market price, what the airline pays under its
 * standing policy, the hedge ladder's rungs, the policy's book since it
 * was set, and the four dials (sim/fuelPrice.ts). Colour does the
 * reading: green is fuel cheaper than the market or money made, red is
 * dearer or money lost.
 */

const SVG = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 300;
const CHART_HEIGHT = 90;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  return el;
}

function polyline(values: number[], x: (i: number) => number, y: (price: number) => number, className: string): SVGPolylineElement {
  return svgEl('polyline', { points: values.map((price, i) => `${x(i).toFixed(1)},${y(price).toFixed(1)}`).join(' '), class: className });
}

/**
 * The market price over the last days (amber), the price paid (green),
 * the usual price dashed, and each running rung as a faint line at its
 * locked price across the days it has covered. An SVG built as DOM, like
 * any other panel element: the canvas is the map's.
 */
function fuelChart(state: SimState): SVGSVGElement {
  const market = state.fuelPriceHistory ?? [];
  // Both histories end today; the paid one may be shorter in an older save.
  const paid = (state.fuelPaidHistory ?? []).slice(-market.length);
  const tranches = activeTranches(state);
  const today = dayIndex(state);
  const values = [...market, ...paid, FUEL_PRICE_BASELINE, ...tranches.map((tranche) => tranche.lockedPrice)];
  const low = Math.min(...values) - 0.05;
  const high = Math.max(...values) + 0.05;
  const days = Math.max(market.length, 2);
  const x = (i: number) => (i / (days - 1)) * CHART_WIDTH;
  const y = (price: number) => CHART_HEIGHT - ((price - low) / (high - low)) * CHART_HEIGHT;

  const svg = svgEl('svg', { viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, class: 'fuel-chart', role: 'img' });
  svg.setAttribute('aria-label', `Fuel price over the last ${market.length} days, market and paid`);
  svg.append(svgEl('line', { x1: 0, y1: y(FUEL_PRICE_BASELINE), x2: CHART_WIDTH, y2: y(FUEL_PRICE_BASELINE), class: 'fuel-chart-usual' }));

  // The history's last entry is today; entry i is (length − 1 − i) days ago.
  const firstDay = today - (market.length - 1);
  for (const tranche of tranches) {
    const from = Math.max(0, tranche.startDay - firstDay);
    const to = market.length - 1;
    if (to > from) svg.append(svgEl('line', { x1: x(from), y1: y(tranche.lockedPrice), x2: x(to), y2: y(tranche.lockedPrice), class: 'fuel-chart-rung' }));
  }
  if (market.length > 1) svg.append(polyline(market, x, y, 'fuel-chart-price'));
  if (paid.length > 1) svg.append(polyline(paid, (i) => x(i + market.length - paid.length), y, 'fuel-chart-paid'));
  return svg;
}

/** A price as a chip, green under the market (or usual), red over it. */
function priceChip(label: string, price: number, against: number, tip: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'fuel-chip';
  const gap = price - against;
  chip.classList.toggle('is-good', gap < -0.005);
  chip.classList.toggle('is-bad', gap > 0.005);
  chip.textContent = `${label} ${describeFuelPrice(price)}`;
  chip.dataset.tip = tip;
  return chip;
}

/** Today in one row: the market, what the airline pays, and how much is hedged. */
function todayRow(state: SimState): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fuel-today';
  const market = state.fuelPriceIndex;
  const paid = airlineFuelPrice(state);
  const share = hedgedShare(state);
  const cover = document.createElement('span');
  cover.className = 'fuel-chip fuel-cover';
  cover.style.setProperty('--cover', String(share));
  cover.textContent = `🛡 ${Math.round(share * 100)}%`;
  cover.dataset.tip = `${Math.round(share * 100)}% of fuel hedged today`;
  row.append(
    priceChip('⛽', market, FUEL_PRICE_BASELINE, `Market ${describeFuelPrice(market)} against usual · rivals pay this`),
    priceChip('Paid', paid, market, `You pay ${describeFuelPrice(paid)} · blend of market and locked rungs`),
    cover,
  );
  const surcharge = state.fuelSurcharge ?? 0;
  if (surcharge > 0) {
    const chip = document.createElement('span');
    chip.className = 'fuel-chip is-warn';
    chip.textContent = `🎫 +${Math.round(surcharge * 100)}%`;
    chip.dataset.tip = `Fuel surcharge on policy and stance fares today: +${Math.round(surcharge * 100)}%`;
    row.append(chip);
  }
  return row;
}

/** The running rungs: locked price, a bar of the term left, green if under today's market, red if over. */
function ladder(state: SimState): HTMLElement {
  const today = dayIndex(state);
  const row = document.createElement('div');
  row.className = 'fuel-ladder';
  const tranches = [...activeTranches(state)].sort((a, b) => a.endDay - b.endDay);
  if (tranches.length === 0) {
    row.append(line('No rungs running', 'inspector-line goal-ahead'));
    return row;
  }
  for (const tranche of tranches) {
    const rung = document.createElement('span');
    rung.className = 'fuel-rung';
    const gap = tranche.lockedPrice - state.fuelPriceIndex;
    rung.classList.toggle('is-good', gap < -0.005);
    rung.classList.toggle('is-bad', gap > 0.005);
    const left = tranche.endDay - today;
    const term = tranche.endDay - tranche.startDay;
    rung.style.setProperty('--left', String(left / term));
    rung.textContent = `${describeFuelPrice(tranche.lockedPrice)} · ${left}d`;
    rung.dataset.tip = `${Math.round(tranche.share * 100)}% of fuel locked at ${describeFuelPrice(tranche.lockedPrice)} · day ${tranche.startDay}–${tranche.endDay} · premium ${money(tranche.premium)}`;
    row.append(rung);
  }
  return row;
}

/** The policy's book since it was set, as four coloured cells. */
function book(state: SimState): HTMLElement[] {
  const record = state.fuelBook;
  if (!record) return [line('Set a policy to start a book', 'inspector-line goal-ahead')];
  const net = record.saved - record.premiums + record.surcharge;
  const grid = document.createElement('div');
  grid.className = 'fuel-book';
  const cell = (icon: string, value: number, tip: string) => {
    const el = document.createElement('div');
    el.className = 'fuel-book-cell';
    el.classList.toggle('is-good', value > 0);
    el.classList.toggle('is-bad', value < 0);
    const label = document.createElement('span');
    label.className = 'fuel-book-label';
    label.textContent = icon;
    const amount = document.createElement('span');
    amount.textContent = `${value > 0 ? '+' : ''}${money(value)}`;
    el.append(label, amount);
    el.dataset.tip = tip;
    return el;
  };
  grid.append(
    cell('🛡', record.saved, 'Hedge vs market: what locked rungs saved (or cost) against paying the market'),
    cell('Prem', -record.premiums, 'Premiums paid for rungs'),
    cell('🎫', record.surcharge, 'Fare revenue that was fuel surcharge'),
    cell('Net', net, 'Hedge vs market − premiums + surcharge'),
  );
  const since = line(`Since day ${record.sinceDay} · ${dayIndex(state) - record.sinceDay}d${record.missed > 0 ? ` · ${record.missed} rung${record.missed === 1 ? '' : 's'} missed, no cash` : ''}`, `inspector-line goal-ahead${record.missed > 0 ? ' is-bad' : ''}`);
  return [grid, since];
}

/** When the next rung comes and about what it costs, or why none will. */
function nextRung(state: SimState, policy: FuelPolicy): HTMLElement {
  if (policy.cover <= 0) return line('Cover 0% · no new rungs', 'inspector-line goal-ahead');
  const due = Math.max(dayIndex(state), state.fuelNextRungDay ?? dayIndex(state));
  const premium = money(rungPremium(state, policy));
  const dip = policy.buy === 'dips' ? ` · when ≤ ${describeFuelPrice(FUEL_DIP_PRICE)}` : '';
  return line(`Next rung day ${due}${dip} · ≈${premium} · every ${rungInterval(policy.termDays)}d`, 'inspector-line goal-ahead');
}

/** One dial: a label with its (i), and a button per setting, the one in force lit. */
function dial<T>(label: string, explanation: string, settings: { value: T; text: string; tip: string; blocked?: string | null }[], current: T, pick: (value: T) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fuel-dial';
  const title = document.createElement('div');
  title.className = 'fuel-dial-label';
  title.append(`${label} `, info(explanation));
  const row = document.createElement('div');
  row.className = 'rd-budgets';
  for (const setting of settings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rd-budget';
    button.classList.toggle('is-on', setting.value === current);
    button.textContent = setting.blocked ? `🔒 ${setting.text}` : setting.text;
    button.dataset.tip = setting.blocked ? `${setting.blocked} · ${setting.tip}` : setting.tip;
    button.disabled = Boolean(setting.blocked);
    button.addEventListener('click', () => pick(setting.value));
    row.append(button);
  }
  wrap.append(title, row);
  return wrap;
}

function dials(state: SimState, changed: () => void): HTMLElement[] {
  const policy = fuelPolicyOf(state);
  const set = (change: Partial<FuelPolicy>) => {
    ops.changeFuelPolicy(state, { ...policy, ...change });
    changed();
  };
  const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  return [
    dial(
      'Cover',
      `The share of your fuel kept hedged. It is held as a ladder of ${FUEL_RUNGS} rungs: one is bought every third of the term, each locking its share at that day's price, so the ladder fills over one term. More cover is a steadier bill, and cheap fuel through a spike while rivals pay the market and drop losing routes. It also means premiums on every rung, and staying locked high when fuel falls.`,
      FUEL_COVERS.map((cover) => ({ value: cover, text: `${Math.round(cover * 100)}%`, tip: cover === 0 ? 'No hedging · pay the market' : `Hold ${Math.round(cover * 100)}% hedged` })),
      policy.cover,
      (cover) => set({ cover }),
    ),
    dial(
      'Term',
      'How long each rung locks its price. A longer term blends more days, so what you pay is smoother and lags the market, both up and down. Premiums grow with the term. The banks write 180-day hedges only for an airline with a treasury CFO.',
      FUEL_TERMS.map((termDays) => ({
        value: termDays,
        text: `${termDays}d`,
        tip: `Rungs lock ${termDays}d · premium ${percent(premiumRate(state, termDays))} of fuel covered`,
        blocked: termBlocked(state, termDays),
      })),
      policy.termDays,
      (termDays) => set({ termDays }),
    ),
    dial(
      'Buy',
      `When a rung is due: buy it whatever the price, or wait until fuel dips to ${describeFuelPrice(FUEL_DIP_PRICE)} or under. Prices drift back to usual, so locking on dips locks cheaper. Waiting can leave the ladder empty when a spike runs, which is when cover matters most.`,
      [
        { value: 'any' as const, text: 'Any day', tip: 'Buy each rung on the day it is due' },
        { value: 'dips' as const, text: 'Dips', tip: `Buy a due rung only at ${describeFuelPrice(FUEL_DIP_PRICE)} or under` },
      ],
      policy.buy,
      (buy) => set({ buy }),
    ),
    dial(
      'Surcharge',
      'Pass fuel above the usual price into fares priced by policy or by a stance (a fare set by hand is left alone). It is worked out from the market price each day and comes off when fuel is back to usual. Rivals charge none, so they take passengers where you compete, and they raise their own fares behind yours, which helps them ride out a spike.',
      FUEL_SURCHARGES.map((surcharge) => ({ value: surcharge, text: surcharge === 0 ? 'Off' : surcharge === 1 ? 'Full' : 'Half', tip: surcharge === 0 ? 'No surcharge' : `Pass ${Math.round(surcharge * 100)}% of fuel above usual into fares` })),
      policy.surcharge,
      (surcharge) => set({ surcharge }),
    ),
  ];
}

export function buildFuelView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  root.append(titleWithSwitch('Fuel', moneySwitch('fuel')));

  const policy = fuelPolicyOf(state);
  const history = state.fuelPriceHistory ?? [];
  root.append(
    todayRow(state),
    fuelChart(state),
    line(`${history.length}d · amber market · green paid · dashed usual`, 'inspector-line goal-ahead'),
    heading('Hedges', 'The hedges running now, soonest to end first: the price each locked and the days it has left. Green is locked under today\'s market, red over it.'),
    ladder(state),
    nextRung(state, policy),
    heading('Book', 'How the policy has done since its dials were last changed. Changing a dial starts a new book; rungs already bought run to the end of their term.'),
    ...book(state),
    heading('Policy', 'A standing fuel policy: set it once and it runs every day. The price wanders and drifts back to usual; a fuel spike sends it up for weeks.'),
    ...dials(state, changed),
  );
  return root;
}
