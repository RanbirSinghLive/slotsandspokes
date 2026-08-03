import { orderAircraft, type FleetListing } from '../sim/fleetMarket';
import type { SimState } from '../sim/state';

const tableBody = document.querySelector<HTMLTableSectionElement>('#fleet-market-rows')!;

// Tracked by registration so acquireAircraft() can remove a listing's row
// without a DOM search — same "keep a direct reference" reasoning
// ui/panels.ts's schedule table and ui/commercial.ts's RowCells use.
const rowsByRegistration = new Map<string, HTMLTableRowElement>();

function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Order `listing` — the rules all live in sim/fleetMarket.ts's
 * orderAircraft(); this just removes the row and reports the date.
 *
 * Week eight: this no longer produces an aircraft. It produces a
 * *delivery*, which becomes an aircraft after the listing's lead time.
 * Buying used to be the one commitment in the game with no wait attached,
 * which sat oddly next to crew taking ten days to show up — and it made
 * age a pure discount rather than a trade.
 *
 * There's no setSelectedTail() any more either: there is no tail yet to
 * select. Selecting it on arrival would also mean silently changing what
 * the map is armed for, weeks after the click that caused it.
 */
function order(listing: FleetListing, ownership: 'owned' | 'leased', state: SimState): void {
  if (ownership === 'owned' && listing.buyPrice > state.cash) return; // button is disabled; stale-click guard

  orderAircraft(state, listing, ownership);
  rowsByRegistration.get(listing.registration)?.remove();
  rowsByRegistration.delete(listing.registration);
}

function buildListingRow(listing: FleetListing, state: SimState): HTMLTableRowElement {
  const row = document.createElement('tr');

  const regCell = document.createElement('td');
  regCell.textContent = listing.registration;

  const typeCell = document.createElement('td');
  typeCell.textContent = listing.typeCode;

  const ageCell = document.createElement('td');
  ageCell.textContent = `${listing.ageYears} yr`;

  // Lead time sits next to age and price because it is the third axis of
  // the same decision, not a footnote: the cheap airframe is also the one
  // you can have soonest, and the one that will break down most.
  const leadCell = document.createElement('td');
  leadCell.className = 'fleet-market-lead';
  leadCell.textContent = `${listing.leadTimeDays} d`;

  const leaseCell = document.createElement('td');
  leaseCell.textContent = `${formatMoney(listing.leasePricePerDay)}/day`;

  const buyCell = document.createElement('td');
  buyCell.textContent = formatMoney(listing.buyPrice);

  const actionCell = document.createElement('td');
  actionCell.className = 'fleet-market-actions';

  const buyButton = document.createElement('button');
  buyButton.type = 'button';
  buyButton.textContent = 'Buy';
  buyButton.addEventListener('click', () => order(listing, 'owned', state));

  const leaseButton = document.createElement('button');
  leaseButton.type = 'button';
  leaseButton.textContent = 'Lease';
  leaseButton.addEventListener('click', () => order(listing, 'leased', state));

  actionCell.append(buyButton, leaseButton);
  row.append(regCell, typeCell, ageCell, leadCell, leaseCell, buyCell, actionCell);

  rowsByRegistration.set(listing.registration, row);
  return row;
}

/**
 * Build the Fleet Market panel once at startup — one row per listing
 * still in `state.fleetMarket`. Same "build once, mutate via events" rule
 * as ui/panels.ts's schedule table: nothing here needs a periodic
 * rebuild, since the only thing that changes it is a Buy/Lease click,
 * already handled directly.
 */
export function setupFleetMarket(state: SimState): void {
  for (const listing of state.fleetMarket) {
    tableBody.appendChild(buildListingRow(listing, state));
  }
}
