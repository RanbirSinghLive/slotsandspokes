import { allAirports, dailyDeparturesAt, connectivityFactor } from '../sim/airports';
import { nextSlotFees, slotFeesPerDayAt, slotsHeld } from '../sim/slots';
import type { SimState } from '../sim/state';

/**
 * The Airports tab: what the airline looks like *at each field* rather
 * than route by route.
 *
 * Slots are the substance of it: the ledger of every slot pair held and
 * what it costs (sim/slots.ts). Presence itself moved to the map in
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
 * are sized by departures and carry a halo at Base/Hub level. Week
 * eight's deep dive added a capacity ring at every base (how full its
 * pooled aircraft-day budget is) in place of the ring that used to mark
 * slot-controlled fields there; slot holdings themselves are still real
 * (they still gate route-building and still show in the airport-detail
 * popover — render/airports.ts, ui/mapMenu.ts), they just lost
 * their own always-on map ring once utilisation needed that visual slot
 * more. A table of IATA codes describing *places* was the least spatial
 * way to show spatial data to begin with.
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

/**
 * Every airport where the airline holds slots (sim/slots.ts): how many
 * pairs, what they cost a day in total, and what the next pair would cost
 * there now. Read-only — slots are taken automatically when a rotation is
 * drawn and given back at rollover once unused; this is the ledger.
 */
function renderSlots(state: SimState): void {
  slotsEl.innerHTML = '';

  const rows = allAirports()
    .map((airport) => ({ airport, held: slotsHeld(state, airport.iata), fees: slotFeesPerDayAt(state, airport.iata) }))
    .filter((row) => row.held > 0)
    .sort((a, b) => b.fees - a.fees);

  if (rows.length === 0) {
    slotsEl.textContent = 'No slots held yet. The first slot pair at an airport nobody serves is free.';
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.fees, 0);
  const summary = document.createElement('p');
  summary.className = 'airports-note';
  summary.textContent = `Slot fees: ${money(total)}/day across ${rows.length} airport${rows.length === 1 ? '' : 's'}.`;
  slotsEl.appendChild(summary);

  for (const { airport, held, fees } of rows) {
    const [next] = nextSlotFees(state, airport.iata, 1);
    const block = document.createElement('div');
    block.className = 'airport-slot-block';
    block.innerHTML = `
      <div class="airport-slot-header">
        <span class="airport-code">${airport.iata}</span>
        <span class="airport-name">${airport.name}</span>
      </div>
      <div class="airport-slot-counts">
        <strong>${held}</strong> pair${held === 1 ? '' : 's'} · ${money(fees)}/day ·
        next ${next === null ? 'none left' : next === 0 ? 'free' : `${money(next)}/day`}
      </div>`;
    slotsEl.appendChild(block);
  }
}

/** Nothing to build once — the panel is rebuilt wholesale, same as the C-suite's. */
export function setupAirportsPanel(): void {}

export function updateAirportsPanel(state: SimState): void {
  renderPresence(state);
  renderSlots(state);
}
