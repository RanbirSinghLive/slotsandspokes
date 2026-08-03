import { loadMissions } from '../sim/missions';
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

/**
 * Same bidirectional market-pair key every other "market" concept in
 * this codebase uses — duplicated locally rather than imported, matching
 * the existing pattern of a small local copy per file.
 */
function marketKey(a: string, b: string): string {
  return [a, b].sort().join('-');
}

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
  const currentAirports = new Set(Object.keys(state.weatherByAirport));

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

let hasSeenInitialCompetitorRoutes = false;
const seenCompetitorRouteKeys = new Set<string>();

function pollCompetitorEvents(state: SimState): void {
  if (!hasSeenInitialCompetitorRoutes) {
    for (const route of state.competitorRoutes) {
      seenCompetitorRouteKeys.add(`${route.code}:${marketKey(route.origin, route.dest)}`);
    }
    hasSeenInitialCompetitorRoutes = true;
    return;
  }

  for (const route of state.competitorRoutes) {
    const id = `${route.code}:${marketKey(route.origin, route.dest)}`;
    if (seenCompetitorRouteKeys.has(id)) continue;
    seenCompetitorRouteKeys.add(id);
    pushEvent(state.simMinute, `${route.airline} opens ${route.origin}–${route.dest}`);
  }
}

/**
 * The bottom-of-screen ticker for events nobody clicked to cause — new
 * weather forming, a competitor opening a route — the same two "non-
 * player" categories render/competition.ts's map flash already surfaces
 * visually, just as a persistent, always-visible scroll rather than
 * something you only catch while looking at the map. Called every frame
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

let hasSeenInitialFleet = false;
const seenTails = new Set<string>();

/**
 * Week eight's aircraft deliveries. An airframe ordered with a 90-day lead
 * time arrives long after the player stopped watching for it, and the
 * Inbound list simply goes quiet when it lands — so the arrival itself
 * gets announced, the same "diff against what I already announced" shape
 * as weather, competitor routes and missions above, each with its own
 * local bookkeeping.
 */
function pollFleetEvents(state: SimState): void {
  if (!hasSeenInitialFleet) {
    for (const aircraft of state.aircraft) seenTails.add(aircraft.tail);
    hasSeenInitialFleet = true;
    return;
  }

  for (const aircraft of state.aircraft) {
    if (seenTails.has(aircraft.tail)) continue;
    seenTails.add(aircraft.tail);
    pushEvent(state.simMinute, `${aircraft.tail} (${aircraft.typeCode}) delivered — assign it a base to put it to work`);
  }
}

export function updateTicker(state: SimState): void {
  pollWeatherEvents(state);
  pollCompetitorEvents(state);
  pollMissionEvents(state);
  pollFleetEvents(state);
}
