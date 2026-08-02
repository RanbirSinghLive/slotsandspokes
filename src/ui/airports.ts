import {
  allAirports,
  slotControlledAirports,
  dailyDeparturesAt,
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
 * Slots are the substance of it: buying growth at the two fields that are
 * genuinely slot-coordinated in life. Presence itself moved to the map in
 * phase one of the menu-condensing pass — see renderPresence() below for
 * why a table of IATA codes was the wrong home for it.
 */

const presenceNoteEl = document.querySelector<HTMLParagraphElement>('#airports-presence-note')!;
const slotsEl = document.querySelector<HTMLDivElement>('#airports-slots')!;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Presence itself moved to the map in week six's phase one — the dots
 * are sized by departures, carry a halo at Base/Hub level and a slot ring
 * where the field is controlled, and hovering one gives level,
 * connectivity and slot holdings (render/airports.ts,
 * ui/competitionTooltip.ts). A table of IATA codes describing *places*
 * was the least spatial way to show spatial data.
 *
 * What's left here is a one-line summary, so the tab still answers "where
 * am I strongest" without making you scan the map for it.
 */
function renderPresence(state: SimState): void {
  const served = allAirports()
    .map((airport) => ({ iata: airport.iata, departures: dailyDeparturesAt(state, airport.iata) }))
    .filter((a) => a.departures > 0)
    .sort((a, b) => b.departures - a.departures);

  if (served.length === 0) {
    presenceNoteEl.textContent = 'No departures scheduled anywhere yet. Airport dots on the map grow with your presence.';
    return;
  }

  const best = served[0];
  const uplift = Math.round((connectivityFactor(state, best.iata) - 1) * 100);
  presenceNoteEl.textContent =
    `${served.length} airport${served.length === 1 ? '' : 's'} served. Strongest is ${best.iata} at ` +
    `${best.departures} departures a day${uplift > 0 ? `, worth +${uplift}% on revenue there` : ''}. ` +
    `Hover any airport on the map for its level, connectivity and slots.`;
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
