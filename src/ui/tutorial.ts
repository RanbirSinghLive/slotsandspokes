import type { SimState } from '../sim/state';
import { select, type Selection } from './selection';

/**
 * The first-run tutorial: a click-through over the real screen for a
 * player who has never seen the game. A spotlight dims everything but the
 * thing being explained, and a card beside it says what it is and what to
 * do with it. Most steps move on with Next; the ones where the player does
 * something (choosing a home, drawing a first route) move on by themselves
 * once it's done, with a way to skip.
 *
 * A first visit asks whether to play it; the answer is remembered in
 * localStorage (TUTORIAL_KEY), so it asks once. The Game screen can start
 * it again. Screen state, not game state: nothing here is saved in SimState.
 */

const TUTORIAL_KEY = 'slotsandspokes-tutorial';
/** Below this width the game is cramped; the welcome card says so. */
const DESKTOP_MIN_WIDTH_PX = 900;

type Step = {
  title: string;
  text: string;
  /** What to spotlight: a selector, or none for a card in the middle. */
  target?: string;
  /** Moves on by itself once this is true; the card shows "Skip this step" instead of Next. */
  until?: (state: SimState, choosingHome: boolean) => boolean;
  /** The steps after it mean nothing until it is done, so it can't be skipped alone. */
  required?: boolean;
  /** Runs as the step starts: pause for reading, or run the clock to watch. */
  speed?: 0 | 1;
  /** Opens what the step points at (a screen in the side panel) before it's shown. */
  open?: () => void;
};

/** Open a screen in the side panel and bring a part of it into view, for a step that points inside it. */
function openScreen(selection: Selection, scrollTo?: string): () => void {
  return () => {
    select(selection);
    if (scrollTo) requestAnimationFrame(() => document.querySelector(scrollTo)?.scrollIntoView({ block: 'start' }));
  };
}

const STEPS: Step[] = [
  {
    title: 'Pick your home',
    text: 'Your airline starts with one leased Propeller at the city you choose. Standard homes are the gentlest start; Hard and Brutal ones have thin markets, and more contract help.',
    target: '#home-picker-modal .modal-box',
    until: (_state, choosingHome) => !choosingHome,
    required: true,
  },
  {
    title: 'Your airline',
    text: "This is the map: your home, and the airports a Propeller can reach from it. Everything you'll build, you build here.",
    target: '#map-surface',
    speed: 0,
  },
  {
    title: 'Fly your first route',
    text: 'Click your home airport to open its ring, choose Draw route (with more than one type there, pick which), then click another airport and press ✓. The game times the flights for you.',
    target: '#map-surface',
    until: (state) => state.schedule.length > 0,
  },
  {
    title: 'The clock',
    text: 'Your airline runs on its home clock. Speed up with 20× or 100× when things are quiet; Space pauses.',
    target: '#hud',
  },
  {
    title: "Today's operation",
    text: 'DEP · AIR · TO GO · LATE · CNX is how today is going. The bars under it are each day: green made money, red lost it. Hover them for the whole chart.',
    target: '#hud',
  },
  {
    title: 'Read the map',
    text: 'Lenses recolour the map: Profit shows which routes pay, On-time which run late, Demand where people want to fly, Rivals who flies against you, Cargo which airports make what others need.',
    target: '#map-tools',
  },
  {
    title: 'Every screen, one click',
    text: 'The rail has everything: Routes and fares, Fleet to lease planes, Crews, Money, Goals, and Office for fuel, contracts and executives. A dot means something wants a look.',
    target: '#rail',
  },
  {
    title: 'The Schedule',
    text: "Each plane's day, flight by flight, grouped by type; the airport between flights is where it waits on the ground. You never have to touch it. When you want to, drag a rotation left or right to move it in the day, or onto another plane of its type.",
    target: '#rotations-section',
    open: openScreen({ kind: 'fleet' }, '#rotations-section'),
  },
  {
    title: 'Hours fill up',
    text: "A busy airport fills at its peaks first (07:00, 17:00). A full hour takes no new flights, so the planner starts yours at the next hour with room. Peak flights carry more business travellers and cost more in slots; off-peak ones are cheap and mostly leisure. Click an airport to see its hours.",
    target: '#rotations-section',
  },
  {
    title: 'Crews and maintenance',
    text: 'Crews are rated for one type and based where your planes are: hire them ahead of each new plane (or from an airport ring). Mtc shows any plane grounded by a fault (AOG), what it cancels, and the fleet\'s health.',
    target: '#rail .rail-item[data-go="maintenance"]',
  },
  {
    title: 'Head office',
    text: 'Fuel and hedging, contracts, three executive chairs to fill (click one to meet its candidates), and the innovations each rung of the ladder opens, as a tree.',
    target: '#rail .rail-item[data-go="headOffice"]',
  },
  {
    title: 'Aim for the next rung',
    text: 'Goals is a ladder of milestones. Meet them to become a bigger airline, and unlock bigger aircraft.',
    target: '#rail .rail-item[data-go="goals"]',
  },
  {
    title: 'Build something that lasts',
    text: "Profit draws rivals, so every edge fades, and the bigger you get the more come looking. Keep routes full and on time, grow before a rival copies you, and never let cash reach $0: that ends the airline. At day 365 you get your year one report. Good luck.",
  },
];

let steps: Step[] = [];
let index = -1;
let controls: { setSpeed: (speed: 0 | 1) => void } | null = null;

const spotlight = document.createElement('div');
spotlight.id = 'tutorial-spotlight';
spotlight.hidden = true;
const card = document.createElement('div');
card.id = 'tutorial-card';
card.hidden = true;
document.body.append(spotlight, card);

function remember(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, 'seen');
  } catch {
    // A browser that won't store it just asks again next time.
  }
}

function seen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) !== null;
  } catch {
    return false;
  }
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

/** Whether a step's own action is done, in which case it's skipped over. */
let lastState: { state: SimState; choosingHome: boolean } | null = null;

/** Show step `next`, passing over any hands-on step already done (a home already chosen) in the direction of travel. */
function show(next: number, direction: 1 | -1 = 1): void {
  while (next < steps.length && next >= 0 && lastState && steps[next].until?.(lastState.state, lastState.choosingHome)) next += direction;
  index = next;
  if (index >= steps.length) {
    end();
    return;
  }
  // Back past the first step that still applies: stay on the first one.
  if (index < 0) {
    show(0);
    return;
  }
  const step = steps[index];
  if (step.speed !== undefined) controls?.setSpeed(step.speed);
  step.open?.();

  const count = document.createElement('div');
  count.className = 'tutorial-count';
  count.textContent = `${index + 1} / ${steps.length}`;
  const title = document.createElement('h3');
  title.textContent = step.title;
  const text = document.createElement('p');
  text.textContent = step.text;
  const actions = document.createElement('div');
  actions.className = 'tutorial-actions';
  actions.append(button('Skip tutorial', 'tutorial-skip', end));
  if (index > 0) actions.append(button('Back', 'tutorial-back', () => show(index - 1, -1)));
  if (step.required) {
    // No way on from here but doing it: the picker is the only thing on screen.
  } else if (step.until) {
    actions.append(button('Skip this step', 'tutorial-next', () => show(index + 1)));
  } else {
    actions.append(button(index === steps.length - 1 ? 'Start playing' : 'Next', 'tutorial-next', () => show(index + 1)));
  }
  card.replaceChildren(count, title, text, actions);
  card.classList.remove('is-centred');
  card.hidden = false;
  place();
}

/** Put the spotlight on the step's target and the card beside it, clear of the screen's edges. */
function place(): void {
  const step = steps[index];
  if (!step) return;
  const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
  const rect = target && !target.hidden ? target.getBoundingClientRect() : null;
  const margin = 8;
  if (rect && rect.width > 0) {
    spotlight.hidden = false;
    spotlight.style.left = `${rect.left - margin}px`;
    spotlight.style.top = `${rect.top - margin}px`;
    spotlight.style.width = `${rect.width + margin * 2}px`;
    spotlight.style.height = `${rect.height + margin * 2}px`;
  } else {
    spotlight.hidden = true;
  }
  // The card goes below the target if there's room, else above, else inside it; in the middle with no target.
  const box = card.getBoundingClientRect();
  let left: number;
  let top: number;
  if (!rect || rect.width > window.innerWidth * 0.6) {
    left = (window.innerWidth - box.width) / 2;
    top = rect ? Math.max(margin, rect.bottom - box.height - 80) : (window.innerHeight - box.height) / 2;
  } else if (rect.left > window.innerWidth * 0.6) {
    left = rect.left - box.width - 20;
    top = rect.top + 20;
  } else {
    left = rect.left;
    top = rect.bottom + 18 + box.height < window.innerHeight ? rect.bottom + 18 : Math.max(margin, rect.top - box.height - 18);
  }
  card.style.left = `${Math.min(Math.max(margin, left), window.innerWidth - box.width - margin)}px`;
  card.style.top = `${Math.min(Math.max(margin, top), window.innerHeight - box.height - margin)}px`;
}

function end(): void {
  remember();
  spotlight.hidden = true;
  card.hidden = true;
  card.classList.remove('is-centred');
  const wasRunning = index >= 0;
  index = -1;
  steps = [];
  // Back to the game at normal speed, unless a home is still to be chosen.
  if (wasRunning && lastState && !lastState.choosingHome) controls?.setSpeed(1);
}

/** Start the tutorial from the first step that isn't already done. */
export function startTutorial(): void {
  steps = STEPS;
  show(0);
}

export function isTutorialRunning(): boolean {
  return index >= 0;
}

/**
 * On a first visit, ask whether to play the tutorial (and, on a narrow
 * screen, say the game wants a desktop). `setSpeed` lets the tutorial
 * pause for reading and run the clock again at the end.
 */
export function setupTutorial(setSpeed: (speed: 0 | 1) => void): void {
  controls = { setSpeed };
  window.addEventListener('resize', place);
  if (seen()) return;
  const welcome = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = 'Welcome to Slots & Spokes';
  const text = document.createElement('p');
  text.textContent =
    'Build an airline on a real map, find the passengers nobody is flying, and stay a step ahead of rivals. New here? The tutorial takes about two minutes.';
  welcome.append(title, text);
  if (window.innerWidth < DESKTOP_MIN_WIDTH_PX) {
    const narrow = document.createElement('p');
    narrow.className = 'tutorial-note';
    narrow.textContent = 'On a small screen: tap an icon to read its name, and pinch to zoom the map.';
    welcome.append(narrow);
  }
  const actions = document.createElement('div');
  actions.className = 'tutorial-actions';
  actions.append(
    button('Skip the tutorial', 'tutorial-skip', end),
    button('Play the tutorial', 'tutorial-next', startTutorial),
  );
  welcome.append(actions);
  card.replaceChildren(...welcome.childNodes);
  // Centred by CSS, so it stays centred however the window changes.
  card.classList.add('is-centred');
  card.hidden = false;
  spotlight.hidden = true;
}

/**
 * Called every frame from main.ts's render(): moves a hands-on step on once
 * its action is done, and keeps the spotlight on its target as the layout
 * shifts (the panel opening, the window resizing).
 */
export function updateTutorial(state: SimState, choosingHome: boolean): void {
  lastState = { state, choosingHome };
  if (index < 0) return;
  const step = steps[index];
  if (step?.until?.(state, choosingHome)) {
    show(index + 1);
    return;
  }
  place();
}
