import { planHub, type HubMove, type HubPlan } from '../sim/hubPlanner';
import { HUB_STYLES } from '../sim/hubStyle';
import { airports } from '../render/airports';
import { armRouteBuilderAt } from './routeBuilder';
import * as ops from './routeActions';
import type { SimState } from '../sim/state';

/**
 * The Plan hub window: everything about one hub's connections on one
 * screen, with no timeline anywhere (the player never authors times).
 * Opened from the button in an airport's view (ui/inspector/airport.ts), which is
 * always there and turns yellow, then red, as sim/hubPlanner.ts finds more
 * value being missed.
 *
 * Three parts:
 *   - Hub style: the three styles side by side with what each would do
 *     here — connections, peak load, extra ground time — and a click to
 *     switch.
 *   - The connection grid: spokes down and across, each cell the
 *     passengers a day connecting between that pair. Thin rows and blank
 *     cells are where a hub is weak.
 *   - Suggested moves, each with its dollar value and a button that does
 *     it through the same operations the map menu uses.
 *
 * Real DOM, per CLAUDE.md: it's a table and some buttons.
 */

const modalEl = document.querySelector<HTMLElement>('#hub-planner-modal')!;
const titleEl = document.querySelector<HTMLElement>('#hub-planner-title')!;
const summaryEl = document.querySelector<HTMLElement>('#hub-planner-summary')!;
const stylesEl = document.querySelector<HTMLElement>('#hub-planner-styles')!;
const gridEl = document.querySelector<HTMLElement>('#hub-planner-grid')!;
const movesEl = document.querySelector<HTMLElement>('#hub-planner-moves')!;
const noticeEl = document.querySelector<HTMLElement>('#hub-planner-notice')!;
const closeButton = document.querySelector<HTMLButtonElement>('#hub-planner-close')!;

let openHub: string | null = null;
let openState: SimState | null = null;
let onChange: (() => void) | null = null;

function money(amount: number): string {
  return Math.abs(amount) >= 1000 ? `$${(amount / 1000).toFixed(1)}k` : `$${Math.round(amount)}`;
}

function button(text: string, onClick: () => void, disabledReason?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  if (disabledReason) {
    el.disabled = true;
    el.title = disabledReason;
  }
  el.addEventListener('click', onClick);
  return el;
}

/** Run an operation, say what happened, and redraw this window and whatever opened it. */
function act(result: ops.Outcome<{ message: string }>): void {
  noticeEl.textContent = result.ok ? result.message : result.reason;
  noticeEl.classList.toggle('is-problem', !result.ok);
  onChange?.();
  render();
}

function renderStyles(plan: HubPlan, state: SimState): void {
  stylesEl.replaceChildren(
    ...plan.styles.map((preview) => {
      const spec = HUB_STYLES[preview.style];
      const current = preview.style === plan.style;
      const card = document.createElement('div');
      card.className = 'hub-style-card';
      card.classList.toggle('is-current', current);

      const name = document.createElement('div');
      name.className = 'hub-style-name';
      name.textContent = current ? `${spec.name} (current)` : spec.name;
      const figures = document.createElement('div');
      figures.className = 'hub-style-figures';
      figures.textContent =
        `${Math.round(preview.connecting)} connecting/day · peak load ${Math.round(preview.load * 100)}%` +
        (spec.hubWaitMinutes > 0 ? ` · +${spec.hubWaitMinutes} min per arrival` : '');
      const description = document.createElement('div');
      description.className = 'hub-style-description';
      description.textContent = spec.description;

      card.append(name, figures, description);
      if (!current) {
        card.append(button(`Switch to ${spec.name}`, () => act(ops.setHubStyle(state, plan.hub, preview.style)), preview.blockedReason ?? undefined));
      }
      return card;
    }),
  );
}

function renderGrid(plan: HubPlan): void {
  if (plan.spokes.length < 2) {
    gridEl.textContent = `Fly from ${plan.hub} to at least two airports: connections need two routes to meet.`;
    return;
  }
  const busiest = Math.max(1, ...Object.values(plan.grid));
  const table = document.createElement('table');
  table.className = 'hub-grid';

  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  for (const spoke of plan.spokes) {
    const th = document.createElement('th');
    th.textContent = spoke.iata;
    th.title = `${spoke.flightsPerDay} flight${spoke.flightsPerDay === 1 ? '' : 's'} a day each way`;
    head.append(th);
  }
  table.append(head);

  plan.spokes.forEach((row, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = `${row.iata} ${row.flightsPerDay}/day`;
    tr.append(th);
    plan.spokes.forEach((column, j) => {
      const td = document.createElement('td');
      if (i === j) {
        td.textContent = '—';
        td.className = 'hub-grid-self';
      } else {
        const [first, second] = i < j ? [row.iata, column.iata] : [column.iata, row.iata];
        const passengers = plan.grid[`${first}|${second}`] ?? 0;
        td.textContent = passengers >= 1 ? String(Math.round(passengers)) : '';
        // Shaded by volume, so the strong and weak pairs read at a glance.
        td.style.background = `rgba(94, 214, 200, ${(0.08 + 0.5 * (passengers / busiest)).toFixed(2)})`;
        td.title = `${row.iata}–${column.iata}: ${passengers.toFixed(1)} connecting a day through ${plan.hub}`;
      }
      tr.append(td);
    });
    table.append(tr);
  });
  gridEl.replaceChildren(table);
}

function describeMove(move: HubMove): string {
  switch (move.kind) {
    case 'style':
      return (
        `Switch to ${HUB_STYLES[move.style].name}: +${money(move.gainPerDay)}/day. ` +
        `${Math.round(move.extraConnecting)} more connecting passengers fit in today's empty seats, net of the ground time it costs.`
      );
    case 'frequency':
      return (
        `Add a daily flight to ${move.spoke}: +${money(move.gainPerDay)}/day from about ` +
        `${Math.round(move.extraConnecting)} more connecting passengers, net of the flights' cost.`
      );
  }
}

function renderMoves(plan: HubPlan, state: SimState): void {
  if (plan.moves.length === 0) {
    movesEl.textContent = 'Nothing obvious to change here right now.';
    return;
  }
  movesEl.replaceChildren(
    ...plan.moves.map((move) => {
      const row = document.createElement('div');
      row.className = `hub-move hub-move--${move.kind}`;
      const text = document.createElement('div');
      text.textContent = describeMove(move);
      row.append(text);

      if (move.kind === 'style') {
        row.append(button('Switch', () => act(ops.setHubStyle(state, plan.hub, move.style))));
      } else if (move.kind === 'frequency') {
        const preview = ops.previewAddFlight(state, plan.hub, move.spoke);
        row.append(button('Add flight', () => act(ops.addFlight(state, plan.hub, move.spoke)), preview.ok ? undefined : preview.reason));
      } else {
        const hubAirport = airports.find((a) => a.iata === plan.hub);
        row.append(
          button('Draw route', () => {
            closeHubPlanner();
            if (hubAirport) armRouteBuilderAt(hubAirport);
          }),
        );
      }
      return row;
    }),
  );
}

function render(): void {
  if (!openHub || !openState) return;
  const state = openState;
  const plan = planHub(state, openHub);
  const name = airports.find((a) => a.iata === openHub)?.name ?? '';

  titleEl.textContent = `Plan hub: ${openHub} — ${name}`;
  summaryEl.textContent =
    `${Math.round(plan.connecting)} connecting passengers a day · ${HUB_STYLES[plan.style].name}` +
    (plan.missedPerDay > 0 ? ` · about ${money(plan.missedPerDay)}/day being missed` : '');
  summaryEl.className = `hub-planner-summary is-${plan.urgency}`;
  renderStyles(plan, state);
  renderGrid(plan);
  renderMoves(plan, state);
}

export function openHubPlanner(state: SimState, hub: string, changed: () => void): void {
  openHub = hub;
  openState = state;
  onChange = changed;
  noticeEl.textContent = '';
  render();
  modalEl.hidden = false;
}

export function closeHubPlanner(): void {
  modalEl.hidden = true;
  openHub = null;
  openState = null;
  onChange = null;
}

export function isHubPlannerOpen(): boolean {
  return !modalEl.hidden;
}

closeButton.addEventListener('click', closeHubPlanner);
// Clicking the dimmed backdrop, not the box, closes it — same as the other modals feel.
modalEl.addEventListener('click', (event) => {
  if (event.target === modalEl) closeHubPlanner();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isHubPlannerOpen()) closeHubPlanner();
});
