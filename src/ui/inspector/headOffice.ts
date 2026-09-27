import { dayIndex } from '../../sim/clock';
import { FUEL_PRICE_BASELINE } from '../../sim/fuel';
import { activeHedge, describeFuelPrice } from '../../sim/fuelPrice';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import type { InnovationOption } from '../routeActions';

/**
 * The Head office view (Network › Head office): the airline's decisions
 * that aren't made on the map. Fuel, with its price chart and the hedge
 * (sim/fuelPrice.ts), and the innovations the ladder opens
 * (sim/innovations.ts). Executives join them in WEEK-TEN.md's thread 8.
 */

function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/** One innovation: what it does and costs, and a button to adopt it, or why it can't be yet. */
function innovationCard(state: SimState, option: InnovationOption, changed: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'innovation-card';
  card.classList.toggle('is-adopted', option.adopted);
  card.classList.toggle('is-locked', !option.adopted && option.blocked !== null);
  const name = document.createElement('div');
  name.className = 'innovation-name';
  name.textContent = option.adopted ? `✓ ${option.name}` : option.name;
  const price = [option.oneOffPrice > 0 ? `${money(option.oneOffPrice)} once` : null, option.runningCost]
    .filter(Boolean)
    .join(', then ');
  const status = option.adopted ? (option.runningCost ? `Running: ${option.runningCost}.` : 'Adopted.') : `Costs ${price}.`;
  card.append(name, line(option.description), line(status, 'inspector-line innovation-price'));
  if (option.adopted) return card;

  if (option.blocked) {
    card.append(line(option.blocked, 'inspector-line goal-ahead'));
    return card;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = `Adopt ${option.name.toLowerCase()}`;
  // Two clicks, since it can't be undone and a running cost runs for good.
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = option.runningCost
        ? `Click again to adopt. It can't be dropped: ${option.runningCost} from now on.`
        : `Click again to pay ${money(option.oneOffPrice)}. It can't be undone.`;
      button.classList.add('is-act');
      return;
    }
    ops.adoptInnovation(state, option.id);
    changed();
  });
  card.append(button);
  return card;
}

const SVG = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 300;
const CHART_HEIGHT = 90;

function svgLine(x1: number, y1: number, x2: number, y2: number, className: string): SVGLineElement {
  const el = document.createElementNS(SVG, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('class', className);
  return el;
}

/**
 * The market price over the last days, with the usual price dashed and a
 * running hedge's locked price as a line across the days it covers. An
 * SVG built as DOM, like any other panel element: the canvas is the map's.
 */
function fuelChart(state: SimState): SVGSVGElement {
  const history = state.fuelPriceHistory ?? [];
  const hedge = state.fuelHedge;
  const today = dayIndex(state);
  const values = [...history, FUEL_PRICE_BASELINE, ...(hedge ? [hedge.lockedPrice] : [])];
  const low = Math.min(...values) - 0.05;
  const high = Math.max(...values) + 0.05;
  const days = Math.max(history.length, 2);
  const x = (i: number) => (i / (days - 1)) * CHART_WIDTH;
  const y = (price: number) => CHART_HEIGHT - ((price - low) / (high - low)) * CHART_HEIGHT;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('class', 'fuel-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Fuel price over the last ${history.length} days`);
  svg.append(svgLine(0, y(FUEL_PRICE_BASELINE), CHART_WIDTH, y(FUEL_PRICE_BASELINE), 'fuel-chart-usual'));

  // The history's last entry is today; entry i is (length − 1 − i) days ago.
  if (hedge) {
    const firstDay = today - (history.length - 1);
    const from = Math.max(0, hedge.startDay - firstDay);
    const to = Math.min(history.length - 1, hedge.endDay - 1 - firstDay);
    if (to >= from) svg.append(svgLine(x(from), y(hedge.lockedPrice), x(to), y(hedge.lockedPrice), 'fuel-chart-hedge'));
  }
  if (history.length > 1) {
    const path = document.createElementNS(SVG, 'polyline');
    path.setAttribute('points', history.map((price, i) => `${x(i).toFixed(1)},${y(price).toFixed(1)}`).join(' '));
    path.setAttribute('class', 'fuel-chart-price');
    svg.append(path);
  }
  return svg;
}

/** Where the hedge stands: running and what it has saved, or how the last one ended. */
function hedgeStatus(state: SimState): HTMLElement | null {
  const hedge = state.fuelHedge;
  if (!hedge) return null;
  const net = hedge.saved - hedge.premium;
  const result = `${hedge.saved >= 0 ? 'saved' : 'cost'} ${money(Math.abs(hedge.saved))} against the market, for a ${money(hedge.premium)} premium: ${net >= 0 ? 'up' : 'down'} ${money(Math.abs(net))}`;
  if (activeHedge(state)) {
    return line(`Hedged at ${describeFuelPrice(hedge.lockedPrice)} until day ${hedge.endDay}. So far it has ${result}.`, `inspector-line ${net >= 0 ? 'is-good' : ''}`);
  }
  return line(`Your last hedge (days ${hedge.startDay} to ${hedge.endDay}) ${result}.`);
}

/** One button per hedge length, each two clicks since the premium is spent for good. */
function hedgeButtons(state: SimState, changed: () => void): HTMLElement[] {
  const options = ops.hedgeOptions(state);
  const blocked = options.find((option) => option.blocked)?.blocked;
  if (options.every((option) => option.blocked)) return blocked ? [line(blocked, 'inspector-line goal-ahead')] : [];
  return options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    button.textContent = `Hedge ${option.days} days: ${money(option.premium)}`;
    button.disabled = option.blocked !== null;
    let armed = false;
    button.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        button.textContent = `Click again to pay ${money(option.premium)} and lock ${describeFuelPrice(option.lockedPrice)} until day ${dayIndex(state) + option.days}.`;
        button.classList.add('is-act');
        return;
      }
      ops.hedgeFuel(state, option.days);
      changed();
    });
    return button;
  });
}

/** One line for the Network view: today's fuel price, and whether it's hedged. */
export function headOfficeSummary(state: SimState): string {
  const hedge = activeHedge(state);
  return `Fuel ${describeFuelPrice(state.fuelPriceIndex)}${hedge ? ` · hedged to day ${hedge.endDay}` : ''}`;
}

export function buildHeadOfficeView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Head office';
  root.append(title);

  const history = state.fuelPriceHistory ?? [];
  root.append(
    heading('Fuel'),
    line(`Fuel today: ${describeFuelPrice(state.fuelPriceIndex)} against the usual price. It wanders from day to day and drifts back, and a fuel spike sends it up for weeks.`),
    fuelChart(state),
    line(`The last ${history.length} day${history.length === 1 ? '' : 's'}. Dashed: the usual price.${state.fuelHedge ? ' Green: your locked price.' : ''}`, 'inspector-line goal-ahead'),
  );
  const status = hedgeStatus(state);
  if (status) root.append(status);
  root.append(
    line("A hedge locks today's price on all your fuel. If fuel rises, you pay less than the market; if it falls, you still pay today's price. The premium is spent either way, so hedging at random loses money: it's a bet on where the price goes."),
    ...hedgeButtons(state, changed),
  );

  root.append(
    heading('Innovations'),
    line('Programmes the ladder opens (see Goals). Each is yours to adopt, for good, if it pays for your airline.'),
    ...ops.innovationOptions(state).map((option) => innovationCard(state, option, changed)),
  );
  return root;
}
