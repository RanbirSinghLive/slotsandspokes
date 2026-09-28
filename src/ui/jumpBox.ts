import { classByCode } from '../sim/aircraftClasses';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { airports } from '../render/airports';
import { select, selectRoute, type Selection } from './selection';
import { rivalsInSight } from '../sim/reach';

/**
 * The jump box: press / (or ⌘K / Ctrl+K), type an airport, a tail, a
 * rival, a route or a screen, and go straight there. For digging once
 * you know what you want, instead of clicking down to it. Every match is
 * worked out when the box opens, from what the player can see: known
 * airports, their own planes and routes, rivals on the map.
 */

const boxEl = document.querySelector<HTMLDivElement>('#jump-box')!;
const inputEl = document.querySelector<HTMLInputElement>('#jump-input')!;
const resultsEl = document.querySelector<HTMLDivElement>('#jump-results')!;

type Target = { label: string; kind: string; keys: string[]; go: () => void };

const MAX_RESULTS = 8;
const namesByIata = new Map(airports.map((airport) => [airport.iata, airport.name]));

const SCREENS: [string, Selection][] = [
  ['Overview', { kind: 'network' }],
  ['Routes', { kind: 'routes', sort: 'margin' }],
  ['Airports', { kind: 'airports' }],
  ['Fleet', { kind: 'fleet' }],
  ['Crews', { kind: 'crews' }],
  ['Rivals', { kind: 'rivals' }],
  ['Money', { kind: 'money' }],
  ['Goals', { kind: 'goals' }],
  ['Head office', { kind: 'headOffice' }],
  ['Game', { kind: 'game' }],
];

function targets(state: SimState): Target[] {
  const list: Target[] = SCREENS.map(([label, selection]) => ({ label, kind: 'screen', keys: [label.toLowerCase()], go: () => select(selection) }));
  for (const iata of state.knownAirports) {
    const name = namesByIata.get(iata) ?? iata;
    list.push({ label: `${iata} · ${name}`, kind: 'airport', keys: [iata.toLowerCase(), name.toLowerCase()], go: () => select({ kind: 'airport', iata }) });
  }
  for (const aircraft of state.aircraft) {
    const name = classByCode(aircraft.typeCode)?.name ?? aircraft.typeCode;
    list.push({
      label: `${aircraft.tail} · ${name} · ${aircraft.baseAirport ?? 'no base'}`,
      kind: 'plane',
      keys: [aircraft.tail.toLowerCase(), name.toLowerCase()],
      go: () => select({ kind: 'aircraft', tail: aircraft.tail }),
    });
  }
  const inSight = rivalsInSight(state);
  const rivals = new Map(state.competitorRoutes.filter((route) => inSight.has(route.code)).map((route) => [route.code, route.airline]));
  for (const [code, airline] of rivals) {
    list.push({ label: `${airline} (${code})`, kind: 'rival', keys: [code.toLowerCase(), airline.toLowerCase()], go: () => select({ kind: 'rival', code }) });
  }
  const flown = new Map(state.schedule.map((leg) => [marketKey(leg.origin, leg.dest), leg]));
  for (const leg of flown.values()) {
    const [a, b] = [leg.origin, leg.dest];
    list.push({
      label: `${a}–${b}`,
      kind: 'route',
      keys: [`${a}-${b}`.toLowerCase(), `${b}-${a}`.toLowerCase(), `${a} ${b}`.toLowerCase(), `${b} ${a}`.toLowerCase()],
      go: () => selectRoute(state, a, b),
    });
  }
  return list;
}

/** How well a target matches: exact beats a prefix beats a word start beats anywhere; null for no match. */
function score(target: Target, query: string): number | null {
  let best: number | null = null;
  for (const key of target.keys) {
    const s = key === query ? 0 : key.startsWith(query) ? 1 : key.includes(` ${query}`) ? 2 : key.includes(query) ? 3 : null;
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

let all: Target[] = [];
let shown: Target[] = [];
let highlighted = 0;

function renderResults(): void {
  const query = inputEl.value.trim().toLowerCase().replace(/[–—]/g, '-');
  shown = query
    ? all
        .map((target) => ({ target, s: score(target, query) }))
        .filter((m): m is { target: Target; s: number } => m.s !== null)
        .sort((x, y) => x.s - y.s || x.target.label.localeCompare(y.target.label))
        .slice(0, MAX_RESULTS)
        .map((m) => m.target)
    : all.filter((target) => target.kind === 'screen');
  highlighted = Math.min(highlighted, Math.max(0, shown.length - 1));
  resultsEl.replaceChildren(
    ...shown.map((target, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'jump-row';
      row.classList.toggle('is-highlighted', i === highlighted);
      const label = document.createElement('span');
      label.textContent = target.label;
      const kind = document.createElement('span');
      kind.className = 'jump-kind';
      kind.textContent = target.kind;
      row.append(label, kind);
      // mousedown, not click: the input's blur would close the box first.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        go(target);
      });
      return row;
    }),
  );
  if (shown.length === 0) resultsEl.textContent = 'No match';
}

function go(target: Target): void {
  closeJumpBox();
  target.go();
}

export function openJumpBox(state: SimState): void {
  all = targets(state);
  highlighted = 0;
  inputEl.value = '';
  boxEl.hidden = false;
  renderResults();
  inputEl.focus();
}

export function closeJumpBox(): void {
  boxEl.hidden = true;
  inputEl.blur();
}

export function isJumpBoxOpen(): boolean {
  return !boxEl.hidden;
}

export function setupJumpBox(state: SimState): void {
  inputEl.addEventListener('input', () => {
    highlighted = 0;
    renderResults();
  });
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length > 0) highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      renderResults();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[highlighted]) go(shown[highlighted]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeJumpBox();
    }
    // Keys typed here are the box's: not the lens (1-5) or the route builder.
    event.stopPropagation();
  });
  inputEl.addEventListener('blur', () => closeJumpBox());
  // A click anywhere else closes it too, focused or not.
  document.addEventListener('mousedown', (event) => {
    if (isJumpBoxOpen() && !boxEl.contains(event.target as Node)) closeJumpBox();
  });
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const shortcut = (event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k');
    if (!shortcut) return;
    event.preventDefault();
    if (isJumpBoxOpen()) closeJumpBox();
    else openJumpBox(state);
  });
}
