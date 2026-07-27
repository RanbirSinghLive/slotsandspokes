import { airports } from '../render/airports';
import type { FleetListing } from '../sim/fleetMarket';
import type { Aircraft, SimState } from '../sim/state';
import { refreshTailOptions } from './routeBuilder';

const tableBody = document.querySelector<HTMLTableSectionElement>('#fleet-market-rows')!;
const baseAirportSelect = document.querySelector<HTMLSelectElement>('#fleet-market-base-airport')!;

// Tracked by registration so acquireAircraft() can remove a listing's row
// without a DOM search — same "keep a direct reference" reasoning
// ui/panels.ts's schedule table and ui/commercial.ts's RowCells use.
const rowsByRegistration = new Map<string, HTMLTableRowElement>();

function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Buy or lease `listing` — creates the Aircraft record, charges (or
 * doesn't) cash, removes the listing from `state.fleetMarket` and its row,
 * and refreshes the route builder's Tail dropdown so the new tail is
 * immediately selectable. Acquisition-only for this pass: no sell-back, no
 * early lease-end, so once a listing is gone it's gone for the rest of
 * this game.
 *
 * The aircraft is based wherever `baseAirportSelect` currently points —
 * for a brand-new game with zero fleet, whichever airport the player picks
 * for their *first* purchase is effectively choosing a home base, without
 * a separate "pick a home airport" step existing at all.
 */
function acquireAircraft(listing: FleetListing, ownership: 'owned' | 'leased', state: SimState): void {
  if (ownership === 'owned') {
    state.cash -= listing.buyPrice;
  }
  // Leasing costs nothing up front — its cost is the recurring
  // leaseCostPerDay charged daily at step.ts's day-rollover, the same
  // shape RouteSettings.marketingSpend already has.

  const aircraft: Aircraft = {
    tail: listing.registration,
    typeCode: listing.typeCode,
    status: 'ground',
    atAirport: baseAirportSelect.value,
    activeLegId: null,
    groundSinceMinute: state.simMinute,
    ownership,
    leaseCostPerDay: ownership === 'leased' ? listing.leasePricePerDay : 0,
  };
  state.aircraft.push(aircraft);

  const index = state.fleetMarket.findIndex((l) => l.registration === listing.registration);
  if (index !== -1) state.fleetMarket.splice(index, 1);
  rowsByRegistration.get(listing.registration)?.remove();
  rowsByRegistration.delete(listing.registration);

  refreshTailOptions(state);
}

function buildListingRow(listing: FleetListing, state: SimState): HTMLTableRowElement {
  const row = document.createElement('tr');

  const regCell = document.createElement('td');
  regCell.textContent = listing.registration;

  const typeCell = document.createElement('td');
  typeCell.textContent = listing.typeCode;

  const ageCell = document.createElement('td');
  ageCell.textContent = `${listing.ageYears} yr`;

  const leaseCell = document.createElement('td');
  leaseCell.textContent = `${formatMoney(listing.leasePricePerDay)}/day`;

  const buyCell = document.createElement('td');
  buyCell.textContent = formatMoney(listing.buyPrice);

  const actionCell = document.createElement('td');
  actionCell.className = 'fleet-market-actions';

  const buyButton = document.createElement('button');
  buyButton.type = 'button';
  buyButton.textContent = 'Buy';
  buyButton.addEventListener('click', () => acquireAircraft(listing, 'owned', state));

  const leaseButton = document.createElement('button');
  leaseButton.type = 'button';
  leaseButton.textContent = 'Lease';
  leaseButton.addEventListener('click', () => acquireAircraft(listing, 'leased', state));

  actionCell.append(buyButton, leaseButton);
  row.append(regCell, typeCell, ageCell, leaseCell, buyCell, actionCell);

  rowsByRegistration.set(listing.registration, row);
  return row;
}

/**
 * Build the Fleet Market panel once at startup — the base-airport picker
 * (every one of the game's 10 airports, alphabetical by IATA is fine at
 * this size) and one row per listing still in `state.fleetMarket`. Same
 * "build once, mutate via events" rule as ui/panels.ts's schedule table:
 * nothing here needs a periodic rebuild, since the only thing that changes
 * it is a Buy/Lease click, already handled directly.
 */
export function setupFleetMarket(state: SimState): void {
  for (const airport of airports) {
    const option = document.createElement('option');
    option.value = airport.iata;
    option.textContent = `${airport.iata} — ${airport.name}`;
    baseAirportSelect.appendChild(option);
  }

  for (const listing of state.fleetMarket) {
    tableBody.appendChild(buildListingRow(listing, state));
  }
}
