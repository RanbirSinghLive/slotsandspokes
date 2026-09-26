import { classByCode } from '../../sim/aircraftClasses';
import { dayIndex } from '../../sim/clock';
import type { CompetitorOffering } from '../../sim/competitors';
import { FLIGHTS_PER_RIVAL_PLANE, rivalFlights } from '../../sim/market';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_MAX_ROUTES_PER_AIRLINE, RIVAL_REOPEN_COOLDOWN_DAYS } from '../../sim/pressure';
import { rivalRouteOutlook } from '../../sim/rivalEconomics';
import { legsServingMarket, marketKey, recommendedFare } from '../../sim/schedule';
import type { SimState } from '../../sim/state';
import { select, selectRoute } from '../selection';

/**
 * The inspector's views of rival airlines (ui/inspector/inspector.ts):
 * the list of every rival on the map, and one rival's whole network,
 * what each of its routes makes, and how close each losing one is to
 * closing (sim/rivalEconomics.ts). It is where a price war can be read
 * from the other side: which of their routes are hurting, and which they
 * can afford to hold.
 */

function money(amount: number): string {
  return `${amount < 0 ? '−' : ''}$${Math.round(Math.abs(amount)).toLocaleString()}`;
}

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

function title(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.className = 'inspector-title';
  el.textContent = text;
  return el;
}

/** Every rival airline on the map, by code, with its name and routes. */
function rivalsOnMap(state: SimState): { code: string; airline: string; routes: CompetitorOffering[] }[] {
  const byCode = new Map<string, { code: string; airline: string; routes: CompetitorOffering[] }>();
  for (const route of state.competitorRoutes) {
    const entry = byCode.get(route.code) ?? { code: route.code, airline: route.airline, routes: [] };
    entry.routes.push(route);
    byCode.set(route.code, entry);
  }
  return [...byCode.values()];
}

/** The rival's name as it appears on the map, or its code if it has left. */
export function rivalName(state: SimState, code: string): string {
  return state.competitorRoutes.find((route) => route.code === code)?.airline ?? code;
}

/** A button that opens a rival's view: every rival name in the panel is one. */
export function rivalLink(state: SimState, code: string): HTMLButtonElement {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inspector-link';
  link.textContent = rivalName(state, code);
  link.addEventListener('click', () => select({ kind: 'rival', code }));
  return link;
}

/** Every rival on the map, biggest first, each a row opening its view. */
export function buildRivalsView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  root.append(title('Rivals'));

  const rivals = rivalsOnMap(state)
    .map((rival) => ({
      ...rival,
      flights: rivalFlights(state, rival.code),
      margin: rival.routes.reduce((sum, route) => sum + rivalRouteOutlook(state, route).margin, 0),
      losing: rival.routes.filter((route) => rivalRouteOutlook(state, route).margin < 0).length,
      againstYou: rival.routes.filter((route) => legsServingMarket(route.origin, route.dest, state.schedule) > 0).length,
    }))
    .sort((x, y) => y.flights - x.flights || x.airline.localeCompare(y.airline));

  if (rivals.length === 0) {
    root.append(line('No rival airlines on the map.'));
    return root;
  }
  root.append(line(`${rivals.length} airline${rivals.length === 1 ? '' : 's'} on the map. Margins are estimated with your own economics.`));

  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const rival of rivals) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.textContent = rival.airline;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent =
      `${rival.routes.length} route${rival.routes.length === 1 ? '' : 's'}` +
      (rival.againstYou > 0 ? ` (${rival.againstYou} vs you)` : '') +
      ` · ${money(rival.margin)}/day` +
      (rival.losing > 0 ? ` · ${rival.losing} losing` : '');
    if (rival.margin < 0) detail.classList.add('is-over');
    row.append(name, detail);
    row.addEventListener('click', () => select({ kind: 'rival', code: rival.code }));
    list.append(row);
  }
  root.append(list);
  return root;
}

/** One rival airline: its fleet, its size against the cap, and every route it flies. */
export function buildRivalView(state: SimState, code: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const routes = state.competitorRoutes.filter((route) => route.code === code);
  root.append(title(`${rivalName(state, code)} (${code})`));

  const flights = rivalFlights(state, code);
  const fleet = state.competitorFleets[code] ?? [];
  const fleetByClass = new Map<string, number>();
  for (const typeCode of fleet) fleetByClass.set(typeCode, (fleetByClass.get(typeCode) ?? 0) + 1);
  const fleetText = [...fleetByClass.entries()].map(([typeCode, count]) => `${classByCode(typeCode)?.name ?? typeCode} x${count}`).join(', ');
  root.append(
    line(
      `${routes.length} of ${RIVAL_MAX_ROUTES_PER_AIRLINE} routes · ${flights} flights/day · fleet: ${fleetText || 'none'}`,
    ),
  );
  // Rivals don't assign planes to routes: every route is flown by the
  // fleet on average (sim/rivalEconomics.ts). Planes beyond what its
  // flying needs are still leased, and paid for across its routes.
  const seatsPerFlight = fleet.length > 0 ? Math.round(fleet.reduce((sum, typeCode) => sum + (classByCode(typeCode)?.seats ?? 0), 0) / fleet.length) : 0;
  const spare = fleet.length - Math.ceil(flights / FLIGHTS_PER_RIVAL_PLANE);
  root.append(
    line(
      `Its routes average ${seatsPerFlight} seats a flight.` +
        (spare > 0 ? ` ${spare} plane${spare === 1 ? '' : 's'} more than its flying needs, paid for across its routes.` : ''),
    ),
  );

  const outlooks = routes
    .map((route) => ({ route, outlook: rivalRouteOutlook(state, route) }))
    .sort((x, y) => x.outlook.margin - y.outlook.margin);
  const total = outlooks.reduce((sum, { outlook }) => sum + outlook.margin, 0);
  const totalLine = line(`Estimated margin: ${money(total)}/day across its network.`);
  if (total < 0) totalLine.classList.add('is-over');
  root.append(totalLine);

  root.append(heading('Routes, worst first'));
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const { route, outlook } of outlooks) {
    const youFly = legsServingMarket(route.origin, route.dest, state.schedule) > 0;
    const fareShare = Math.round((route.fare / recommendedFare(route.origin, route.dest)) * 100);
    const row = document.createElement(youFly ? 'button' : 'div');
    row.className = 'inspector-row';
    if (youFly) {
      (row as HTMLButtonElement).type = 'button';
      row.addEventListener('click', () => selectRoute(state, route.origin, route.dest));
    }
    const name = document.createElement('span');
    name.textContent = `${route.origin} – ${route.dest}${youFly ? ' · vs you' : ''}`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    let status = '';
    if (outlook.closesInDays !== null) {
      status = outlook.graceDaysLeft > 0
        ? ` · losing, protected ${outlook.graceDaysLeft} more days`
        : ` · losing ${outlook.losingDays}/${RIVAL_CLOSE_AFTER_LOSING_DAYS} days, closes in about ${outlook.closesInDays}`;
      detail.classList.add('is-over');
    }
    detail.textContent = `${route.dailyFrequency}/day at $${route.fare} (${fareShare}%) · ${money(outlook.margin)}/day${status}`;
    row.append(name, detail);
    list.append(row);
  }
  root.append(list);

  // Markets it closed recently, which it won't reopen until the cooldown ends.
  const today = dayIndex(state);
  const closures = (state.rivalClosures ?? []).filter((closure) => closure.code === code);
  if (closures.length > 0) {
    root.append(heading('Closed recently'));
    for (const closure of closures) {
      const daysAgo = today - Math.floor(closure.closedAtMinute / 1440);
      root.append(
        line(
          `${closure.market.replace('-', ' – ')}: closed ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago, won't reopen for ${Math.max(0, RIVAL_REOPEN_COOLDOWN_DAYS - daysAgo)} more.`,
        ),
      );
    }
  }
  return root;
}

/** The rival names on a market as links, for "Rivals: …" lines elsewhere in the panel. */
export function rivalLinksOn(state: SimState, a: string, b: string): Node[] {
  const key = marketKey(a, b);
  const nodes: Node[] = [];
  state.competitorRoutes
    .filter((route) => marketKey(route.origin, route.dest) === key)
    .forEach((route, i) => {
      if (i > 0) nodes.push(document.createTextNode(', '));
      nodes.push(rivalLink(state, route.code), document.createTextNode(` ${route.dailyFrequency}/day at $${route.fare.toLocaleString()}`));
    });
  return nodes;
}
