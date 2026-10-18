import { cashRunway } from '../sim/forecast';
import { crewBases } from '../sim/crews';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { scheduleProblems } from './panels';
import * as ops from './routeActions';
import { RUNWAY_WARN_DAYS } from './runway';
import { getSelection, select, type Selection } from './selection';
import { contractsOf, faceOf, takeoverOpen } from '../sim/contracts';
import { anyEntryShort } from '../sim/crewPlan';

/**
 * The rail down the side panel's left edge: every screen one click away,
 * and still there with the panel hidden, when clicking an item slides the
 * panel open straight to it. Clicking the screen already showing hides
 * the panel, so the rail is also the panel's handle.
 *
 * A dot on an item says where to dig before clicking. Two kinds:
 *   - a condition, lit while it lasts: a plane out or a schedule problem
 *     (Fleet, red), a plane AOG (Mtc, red), a class short of crews (Crews, red; stretched, or a
 *     plane on its way that would enter service short, amber),
 *     a route that lost money yesterday (Routes, amber), cash running out
 *     within a month (Money, red), a running contract whose buyer is sad
 *     (Contracts, amber; red once a rival circles it);
 *   - something new since the screen was last open, like unread mail: a
 *     milestone met (Goals, green), a rival on one of your markets
 *     (Rivals, amber), an executive or innovation newly on
 *     offer (Office, green), a contract newly out to tender (Contracts, green). Opening the screen reads it.
 * The first look only records what's there, so loading a game lights no
 * "new" dots.
 */

const railEl = document.querySelector<HTMLElement>('#rail')!;
const items = [...railEl.querySelectorAll<HTMLButtonElement>('.rail-item[data-go]')];
const hideButton = railEl.querySelector<HTMLButtonElement>('#rail-hide')!;

type Screen = 'network' | 'routes' | 'airports' | 'fleet' | 'product' | 'crews' | 'maintenance' | 'rivals' | 'money' | 'goals' | 'contracts' | 'headOffice' | 'game';

/** Where each rail item goes. Routes opens worst margin first. */
function targetOf(screen: Screen): Selection {
  return screen === 'routes' ? { kind: 'routes', sort: 'margin' } : ({ kind: screen } as Selection);
}

/** The rail item a selection sits under, the one lit while it shows. */
function screenOf(selection: Selection): Screen {
  switch (selection.kind) {
    case 'route':
    case 'routes':
      return 'routes';
    case 'airport':
      return 'airports';
    case 'aircraft':
      return 'fleet';
    case 'rival':
      return 'rivals';
    default:
      return selection.kind;
  }
}

export function setupRail(panel: { isHidden: () => boolean; setHidden: (hidden: boolean) => void }): void {
  for (const item of items) {
    item.addEventListener('click', () => {
      const screen = item.dataset.go as Screen;
      if (!panel.isHidden() && screenOf(getSelection()) === screen) {
        panel.setHidden(true);
        return;
      }
      if (panel.isHidden()) panel.setHidden(false);
      select(targetOf(screen));
    });
  }
  hideButton.addEventListener('click', () => panel.setHidden(!panel.isHidden()));
}

type Dot = 'bad' | 'warn' | 'good' | null;

/** What each "new" dot compares against: the ids seen when its screen was last open. */
const seen: Partial<Record<Screen, Set<string>>> = {};

/** Ids now, for the screens whose dot means "something new". */
function newsIds(state: SimState): Partial<Record<Screen, string[]>> {
  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const offers = [
    ...ops.executiveOptions(state).flatMap((chair) => chair.candidates.filter((c) => !c.blocked).map((c) => `exec:${c.id}`)),
    ...ops.innovationOptions(state).filter((option) => !option.adopted && !option.blocked).map((option) => `innovation:${option.id}`),
  ];
  return {
    goals: Object.keys(state.milestonesMet ?? {}),
    rivals: state.competitorRoutes.filter((route) => flown.has(marketKey(route.origin, route.dest))).map((route) => `${route.code}:${marketKey(route.origin, route.dest)}`),
    headOffice: offers,
    contracts: contractsOf(state).filter((c) => c.status === 'offered').map((c) => `contract:${c.id}`),
  };
}

export function conditions(state: SimState): Partial<Record<Screen, Dot>> {
  const fleetBad = state.groundedTails.length > 0 || scheduleProblems(state).length > 0;
  let crews: Dot = null;
  for (const iata of Object.keys(crewBases(state))) {
    for (const crew of ops.crewReadout(state, iata)?.classes ?? []) {
      if (crew.crews < crew.minimum) crews = 'bad';
      else if (crew.crews < crew.ideal && crews === null) crews = 'warn';
    }
  }
  // A plane on its way that would enter service short is a job to do now.
  if (crews === null && anyEntryShort(state)) crews = 'warn';
  const markets = new Map(state.schedule.map((leg) => [marketKey(leg.origin, leg.dest), leg]));
  const losing = [...markets.values()].some((leg) => {
    const margins = ops.marketPnlHistory(state, leg.origin, leg.dest).margin;
    return margins.length > 0 && margins[margins.length - 1] < 0;
  });
  const runway = cashRunway(state)?.daysLeft ?? null;
  return {
    fleet: fleetBad ? 'bad' : null,
    crews,
    maintenance: state.aogs.length > 0 ? 'bad' : null,
    contracts: contractsOf(state).some(takeoverOpen) ? 'bad' : contractsOf(state).some((c) => c.status === 'active' && faceOf(c) === 'sad') ? 'warn' : null,
    routes: losing ? 'warn' : null,
    money: runway !== null && runway <= RUNWAY_WARN_DAYS ? 'bad' : null,
  };
}

/** What each condition dot is called on the Overview's Attention card, worst first, with the screen that fixes it. */
const ATTENTION: { screen: Screen; short: (state: SimState) => string }[] = [
  { screen: 'maintenance', short: (state) => `${state.aogs.length} AOG` },
  { screen: 'fleet', short: () => 'fleet' },
  { screen: 'crews', short: () => 'crews' },
  { screen: 'contracts', short: () => 'contracts' },
  { screen: 'money', short: () => 'cash' },
  { screen: 'routes', short: () => 'losing routes' },
];

const attentionCardEl = document.querySelector<HTMLElement>('#card-attention')!;
const attentionValueEl = document.querySelector<HTMLElement>('#panel-attention')!;
const attentionLineEl = attentionCardEl.querySelector<HTMLElement>('.stat-trend')!;
const fleetValueEl = document.querySelector<HTMLElement>('#panel-fleet')!;
const fleetCardEl = document.querySelector<HTMLElement>('#card-fleet')!;
const fleetLineEl = fleetCardEl.querySelector<HTMLElement>('.stat-trend')!;
let attentionTarget: Selection = { kind: 'fleet' };
attentionCardEl.addEventListener('click', () => select(attentionTarget));

/** The Overview's Attention and Fleet cards: the rail's condition dots as words, so the cause of a falling card is on the same page. */
function updateOverviewCards(state: SimState, dots: Partial<Record<Screen, Dot>>): void {
  const problems = ATTENTION.filter((entry) => dots[entry.screen] === 'bad' || dots[entry.screen] === 'warn');
  attentionCardEl.dataset.trend = problems.length === 0 ? 'better' : problems.some((entry) => dots[entry.screen] === 'bad') ? 'worse' : 'steady';
  attentionValueEl.textContent = problems.length === 0 ? 'All clear' : `${problems.length} to fix`;
  attentionLineEl.textContent = problems.map((entry) => entry.short(state)).join(' · ');
  attentionCardEl.dataset.tip = problems.length === 0 ? 'Nothing needs you: no plane out, crews covered, no route losing money, cash safe' : 'Open the first one: planes out, crews short, contracts, cash, losing routes';
  attentionTarget = problems.length === 0 ? { kind: 'network' } : targetOf(problems[0].screen);

  const flying = state.aircraft.filter((aircraft) => aircraft.status === 'airborne').length;
  fleetValueEl.textContent = `${state.aircraft.length} aircraft`;
  fleetLineEl.textContent = `${flying} flying · ${state.aogs.length} AOG`;
}

const NEWS_DOT: Partial<Record<Screen, Dot>> = { goals: 'good', rivals: 'warn', headOffice: 'good', contracts: 'good' };
/** How often the dots are worked out: they read a lot of state, and nothing they show moves faster than this. */
const DOT_INTERVAL_MS = 500;
let lastDotsAt = -Infinity;

/** `open` is the screen showing, read as it stands; null with the panel hidden. */
function updateDots(state: SimState, open: Screen | null, now: number): void {
  if (now - lastDotsAt < DOT_INTERVAL_MS) return;
  lastDotsAt = now;
  const dots = conditions(state);
  updateOverviewCards(state, dots);
  for (const [screen, ids] of Object.entries(newsIds(state)) as [Screen, string[]][]) {
    // The screen open now has been read; so has everything on a first look.
    if (!seen[screen] || screen === open) seen[screen] = new Set(ids);
    if (ids.some((id) => !seen[screen]!.has(id))) dots[screen] = NEWS_DOT[screen] ?? 'warn';
  }
  for (const item of items) {
    const dot = dots[item.dataset.go as Screen] ?? null;
    const el = item.querySelector<HTMLElement>('.rail-dot')!;
    el.hidden = dot === null;
    el.classList.toggle('is-bad', dot === 'bad');
    el.classList.toggle('is-good', dot === 'good');
  }
}

/** Light the current screen's item and the dots, and say which way the hide button goes. Called every frame. */
export function updateRail(state: SimState, panelHidden: boolean): void {
  const current = screenOf(getSelection());
  updateDots(state, panelHidden ? null : current, performance.now());
  for (const item of items) item.classList.toggle('is-active', !panelHidden && item.dataset.go === current);
  hideButton.classList.toggle('is-active', panelHidden);
  const label = hideButton.querySelector('.rail-label')!;
  if (label.textContent !== (panelHidden ? 'Show' : 'Hide')) {
    label.textContent = panelHidden ? 'Show' : 'Hide';
    hideButton.title = panelHidden ? 'Show the side panel' : 'Hide the side panel (the map fills the screen)';
    hideButton.setAttribute('aria-label', panelHidden ? 'Show panel' : 'Hide panel');
  }
}
