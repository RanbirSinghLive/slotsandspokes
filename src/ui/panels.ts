import type { SimState } from '../sim/state';

// Must match the width baked into #map / #panel in style.css — see the
// comment there.
export const PANEL_WIDTH_PX = 280;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const revenueEl = document.querySelector<HTMLSpanElement>('#panel-revenue')!;
const costEl = document.querySelector<HTMLSpanElement>('#panel-cost')!;
const marginEl = document.querySelector<HTMLSpanElement>('#panel-margin')!;
const fleetBody = document.querySelector<HTMLTableSectionElement>('#fleet-table tbody')!;

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * Refresh the sidebar from `state`. Called once per rendered frame, same as
 * the canvas draw calls — this is a plain read of state, same rule as
 * everything under render/: it never writes back to it.
 */
export function updatePanel(state: SimState): void {
  cashEl.textContent = formatMoney(state.cash);
  revenueEl.textContent = formatMoney(state.todayRevenue);
  costEl.textContent = formatMoney(state.todayCost);
  marginEl.textContent = formatMoney(state.todayMargin);

  fleetBody.innerHTML = '';
  for (const aircraft of state.aircraft) {
    const row = document.createElement('tr');

    const tailCell = document.createElement('td');
    tailCell.textContent = aircraft.tail;

    const typeCell = document.createElement('td');
    typeCell.textContent = aircraft.typeCode;

    const statusCell = document.createElement('td');
    statusCell.textContent = aircraft.status;

    const whereCell = document.createElement('td');
    if (aircraft.status === 'ground') {
      whereCell.textContent = aircraft.atAirport ?? '—';
    } else {
      const flight = state.activeFlights.find((f) => f.tail === aircraft.tail);
      whereCell.textContent = flight
        ? `${flight.origin} → ${flight.dest} (${flight.arriveMinute - state.simMinute} min)`
        : '—';
    }

    row.append(tailCell, typeCell, statusCell, whereCell);
    fleetBody.appendChild(row);
  }
}
