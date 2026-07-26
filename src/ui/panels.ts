import { legsServingMarket, marketKey, validateSchedule, type ScheduleLeg } from '../sim/schedule';
import { removeCommercialRow } from './commercial';
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
const scheduleFilterTail = document.querySelector<HTMLInputElement>('#schedule-filter-tail')!;
const scheduleFilterRoute = document.querySelector<HTMLInputElement>('#schedule-filter-route')!;
const scheduleFilterDepart = document.querySelector<HTMLInputElement>('#schedule-filter-depart')!;
const scheduleWarningsEl = document.querySelector<HTMLUListElement>('#schedule-warnings')!;

/**
 * Show validateSchedule()'s problems (if any) directly in the Schedule
 * panel, not just the console — a route added onto a tail that's already
 * busy elsewhere (its own separate rotation) breaks with zero revenue and
 * no other visible symptom, and console-only errors are easy to miss
 * without devtools open. Every validateSchedule() call site should route
 * its result through here so the panel never shows a stale list from
 * before the player's latest edit.
 */
export function renderScheduleWarnings(problems: string[]): void {
  scheduleWarningsEl.innerHTML = '';
  scheduleWarningsEl.hidden = problems.length === 0;
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem;
    scheduleWarningsEl.appendChild(item);
  }
}

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
// since midnight. These two just convert between them. Exported since
// ui/rotationBoard.ts needs the same formatting for its bar tooltips.
export function minuteOfDayToTimeString(minuteOfDay: number): string {
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

function timeStringToMinuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Tracked by legId so the delete button (below) can find and remove its
// own row without a DOM search — same "keep a direct reference" reasoning
// ui/commercial.ts's RowCells uses.
const scheduleRowsByLegId = new Map<string, HTMLTableRowElement>();

/**
 * Remove `leg` entirely — week three's playtest-readiness gap: until now
 * there was no way back from an unwanted route or frequency short of
 * hand-editing data/schedule.json. Removes it from `state.schedule` (the
 * array step() reads from) and its row from the DOM; if that was the
 * *last* leg serving that market, also drops the now-orphaned
 * RouteSettings entry and Commercial-panel row, since a fare/marketing
 * lever with nothing left to fly would otherwise linger. A flight already
 * airborne on this leg is unaffected — ActiveFlight carries its own
 * copied data independent of `state.schedule`, per sim/state.ts.
 */
function removeScheduleLeg(leg: ScheduleLeg, state: SimState): void {
  const index = state.schedule.indexOf(leg);
  if (index === -1) return;
  state.schedule.splice(index, 1);

  scheduleRowsByLegId.get(leg.legId)?.remove();
  scheduleRowsByLegId.delete(leg.legId);

  if (legsServingMarket(leg.origin, leg.dest, state.schedule) === 0) {
    const key = marketKey(leg.origin, leg.dest);
    delete state.routeSettings[key];
    removeCommercialRow(key);
  }

  renderScheduleWarnings(validateSchedule(state.schedule));
}

/**
 * Build one schedule-table row for `leg` and append it. Shared by
 * setupScheduleEditor() (the initial build) and addScheduleRow() (M10 — a
 * newly created route, appended without touching any other row).
 */
function buildScheduleRow(leg: ScheduleLeg, state: SimState): HTMLTableRowElement {
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
    renderScheduleWarnings(validateSchedule(state.schedule));
    applyScheduleFilters(); // the edited time may no longer match an active Depart filter
  });
  departCell.appendChild(departInput);

  const removeCell = document.createElement('td');
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'schedule-remove-button';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remove ${leg.legId}`);
  removeButton.addEventListener('click', () => removeScheduleLeg(leg, state));
  removeCell.appendChild(removeButton);

  row.append(tailCell, routeCell, departCell, removeCell);
  scheduleRowsByLegId.set(leg.legId, row);
  return row;
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
 * `state.schedule` changes except through this table's own inputs (or
 * addScheduleRow(), below), so there's nothing else for a repeated render
 * to pick up anyway.
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
    scheduleBody.appendChild(buildScheduleRow(leg, state));
  }
}

/**
 * Append one new row for a leg just created by the M10 route builder,
 * without rebuilding the table — same reasoning as setupScheduleEditor()
 * above: a full rebuild would tear out any input another row's edit is
 * mid-focus on.
 */
export function addScheduleRow(leg: ScheduleLeg, state: SimState): void {
  scheduleBody.appendChild(buildScheduleRow(leg, state));
}

/**
 * Show or hide each schedule row against the three filter inputs above the
 * table — case-insensitive substring match, ANDed across fields (a row
 * must match every non-empty filter to stay visible). Depart is matched
 * against the row's current <input type="time"> value rather than text
 * content, since that cell holds a live input, not a plain text node.
 */
function applyScheduleFilters(): void {
  const tailQuery = scheduleFilterTail.value.trim().toLowerCase();
  const routeQuery = scheduleFilterRoute.value.trim().toLowerCase();
  const departQuery = scheduleFilterDepart.value.trim().toLowerCase();

  for (const row of Array.from(scheduleBody.children)) {
    const tailText = row.children[0].textContent?.toLowerCase() ?? '';
    const routeText = row.children[1].textContent?.toLowerCase() ?? '';
    const departValue = row.querySelector<HTMLInputElement>('input[type="time"]')?.value.toLowerCase() ?? '';

    const matches =
      tailText.includes(tailQuery) && routeText.includes(routeQuery) && departValue.includes(departQuery);
    (row as HTMLElement).style.display = matches ? '' : 'none';
  }
}

for (const filterInput of [scheduleFilterTail, scheduleFilterRoute, scheduleFilterDepart]) {
  filterInput.addEventListener('input', applyScheduleFilters);
}

/**
 * Called by the M10 route builder right after adding a new leg: clears the
 * tail/depart filters — so a filter left over from before can't hide the
 * row the player just created — and sets the route filter to that leg's
 * exact "ORIGIN → DEST" text, so the table immediately narrows to just
 * that route.
 */
export function filterScheduleToRoute(origin: string, dest: string): void {
  scheduleFilterTail.value = '';
  scheduleFilterDepart.value = '';
  scheduleFilterRoute.value = `${origin} → ${dest}`;
  applyScheduleFilters();
}
