import aircraftTypesData from '../../data/aircraft-types.json';
import { loadFleetCatalogue, orderAircraft, type FleetListing } from '../sim/fleetMarket';
import type { SimState } from '../sim/state';

const tableBody = document.querySelector<HTMLTableSectionElement>('#fleet-market-rows')!;

type AircraftTypeSpec = { code: string; name: string; seats: number; rangeNm: number };
const typesByCode = new Map<string, AircraftTypeSpec>((aircraftTypesData as AircraftTypeSpec[]).map((t) => [t.code, t]));

// Kept so updateFleetMarket() can grey out a button by reference, without
// rebuilding the rows (a per-frame rebuild breaks buttons mid-click — see
// the renderFleet() comment in ui/panels.ts).
const buttonsByType = new Map<string, { buy: HTMLButtonElement; lease: HTMLButtonElement; listing: FleetListing }>();

function formatMoney(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Whether an outright purchase is allowed. It must leave cash above zero,
 * since zero cash ends the game (sim/loans.ts's isInsolvent()) and buying
 * yourself into a game over is never the intent.
 */
function canBuy(listing: FleetListing, state: SimState): boolean {
  return state.cash - listing.buyPrice > 0;
}

/**
 * Order one aircraft of this class — the rules all live in
 * sim/fleetMarket.ts's orderAircraft(). It lands on the Fleet tab as an
 * inbound delivery and becomes a usable, unbased aircraft when its lead
 * time is up.
 */
function order(listing: FleetListing, ownership: 'owned' | 'leased', state: SimState): void {
  if (ownership === 'owned' && !canBuy(listing, state)) return; // button is disabled; stale-click guard

  orderAircraft(state, listing, ownership);
  updateFleetMarket(state);
}

function buildListingRow(listing: FleetListing, state: SimState): HTMLTableRowElement {
  const type = typesByCode.get(listing.typeCode);
  const row = document.createElement('tr');

  const classCell = document.createElement('td');
  classCell.textContent = type?.name ?? listing.typeCode;

  const seatsCell = document.createElement('td');
  seatsCell.textContent = type ? `${type.seats}` : '';

  const rangeCell = document.createElement('td');
  rangeCell.textContent = type ? `${type.rangeNm.toLocaleString()} nm` : '';

  const actionCell = document.createElement('td');
  actionCell.className = 'fleet-market-actions';

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.textContent = `Buy ${formatMoney(listing.buyPrice)}`;
  buy.addEventListener('click', () => order(listing, 'owned', state));

  const lease = document.createElement('button');
  lease.type = 'button';
  lease.textContent = `Lease ${formatMoney(listing.leasePricePerDay)}/day`;
  lease.addEventListener('click', () => order(listing, 'leased', state));

  actionCell.append(buy, lease);
  row.append(classCell, seatsCell, rangeCell, actionCell);
  buttonsByType.set(listing.typeCode, { buy, lease, listing });
  return row;
}

/** Build the four class rows once at startup. Nothing here needs a periodic rebuild. */
export function setupFleetMarket(state: SimState): void {
  for (const listing of loadFleetCatalogue()) {
    tableBody.appendChild(buildListingRow(listing, state));
  }
  updateFleetMarket(state);
}

/** Grey out Buy where it would take cash to zero or below. Only toggles `disabled`; never rebuilds. */
export function updateFleetMarket(state: SimState): void {
  for (const { buy, listing } of buttonsByType.values()) {
    buy.disabled = !canBuy(listing, state);
  }
}
