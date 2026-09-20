import { PROPELLER_RANGE_NM, type HomeOption } from '../sim/homes';

/**
 * The first screen of a new game: choose the city the airline starts from.
 * A plain modal over the map (real DOM, like every other control), shown
 * only when there is no saved game to resume. The game is paused while it
 * is open (main.ts), so no simulated time passes while the player thinks.
 */

const modalEl = document.querySelector<HTMLDivElement>('#home-picker-modal')!;
const rangeEl = document.querySelector<HTMLElement>('#home-picker-range')!;
const listEl = document.querySelector<HTMLDivElement>('#home-picker-list')!;

export function showHomePicker(options: HomeOption[], onChoose: (iata: string) => void): void {
  rangeEl.textContent = String(PROPELLER_RANGE_NM);
  listEl.replaceChildren(
    ...options.map((option) => {
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
    }),
  );
  modalEl.hidden = false;
}
