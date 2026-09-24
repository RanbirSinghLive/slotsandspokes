import { loadMissions } from '../sim/missions';
import { networkAirports } from '../sim/reach';
import { AIRCRAFT_CLASSES } from '../sim/aircraftClasses';
import type { SimState } from '../sim/state';

const tickerTrack = document.querySelector<HTMLDivElement>('#ticker-track')!;

// How many recent messages the ticker keeps queued up, and how fast the
// scroll moves — a fixed *speed*, not a fixed animation duration, so a
// short queue doesn't zip past and a long one doesn't crawl (see
// restartScrollAnimation() below).
const MAX_EVENTS = 20;
const EVENT_SEPARATOR = '   •   ';
const PIXELS_PER_SECOND = 60;

type TickerEvent = { simMinute: number; message: string };

let events: TickerEvent[] = [];

function pushEvent(simMinute: number, message: string): void {
  events.push({ simMinute, message });
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

  tickerTrack.textContent = events.map((event) => event.message).join(EVENT_SEPARATOR);
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
    const kindLabel = state.weatherByAirport[iata].kind === 'thunderstorm' ? 'Thunderstorm' : 'Snowstorm';
    pushEvent(state.simMinute, `${kindLabel} forms at ${iata}`);
  }
  previousWeatherAirports = currentAirports;
}

/**
 * The bottom-of-screen ticker for events nobody clicked to cause — new
 * weather forming, new airports in reach, and rivals moving in on your
 * network (see pollRivalEvents()). Called every frame
 * from main.ts's render(), *before* its `panelView !== 'map'` early
 * return, so an event happening while you're deep in the Commercial
 * panel still gets announced rather than silently missed.
 */
let hasSeenInitialMissions = false;
const seenMissionIds = new Set<string>();

/**
 * Week six's missions: same "diff against what I already announced"
 * shape as weather and competitor routes above, each with its own local
 * bookkeeping. The first call establishes a baseline so a resumed save
 * doesn't replay every mission ever completed as fresh news.
 */
function pollMissionEvents(state: SimState): void {
  if (!hasSeenInitialMissions) {
    for (const id of state.completedMissionIds) seenMissionIds.add(id);
    hasSeenInitialMissions = true;
    return;
  }

  for (const id of state.completedMissionIds) {
    if (seenMissionIds.has(id)) continue;
    seenMissionIds.add(id);
    const mission = loadMissions().find((m) => m.id === id);
    if (mission) {
      pushEvent(state.simMinute, `Mission complete: ${mission.name} (+${mission.reputationReward} Reputation)`);
    }
  }
}

let hasSeenInitialRivals = false;
const seenRouteFrequencies = new Map<string, number>();

/**
 * Rival news, but only what touches the airline: a route at an airport in
 * the player's network, or more flights on one. A competitor opening
 * something on the far side of the map is not news to this player.
 */
function pollRivalEvents(state: SimState): void {
  const network = networkAirports(state);
  const identity = (route: { code: string; origin: string; dest: string }) =>
    `${route.code}:${[route.origin, route.dest].sort().join('-')}`;

  if (!hasSeenInitialRivals) {
    for (const route of state.competitorRoutes) seenRouteFrequencies.set(identity(route), route.dailyFrequency);
    hasSeenInitialRivals = true;
    return;
  }

  for (const route of state.competitorRoutes) {
    const id = identity(route);
    const previous = seenRouteFrequencies.get(id);
    seenRouteFrequencies.set(id, route.dailyFrequency);
    if (!network.has(route.origin) && !network.has(route.dest)) continue;

    if (previous === undefined) {
      pushEvent(state.simMinute, `${route.airline} opens ${route.origin}–${route.dest}`);
    } else if (route.dailyFrequency > previous) {
      pushEvent(state.simMinute, `${route.airline} adds a flight on ${route.origin}–${route.dest} (${route.dailyFrequency}/day)`);
    }
  }
}

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
  pushEvent(state.simMinute, `New airports in reach: ${shown}${added.length > 4 ? ` and ${added.length - 4} more` : ''}`);
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
        `${event.tail} AOG at ${event.base} (${event.fault}), out ~${days} day${days === 1 ? '' : 's'}. ` +
          (uncovered ? `Cancelled until repaired: ${uncovered}` : 'Its flying moved to other planes'),
      );
    } else if (uncovered !== previous) {
      pushEvent(state.simMinute, uncovered ? `While ${event.tail} is repaired, cancelled: ${uncovered}` : `All of ${event.tail}'s flying is now covered`);
    }
    seenAogs.set(event.tail, uncovered);
  }

  for (const tail of [...seenAogs.keys()]) {
    if (current.has(tail)) continue;
    seenAogs.delete(tail);
    const aircraft = state.aircraft.find((a) => a.tail === tail);
    pushEvent(state.simMinute, `${tail} back in service${aircraft?.baseAirport ? ` at ${aircraft.baseAirport}` : ''}`);
  }
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
    const name = AIRCRAFT_CLASSES.find((c) => c.code === listing.typeCode)?.name ?? listing.typeCode;
    pushEvent(state.simMinute, `Lessor: ${name} listed (${listing.ageYears} yrs, $${listing.leasePricePerDay.toLocaleString()}/day)`);
  }
  lastListingId = Math.max(lastListingId, state.market.nextListingId - 1);

  for (const [code, fleet] of Object.entries(state.competitorFleets)) {
    const previous = seenRivalFleetSizes.get(code) ?? fleet.length;
    seenRivalFleetSizes.set(code, fleet.length);
    if (fleet.length <= previous) continue;
    const airline = state.competitorRoutes.find((route) => route.code === code)?.airline ?? code;
    for (const typeCode of fleet.slice(previous)) {
      const name = AIRCRAFT_CLASSES.find((c) => c.code === typeCode)?.name ?? typeCode;
      const left = state.market.listings.filter((l) => l.typeCode === typeCode).length;
      pushEvent(state.simMinute, `${airline} leased a ${name} from the lessor (${left === 0 ? 'none left' : `${left} left`})`);
    }
  }
}

export function updateTicker(state: SimState): void {
  pollAogEvents(state);
  pollMarketEvents(state);
  pollReachEvents(state);
  pollRivalEvents(state);
  pollWeatherEvents(state);
  pollMissionEvents(state);
}
