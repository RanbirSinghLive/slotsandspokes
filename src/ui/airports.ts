import {
  allAirports,
  slotControlledAirports,
  dailyDeparturesAt,
  airportLevel,
  connectivityFactor,
  slotsOwned,
  slotsTotal,
  nextSlotPrice,
  canBuySlot,
  buySlot,
  isSlotControlled,
} from '../sim/airports';
import type { SimState } from '../sim/state';

/**
 * The Airports tab: what the airline looks like *at each field* rather
 * than route by route.
 *
 * Two halves. The presence table shows every airport the airline touches,
 * its level, and the connectivity multiplier that concentration earns —
 * which is the argument for building a hub rather than scattering
 * departures. The slots half only concerns the two fields on this map
 * that are genuinely slot-controlled in life, and is where growth there
 * gets bought.
 */

const presenceEl = document.querySelector<HTMLDivElement>('#airports-presence')!;
const presenceNoteEl = document.querySelector<HTMLDivElement>('#airports-presence-note')!;
const slotsEl = document.querySelector<HTMLDivElement>('#airports-slots')!;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function renderPresence(state: SimState): void {
  // Only airports the airline actually touches — listing all nineteen
  // with zeroes would bury the handful that matter.
  const served = allAirports()
    .map((airport) => ({
      iata: airport.iata,
      name: airport.name,
      departures: dailyDeparturesAt(state, airport.iata),
    }))
    .filter((a) => a.departures > 0)
    .sort((a, b) => b.departures - a.departures);

  if (served.length === 0) {
    presenceEl.innerHTML = '';
    presenceNoteEl.textContent = 'No departures scheduled anywhere yet.';
    return;
  }

  presenceEl.innerHTML = served
    .map((a) => {
      const factor = connectivityFactor(state, a.iata);
      const uplift = Math.round((factor - 1) * 100);
      return `
        <div class="airport-row">
          <span class="airport-code">${a.iata}</span>
          <span class="airport-name">${a.name}</span>
          <span class="airport-level">${airportLevel(a.departures)}</span>
          <span class="airport-departures">${a.departures}/day</span>
          <span class="${uplift > 0 ? 'airport-uplift' : 'airport-uplift-none'}">${uplift > 0 ? `+${uplift}%` : '—'}</span>
        </div>`;
    })
    .join('');

  const best = served[0];
  presenceNoteEl.textContent =
    `Concentration pays: revenue on a flight is lifted by the average of its two ends' factors. ` +
    `Your strongest field is ${best.iata} at ${best.departures} departures a day.`;
}

function renderSlots(state: SimState): void {
  slotsEl.innerHTML = '';

  for (const airport of slotControlledAirports()) {
    const owned = slotsOwned(state, airport.iata);
    const total = slotsTotal(airport.iata) ?? 0;
    const used = dailyDeparturesAt(state, airport.iata);
    const soldOut = owned >= total;
    const price = nextSlotPrice(state, airport.iata);

    const block = document.createElement('div');
    block.className = 'airport-slot-block';
    block.innerHTML = `
      <div class="airport-slot-header">
        <span class="airport-code">${airport.iata}</span>
        <span class="airport-name">${airport.name}</span>
      </div>
      <div class="airport-slot-counts">
        Holding <strong>${owned}</strong> of ${total} slots · ${used} in use
        ${used > owned ? '<span class="airport-slot-over">over capacity</span>' : ''}
      </div>`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'airport-slot-buy';
    if (soldOut) {
      button.textContent = 'All slots held';
      button.disabled = true;
    } else {
      button.textContent = `Buy a slot — ${money(price)}`;
      button.disabled = !canBuySlot(state, airport.iata);
      button.addEventListener('click', () => {
        buySlot(state, airport.iata);
        updateAirportsPanel(state);
      });
    }
    block.appendChild(button);

    if (!soldOut && state.cash < price) {
      const note = document.createElement('div');
      note.className = 'airport-slot-note';
      note.textContent = `Need ${money(price - state.cash)} more.`;
      block.appendChild(note);
    }

    slotsEl.appendChild(block);
  }
}

/** Nothing to build once — the panel is rebuilt wholesale, same as the C-suite's. */
export function setupAirportsPanel(): void {}

export function updateAirportsPanel(state: SimState): void {
  renderPresence(state);
  renderSlots(state);
}

/** Exported for the schedule warnings, which want to name over-capacity fields. */
export function slotOverages(state: SimState): string[] {
  return slotControlledAirports()
    .filter((a) => isSlotControlled(a.iata) && dailyDeparturesAt(state, a.iata) > slotsOwned(state, a.iata))
    .map((a) => a.iata);
}
