import homeStoriesData from '../../data/home-stories.json';
import type { StartSeason } from '../sim/clock';
import { homeNeighbours, homeReasons, PROPELLER_RANGE_NM, type HomeDifficulty, type HomeOption } from '../sim/homes';
import { drawPickerMap, type PickerPoint, type PickerView } from '../render/pickerMap';
import { airports } from '../render/airports';
import { fitWorld, projection } from '../render/projection';

/**
 * The first screen of a new game: choose the city the airline starts
 * from, and the date it starts. Shown only when there is no saved game to
 * resume; the game is paused while it is open (main.ts), so no simulated
 * time passes while the player thinks.
 *
 * Two ways to choose, as a strategy game offers a featured list and the
 * whole map:
 *   - **The world map**: the featured homes (data/home-stories.json) as
 *     bright dots. The cursor snaps to the nearest one and its story shows
 *     along the bottom; a click chooses it, then "Start" begins.
 *   - **"Select a different airport"**: every home in a list, grouped by
 *     how hard a start it is (sim/homes.ts), easiest first. A click there
 *     starts straight away.
 *
 * Both share the start date: 1 May or 1 November (sim/clock.ts).
 */

type Story = { region: string; world: string; game: string };
const stories = homeStoriesData as unknown as Record<string, Story | string>;

const GROUPS: { difficulty: HomeDifficulty | null; title: string; note: string }[] = [
  { difficulty: 'Standard', title: 'Standard starts', note: 'Room to learn: the first routes pay their way.' },
  { difficulty: 'Hard', title: 'Hard starts', note: 'The first routes lose money for weeks. Plan the opening.' },
  { difficulty: 'Brutal', title: 'Brutal starts', note: 'For experienced players: thin or short markets that sink a careless opening fast.' },
  { difficulty: null, title: 'Unrated', note: 'Not measured yet.' },
];

/** How far, in screen pixels, the cursor reaches for the nearest featured home. */
const SNAP_RADIUS_PX = 70;
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

let chosenSeason: StartSeason = 'summer';
let options: HomeOption[] = [];
let featured: (PickerPoint & { option: HomeOption; story: Story })[] = [];
let lifted: (typeof featured)[number] | null = null;
let pinned: (typeof featured)[number] | null = null;
let choose: (iata: string, season: StartSeason) => void = () => {};

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

function millions(population: number): string {
  return `${(population / 1_000_000).toFixed(population >= 10_000_000 ? 0 : 1)}M`;
}

function textEl(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/** Why a Hard or Brutal home is one, in a line (sim/homes.ts's homeReasons()); null for a Standard home or one with no reason found. */
function whyHard(option: HomeOption): string | null {
  if (option.difficulty !== 'Hard' && option.difficulty !== 'Brutal') return null;
  const reasons = homeReasons(option.iata);
  return reasons.length > 0 ? `Why hard · ${reasons.join(' · ')}` : null;
}

/** The story along the bottom: the home under the cursor, else the one chosen, else a hint. */
function showStory(): void {
  const home = lifted ?? pinned;
  if (!home) {
    storyEl.replaceChildren(textEl('p', 'home-world-hint', `${featured.length} featured homes · point at one to read it, click to choose it`));
  } else {
    const { option, story } = home;
    storyEl.replaceChildren(
      textEl('div', 'home-world-name', `${option.iata} · ${option.name}`),
      textEl('div', 'home-world-facts', [story.region, option.difficulty ?? 'Unrated', `${option.neighbours} within reach`, `${millions(option.population)} catchment`].join(' · ')),
      ...(whyHard(option) ? [textEl('div', 'home-world-why', whyHard(option)!)] : []),
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
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  if (worldCanvas.width !== width * dpr || worldCanvas.height !== height * dpr) {
    worldCanvas.width = width * dpr;
    worldCanvas.height = height * dpr;
  }
  worldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Fitted on every draw: the game map (main.ts) refits the same projection to home on a resize.
  fitWorld(width, height, { top: MAP_INSET_PX, right: MAP_INSET_PX, bottom: panelEl.offsetHeight + MAP_INSET_PX, left: MAP_INSET_PX });
  const view: PickerView = {
    airports: [...pointByIata.values()],
    featured,
    lifted: lifted
      ? {
          home: lifted,
          label: `${lifted.option.name} · ${lifted.option.difficulty ?? 'Unrated'}`,
          reach: homeNeighbours(lifted.iata).flatMap((iata) => pointByIata.get(iata) ?? []),
        }
      : null,
    pinned,
  };
  drawPickerMap(worldCtx, width, height, view);
}

/** The featured home nearest the cursor, within SNAP_RADIUS_PX. */
function nearestFeatured(x: number, y: number): (typeof featured)[number] | null {
  let best: (typeof featured)[number] | null = null;
  let bestDistance = SNAP_RADIUS_PX;
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

worldCanvas.addEventListener('pointermove', (event) => {
  const next = nearestFeatured(...pointerAt(event));
  if (next === lifted) return;
  lifted = next;
  worldCanvas.style.cursor = lifted ? 'pointer' : 'default';
  showStory();
  drawWorld();
});

worldCanvas.addEventListener('pointerleave', () => {
  if (!lifted) return;
  lifted = null;
  showStory();
  drawWorld();
});

worldCanvas.addEventListener('click', (event) => {
  const home = nearestFeatured(...pointerAt(event));
  if (!home) return;
  pinned = home;
  showStory();
  drawWorld();
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

function start(iata: string): void {
  worldEl.hidden = true;
  modalEl.hidden = true;
  choose(iata, chosenSeason);
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
  const why = whyHard(option);
  if (why) button.title = why;
  button.addEventListener('click', () => start(option.iata));
  return button;
}

function fillList(): void {
  rangeEl.textContent = String(PROPELLER_RANGE_NM);
  const sections: HTMLElement[] = [];
  for (const group of GROUPS) {
    const inGroup = options.filter((option) => option.difficulty === group.difficulty);
    if (inGroup.length === 0) continue;
    sections.push(
      textEl('h3', 'home-group-title', `${group.title} (${inGroup.length})`),
      textEl('p', 'home-group-note', group.note),
      ...inGroup.map(optionButton),
    );
  }
  listEl.replaceChildren(...sections);
}

export function showHomePicker(homes: HomeOption[], onChoose: (iata: string, season: StartSeason) => void): void {
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
  worldEl.hidden = false;
  showStory();
  drawWorld();
}
