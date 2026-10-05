import { DIFFICULTY_SETTINGS, type GameDifficulty } from '../sim/difficulty';
import homeStoriesData from '../../data/home-stories.json';
import type { StartSeason } from '../sim/clock';
import { homeNeighbours, PROPELLER_RANGE_NM, type HomeOption } from '../sim/homes';
import { drawPickerMap, loadFinePickerLand, type PickerPoint, type PickerView } from '../render/pickerMap';
import { airports } from '../render/airports';
import { fitWorld, projection } from '../render/projection';
import { setupMapInput } from './mapInput';

/**
 * The first screen of a new game: choose the city the airline starts
 * from, the date it starts and the difficulty (sim/difficulty.ts). Shown
 * only when there is no saved game to
 * resume; the game is paused while it is open (main.ts), so no simulated
 * time passes while the player thinks.
 *
 * Two ways to choose, as a strategy game offers a featured list and the
 * whole map:
 *   - **The world map**: the featured homes (data/home-stories.json) as
 *     bright dots. The cursor snaps to the nearest one and its story shows
 *     along the bottom; a click chooses it, then "Start" begins.
 *   - **"Select a different airport"**: every home in a list, biggest
 *     catchment first. A click there starts straight away. Cities carry no
 *     rating: which ones play differently is for the player to find out.
 *
 * Both share the start date (1 May or 1 November, sim/clock.ts) and the
 * difficulty.
 */

type Story = { region: string; world: string; game: string };
const stories = homeStoriesData as unknown as Record<string, Story | string>;

/** How far, in screen pixels, the cursor reaches for the nearest featured home. */
const SNAP_RADIUS_PX = 70;
/** A fingertip covers more than a cursor, but the map is zoomable, so a tighter reach keeps a tap on the dot it meant. */
const TOUCH_SNAP_RADIUS_PX = 44;
const MAX_ZOOM = 8;
const DOUBLE_TAP_ZOOM = 2;
const MAP_INSET_PX = 16;

const worldEl = document.querySelector<HTMLDivElement>('#home-world')!;
const worldCanvas = document.querySelector<HTMLCanvasElement>('#home-world-map')!;
const worldCtx = worldCanvas.getContext('2d')!;
const panelEl = document.querySelector<HTMLDivElement>('#home-world-panel')!;
const storyEl = document.querySelector<HTMLDivElement>('#home-world-story')!;
const startButton = document.querySelector<HTMLButtonElement>('#home-world-start')!;
const seasonNoteEl = document.querySelector<HTMLElement>('#home-world-season-note')!;
const otherButton = document.querySelector<HTMLButtonElement>('#home-world-other')!;

const modalEl = document.querySelector<HTMLDivElement>('#home-picker-modal')!;
const rangeEl = document.querySelector<HTMLElement>('#home-picker-range')!;
const listEl = document.querySelector<HTMLDivElement>('#home-picker-list')!;
const backButton = document.querySelector<HTMLButtonElement>('#home-picker-back')!;
const seasonButtons = document.querySelectorAll<HTMLButtonElement>('[data-season]');
const difficultyButtons = document.querySelectorAll<HTMLButtonElement>('[data-difficulty]');
const difficultyNoteEl = document.querySelector<HTMLElement>('#home-world-difficulty-note')!;

let chosenSeason: StartSeason = 'summer';
let chosenDifficulty: GameDifficulty = 'medium';
let options: HomeOption[] = [];
let featured: (PickerPoint & { option: HomeOption; story: Story })[] = [];
let lifted: (typeof featured)[number] | null = null;
let pinned: (typeof featured)[number] | null = null;
let choose: (iata: string, season: StartSeason, difficulty: GameDifficulty) => void = () => {};

/**
 * The picker's own zoom and pan, on top of the whole-world fit: a factor
 * (1 = the world fits the window) and a pixel offset. Touch only, so a
 * phone can enlarge a crowded region; the mouse view is unchanged.
 */
const zoomState = { factor: 1, panX: 0, panY: 0 };

const pointByIata = new Map(airports.map((airport) => [airport.iata, { iata: airport.iata, lon: airport.lon, lat: airport.lat }]));

/**
 * What the chosen date opens into, for the home shown. The two dates are
 * the same everywhere, but south of the equator 1 May is the start of
 * winter (sim/seasons.ts).
 */
function seasonNote(home: PickerPoint | null): string {
  const southern = (home?.lat ?? 0) < 0;
  if (chosenSeason === 'summer') return southern ? 'Winter ahead · quiet until Christmas' : 'Summer ahead · leisure peaks in July';
  return southern ? 'Summer ahead · Christmas, then the January peak' : 'Winter ahead · quiet November, then Christmas';
}

function showSeason(): void {
  seasonButtons.forEach((button) => button.classList.toggle('active', button.dataset.season === chosenSeason));
  seasonNoteEl.textContent = seasonNote(lifted ?? pinned);
}

seasonButtons.forEach((button) =>
  button.addEventListener('click', () => {
    chosenSeason = button.dataset.season as StartSeason;
    showSeason();
  }),
);

/** What the chosen difficulty changes, in the panel's terms (sim/difficulty.ts has the numbers). */
function difficultyNote(): string {
  const settings = DIFFICULTY_SETTINGS[chosenDifficulty];
  const cash = `$${settings.startingCash / 1_000}k`;
  return `${cash} · rivals d${settings.rivalFirstEntryDay} · shocks d${settings.firstShockDay}`;
}

function showDifficulty(): void {
  difficultyButtons.forEach((button) => button.classList.toggle('active', button.dataset.difficulty === chosenDifficulty));
  difficultyNoteEl.textContent = difficultyNote();
}

difficultyButtons.forEach((button) =>
  button.addEventListener('click', () => {
    chosenDifficulty = button.dataset.difficulty as GameDifficulty;
    showDifficulty();
  }),
);

function millions(population: number): string {
  return `${(population / 1_000_000).toFixed(population >= 10_000_000 ? 0 : 1)}M`;
}

function textEl(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/** The story along the bottom: the home under the cursor, else the one chosen, else a hint. */
function showStory(): void {
  const home = lifted ?? pinned;
  if (!home) {
    const how = window.matchMedia('(pointer: coarse)').matches ? 'tap one to choose it · pinch to zoom' : 'point at one to read it, click to choose it';
    storyEl.replaceChildren(textEl('p', 'home-world-hint', `${featured.length} featured homes · ${how}`));
  } else {
    const { option, story } = home;
    storyEl.replaceChildren(
      textEl('div', 'home-world-name', `${option.iata} · ${option.name}`),
      textEl('div', 'home-world-facts', [story.region, `${option.neighbours} within reach`, `${millions(option.population)} catchment`].join(' · ')),
      textEl('p', 'home-world-text', story.world),
      textEl('p', 'home-world-text home-world-text--game', story.game),
    );
  }
  startButton.disabled = pinned === null;
  startButton.textContent = pinned ? `Start at ${pinned.iata}` : 'Start';
  showSeason();
}

function drawWorld(): void {
  // Only while it's on screen: hiding it fires pointerleave, and a redraw
  // then would refit the shared projection after the game has fitted it to home.
  if (worldEl.hidden) return;
  const width = worldEl.clientWidth;
  const height = worldEl.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (worldCanvas.width !== width * dpr || worldCanvas.height !== height * dpr) {
    worldCanvas.width = width * dpr;
    worldCanvas.height = height * dpr;
  }
  worldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Fitted on every draw: the game map (main.ts) refits the same projection to home on a resize.
  fitWorld(width, height, { top: MAP_INSET_PX, right: MAP_INSET_PX, bottom: panelEl.offsetHeight + MAP_INSET_PX, left: MAP_INSET_PX });
  applyZoom(width, height);
  const view: PickerView = {
    airports: [...pointByIata.values()],
    featured,
    lifted: lifted
      ? {
          home: lifted,
          label: lifted.option.name,
          reach: homeNeighbours(lifted.iata).flatMap((iata) => pointByIata.get(iata) ?? []),
        }
      : null,
    pinned,
  };
  drawPickerMap(worldCtx, width, height, view);
}

/** Lay the zoom and pan over the fitted projection, keeping the map covering the window. */
function applyZoom(width: number, height: number): void {
  const mapHeight = height - panelEl.offsetHeight;
  zoomState.panX = Math.min(0, Math.max(width * (1 - zoomState.factor), zoomState.panX));
  zoomState.panY = Math.min(0, Math.max(mapHeight * (1 - zoomState.factor), zoomState.panY));
  if (zoomState.factor === 1) {
    zoomState.panX = 0;
    zoomState.panY = 0;
    return;
  }
  const [translateX, translateY] = projection.translate();
  projection.scale(projection.scale() * zoomState.factor);
  projection.translate([translateX * zoomState.factor + zoomState.panX, translateY * zoomState.factor + zoomState.panY]);
}

/** Change the zoom by `ratio`, keeping the map point under (centerX, centerY) where it is. */
function zoomAround(ratio: number, centerX: number, centerY: number): void {
  const next = Math.min(MAX_ZOOM, Math.max(1, zoomState.factor * ratio));
  const applied = next / zoomState.factor;
  zoomState.panX = centerX - (centerX - zoomState.panX) * applied;
  zoomState.panY = centerY - (centerY - zoomState.panY) * applied;
  zoomState.factor = next;
}

/** The featured home nearest the cursor, within the snap radius. */
function nearestFeatured(x: number, y: number, radius = SNAP_RADIUS_PX): (typeof featured)[number] | null {
  let best: (typeof featured)[number] | null = null;
  let bestDistance = radius;
  for (const home of featured) {
    const at = projection([home.lon, home.lat]);
    if (!at) continue;
    const distance = Math.hypot(at[0] - x, at[1] - y);
    if (distance < bestDistance) [best, bestDistance] = [home, distance];
  }
  return best;
}

function pointerAt(event: PointerEvent): [number, number] {
  const box = worldCanvas.getBoundingClientRect();
  return [event.clientX - box.left, event.clientY - box.top];
}

function chooseAt(x: number, y: number, radius: number): void {
  const home = nearestFeatured(x, y, radius);
  if (!home) return;
  pinned = home;
  lifted = null;
  showStory();
  drawWorld();
}

// Touch goes through the same state machine as the game map (ui/mapInput.ts).
setupMapInput(worldCanvas, (clientX, clientY) => {
  const box = worldCanvas.getBoundingClientRect();
  return [clientX - box.left, clientY - box.top];
}, {
  pressed: () => {},
  cancelHold: () => {},
  gestureStarted: () => {},
  holdFired: () => false,
  pan: (dx, dy) => {
    zoomState.panX += dx;
    zoomState.panY += dy;
    drawWorld();
  },
  pinch: (x, y, ratio, dx, dy) => {
    zoomState.panX += dx;
    zoomState.panY += dy;
    zoomAround(ratio, x, y);
    drawWorld();
  },
  gestureEnded: () => {},
  tap: (clientX, clientY) => {
    const box = worldCanvas.getBoundingClientRect();
    chooseAt(clientX - box.left, clientY - box.top, TOUCH_SNAP_RADIUS_PX);
  },
  doubleTap: (x, y) => {
    zoomAround(DOUBLE_TAP_ZOOM, x, y);
    drawWorld();
  },
});

worldCanvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  const next = nearestFeatured(...pointerAt(event));
  if (next === lifted) return;
  lifted = next;
  worldCanvas.style.cursor = lifted ? 'pointer' : 'default';
  showStory();
  drawWorld();
});

worldCanvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'touch' || !lifted) return;
  lifted = null;
  showStory();
  drawWorld();
});

worldCanvas.addEventListener('click', (event) => {
  // A touch is chosen on pointerup, above; the click that follows it would choose twice.
  if ((event as PointerEvent).pointerType === 'touch') return;
  chooseAt(...pointerAt(event as PointerEvent), SNAP_RADIUS_PX);
});

startButton.addEventListener('click', () => {
  if (!pinned) return;
  start(pinned.iata);
});

otherButton.addEventListener('click', () => {
  modalEl.hidden = false;
});

backButton.addEventListener('click', () => {
  modalEl.hidden = true;
});

window.addEventListener('resize', drawWorld);
window.visualViewport?.addEventListener('resize', drawWorld);

function start(iata: string): void {
  worldEl.hidden = true;
  modalEl.hidden = true;
  choose(iata, chosenSeason, chosenDifficulty);
}

/** One city's row in the full list: its code, name and reach. Choosing it starts the game there. */
function optionButton(option: HomeOption): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-option';
  button.append(
    textEl('span', 'home-option-code', option.iata),
    textEl('span', 'home-option-name', option.name),
    textEl('span', 'home-option-reach', `${option.neighbours} within reach`),
  );
  button.addEventListener('click', () => start(option.iata));
  return button;
}

function fillList(): void {
  rangeEl.textContent = String(PROPELLER_RANGE_NM);
  listEl.replaceChildren(...options.map(optionButton));
}

export function showHomePicker(homes: HomeOption[], onChoose: (iata: string, season: StartSeason, difficulty: GameDifficulty) => void): void {
  options = homes;
  choose = onChoose;
  const optionByIata = new Map(homes.map((option) => [option.iata, option]));
  // A featured home must still be a pickable one (sim/homes.ts); the stories file can't add a home.
  featured = Object.entries(stories).flatMap(([iata, story]) => {
    const option = optionByIata.get(iata);
    const point = pointByIata.get(iata);
    return typeof story === 'object' && option && point ? [{ ...point, option, story }] : [];
  });
  fillList();
  showDifficulty();
  worldEl.hidden = false;
  zoomState.factor = 1;
  showStory();
  drawWorld();
  loadFinePickerLand(drawWorld);
}
