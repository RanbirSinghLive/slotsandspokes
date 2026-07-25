import { validateSchedule } from '../sim/schedule';
import type { SimState } from '../sim/state';

// Must match the width baked into #map / #panel in style.css — see the
// comment there.
export const PANEL_WIDTH_PX = 280;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const revenueEl = document.querySelector<HTMLSpanElement>('#panel-revenue')!;
const costEl = document.querySelector<HTMLSpanElement>('#panel-cost')!;
const marginEl = document.querySelector<HTMLSpanElement>('#panel-margin')!;
const fleetBody = document.querySelector<HTMLTableSectionElement>('#fleet-table tbody')!;
const scheduleBody = document.querySelector<HTMLTableSectionElement>('#schedule-table tbody')!;

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
      if (flight) {
        const minutesRemaining = flight.arriveMinute - state.simMinute;
        // How far behind an entirely on-time day this flight's arrival is —
        // see ActiveFlight.scheduledArriveMinute in sim/state.ts. This is
        // what lets the panel explain *why* a flight is running late (M9),
        // not just that it is.
        const lateness = flight.arriveMinute - flight.scheduledArriveMinute;
        whereCell.textContent =
          lateness > 0
            ? `${flight.origin} → ${flight.dest} (${minutesRemaining} min, ${lateness} min late)`
            : `${flight.origin} → ${flight.dest} (${minutesRemaining} min)`;
      } else {
        whereCell.textContent = '—';
      }
    }

    row.append(tailCell, typeCell, statusCell, whereCell);
    fleetBody.appendChild(row);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// <input type="time"> speaks in "HH:MM" strings; the sim speaks in minutes
// since midnight. These two just convert between them.
function minuteOfDayToTimeString(minuteOfDay: number): string {
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

function timeStringToMinuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Build the schedule table and wire up its editing — called once at
 * startup, not from the per-frame render() loop like updatePanel() above.
 *
 * That's deliberate, not an oversight: rebuilding these rows every frame
 * (as updatePanel() does for the fleet table, harmlessly, since it's plain
 * text) would tear out and recreate the <input> elements roughly 60 times
 * a second, which steals focus and resets the browser's native time-picker
 * UI out from under anyone actually trying to type into one. Nothing in
 * `state.schedule` changes except through this table's own inputs, so
 * there's nothing else for a repeated render to pick up anyway.
 *
 * Editing a departure time mutates the leg object in `state.schedule`
 * directly, which is the array `step()` itself reads from — the very next
 * simulated minute that reaches that leg's slot uses the new time. Every
 * edit re-runs validateSchedule() so a change that breaks a rotation (an
 * aircraft asked to depart before it could plausibly have landed and
 * turned around) gets caught and logged to the console the same way a
 * broken schedule.json would be caught at startup.
 */
export function setupScheduleEditor(state: SimState): void {
  for (const leg of state.schedule) {
    const row = document.createElement('tr');

    const tailCell = document.createElement('td');
    tailCell.textContent = leg.tail;

    const routeCell = document.createElement('td');
    routeCell.textContent = `${leg.origin} → ${leg.dest}`;

    const departCell = document.createElement('td');
    const departInput = document.createElement('input');
    departInput.type = 'time';
    departInput.value = minuteOfDayToTimeString(leg.departMinute);
    departInput.addEventListener('change', () => {
      leg.departMinute = timeStringToMinuteOfDay(departInput.value);
      validateSchedule(state.schedule);
    });
    departCell.appendChild(departInput);

    row.append(tailCell, routeCell, departCell);
    scheduleBody.appendChild(row);
  }
}
