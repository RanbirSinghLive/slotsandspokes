import { CALL_ORDERS, fleetOrder, orderFor, setOrder, type CallOrder } from '../sim/orders';
import type { SimState } from '../sim/state';
import { info } from './inspector/dom';

/**
 * The standing-order buttons (sim/orders.ts): ✋ ask, 🛡 protect, ✂ auto,
 * for one plane or, with no tail, the fleet default. The lit button is the
 * order in force; tapping another sets it. Icons and tips only.
 */
const SYMBOL: Record<CallOrder, string> = { ask: '✋', protect: '🛡', auto: '✂' };
const TIP: Record<CallOrder, string> = {
  ask: 'Ask: stop and let me decide',
  protect: 'Protect: never cancel for it, take the delay',
  auto: 'Auto: swap or cancel the cheaper rotation when the day breaks',
};
export const ORDERS_INFO =
  'What happens when a waiting plane\'s day is about to break (the curfew will cancel a rotation, or a priority flight will fail). ✋ asks you, with a pause if Pause on call is on. 🛡 never asks and never cancels: the plane takes its delay. ✂ settles it without a stop: a swap to an idle plane when that saves a flight for less than the rotation earns, else cancelling the rotation that recovers the most when that earns more than it gives up. A plane that is only late is left alone. A plane\'s own choice beats the fleet default (Game screen). The fleet default also answers a storm forecast for a busy airport: ✋ shows the card, 🛡 flies on, ✂ waives the day when the forecast is above the break-even.';

export function orderButtons(state: SimState, tail: string | null, changed: () => void): HTMLElement {
  const group = document.createElement('span');
  group.className = 'order-buttons';
  const current = tail === null ? fleetOrder(state) : orderFor(state, tail);
  for (const order of CALL_ORDERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = order === current ? 'inspector-plan-hub is-current' : 'inspector-plan-hub';
    button.textContent = SYMBOL[order];
    button.dataset.tip = TIP[order];
    button.setAttribute('aria-label', TIP[order]);
    button.setAttribute('aria-pressed', String(order === current));
    button.addEventListener('click', () => {
      setOrder(state, tail, order);
      changed();
    });
    group.append(button);
  }
  return group;
}

/** The plane page's line: ✋ 🛡 ✂ with an (i), then what ✂ did for this plane lately. */
export function buildOrdersLine(state: SimState, tail: string, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-line order-line';
  root.append(orderButtons(state, tail, changed), ' ', info(ORDERS_INFO));
  const last = (state.orderLog ?? []).filter((entry) => entry.tail === tail).slice(-2);
  for (const entry of last) {
    const text = document.createElement('div');
    text.className = 'inspector-row-detail';
    text.textContent = `✂ d${entry.day} · ${entry.text}`;
    root.append(text);
  }
  return root;
}

/** The Game screen's fleet default, drawn into #fleet-orders. */
export function mountFleetOrders(state: SimState): void {
  const slot = document.querySelector<HTMLElement>('#fleet-orders');
  if (!slot) return;
  slot.replaceChildren('Calls ', orderButtons(state, null, () => mountFleetOrders(state)), ' ', info(ORDERS_INFO));
}
