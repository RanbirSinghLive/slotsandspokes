import { PROPELLER_RANGE_NM, type HomeDifficulty, type HomeOption } from '../sim/homes';

/**
 * The first screen of a new game: choose the city the airline starts from.
 * A plain modal over the map (real DOM, like every other control), shown
 * only when there is no saved game to resume. The game is paused while it
 * is open (main.ts), so no simulated time passes while the player thinks.
 *
 * Cities are grouped by how hard a start they are (sim/homes.ts), easiest
 * first, so a new player finds a fair start at the top and a veteran can
 * go looking for a hard one.
 */

const GROUPS: { difficulty: HomeDifficulty | null; title: string; note: string }[] = [
  { difficulty: 'Standard', title: 'Standard starts', note: 'Room to learn: the first routes pay their way.' },
  { difficulty: 'Hard', title: 'Hard starts', note: 'The first routes lose money for weeks. Plan the opening.' },
  { difficulty: 'Brutal', title: 'Brutal starts', note: 'For experienced players: thin or short markets that sink a careless opening fast.' },
  { difficulty: null, title: 'Unrated', note: 'Not measured yet.' },
];

const modalEl = document.querySelector<HTMLDivElement>('#home-picker-modal')!;
const rangeEl = document.querySelector<HTMLElement>('#home-picker-range')!;
const listEl = document.querySelector<HTMLDivElement>('#home-picker-list')!;

/** One city's row: its code, name and reach. Choosing it starts the game there. */
function optionButton(option: HomeOption, onChoose: (iata: string) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'home-option';

  const code = document.createElement('span');
  code.className = 'home-option-code';
  code.textContent = option.iata;

  const name = document.createElement('span');
  name.className = 'home-option-name';
  name.textContent = option.name;

  const reach = document.createElement('span');
  reach.className = 'home-option-reach';
  reach.textContent = `${option.neighbours} within reach`;

  button.append(code, name, reach);
  button.addEventListener('click', () => {
    modalEl.hidden = true;
    onChoose(option.iata);
  });
  return button;
}

export function showHomePicker(options: HomeOption[], onChoose: (iata: string) => void): void {
  rangeEl.textContent = String(PROPELLER_RANGE_NM);
  const sections: HTMLElement[] = [];
  for (const group of GROUPS) {
    const inGroup = options.filter((option) => option.difficulty === group.difficulty);
    if (inGroup.length === 0) continue;
    const heading = document.createElement('h3');
    heading.className = 'home-group-title';
    heading.textContent = `${group.title} (${inGroup.length})`;
    const note = document.createElement('p');
    note.className = 'home-group-note';
    note.textContent = group.note;
    sections.push(heading, note, ...inGroup.map((option) => optionButton(option, onChoose)));
  }
  listEl.replaceChildren(...sections);
  modalEl.hidden = false;
}
