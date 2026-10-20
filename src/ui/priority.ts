import { callPolicy, nextRoutePriority, routePriority, setCallPolicy, setRoutePriority, type CallPolicy, type RoutePriority } from '../sim/priority';
import type { SimState } from '../sim/state';
import { info } from './inspector/dom';

/**
 * Route priority (sim/priority.ts) on the page: one icon per route that
 * cycles ● normal → ★ keep → ▽ expendable, and the fleet policy switch on
 * the Game screen. Icons and tips only.
 */
const SYMBOL: Record<RoutePriority, string> = { normal: '●', keep: '★', expendable: '▽' };
const TIP: Record<RoutePriority, string> = {
  normal: 'Normal: cut only when the flights it saves are worth more',
  keep: 'Keep: never cut for a late plane, takes the delay; requests offered here are accepted',
  expendable: 'Expendable: first to be cut when a day breaks',
};
const POLICY_SYMBOL: Record<CallPolicy, string> = { priority: '★', ask: '✋' };
const POLICY_TIP: Record<CallPolicy, string> = {
  priority: 'Priority: the controller settles a breaking day by route priority, no stop',
  ask: 'Ask: stop and let me decide',
};
export const PRIORITY_INFO =
  'Rank a route once and the controller uses it when a day breaks (the 22:00 curfew will cancel a rotation, or a request flight will fail). ★ keep is never cut: the plane takes its delay, and requests offered on it are accepted. ● normal is cut only when the flights it saves are worth more than it gives up. ▽ expendable goes first whenever its loss saves a flight. A swap to an idle plane is tried before any cut. A plane that is only late is left alone. Tap the icon to cycle. Priority on the Game screen settles it with no stop; ✋ ask stops and lets you decide (with a pause if Pause on call is on). The same policy answers a storm forecast: a busy airport with a ★ route flies on; otherwise the day is waived when the forecast is above the break-even. Yesterday\'s cuts are listed in the morning brief.';

/** One tap-to-cycle icon for the route `a`–`b`; `changed` runs after a tap so the page can redraw. */
export function priorityButton(state: SimState, a: string, b: string, changed: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const paint = (): void => {
    const priority = routePriority(state, a, b);
    button.className = `priority-button is-${priority}`;
    button.textContent = SYMBOL[priority];
    button.dataset.tip = TIP[priority];
    button.setAttribute('aria-label', TIP[priority]);
  };
  paint();
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setRoutePriority(state, a, b, nextRoutePriority(routePriority(state, a, b)));
    paint();
    changed();
  });
  return button;
}

/** The Game screen's fleet policy, drawn into #fleet-orders. */
export function mountCallPolicy(state: SimState): void {
  const slot = document.querySelector<HTMLElement>('#fleet-orders');
  if (!slot) return;
  const group = document.createElement('span');
  group.className = 'order-buttons';
  for (const policy of ['priority', 'ask'] as CallPolicy[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = policy === callPolicy(state) ? 'inspector-plan-hub is-current' : 'inspector-plan-hub';
    button.textContent = POLICY_SYMBOL[policy];
    button.dataset.tip = POLICY_TIP[policy];
    button.setAttribute('aria-label', POLICY_TIP[policy]);
    button.setAttribute('aria-pressed', String(policy === callPolicy(state)));
    button.addEventListener('click', () => {
      setCallPolicy(state, policy);
      mountCallPolicy(state);
    });
    group.append(button);
  }
  slot.replaceChildren('Calls ', group, ' ', info(PRIORITY_INFO));
}
