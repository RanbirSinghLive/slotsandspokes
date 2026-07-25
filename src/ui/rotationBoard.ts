import { minuteOfDayToTimeString } from './panels';
import type { SimState } from '../sim/state';

const MINUTES_PER_DAY = 1440;
const HOUR_TICK_INTERVAL_MINUTES = 180; // every 3 hours

const axisTrack = document.querySelector<HTMLDivElement>('#rotation-axis-track')!;
const rowsContainer = document.querySelector<HTMLDivElement>('#rotation-rows')!;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Build the hour-tick axis once, at startup — unlike the rows below it,
 * the axis never changes (it's always 00:00–24:00), so there's nothing to
 * rebuild here the way updateRotationBoard() rebuilds the rows.
 */
export function setupRotationBoard(): void {
  for (let minute = 0; minute <= MINUTES_PER_DAY; minute += HOUR_TICK_INTERVAL_MINUTES) {
    const tick = document.createElement('div');
    tick.className = 'rotation-tick';
    tick.style.left = `${(minute / MINUTES_PER_DAY) * 100}%`;
    tick.textContent = minute === MINUTES_PER_DAY ? '24:00' : `${pad(minute / 60)}:00`;
    axisTrack.appendChild(tick);
  }
}

/**
 * Rebuild the board's rows from `state` — one row per active tail, one bar
 * per scheduled leg, positioned by percentage across the 24-hour width
 * (`left` from departMinute, `width` from blockMinutes). This is a
 * read-only view for now (M11 phase 1 — see WEEK-TWO.md's "rotation
 * board"), so unlike the M8/M10 forms there's nothing interactive here to
 * lose focus on; a full rebuild on every call is simple and cheap enough
 * at a dozen-plus legs. Called whenever the board becomes visible and
 * whenever the schedule might have changed while it wasn't.
 */
export function updateRotationBoard(state: SimState): void {
  rowsContainer.innerHTML = '';

  for (const aircraft of state.aircraft) {
    const row = document.createElement('div');
    row.className = 'rotation-row';

    const label = document.createElement('div');
    label.className = 'rotation-row-label';
    label.textContent = aircraft.tail;

    const track = document.createElement('div');
    track.className = 'rotation-row-track';

    for (const leg of state.schedule) {
      if (leg.tail !== aircraft.tail) continue;

      const bar = document.createElement('div');
      bar.className = 'rotation-bar';
      bar.style.left = `${(leg.departMinute / MINUTES_PER_DAY) * 100}%`;
      bar.style.width = `${(leg.blockMinutes / MINUTES_PER_DAY) * 100}%`;
      bar.textContent = `${leg.origin} → ${leg.dest}`;

      const departTime = minuteOfDayToTimeString(leg.departMinute);
      const arriveTime = minuteOfDayToTimeString(leg.departMinute + leg.blockMinutes);
      bar.title = `${leg.legId}: ${leg.origin} → ${leg.dest}, ${departTime}–${arriveTime} (${leg.blockMinutes} min)`;

      track.appendChild(bar);
    }

    row.append(label, track);
    rowsContainer.appendChild(row);
  }
}
