import { classByCode } from '../../sim/aircraftClasses';
import { rivalHubs, rivalLadderInWords } from '../../sim/rivalLadder';
import { info, line, heading, lineWithInfo } from './dom';
import { money, shortMoney } from '../format';
import { dayIndex } from '../../sim/clock';
import type { CompetitorOffering } from '../../sim/competitors';
import { FLIGHTS_PER_RIVAL_PLANE, rivalFlights } from '../../sim/market';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_MAX_ROUTES_PER_AIRLINE, RIVAL_REOPEN_COOLDOWN_DAYS } from '../../sim/pressure';
import { rivalRouteOutlook } from '../../sim/rivalEconomics';
import { legsServingMarket, marketKey, recommendedFare } from '../../sim/schedule';
import type { SimState } from '../../sim/state';
import { select, selectRoute } from '../selection';
import { linkToMap } from '../mapLink';
import { rivalsInSight } from '../../sim/reach';
import { airports } from '../../render/airports';
import { flagBadge, fleetPips, rivalLogo } from '../rivalBadge';

/**
 * The inspector's views of rival airlines (ui/inspector/inspector.ts):
 * the list of every rival on the map, and one rival's whole network,
 * what each of its routes makes, and how close each losing one is to
 * closing (sim/rivalEconomics.ts). It is where a price war can be read
 * from the other side: which of their routes are hurting, and which they
 * can afford to hold.
 */

function title(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.className = 'inspector-title';
  el.textContent = text;
  return el;
}

/** Every rival airline on the map, by code, with its name and routes. */
function rivalsOnMap(state: SimState): { code: string; airline: string; routes: CompetitorOffering[] }[] {
  // Only rivals the player can see: one flying wholly in the fog isn't on their map.
  const inSight = rivalsInSight(state);
  const byCode = new Map<string, { code: string; airline: string; routes: CompetitorOffering[] }>();
  for (const route of state.competitorRoutes) {
    if (!inSight.has(route.code)) continue;
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

/** A small icon-and-number chip with its meaning as a tip. */
function chip(glyph: string, text: string, tip: string, tone = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `rival-chip ${tone}`.trim();
  el.textContent = `${glyph} ${text}`;
  el.dataset.tip = tip;
  el.setAttribute('aria-label', tip);
  return el;
}

/** One block per route, green when it makes money, red when it loses, ringed amber when you fly the market too. */
function routeBlocks(outlooks: { route: CompetitorOffering; margin: number; vsYou: boolean }[]): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rival-blocks';
  el.dataset.tip = 'One block per route · green earns · red loses · amber ring = you fly it too';
  for (const { margin, vsYou } of [...outlooks].sort((x, y) => y.margin - x.margin)) {
    const block = document.createElement('b');
    block.className = (margin < 0 ? 'is-losing' : 'is-earning') + (vsYou ? ' is-vs-you' : '');
    el.append(block);
  }
  return el;
}

function marginText(amount: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rival-margin' + (amount < 0 ? ' is-over' : ' is-good');
  el.textContent = shortMoney(amount);
  el.dataset.tip = `${money(amount)}/day est. margin`;
  return el;
}

/** Every rival on the map, the ones fighting you first, each a card opening its view. */
export function buildRivalsView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view rival-view';
  root.append(title('Rivals'));

  const inSight = rivalsInSight(state);
  const rivals = rivalsOnMap(state)
    .map((rival) => {
      const outlooks = rival.routes.map((route) => ({
        route,
        margin: rivalRouteOutlook(state, route).margin,
        vsYou: legsServingMarket(route.origin, route.dest, state.schedule) > 0,
      }));
      return {
        ...rival,
        outlooks,
        flights: rivalFlights(state, rival.code),
        margin: outlooks.reduce((sum, o) => sum + o.margin, 0),
        losing: outlooks.filter((o) => o.margin < 0).length,
        againstYou: outlooks.filter((o) => o.vsYou).length,
      };
    })
    .sort((x, y) => y.againstYou - x.againstYou || y.flights - x.flights || x.airline.localeCompare(y.airline));

  // Rivals the player can't see yet stay on the list, greyed, so the field's size is no secret.
  const allCodes = [...new Set(state.competitorRoutes.map((route) => route.code))];
  const unseen = allCodes.filter((code) => !inSight.has(code));

  const summary = document.createElement('div');
  summary.className = 'rival-summary';
  summary.append(
    chip('✈', `${rivals.length}/${allCodes.length}`, 'Rivals in your reach out of all flying'),
    chip('⚔', String(rivals.reduce((sum, r) => sum + r.againstYou, 0)), 'Rival routes on markets you fly too', 'is-warn'),
    chip('⏱', String(rivals.reduce((sum, r) => sum + r.losing, 0)), 'Rival routes losing money; they pull out after a losing run', 'is-bad'),
    info('Rival margins are estimated with your own economics. Amber edge = it competes with you.'),
  );
  root.append(summary);

  if (rivals.length === 0) root.append(line('None in reach'));
  const list = document.createElement('div');
  list.className = 'rival-cards';
  for (const rival of rivals) {
    const card = linkToMap(document.createElement('button'), { kind: 'rival', code: rival.code });
    card.type = 'button';
    card.className = 'rival-card' + (rival.againstYou > 0 ? ' is-threat' : '');
    const name = document.createElement('span');
    name.className = 'rival-name';
    name.append(flagBadge(state, rival.code), document.createTextNode(rival.airline));
    const sub = document.createElement('span');
    sub.className = 'rival-sub';
    sub.append(fleetPips(state.competitorFleets[rival.code] ?? []), routeBlocks(rival.outlooks));
    const hub = hubChip(rival.outlooks.map(({ route }) => route));
    if (hub) sub.append(hub);
    if (rival.againstYou > 0) sub.append(chip('⚔', String(rival.againstYou), `${rival.againstYou} route${rival.againstYou === 1 ? '' : 's'} on markets you fly`, 'is-warn'));
    if (rival.losing > 0) sub.append(chip('⏱', String(rival.losing), `${rival.losing} route${rival.losing === 1 ? '' : 's'} losing money`, 'is-bad'));
    card.append(rivalLogo(rival.code, 44), name, marginText(rival.margin), sub);
    card.addEventListener('click', () => select({ kind: 'rival', code: rival.code }));
    list.append(card);
  }
  root.append(list);

  if (unseen.length > 0) {
    root.append(heading('Beyond your reach', 'Airlines flying where you can\'t see yet. They appear here in full as your reach grows.'));
    const fogged = document.createElement('div');
    fogged.className = 'rival-cards';
    for (const code of unseen) {
      const card = document.createElement('div');
      card.className = 'rival-card is-unseen';
      const name = document.createElement('span');
      name.className = 'rival-name';
      name.append(flagBadge(state, code, true), document.createTextNode('Out of reach'));
      const lock = document.createElement('span');
      lock.className = 'rival-margin';
      lock.textContent = '🔒';
      lock.dataset.tip = 'Not in your reach yet';
      const sub = document.createElement('span');
      sub.className = 'rival-sub';
      sub.append(fleetPips(state.competitorFleets[code] ?? [], true));
      card.append(rivalLogo(code, 44, true), name, lock, sub);
      fogged.append(card);
    }
    root.append(fogged);
  }
  return root;
}

/** The rival's network drawn small, each route green or red by its margin. Plain lon/lat fit: it only has to read, and the map owns the one projection. */
/** ★ chip naming a rival's hub airports, or nothing when it has none. */
function hubChip(routes: CompetitorOffering[]): HTMLElement | null {
  const hubs = rivalHubs(routes);
  return hubs.length > 0 ? chip('★', hubs.join(' '), `Hub${hubs.length === 1 ? '' : 's'} ${hubs.join(' · ')}: 4+ of its routes`, 'is-hub') : null;
}

function networkSketch(outlooks: { route: CompetitorOffering; margin: number }[]): SVGSVGElement {
  const hubs = new Set(rivalHubs(outlooks.map(({ route }) => route)));
  const width = 400;
  const height = 170;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'rival-sketch');
  const byIata = new Map(airports.map((airport) => [airport.iata, airport]));
  const points = new Map<string, { lon: number; lat: number }>();
  for (const { route } of outlooks) {
    for (const iata of [route.origin, route.dest]) {
      const airport = byIata.get(iata);
      if (airport) points.set(iata, airport);
    }
  }
  if (points.size === 0) return svg;
  const lons = [...points.values()].map((p) => p.lon);
  const lats = [...points.values()].map((p) => p.lat);
  const lonSpan = Math.max(Math.max(...lons) - Math.min(...lons), 2);
  const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), 2);
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const xPerDegree = Math.cos((midLat * Math.PI) / 180);
  const scale = Math.min((width - 60) / (lonSpan * xPerDegree), (height - 40) / latSpan);
  const centreLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const x = (lon: number) => width / 2 + (lon - centreLon) * xPerDegree * scale;
  const y = (lat: number) => height / 2 - (lat - midLat) * scale;
  let markup = '';
  for (const { route, margin } of outlooks) {
    const a = points.get(route.origin);
    const b = points.get(route.dest);
    if (!a || !b) continue;
    const mx = (x(a.lon) + x(b.lon)) / 2;
    const my = (y(a.lat) + y(b.lat)) / 2 - 12;
    markup += `<path d="M${x(a.lon)} ${y(a.lat)} Q${mx} ${my} ${x(b.lon)} ${y(b.lat)}" fill="none" stroke="${margin < 0 ? '#c24848' : '#3b8f5c'}" stroke-width="${1 + route.dailyFrequency / 2}" opacity="0.9"/>`;
  }
  for (const [iata, p] of points) {
    if (hubs.has(iata)) markup += `<circle cx="${x(p.lon)}" cy="${y(p.lat)}" r="8" fill="none" stroke="#6fb3ff" stroke-width="2"/>`;
    markup += `<circle cx="${x(p.lon)}" cy="${y(p.lat)}" r="${hubs.has(iata) ? 4.5 : 3}" fill="${hubs.has(iata) ? '#6fb3ff' : '#cfd6e4'}"/><text x="${x(p.lon) + 5}" y="${y(p.lat) - 4}" font-size="9" fill="#8b94a7">${iata}</text>`;
  }
  svg.innerHTML = markup;
  return svg;
}

/** One rival airline: header, four numbers, its network sketched, and every route worst first. */
export function buildRivalView(state: SimState, code: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view rival-view';
  const routes = state.competitorRoutes.filter((route) => route.code === code);
  const fleet = state.competitorFleets[code] ?? [];
  const flights = rivalFlights(state, code);
  const outlooks = routes
    .map((route) => ({ route, outlook: rivalRouteOutlook(state, route), vsYou: legsServingMarket(route.origin, route.dest, state.schedule) > 0 }))
    .sort((x, y) => x.outlook.margin - y.outlook.margin);
  const total = outlooks.reduce((sum, { outlook }) => sum + outlook.margin, 0);
  const losing = outlooks.filter(({ outlook }) => outlook.margin < 0).length;
  const againstYou = outlooks.filter(({ vsYou }) => vsYou).length;

  const hero = document.createElement('div');
  hero.className = 'rival-hero';
  const names = document.createElement('div');
  names.className = 'rival-hero-names';
  const name = document.createElement('div');
  name.className = 'rival-hero-name';
  name.append(document.createTextNode(rivalName(state, code)), flagBadge(state, code));
  names.append(name, fleetPips(fleet));
  const margin = marginText(total);
  margin.classList.add('is-big');
  hero.append(rivalLogo(code, 56), names, margin);
  root.append(hero);

  // Rivals earn bigger planes on the same ladder (sim/rivalLadder.ts); that and the spare planes are prose, so they sit in an (i).
  const seatsPerFlight = fleet.length > 0 ? Math.round(fleet.reduce((sum, typeCode) => sum + (classByCode(typeCode)?.seats ?? 0), 0) / fleet.length) : 0;
  const spare = fleet.length - Math.ceil(flights / FLIGHTS_PER_RIVAL_PLANE);
  const stats = document.createElement('div');
  stats.className = 'rival-stats';
  const stat = (big: string, small: string, tip: string, tone = ''): HTMLElement => {
    const el = document.createElement('span');
    el.className = `rival-stat ${tone}`.trim();
    el.dataset.tip = tip;
    el.setAttribute('aria-label', tip);
    el.append(big, Object.assign(document.createElement('small'), { textContent: small }));
    return el;
  };
  stats.append(
    stat(`${routes.length}/${RIVAL_MAX_ROUTES_PER_AIRLINE}`, 'routes', 'Routes flown out of the most it will run'),
    stat(String(flights), 'flights/day', `${seatsPerFlight} seats a flight on average` + (spare > 0 ? ` · ${spare} spare plane${spare === 1 ? '' : 's'}` : '')),
    stat(`★ ${rivalHubs(routes).join(' ') || '–'}`, 'hubs', 'Airports with 4 or more of its routes', rivalHubs(routes).length > 0 ? 'is-hub' : ''),
    stat(`⚔ ${againstYou}`, 'vs you', 'Routes on markets you fly too', againstYou > 0 ? 'is-warn' : ''),
    stat(`⏱ ${losing}`, 'losing', 'Routes losing money', losing > 0 ? 'is-bad' : ''),
  );
  root.append(
    stats,
    lineWithInfo(
      rivalLadderInWords(state, code),
      'Rivals earn bigger planes on the same ladder as you, judged on their own routes. Rivals don\'t assign planes to routes: each route is flown by the fleet on average, and planes beyond what its flying needs are still paid for across its routes.',
      'inspector-line rival-ladder',
    ),
  );

  const sketch = document.createElement('div');
  sketch.className = 'rival-sketch-box';
  sketch.append(networkSketch(outlooks.map(({ route, outlook }) => ({ route, margin: outlook.margin }))));
  root.append(sketch);

  root.append(heading('Routes · worst first', 'Bar: daily margin, red left of the line, green right. Gauge: its fare (white tick) against the recommended fare (grey mark). ⏱: days until it pulls out.'));
  const longestMargin = Math.max(1, ...outlooks.map(({ outlook }) => Math.abs(outlook.margin)));
  const list = document.createElement('div');
  list.className = 'rival-routes';
  for (const { route, outlook, vsYou } of outlooks) {
    const recommended = recommendedFare(route.origin, route.dest);
    const row = linkToMap(document.createElement(vsYou ? 'button' : 'div'), { kind: 'route', a: route.origin, b: route.dest });
    row.className = 'rival-route';
    if (vsYou) {
      (row as HTMLButtonElement).type = 'button';
      row.addEventListener('click', () => selectRoute(state, route.origin, route.dest));
    }
    const od = document.createElement('span');
    od.className = 'rival-route-od';
    od.textContent = `${route.origin}–${route.dest}`;
    if (vsYou) {
      const swords = document.createElement('em');
      swords.textContent = '⚔';
      swords.dataset.tip = 'You fly this market too · tap for your route';
      od.append(swords);
    }

    const bar = document.createElement('span');
    bar.className = 'rival-bar';
    const fill = document.createElement('u');
    fill.className = outlook.margin < 0 ? 'is-losing' : 'is-earning';
    fill.style.width = `${(Math.abs(outlook.margin) / longestMargin) * 50}%`;
    bar.append(fill);

    // Fare against recommended: the gauge spans 60%–140%, the tick marks 100%.
    const gauge = document.createElement('span');
    gauge.className = 'rival-gauge';
    const ratio = Math.min(1.4, Math.max(0.6, route.fare / recommended));
    gauge.dataset.tip = `$${route.fare.toLocaleString()} · ${Math.round((route.fare / recommended) * 100)}% of the recommended fare`;
    gauge.innerHTML = `<s class="mid"></s><s class="at" style="left:${((ratio - 0.6) / 0.8) * 100}%"></s>`;

    const meta = document.createElement('span');
    meta.className = 'rival-route-meta';
    meta.append(document.createTextNode(`${route.dailyFrequency}/day`), gauge);
    if (outlook.closesInDays !== null) {
      const clock = chip('⏱', `${outlook.closesInDays}d`, outlook.graceDaysLeft > 0 ? `Losing · grace ${outlook.graceDaysLeft}d left` : `Losing ${outlook.losingDays}/${RIVAL_CLOSE_AFTER_LOSING_DAYS}d · exits in ~${outlook.closesInDays}d`, 'is-bad');
      meta.append(clock);
    }
    const middle = document.createElement('span');
    middle.className = 'rival-route-mid';
    middle.append(bar, meta);
    row.append(od, middle, marginText(outlook.margin));
    list.append(row);
  }
  root.append(list);

  // Markets it closed recently, which it won't reopen until the cooldown ends.
  const today = dayIndex(state);
  const closures = (state.rivalClosures ?? []).filter((closure) => closure.code === code);
  if (closures.length > 0) {
    root.append(heading('Closed recently', 'A rival won\'t reopen a market it closed until its cooldown ends.'));
    for (const closure of closures) {
      const daysAgo = today - Math.floor(closure.closedAtMinute / 1440);
      root.append(line(`${closure.market.replace('-', ' – ')} · closed ${daysAgo}d ago · reopens in ${Math.max(0, RIVAL_REOPEN_COOLDOWN_DAYS - daysAgo)}d`));
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
