import { legsServingMarket, marketKey, validateSchedule } from '../sim/schedule';
import { removeCommercialRow } from './commercial';
import { getSelectedTail, setSelectedTail } from './fleetSelection';
import { allRotations, utilisationByBase, utilisationProblems, type Rotation } from '../sim/utilisation';
import { airports } from '../render/airports';
import type { SimState } from '../sim/state';

// Must match the --panel-width custom property's default value in
// style.css — see the comment there. Week six: widened from 280 to fit a
// tab bar and ledger-style content (Commercial, etc.) that used to get
// the full canvas-width area to themselves.
export const PANEL_WIDTH_PX = 420;

const cashEl = document.querySelector<HTMLSpanElement>('#panel-cash')!;
const otpEl = document.querySelector<HTMLSpanElement>('#panel-otp')!;
const npsEl = document.querySelector<HTMLSpanElement>('#panel-nps')!;
const completionEl = document.querySelector<HTMLSpanElement>('#panel-completion')!;
const reputationEl = document.querySelector<HTMLSpanElement>('#panel-reputation')!;
const revenueEl = document.querySelector<HTMLSpanElement>('#panel-revenue')!;
const costEl = document.querySelector<HTMLSpanElement>('#panel-cost')!;
const marginEl = document.querySelector<HTMLSpanElement>('#panel-margin')!;
const fleetBody = document.querySelector<HTMLTableSectionElement>('#fleet-table tbody')!;
const fleetUtilisationEl = document.querySelector<HTMLDivElement>('#fleet-utilisation')!;
const rotationsBody = document.querySelector<HTMLTableSectionElement>('#rotations-table tbody')!;
const rotationsEmptyEl = document.querySelector<HTMLDivElement>('#rotations-empty')!;
const scheduleWarningsEl = document.querySelector<HTMLUListElement>('#schedule-warnings')!;
const fleetSelectionHintEl = document.querySelector<HTMLDivElement>('#fleet-selection-hint')!;

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
  otpEl.textContent =
    state.flightsDepartedTotal === 0
      ? '—'
      : `${Math.round((state.flightsOnTimeTotal / state.flightsDepartedTotal) * 100)}%`;
  // NPS divides by its own denominator, not by departures: week six
  // scores cancellations too (a flat -80 each, sim/nps.ts), and those
  // never departed. On-time above deliberately keeps the departures
  // denominator, since it only ever describes flights that operated.
  if (state.npsScoredFlightsTotal === 0) {
    npsEl.textContent = '—';
  } else {
    const nps = Math.round(state.npsPointsTotal / state.npsScoredFlightsTotal);
    npsEl.textContent = nps > 0 ? `+${nps}` : `${nps}`;
  }
  // Completion Factor — the second reliability axis. On-time says how
  // punctual the flights that operated were; this says how many operated
  // at all, and a carrier can be excellent at one and dreadful at the other.
  completionEl.textContent =
    state.flightsScheduledTotal === 0
      ? '—'
      : `${Math.round(((state.flightsScheduledTotal - state.flightsCancelledTotal) / state.flightsScheduledTotal) * 100)}%`;
  // Always a real number, unlike On-time/NPS above — 0 is a genuine
  // starting Reputation (a new airline with no track record), not a
  // placeholder for "no data yet" — see sim/reputation.ts.
  reputationEl.textContent = `${Math.round(state.reputation)}`;
  revenueEl.textContent = formatMoney(state.todayRevenue);
  costEl.textContent = formatMoney(state.todayCost);
  marginEl.textContent = formatMoney(state.todayMargin);

  fleetBody.innerHTML = '';
  for (const aircraft of state.aircraft) {
    const row = document.createElement('tr');
    row.className = 'fleet-row';
    // Week three's route-builder redesign: a plane has to be picked here,
    // by clicking its row, *before* the map will let you arm a route for
    // it — see ui/routeBuilder.ts. Rebuilt every frame same as the rest of
    // this table, so the highlight is just read fresh from
    // fleetSelection.ts each time rather than tracked separately.
    row.classList.toggle('selected', aircraft.tail === getSelectedTail());
    row.addEventListener('click', () => {
      setSelectedTail(getSelectedTail() === aircraft.tail ? null : aircraft.tail);
    });

    const tailCell = document.createElement('td');
    tailCell.textContent = aircraft.tail;

    const typeCell = document.createElement('td');
    typeCell.textContent = aircraft.typeCode;

    const statusCell = document.createElement('td');
    statusCell.textContent = aircraft.status;

    const whereCell = document.createElement('td');
    if (aircraft.status === 'ground') {
      // null means a Fleet Market purchase that's never flown yet
      // (ui/fleetMarket.ts) — sitting in the pool, not based anywhere
      // until the player draws a route for it.
      whereCell.textContent = aircraft.atAirport ?? 'Unassigned';
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

    // Base is an explicit assignment now, not something inferred from
    // wherever the first route happened to start (see Aircraft.baseAirport).
    // A <select> rather than a click-through so it reads as a setting.
    const baseCell = document.createElement('td');
    const baseSelect = document.createElement('select');
    baseSelect.className = 'fleet-base-select';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '—';
    baseSelect.appendChild(none);
    for (const airport of airports) {
      const option = document.createElement('option');
      option.value = airport.iata;
      option.textContent = airport.iata;
      baseSelect.appendChild(option);
    }
    baseSelect.value = aircraft.baseAirport ?? '';
    // Stop the row's own select-this-tail handler firing when the dropdown
    // is used — picking a base isn't picking a plane to draw a route for.
    baseSelect.addEventListener('click', (event) => event.stopPropagation());
    baseSelect.addEventListener('change', () => {
      aircraft.baseAirport = baseSelect.value || null;
    });
    baseCell.appendChild(baseSelect);

    row.append(tailCell, typeCell, statusCell, whereCell, baseCell);
    fleetBody.appendChild(row);
  }

  renderUtilisation(state);
  renderRotations(state);

  fleetSelectionHintEl.hidden = getSelectedTail() !== null || state.aircraft.length === 0;
}

/**
 * Week six's utilisation pivot, phase one: how much of each based fleet's
 * day is actually being flown, pooled per base rather than per tail.
 * Per-tail figures can't answer "have I a spare aeroplane's worth of gaps
 * scattered about", which is the question the whole pivot exists to make
 * answerable — see sim/utilisation.ts.
 */
function renderUtilisation(state: SimState): void {
  const bases = utilisationByBase(state);
  if (bases.length === 0) {
    fleetUtilisationEl.innerHTML = '';
    return;
  }

  fleetUtilisationEl.innerHTML = bases
    .map((b) => {
      const pct = Math.round(b.share * 100);
      const label = b.base === '' ? 'Unbased' : b.base;
      const spare = b.spareAircraft;
      // The headline reading: spare capacity expressed in aircraft, since
      // "0.05 of a plane" is what tells you another airframe is a bad buy
      // and "0.9" tells you it very nearly isn't.
      const note =
        b.base === ''
          ? `${b.aircraft.length} aircraft with no base — assign one before they can be worked.`
          : spare >= 0
            ? `${spare.toFixed(2)} aircraft spare`
            : `${Math.abs(spare).toFixed(2)} aircraft short — this rotation can't be flown daily`;
      return `
        <div class="util-row${b.share > 1 ? ' util-row--over' : ''}">
          <span class="util-base">${label}</span>
          <span class="util-pct">${pct}%</span>
          <span class="util-note">${note}</span>
          <div class="util-bar-track"><div class="util-bar" style="width:${Math.min(100, pct)}%"></div></div>
        </div>`;
    })
    .join('');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// The sim speaks in minutes since midnight; people read clock times.
// Exported because the route builder's popover shows a rotation's window
// in the same format.
export function minuteOfDayToTimeString(minuteOfDay: number): string {
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

/**
 * Week seven, phase C: the schedule table is gone and this replaces it.
 *
 * The old table listed individual legs with an editable depart time and a
 * per-leg delete — which made sense while the player authored the
 * timeline. They no longer do: rotations are packed into the day
 * automatically, so a per-leg time field would be a control that lies, and
 * deleting one leg out of a rotation would strand the rest of it away from
 * base. The unit the player builds is the unit they remove.
 *
 * Rebuilt every frame, same as the fleet table above and for the same
 * reason it's safe to: these are plain cells and a button, with no
 * `<input>` for a rebuild to steal focus from.
 */
function renderRotations(state: SimState): void {
  const rotations = allRotations(state);
  rotationsEmptyEl.hidden = rotations.length > 0;
  rotationsBody.innerHTML = '';

  for (const rotation of rotations) {
    const row = document.createElement('tr');
    row.className = 'rotation-row';
    if (!rotation.closed) row.classList.add('rotation-row--open');

    const tailCell = document.createElement('td');
    tailCell.textContent = rotation.tail;

    const routeCell = document.createElement('td');
    routeCell.className = 'rotation-route-cell';
    routeCell.textContent = rotation.airports.join(' → ');

    const windowCell = document.createElement('td');
    windowCell.textContent = `${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)}`;

    // The pivot's headline number, per rotation: what share of one
    // aircraft's usable day this costs. Adding up a tail's rows tells the
    // player how full that aeroplane is without a timeline to read.
    const shareCell = document.createElement('td');
    shareCell.textContent = `${Math.round(rotation.share * 100)}%`;

    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'rotation-remove-button';
    removeButton.textContent = '×';
    removeButton.setAttribute('aria-label', `Remove ${rotation.tail} ${rotation.airports.join(' ')}`);
    removeButton.addEventListener('click', () => removeRotation(rotation, state));
    removeCell.appendChild(removeButton);

    row.append(tailCell, routeCell, windowCell, shareCell, removeCell);
    rotationsBody.appendChild(row);
  }
}

/**
 * Remove a whole rotation — every leg of it — from `state.schedule` (the
 * array step() reads from). For any market left with no legs at all, drops
 * the now-orphaned RouteSettings entry and Commercial row too, since a
 * fare/marketing lever with nothing flying it would otherwise linger.
 *
 * A flight already airborne on one of these legs is unaffected:
 * ActiveFlight carries its own copied data independent of state.schedule
 * (see sim/state.ts), so it finishes the sector it's on and simply has
 * nothing to fly next.
 */
function removeRotation(rotation: Rotation, state: SimState): void {
  for (const leg of rotation.legs) {
    const index = state.schedule.indexOf(leg);
    if (index !== -1) state.schedule.splice(index, 1);
  }

  // Checked after every leg is gone, not as each one goes, so a rotation
  // that flies the same market twice doesn't decide the market is orphaned
  // while its own second leg is still in the array.
  for (const leg of rotation.legs) {
    if (legsServingMarket(leg.origin, leg.dest, state.schedule) > 0) continue;
    const key = marketKey(leg.origin, leg.dest);
    delete state.routeSettings[key];
    removeCommercialRow(key);
  }

  renderScheduleWarnings(scheduleProblems(state));
}

/**
 * Every problem worth showing the player, from both halves of the check:
 * `validateSchedule()` for what the *world* says (an aircraft parked
 * somewhere its legs never depart from, an aircraft too large for an
 * airport it's booked into) and `utilisationProblems()` for what the
 * *budget* says (a tail asked to fly more than a day). One function so
 * every call site gets both — the two used to be one list, and phase C
 * splitting them made it easy to accidentally render only half.
 */
export function scheduleProblems(state: SimState): string[] {
  return [...validateSchedule(state.schedule, state.aircraft), ...utilisationProblems(state)];
}
