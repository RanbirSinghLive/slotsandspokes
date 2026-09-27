import type { MapPreview } from '../render/preview';

/**
 * The one radial menu every map click uses: a ring of circular buttons
 * around a point, real DOM positioned over the canvas (CLAUDE.md: never
 * draw a control inside the canvas). It knows nothing about airports or
 * routes. Callers describe a ring as a list of actions and get told when
 * one is hovered or chosen, which is what lets a new kind of thing on the
 * map get a menu by writing a list rather than a new widget.
 *
 * The grammar, deliberately small:
 * - Each action sits at a fixed angle, so a verb is always in the same
 *   place and the player's hand learns it.
 * - An action with `children` opens a fan of choices around itself (the
 *   parent stays lit). Nothing nests deeper than that.
 * - A disabled action is still hoverable and says why. Reasons are for
 *   the player to act on ("No Regional based at YUL"), not error codes.
 * - A `confirm` action takes two clicks. Only destructive things use it.
 */

export type RadialAction = {
  id: string;
  /** What the button does, shown while it is hovered. */
  label: string;
  /** Inner markup of a 24x24 stroke icon. */
  icon: string;
  /** Position on the ring, degrees clockwise from 3 o'clock (-90 is straight up). Children ignore this. */
  angleDeg: number;
  /** A bigger icon, for buttons whose picture has to carry detail. */
  large?: boolean;
  /** Present means the action can't be used right now, and why. */
  disabledReason?: string;
  confirm?: boolean;
  /** Lit as the current choice, for a fan of mutually exclusive settings (a route's turn buffer). */
  selected?: boolean;
  /**
   * Holding the button fires it again and again (after a short delay, then
   * on an interval) instead of once. For things like "add a flight" where
   * doing it five times in a row is the normal case, so the player doesn't
   * have to peck at the same spot repeatedly. Each repeat looks the action
   * up again by id (see `findActionById`) rather than reusing this object,
   * because a render happens after every fire and this object is thrown
   * away with it — that fresh lookup is also what makes holding stop
   * itself the instant the button would be disabled (fleet out of room,
   * demand check failing, whatever it is), instead of needing its own
   * capacity check.
   */
  repeatable?: boolean;
  children?: RadialAction[];
  /** What the map should show while this action is hovered (never for a disabled one). */
  preview?: MapPreview;
  /** Runs when chosen. Return true to close the menu afterwards. */
  onSelect?: () => boolean | void;
};

export type RadialSpec = {
  /** Screen position the ring is centred on. */
  x: number;
  y: number;
  actions: RadialAction[];
  /** Called with what to show while a button is hovered (null when none), and whether it is a problem. */
  onHint: (text: string | null, isProblem: boolean) => void;
  /** Called with the hovered action's preview, or null when the pointer leaves. */
  onPreview?: (preview: MapPreview | null) => void;
};

const RING_RADIUS_PX = 56;
const FAN_RADIUS_PX = 100;
const FAN_STEP_DEG = 26;
const EDGE_MARGIN_PX = 20;
const REPEAT_DELAY_MS = 450;
const REPEAT_INTERVAL_MS = 130;

const menuEl = document.querySelector<HTMLDivElement>('#radial-menu')!;

let current: RadialSpec | null = null;
let openParentId: string | null = null;
let armedId: string | null = null;
let repeatingId: string | null = null;
let repeatDelayTimer: ReturnType<typeof setTimeout> | null = null;
let repeatIntervalTimer: ReturnType<typeof setInterval> | null = null;

export function hideRadial(): void {
  current?.onPreview?.(null);
  stopRepeat();
  menuEl.hidden = true;
  menuEl.innerHTML = '';
  current = null;
  openParentId = null;
  armedId = null;
}

/** Find a repeatable action back by id after a render replaced the object holding it. */
function findActionById(id: string): RadialAction | null {
  if (!current) return null;
  for (const action of current.actions) {
    if (action.id === id) return action;
    const child = action.children?.find((c) => c.id === id);
    if (child) return child;
  }
  return null;
}

function stopRepeat(): void {
  if (repeatDelayTimer !== null) clearTimeout(repeatDelayTimer);
  if (repeatIntervalTimer !== null) clearInterval(repeatIntervalTimer);
  repeatDelayTimer = null;
  repeatIntervalTimer = null;
  repeatingId = null;
}

// One listener for the whole page rather than one per button: the button
// under the pointer gets replaced by a render partway through a hold (see
// the big comment on `repeatable`), so there is no single element left to
// attach a mouseup handler to by the time the hold ends.
document.addEventListener('mouseup', stopRepeat);

function fireRepeat(spec: RadialSpec): void {
  const action = repeatingId ? findActionById(repeatingId) : null;
  if (!action || action.disabledReason) {
    stopRepeat();
    return;
  }
  choose(action, spec);
}

function startRepeat(action: RadialAction, spec: RadialSpec): void {
  stopRepeat();
  repeatingId = action.id;
  repeatDelayTimer = setTimeout(() => {
    repeatDelayTimer = null;
    repeatIntervalTimer = setInterval(() => fireRepeat(spec), REPEAT_INTERVAL_MS);
  }, REPEAT_DELAY_MS);
}

export function showRadial(spec: RadialSpec): void {
  current = spec;
  openParentId = null;
  armedId = null;
  render();
}

/** Swap in a rebuilt list after something changed, keeping any fan that is open. */
export function updateRadial(actions: RadialAction[]): void {
  if (!current) return;
  current = { ...current, actions };
  armedId = null;
  render();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function place(button: HTMLButtonElement, angleDeg: number, radius: number, spec: RadialSpec, mapWidth: number): void {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = clamp(Math.cos(angle) * radius, EDGE_MARGIN_PX - spec.x, mapWidth - spec.x - EDGE_MARGIN_PX);
  const dy = clamp(Math.sin(angle) * radius, EDGE_MARGIN_PX - spec.y, window.innerHeight - spec.y - EDGE_MARGIN_PX);
  button.style.left = `${dx}px`;
  button.style.top = `${dy}px`;
}

function buildButton(action: RadialAction, spec: RadialSpec): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'radial-button';
  button.setAttribute('aria-label', action.label);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${action.icon}</svg>`;

  // aria-disabled and a class rather than the `disabled` attribute: a
  // disabled button gets no hover events, and the whole point of a
  // disabled action here is that hovering it explains itself.
  if (action.disabledReason) {
    button.classList.add('disabled');
    button.setAttribute('aria-disabled', 'true');
  }
  if (action.large) button.classList.add('large');
  if (action.id === openParentId || action.selected) button.classList.add('active');
  if (action.id === armedId) button.classList.add('confirming');

  // A button waiting for its second click keeps saying so, since the ring
  // is rebuilt under the pointer when it arms and re-fires the hover.
  button.addEventListener('mouseenter', () => {
    spec.onPreview?.(action.disabledReason ? null : (action.preview ?? null));
    if (action.id === armedId) spec.onHint(`Click again to confirm: ${action.label}`, true);
    else spec.onHint(action.disabledReason ?? action.label, !!action.disabledReason);
  });
  button.addEventListener('mouseleave', () => {
    spec.onPreview?.(null);
    spec.onHint(null, false);
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    choose(action, spec);
  });
  // The click listener above already fires the first press. This only
  // arms the *continuation*: if the button is still held REPEAT_DELAY_MS
  // later, start firing it again on an interval. A normal tap releases
  // well before the delay elapses, so it behaves exactly as before.
  if (action.repeatable) {
    button.addEventListener('mousedown', (event) => {
      if (action.disabledReason) return;
      event.stopPropagation();
      startRepeat(action, spec);
    });
  }
  return button;
}

function choose(action: RadialAction, spec: RadialSpec): void {
  if (action.disabledReason) {
    spec.onHint(action.disabledReason, true);
    return;
  }

  if (action.children) {
    openParentId = openParentId === action.id ? null : action.id;
    armedId = null;
    render();
    return;
  }

  if (action.confirm && armedId !== action.id) {
    armedId = action.id;
    spec.onHint(`Click again to confirm: ${action.label}`, true);
    render();
    return;
  }

  armedId = null;
  const close = action.onSelect?.();
  if (close) hideRadial();
}

function render(): void {
  if (!current) return;
  const spec = current;
  const mapWidth = document.querySelector<HTMLCanvasElement>('#map')!.getBoundingClientRect().width;

  menuEl.innerHTML = '';
  menuEl.style.left = `${spec.x}px`;
  menuEl.style.top = `${spec.y}px`;

  for (const action of spec.actions) {
    const button = buildButton(action, spec);
    place(button, action.angleDeg, RING_RADIUS_PX, spec, mapWidth);
    menuEl.appendChild(button);

    if (action.id !== openParentId || !action.children) continue;
    const count = action.children.length;
    action.children.forEach((child, i) => {
      const childButton = buildButton(child, spec);
      place(childButton, action.angleDeg + (i - (count - 1) / 2) * FAN_STEP_DEG, FAN_RADIUS_PX, spec, mapWidth);
      menuEl.appendChild(childButton);
    });
  }

  menuEl.hidden = false;
}
