import { airlineCalled, classOpen, LADDER, milestoneById, tiersClimbed } from '../sim/ladder';
import { rivalTiersClimbed } from '../sim/rivalLadder';
import { pluralClassName } from '../sim/aircraftClasses';
import { classByCode } from '../sim/aircraftClasses';
import { shortMoney } from './format';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_SQUEEZED_RESPITE_DAYS } from '../sim/pressure';
import { activeHedge } from '../sim/fuelPrice';
import { activeShock, describeShock, shockEndedLine, type Shock } from '../sim/shocks';
import { moneyOnTable, RIVAL_MARGIN_SHARE } from '../sim/attractiveness';
import { networkAirports } from '../sim/reach';
import { legsServingMarket, marketKey, recommendedFare } from '../sim/schedule';
import { AIRCRAFT_CLASSES } from '../sim/aircraftClasses';
import type { SimState } from '../sim/state';
import { select, type Selection } from './selection';
import { rivalsInSight } from '../sim/reach';
import { contractsOf, SNAP_BACK_SHARE } from '../sim/contracts';

const tickerTrack = document.querySelector<HTMLDivElement>('#ticker-track')!;

// How many recent messages the ticker keeps queued up, and how fast the
// scroll moves — a fixed *speed*, not a fixed animation duration, so a
// short queue doesn't zip past and a long one doesn't crawl (see
// restartScrollAnimation() below).
const MAX_EVENTS = 20;
const EVENT_SEPARATOR = '   •   ';
const PIXELS_PER_SECOND = 60;

/**
 * What kind of news a line is, shown first like an ops board's category
 * ("AOG YUL · C-P002 · hydraulics · back 3d"). Kept apart from the text so
 * the ticker can style it on its own.
 */
type TickerTag = 'AOG' | 'CNX' | 'CREW' | 'FLEET' | 'LESSOR' | 'RIVAL' | 'FARE' | 'FUEL' | 'SHOCK' | 'WX' | 'GOAL' | 'REACH' | 'CONTRACT';

/**
 * A line, and the inspector view that explains it, when one does: clicking
 * the line opens it. A highlighted line (a new contract offer) is news to
 * act on: it scrolls first, with its tag pulsing, until it has been
 * clicked or HIGHLIGHT_MS has passed.
 */
type TickerEvent = { simMinute: number; tag: TickerTag; message: string; target?: Selection; highlightUntil?: number };

let events: TickerEvent[] = [];

/** How long a highlighted line stays at the front, pulsing, in real time. */
const HIGHLIGHT_MS = 90_000;

function isHighlighted(event: TickerEvent): boolean {
  return event.highlightUntil !== undefined && performance.now() < event.highlightUntil;
}

function pushEvent(simMinute: number, tag: TickerTag, message: string, target?: Selection, highlight = false): void {
  events.push({ simMinute, tag, message, target, highlightUntil: highlight ? performance.now() + HIGHLIGHT_MS : undefined });
  if (events.length > MAX_EVENTS) events.shift();
  renderTickerText();
}

/**
 * Rebuilds the ticker's scrolling text and restarts its CSS animation at
 * a duration scaled to the new text's width, so the scroll *speed*
 * (PIXELS_PER_SECOND) stays constant regardless of how many events are
 * currently queued — a fixed-duration animation would make a short
 * queue zip past and a long one crawl. Setting `animation: none` then
 * forcing a reflow (`offsetWidth`) before reapplying it is the standard
 * way to restart a CSS animation from its beginning rather than letting
 * the browser continue whatever frame the old one was already on.
 */
function renderTickerText(): void {
  if (events.length === 0) {
    tickerTrack.textContent = '';
    tickerTrack.style.animation = 'none';
    return;
  }

  // Each line is its coloured tag and its text; one with a target is a
  // button (the track pauses under the pointer, so it can be clicked).
  const nodes: HTMLElement[] = [];
  const ordered = [...events.filter(isHighlighted), ...events.filter((event) => !isHighlighted(event))];
  ordered.forEach((event, i) => {
    if (i > 0) {
      const separator = document.createElement('span');
      separator.className = 'ticker-separator';
      separator.textContent = EVENT_SEPARATOR;
      nodes.push(separator);
    }
    const item = document.createElement(event.target ? 'button' : 'span');
    item.className = 'ticker-item';
    item.classList.toggle('is-highlighted', isHighlighted(event));
    if (event.target) {
      const target = event.target;
      (item as HTMLButtonElement).type = 'button';
      item.addEventListener('click', () => {
        // Read: it stops standing out.
        if (event.highlightUntil !== undefined) {
          event.highlightUntil = undefined;
          renderTickerText();
        }
        select(target);
      });
    }
    const tag = document.createElement('span');
    tag.className = `ticker-tag ticker-tag--${event.tag.toLowerCase()}`;
    tag.textContent = event.tag;
    item.append(tag, ` ${event.message}`);
    nodes.push(item);
  });
  tickerTrack.replaceChildren(...nodes);
  tickerTrack.style.animation = 'none';
  void tickerTrack.offsetWidth; // force a reflow so the animation below actually restarts
  const distancePx = tickerTrack.scrollWidth + window.innerWidth;
  const durationSeconds = distancePx / PIXELS_PER_SECOND;
  tickerTrack.style.animation = `ticker-scroll ${durationSeconds}s linear infinite`;
}

// Weather and competitor-route detection each keep their own independent
// "have I already announced this" bookkeeping, deliberately separate
// from render/competition.ts's own similar diffing for its map flash —
// two independent consumers polling one shared, mutating diff would
// race over which one actually "sees" a new event first. Duplicating
// the small diff loop per consumer, each with its own local state, costs
// a few lines and avoids that entirely.

let hasSeenInitialWeather = false;
let previousWeatherAirports = new Set<string>();

function pollWeatherEvents(state: SimState): void {
  // Only storms at airports the airline actually flies to. Every storm on
  // the known map drowned the ticker — a snowy January put a dozen
  // "Snowstorm forms at …" lines between each AOG or market arrival, which
  // are the news a player has to act on. Storms elsewhere still show on the map.
  const network = networkAirports(state);
  const currentAirports = new Set(Object.keys(state.weatherByAirport).filter((iata) => network.has(iata)));

  // First call just establishes the baseline — a fresh page load or a
  // resumed save with weather already active shouldn't announce every
  // pre-existing storm at once, only ones that appear after this point.
  if (!hasSeenInitialWeather) {
    previousWeatherAirports = currentAirports;
    hasSeenInitialWeather = true;
    return;
  }

  for (const iata of currentAirports) {
    if (previousWeatherAirports.has(iata)) continue;
    const kindLabel = state.weatherByAirport[iata].kind === 'thunderstorm' ? 'thunderstorm' : 'snowstorm';
    pushEvent(state.simMinute, 'WX', `${iata} · ${kindLabel}`, { kind: 'airport', iata });
  }
  previousWeatherAirports = currentAirports;
}

/**
 * Why a rival came, when it opens on a market the player flies: what it
 * read there (sim/attractiveness.ts), the passengers turned away or the
 * margin after costs, whichever was the bigger draw. Empty elsewhere.
 */
function entryReason(state: SimState, a: string, b: string): string {
  if (legsServingMarket(a, b, state.schedule) === 0) return '';
  const table = moneyOnTable(state, a, b);
  const spillValue = table.turnedAway * recommendedFare(a, b);
  const marginValue = RIVAL_MARGIN_SHARE * Math.max(0, table.fullyCostedMargin);
  if (spillValue <= 0 && marginValue <= 0) return '';
  return spillValue >= marginValue
    ? ` · drawn by ${Math.round(table.turnedAway)} pax/day you turn away`
    : ` · drawn by your ${shortMoney(table.fullyCostedMargin)}/day margin`;
}

/** Milestones met, and tiers climbed, as of the last poll (sim/ladder.ts). */
let seenMilestones: Set<string> | null = null;
let seenTiers = 0;

/**
 * The ladder: each milestone as it's met, and each new tier with what it
 * opens. The first poll only records where the airline stands, so loading
 * a save doesn't announce it all again.
 */
function pollLadderEvents(state: SimState): void {
  const met = Object.keys(state.milestonesMet ?? {});
  const climbed = tiersClimbed(state);
  if (seenMilestones === null) {
    seenMilestones = new Set(met);
    seenTiers = climbed;
    return;
  }
  for (const id of met) {
    if (seenMilestones.has(id)) continue;
    seenMilestones.add(id);
    const milestone = milestoneById(id);
    if (milestone) pushEvent(state.simMinute, 'GOAL', `Milestone · ${milestone.name}`, { kind: 'goals' });
  }
  for (; seenTiers < climbed; seenTiers++) {
    const next = LADDER[seenTiers + 1];
    const opened = LADDER[seenTiers].opens;
    pushEvent(
      state.simMinute,
      'GOAL',
      (next ? `Now ${airlineCalled(next)}` : 'Top tier reached') + (opened.length > 0 ? ` · opens ${opened.join(', ')}` : ''),
      { kind: 'goals' },
    );
  }
}

/** The shock running at the last poll, by its start day and kind, or null. */
let seenShock: Shock | null | undefined;

/**
 * Shocks (sim/shocks.ts): announced when one starts, with what it does and
 * for how long, and again when it's over. The first poll only records what
 * is running, so loading a save doesn't announce it again.
 */
function pollShockEvents(state: SimState): void {
  const running = activeShock(state);
  if (seenShock === undefined) {
    seenShock = running;
    return;
  }
  // The same shock (or still none) since the last poll: nothing to say.
  if (seenShock?.startDay === running?.startDay && seenShock?.kind === running?.kind) return;
  // A fuel spike is read against the fuel chart at Head office.
  const shockTarget = (shock: Shock): Selection | undefined =>
    shock.kind === 'fuel' ? { kind: 'headOffice' } : shock.centre ? { kind: 'airport', iata: shock.centre } : undefined;
  if (seenShock) pushEvent(state.simMinute, 'SHOCK', shockEndedLine(seenShock), shockTarget(seenShock));
  if (running) pushEvent(state.simMinute, 'SHOCK', describeShock(state)!.headline, shockTarget(running));
  seenShock = running;
}

// The running hedge's start day at the last poll, so its end is said once.
let seenHedgeStart: number | null | undefined;

/** How a hedge went, the day it runs out (sim/fuelPrice.ts). */
function pollHedgeEvents(state: SimState): void {
  const running = activeHedge(state)?.startDay ?? null;
  if (seenHedgeStart !== undefined && seenHedgeStart !== null && running !== seenHedgeStart && state.fuelHedge?.startDay === seenHedgeStart) {
    const hedge = state.fuelHedge;
    const net = hedge.saved - hedge.premium;
    pushEvent(state.simMinute, 'FUEL', `Hedge ended · ${net >= 0 ? '+' : ''}${shortMoney(net)} net of premium`, { kind: 'headOffice' });
  }
  seenHedgeStart = running;
}

// The fleet and crews at the last poll, so arrivals and departures are
// said once (sim/fleetTiming.ts, sim/crews.ts). Undefined until the first
// poll, which only records: loading a game isn't news.
let seenTails: Map<string, { typeCode: string; base: string | null }> | undefined;
let seenCrews: Map<string, number> | undefined;

/** A plane delivered, a plane gone back to the lessor, crews joining a base. */
function pollFleetEvents(state: SimState): void {
  const tails = new Map(state.aircraft.map((aircraft) => [aircraft.tail, { typeCode: aircraft.typeCode, base: aircraft.baseAirport }]));
  const crews = new Map<string, number>();
  for (const [iata, base] of Object.entries(state.crewBases ?? {})) {
    for (const [classCode, count] of Object.entries(base.crewsByClass ?? {})) crews.set(`${iata}:${classCode}`, count);
  }
  if (seenTails && seenCrews) {
    const className = (code: string) => classByCode(code)?.name ?? code;
    for (const [tail, plane] of tails) {
      if (!seenTails.has(tail)) pushEvent(state.simMinute, 'FLEET', `${tail} ${className(plane.typeCode)} delivered · ${plane.base ?? 'base'}`, { kind: 'aircraft', tail });
    }
    for (const [tail, plane] of seenTails) {
      if (!tails.has(tail)) pushEvent(state.simMinute, 'FLEET', `${tail} ${className(plane.typeCode)} returned to lessor`, plane.base ? { kind: 'airport', iata: plane.base } : undefined);
    }
    for (const [key, count] of crews) {
      const joined = count - (seenCrews.get(key) ?? 0);
      if (joined <= 0) continue;
      // A count only rises when hired or retrained crews join (at rollover).
      const [iata, classCode] = key.split(':');
      pushEvent(state.simMinute, 'CREW', `${iata} · +${joined} ${className(classCode)} crew${joined === 1 ? '' : 's'}`, { kind: 'airport', iata });
    }
  }
  seenTails = tails;
  seenCrews = crews;
}

// Each rival's tiers climbed at the last poll (sim/rivalLadder.ts).
const seenRivalTiers = new Map<string, number>();

/** A rival the player competes with near home climbing a tier, and the planes that opens to it. */
function pollRivalLadderEvents(state: SimState): void {
  const network = networkAirports(state);
  for (const code of new Set(state.competitorRoutes.map((route) => route.code))) {
    const tiers = rivalTiersClimbed(state, code);
    const before = seenRivalTiers.get(code);
    seenRivalTiers.set(code, tiers);
    if (before === undefined || tiers <= before) continue;
    const routes = state.competitorRoutes.filter((route) => route.code === code);
    if (!routes.some((route) => network.has(route.origin) || network.has(route.dest))) continue;
    const opens = LADDER[tiers - 1]?.opensClasses ?? [];
    if (opens.length === 0) continue;
    const names = opens.map((typeCode) => pluralClassName(AIRCRAFT_CLASSES.find((c) => c.code === typeCode)?.name ?? typeCode)).join(', ');
    pushEvent(state.simMinute, 'RIVAL', `${routes[0].airline} · now ${airlineCalled(LADDER[tiers])} · opens ${names}`, { kind: 'rival', code });
  }
}

let hasSeenInitialRivals = false;
/** Every rival route seen last poll, by identity, with what the ticker needs to describe it once it's gone. */
const seenRoutes = new Map<string, { frequency: number; airline: string; origin: string; dest: string }>();

/**
 * Rival news, but only what touches the airline: a route at an airport in
 * the player's network opening, adding a flight, or closing (a rival giving
 * up on a market it lost money on, sim/rivalEconomics.ts). A competitor
 * doing something on the far side of the map is not news to this player.
 */
function pollRivalEvents(state: SimState): void {
  const network = networkAirports(state);
  const identity = (route: { code: string; origin: string; dest: string }) =>
    `${route.code}:${[route.origin, route.dest].sort().join('-')}`;
  const touchesNetwork = (route: { origin: string; dest: string }) => network.has(route.origin) || network.has(route.dest);

  if (!hasSeenInitialRivals) {
    for (const route of state.competitorRoutes) {
      seenRoutes.set(identity(route), { frequency: route.dailyFrequency, airline: route.airline, origin: route.origin, dest: route.dest });
    }
    hasSeenInitialRivals = true;
    return;
  }

  const stillFlying = new Set<string>();
  for (const route of state.competitorRoutes) {
    const id = identity(route);
    stillFlying.add(id);
    const previous = seenRoutes.get(id)?.frequency;
    seenRoutes.set(id, { frequency: route.dailyFrequency, airline: route.airline, origin: route.origin, dest: route.dest });
    if (!touchesNetwork(route)) continue;

    if (previous === undefined) {
      pushEvent(state.simMinute, 'RIVAL', `${route.airline} · opens ${route.origin}–${route.dest}${entryReason(state, route.origin, route.dest)}`, {
        kind: 'rival',
        code: route.code,
      });
    } else if (route.dailyFrequency > previous) {
      pushEvent(state.simMinute, 'RIVAL', `${route.airline} · ${route.origin}–${route.dest} up to ${route.dailyFrequency}/day`, { kind: 'rival', code: route.code });
    }
  }

  for (const [id, route] of seenRoutes) {
    if (stillFlying.has(id)) continue;
    seenRoutes.delete(id);
    if (!touchesNetwork(route)) continue;
    const yours = state.schedule.some((leg) => marketKey(leg.origin, leg.dest) === marketKey(route.origin, route.dest));
    pushEvent(
      state.simMinute,
      'RIVAL',
      `${route.airline} · exits ${route.origin}–${route.dest}` + (yours ? ` · no new rival for ${RIVAL_SQUEEZED_RESPITE_DAYS}d` : ''),
      // The market you now have to yourself, or the rival that left another.
      yours ? { kind: 'route', a: route.origin, b: route.dest } : { kind: 'rival', code: id.split(':')[0] },
    );
  }
}

/** Each rival route's losing run at the last poll, so a squeeze is announced as it starts and nears its end. */
const seenLosingDays = new Map<string, number>();

/**
 * A rival losing money on one of your markets (sim/rivalEconomics.ts),
 * at the moments that matter: when its losing run starts, and at
 * PAIN_WARNING_DAYS, when pulling out is close. Its closing is
 * pollRivalEvents()'s line.
 */
function pollRivalPainEvents(state: SimState): void {
  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const route of state.competitorRoutes) {
    const key = marketKey(route.origin, route.dest);
    const id = `${route.code}:${key}`;
    const losing = route.losingDays ?? 0;
    const before = seenLosingDays.get(id);
    seenLosingDays.set(id, losing);
    if (before === undefined || !flown.has(key)) continue;
    const market: Selection = { kind: 'route', a: route.origin, b: route.dest };
    if (before === 0 && losing > 0) pushEvent(state.simMinute, 'RIVAL', `${route.airline} · ${route.origin}–${route.dest} losing money`, market);
    if (before < PAIN_WARNING_DAYS && losing >= PAIN_WARNING_DAYS) {
      pushEvent(
        state.simMinute,
        'RIVAL',
        `${route.airline} · ${route.origin}–${route.dest} losing ${losing}/${RIVAL_CLOSE_AFTER_LOSING_DAYS}d · exits in ${RIVAL_CLOSE_AFTER_LOSING_DAYS - losing}d`,
        market,
      );
    }
  }
}

/** The losing run at which the ticker warns a rival is close to pulling out. */
const PAIN_WARNING_DAYS = 20;

let previousKnownCount: number | null = null;
let previousKnown = new Set<string>();

/**
 * Announce airports the fog has just lifted from. The first call only
 * records what is already known, so loading a save does not announce
 * the whole map.
 */
function pollReachEvents(state: SimState): void {
  // At minute 0 nothing has happened yet, so whatever is known is the
  // starting picture (including the reveal from choosing a home city), not news.
  if (previousKnownCount === null || state.simMinute === 0) {
    previousKnown = new Set(state.knownAirports);
    previousKnownCount = previousKnown.size;
    return;
  }
  if (state.knownAirports.length === previousKnownCount) return;

  const added = state.knownAirports.filter((iata) => !previousKnown.has(iata));
  previousKnown = new Set(state.knownAirports);
  previousKnownCount = previousKnown.size;
  if (added.length === 0) return;
  const shown = added.slice(0, 4).join(', ');
  pushEvent(state.simMinute, 'REACH', `${shown}${added.length > 4 ? ` +${added.length - 4} more` : ''} in reach`, { kind: 'airports' });
}

/**
 * AOGs (sim/aog.ts) are reported here rather than on the utilisation
 * display, which only shows the red "−1": a plane going down (and what it
 * cancels), cover changing while it's out (the player freed time, or lost
 * it), and the repair finishing.
 */
let hasSeenInitialAogs = false;
const seenAogs = new Map<string, string>();

function pollAogEvents(state: SimState): void {
  const current = new Map(state.aogs.map((event) => [event.tail, event.uncoveredRoutes.join(', ')]));
  if (!hasSeenInitialAogs) {
    for (const [tail, uncovered] of current) seenAogs.set(tail, uncovered);
    hasSeenInitialAogs = true;
    return;
  }

  for (const event of state.aogs) {
    const uncovered = event.uncoveredRoutes.join(', ');
    const previous = seenAogs.get(event.tail);
    if (previous === undefined) {
      const days = Math.max(1, Math.ceil((event.returnsAtMinute - state.simMinute) / 1440));
      pushEvent(
        state.simMinute,
        'AOG',
        `${event.base} · ${event.tail} · ${event.fault} · back ~${days}d · ` + (uncovered ? `CNX ${uncovered}` : 'flying covered'),
        // The Maintenance screen, where the repair can be expedited.
        { kind: 'maintenance' },
      );
    } else if (uncovered !== previous) {
      pushEvent(state.simMinute, 'AOG', `${event.tail} · ` + (uncovered ? `CNX ${uncovered}` : 'all flying now covered'), { kind: 'maintenance' });
    }
    seenAogs.set(event.tail, uncovered);
  }

  for (const tail of [...seenAogs.keys()]) {
    if (current.has(tail)) continue;
    seenAogs.delete(tail);
    const aircraft = state.aircraft.find((a) => a.tail === tail);
    pushEvent(state.simMinute, 'AOG', `${tail} back in service${aircraft?.baseAirport ? ` · ${aircraft.baseAirport}` : ''}`, aircraft ? { kind: 'aircraft', tail } : undefined);
  }
}

/** Stranded planes ferried home empty (sim/ferry.ts): one line each, from the sim's log. */
let lastFerryMinute: number | null = null;

function pollFerryEvents(state: SimState): void {
  const log = state.ferryLog ?? [];
  if (lastFerryMinute === null) {
    lastFerryMinute = log.length > 0 ? log[log.length - 1].simMinute : -1;
    return;
  }
  for (const ferry of log) {
    if (ferry.simMinute <= lastFerryMinute) continue;
    pushEvent(state.simMinute, 'FLEET', `${ferry.tail} ferried ${ferry.from}→${ferry.to} empty · ${shortMoney(ferry.cost)}`, { kind: 'aircraft', tail: ferry.tail });
  }
  if (log.length > 0) lastFerryMinute = Math.max(lastFerryMinute, log[log.length - 1].simMinute);
}

/**
 * The fleet market (sim/market.ts): airframes arriving at the lessor, and
 * rivals leasing from it — the "Trillium Air took the last Regional"
 * moments. Class debuts get a pop-up of their own (ui/market.ts).
 */
let hasSeenInitialMarket = false;
let lastListingId = 0;
const seenRivalFleetSizes = new Map<string, number>();

function pollMarketEvents(state: SimState): void {
  if (!hasSeenInitialMarket) {
    lastListingId = state.market.nextListingId - 1;
    for (const [code, fleet] of Object.entries(state.competitorFleets)) seenRivalFleetSizes.set(code, fleet.length);
    hasSeenInitialMarket = true;
    return;
  }

  for (const listing of state.market.listings) {
    if (listing.id <= lastListingId) continue;
    // Only classes the player can lease (sim/ladder.ts): a locked class's
    // listings are for rivals, and announcing them reads as if it were
    // on sale to the player on a timer.
    if (!classOpen(state, listing.typeCode)) continue;
    const name = AIRCRAFT_CLASSES.find((c) => c.code === listing.typeCode)?.name ?? listing.typeCode;
    pushEvent(state.simMinute, 'LESSOR', `${name} listed · ${listing.ageYears} yrs · ${shortMoney(listing.leasePricePerDay)}/day`);
  }
  lastListingId = Math.max(lastListingId, state.market.nextListingId - 1);

  const inSight = rivalsInSight(state);
  for (const [code, fleet] of Object.entries(state.competitorFleets)) {
    const previous = seenRivalFleetSizes.get(code) ?? fleet.length;
    seenRivalFleetSizes.set(code, fleet.length);
    // A rival flying only in the fog isn't news to this player.
    if (fleet.length <= previous || !inSight.has(code)) continue;
    const airline = state.competitorRoutes.find((route) => route.code === code)?.airline ?? code;
    for (const typeCode of fleet.slice(previous)) {
      const name = AIRCRAFT_CLASSES.find((c) => c.code === typeCode)?.name ?? typeCode;
      const left = state.market.listings.filter((l) => l.typeCode === typeCode).length;
      pushEvent(state.simMinute, 'LESSOR', `${airline} took a ${name} · ${left === 0 ? 'none left' : `${left} left`}`, { kind: 'rival', code });
    }
  }
}

/**
 * Rivals repricing against the player (sim/competitors.ts): reported once
 * a rival's fare on one of the player's markets has moved 5% or more since
 * it was last reported, so a price war reads as a few clear lines rather
 * than a daily trickle.
 */
const RIVAL_FARE_REPORT_SHARE = 0.05;
let hasSeenInitialRivalFares = false;
const reportedRivalFares = new Map<string, number>();

function pollRivalFareEvents(state: SimState): void {
  const identity = (route: { code: string; origin: string; dest: string }) => `${route.code}:${[route.origin, route.dest].sort().join('-')}`;
  if (!hasSeenInitialRivalFares) {
    for (const route of state.competitorRoutes) reportedRivalFares.set(identity(route), route.fare);
    hasSeenInitialRivalFares = true;
    return;
  }
  const playerMarkets = new Set(state.schedule.map((leg) => [leg.origin, leg.dest].sort().join('-')));
  for (const route of state.competitorRoutes) {
    const id = identity(route);
    const reported = reportedRivalFares.get(id);
    if (reported === undefined) {
      reportedRivalFares.set(id, route.fare);
      continue;
    }
    const market = [route.origin, route.dest].sort().join('-');
    if (!playerMarkets.has(market)) {
      reportedRivalFares.set(id, route.fare);
      continue;
    }
    if (Math.abs(route.fare - reported) < reported * RIVAL_FARE_REPORT_SHARE) continue;
    reportedRivalFares.set(id, route.fare);
    const yours = state.routeSettings[market]?.fare;
    pushEvent(
      state.simMinute,
      'FARE',
      `${route.airline} · ${route.origin}–${route.dest} ${route.fare < reported ? '▼' : '▲'} $${route.fare.toLocaleString()}` +
        (yours !== undefined ? ` · you $${yours.toLocaleString()}` : ''),
      { kind: 'route', a: route.origin, b: route.dest },
    );
  }
}

/**
 * A leg cancelled because its plane was parked at another airport
 * (sim/step.ts): the plane was stranded by an earlier disruption and
 * picks its day up from where it is. Said here because nothing else on
 * screen would show a flight that simply didn't happen.
 */
let hasSeenInitialPositions = false;
let lastPositionCount = 0;
let previousCancelled = new Set<string>();

function pollPositionEvents(state: SimState): void {
  const count = state.cancellationsByCause.position ?? 0;
  const cancelled = new Set(state.cancelledToday);
  if (hasSeenInitialPositions && count > lastPositionCount) {
    for (const legId of cancelled) {
      if (previousCancelled.has(legId)) continue;
      const leg = state.schedule.find((l) => l.legId === legId);
      const aircraft = leg && state.aircraft.find((a) => a.tail === leg.tail);
      if (!leg || !aircraft || aircraft.status !== 'ground' || aircraft.atAirport === leg.origin) continue;
      pushEvent(state.simMinute, 'CNX', `${leg.origin}→${leg.dest} · ${leg.tail} out of position at ${aircraft.atAirport}`, { kind: 'aircraft', tail: leg.tail });
    }
  }
  hasSeenInitialPositions = true;
  lastPositionCount = count;
  previousCancelled = cancelled;
}

// Each contract's status and renewals at the last poll (sim/contracts.ts).
// The first poll only records, so loading a game isn't news.
let seenContracts: Map<number, string> | undefined;

/** Contracts: offered, started, renewed, ended (with the snap-back), or lapsed. */
function pollContractEvents(state: SimState): void {
  const now = new Map(contractsOf(state).map((c) => [c.id, `${c.status}:${c.renewals ?? 0}`]));
  if (seenContracts) {
    for (const c of contractsOf(state)) {
      const before = seenContracts.get(c.id);
      const after = now.get(c.id);
      if (before === after) continue;
      const route: Selection = { kind: 'route', a: c.a, b: c.b };
      const market = `${c.a}–${c.b}`;
      if (before === undefined && c.status === 'offered') {
        pushEvent(
          state.simMinute,
          'CONTRACT',
          `New contract · ${market} · ${shortMoney(c.paymentPerDay)}/day · ${c.termDays}d · take by day ${c.offerEndsDay}`,
          { kind: 'headOffice' },
          true,
        );
      } else if (c.status === 'active' && before?.startsWith('offered')) {
        pushEvent(state.simMinute, 'CONTRACT', `${market} contract started · ends day ${c.endsDay}`, route);
      } else if (c.status === 'active') {
        pushEvent(state.simMinute, 'CONTRACT', `${market} renewed · ${shortMoney(c.paymentPerDay)}/day to day ${c.endsDay}`, route);
      } else if (c.status === 'ended') {
        pushEvent(state.simMinute, 'CONTRACT', `${market} contract over · demand −${Math.round(SNAP_BACK_SHARE * 100)}%`, route);
      } else if (c.status === 'lapsed') {
        pushEvent(state.simMinute, 'CONTRACT', `${market} offer lapsed`);
      }
    }
  }
  seenContracts = now;
}

/**
 * The bottom-of-screen ticker for events nobody clicked to cause: the
 * ladder, shocks, new weather, new airports in reach, rivals moving in on
 * your network, and the rest below. Called every frame from main.ts's
 * render(), so an event is announced whichever panel is open.
 */
/** Whether any line was highlighted at the last render, so its running out re-renders the ticker. */
let highlightedShown = false;

export function updateTicker(state: SimState): void {
  const anyHighlighted = events.some(isHighlighted);
  if (highlightedShown !== anyHighlighted) {
    highlightedShown = anyHighlighted;
    renderTickerText();
  }
  pollLadderEvents(state);
  pollContractEvents(state);
  pollShockEvents(state);
  pollHedgeEvents(state);
  pollFleetEvents(state);
  pollPositionEvents(state);
  pollAogEvents(state);
  pollFerryEvents(state);
  pollRivalFareEvents(state);
  pollMarketEvents(state);
  pollReachEvents(state);
  pollRivalEvents(state);
  pollRivalLadderEvents(state);
  pollRivalPainEvents(state);
  pollWeatherEvents(state);
}
