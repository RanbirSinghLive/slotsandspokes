import { buildGoalsView } from './goals';
import { buildHeadOfficeView } from './headOffice';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import { back, getSelection, NETWORK, replaceSelection, select, type Selection } from '../selection';
import { buildAircraftView, buildFleetView } from './aircraft';
import { buildAirportView } from './airport';
import { buildAirportsView } from './airports';
import { buildRivalView, buildRivalsView, rivalName } from './rival';
import { buildRouteView } from './route';

/**
 * The side panel as an inspector: the detail for whatever is selected
 * (ui/selection.ts). At Network, the panel is its usual self: cash, the
 * 7-day bars and the tabs. Anything else hides those and shows its own
 * view here, under a breadcrumb that leads back up.
 *
 * Each kind of selection has one view (ui/inspector/*.ts) that builds its
 * DOM from the selection and `state`. The inspector rebuilds when the
 * selection changes, after an action, and at day rollover (main.ts), never
 * per frame: a rebuild replaces the buttons, and a button replaced
 * mid-click never fires.
 */

const inspectorEl = document.querySelector<HTMLElement>('#inspector')!;
const breadcrumbEl = document.querySelector<HTMLElement>('#inspector-breadcrumb')!;
const bodyEl = document.querySelector<HTMLElement>('#inspector-body')!;
const networkEls = [document.querySelector<HTMLElement>('#econ-summary')!, document.querySelector<HTMLElement>('#sidebar-tab-content')!];

let redrawPools: (() => void) | null = null;
/** What the view was last built for, so a rebuild of the same thing keeps its scroll position. */
let renderedKey = '';

// A rebuild replaces every slider, so one that arrives while the pointer
// is held down in the panel (a slider mid-drag) waits for the release.
let pointerDown = false;
let rebuildWaiting: SimState | null = null;
inspectorEl.addEventListener('pointerdown', () => {
  pointerDown = true;
});
window.addEventListener('pointerup', () => {
  pointerDown = false;
  if (rebuildWaiting) {
    const state = rebuildWaiting;
    rebuildWaiting = null;
    renderInspector(state);
  }
});

/**
 * Rebuild for the day's new numbers (main.ts calls this at rollover),
 * unless the player is mid-drag in the panel, in which case it happens on
 * release.
 */
export function refreshInspectorForNewDay(state: SimState): void {
  if (pointerDown) rebuildWaiting = state;
  else renderInspector(state);
}

/** Whether this selection still refers to something in the game. */
function stillExists(state: SimState, selection: Selection): boolean {
  if (selection.kind === 'route') return ops.rotationsServing(state, selection.a, selection.b).length > 0;
  if (selection.kind === 'airport') return state.knownAirports.includes(selection.iata);
  if (selection.kind === 'rival') return state.competitorRoutes.some((route) => route.code === selection.code);
  if (selection.kind === 'aircraft') return state.aircraft.some((aircraft) => aircraft.tail === selection.tail);
  return true;
}

/** The trail from Network to `selection`, each step with what selecting it shows. */
function trail(state: SimState, selection: Selection): { label: string; target: Selection }[] {
  const steps: { label: string; target: Selection }[] = [{ label: 'Network', target: NETWORK }];
  if (selection.kind === 'network') return steps;
  if (selection.kind === 'goals') {
    steps.push({ label: 'Goals', target: selection });
    return steps;
  }
  if (selection.kind === 'headOffice') {
    steps.push({ label: 'Head office', target: selection });
    return steps;
  }
  if (selection.kind === 'fleet' || selection.kind === 'aircraft') {
    steps.push({ label: 'Fleet', target: { kind: 'fleet' } });
    if (selection.kind === 'aircraft') steps.push({ label: selection.tail, target: selection });
    return steps;
  }
  if (selection.kind === 'rivals' || selection.kind === 'rival') {
    steps.push({ label: 'Rivals', target: { kind: 'rivals' } });
    if (selection.kind === 'rival') steps.push({ label: rivalName(state, selection.code), target: selection });
    return steps;
  }
  steps.push({ label: 'Airports', target: { kind: 'airports' } });
  if (selection.kind === 'airport') steps.push({ label: selection.iata, target: selection });
  if (selection.kind === 'route') {
    steps.push({ label: selection.a, target: { kind: 'airport', iata: selection.a } });
    steps.push({ label: `${selection.a} – ${selection.b}`, target: selection });
  }
  return steps;
}

/** A name for what a selection points at, so a rebuild can tell "the same thing again" from "something new". */
function selectionKey(selection: Selection): string {
  if (selection.kind === 'route') return `route:${selection.a}-${selection.b}`;
  if (selection.kind === 'airport') return `airport:${selection.iata}`;
  if (selection.kind === 'rival') return `rival:${selection.code}`;
  if (selection.kind === 'aircraft') return `aircraft:${selection.tail}`;
  return selection.kind;
}

function renderBreadcrumb(state: SimState, selection: Selection): void {
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'inspector-back';
  backButton.textContent = '‹';
  backButton.title = 'Back (Esc)';
  backButton.setAttribute('aria-label', 'Back');
  backButton.addEventListener('click', () => back());

  const steps = trail(state, selection);
  const crumbs = steps.flatMap((step, i) => {
    const last = i === steps.length - 1;
    const crumb = document.createElement(last ? 'span' : 'button');
    crumb.className = last ? 'inspector-crumb is-current' : 'inspector-crumb';
    crumb.textContent = step.label;
    if (!last) {
      (crumb as HTMLButtonElement).type = 'button';
      crumb.addEventListener('click', () => select(step.target));
    }
    const nodes: Node[] = [crumb];
    if (!last) nodes.push(document.createTextNode(' › '));
    return nodes;
  });
  breadcrumbEl.replaceChildren(backButton, ...crumbs);
}

/** Rebuild the inspector for the current selection. */
export function renderInspector(state: SimState): void {
  let selection = getSelection();
  // A selection that has stopped existing (its last flight removed, a
  // rival gone from the map) falls back to the step above it in the
  // breadcrumb, rather than showing an empty view.
  while (!stillExists(state, selection)) {
    const steps = trail(state, selection);
    replaceSelection(steps[steps.length - 2]?.target ?? NETWORK);
    selection = getSelection();
  }

  const atNetwork = selection.kind === 'network';
  inspectorEl.hidden = atNetwork;
  for (const el of networkEls) el.hidden = !atNetwork;
  redrawPools = null;
  if (atNetwork) {
    bodyEl.replaceChildren();
    renderedKey = '';
    return;
  }

  renderBreadcrumb(state, selection);
  const key = selectionKey(selection);
  // A rebuild of the same selection (after an action, or at rollover)
  // keeps the reader's place; a new selection starts at the top.
  const scroll = key === renderedKey ? inspectorEl.scrollTop : 0;
  renderedKey = key;
  const rebuild = () => renderInspector(state);
  if (selection.kind === 'route') {
    const view = buildRouteView(state, selection.a, selection.b, rebuild);
    bodyEl.replaceChildren(view.root);
    redrawPools = view.redrawPools;
  } else if (selection.kind === 'airport') {
    const view = buildAirportView(state, selection.iata, rebuild);
    bodyEl.replaceChildren(view.root);
    redrawPools = view.redrawPools;
  } else if (selection.kind === 'aircraft') {
    bodyEl.replaceChildren(buildAircraftView(state, selection.tail, rebuild));
  } else if (selection.kind === 'fleet') {
    bodyEl.replaceChildren(buildFleetView(state));
  } else if (selection.kind === 'goals') {
    bodyEl.replaceChildren(buildGoalsView(state));
  } else if (selection.kind === 'headOffice') {
    bodyEl.replaceChildren(buildHeadOfficeView(state, rebuild));
  } else if (selection.kind === 'rival') {
    bodyEl.replaceChildren(buildRivalView(state, selection.code));
  } else if (selection.kind === 'rivals') {
    bodyEl.replaceChildren(buildRivalsView(state));
  } else {
    bodyEl.replaceChildren(buildAirportsView(state, rebuild));
  }
  inspectorEl.scrollTop = scroll;
}

/** Redraw just the plane pools, with whatever the hovered radial button would change. */
export function redrawInspectorPreview(): void {
  redrawPools?.();
}
