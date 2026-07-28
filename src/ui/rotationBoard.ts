import { minuteOfDayToTimeString, renderScheduleWarnings, syncScheduleRowTime } from './panels';
import { tailRotationProblems, validateSchedule, type ScheduleLeg } from '../sim/schedule';
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
 * One in-progress drag, module-level since a mouse can only ever drag one
 * bar at a time. `leg` is the *actual* object living in `state.schedule` —
 * iterating that array hands back real references, not copies — but we
 * deliberately don't write `leg.departMinute` until drop (see
 * commitDrag()): step() reads `state.schedule` on every simulated minute,
 * including while the rotation board is open and a drag is in progress, so
 * writing a half-finished drag straight into live state would feed the
 * simulation a value the player hasn't actually committed to yet.
 */
type DragState = {
  state: SimState;
  leg: ScheduleLeg;
  otherLegsSameTail: ScheduleLeg[];
  bar: HTMLDivElement;
  trackWidthPx: number;
  startClientX: number;
  originalDepartMinute: number;
  tentativeDepartMinute: number;
};

let dragState: DragState | null = null;

function setBarTimingLabel(bar: HTMLDivElement, leg: ScheduleLeg, departMinute: number): void {
  const departTime = minuteOfDayToTimeString(departMinute);
  const arriveTime = minuteOfDayToTimeString(departMinute + leg.blockMinutes);
  bar.title = `${leg.legId}: ${leg.origin} → ${leg.dest}, ${departTime}–${arriveTime} (${leg.blockMinutes} min)`;
}

/**
 * Wire up dragging for one bar — horizontal-only, confined to its own row
 * (a leg can be retimed by dragging, but not reassigned to a different
 * tail this way; that's still a schedule-editor-table edit). Attached
 * fresh every rebuild, same "build once per render, not incrementally
 * patched" simplicity the rest of this file already uses.
 */
function attachDragHandlers(bar: HTMLDivElement, leg: ScheduleLeg, track: HTMLDivElement, state: SimState): void {
  bar.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return; // left-click drags only
    event.preventDefault();

    dragState = {
      state,
      leg,
      otherLegsSameTail: state.schedule.filter((l) => l.tail === leg.tail && l.legId !== leg.legId),
      bar,
      trackWidthPx: track.getBoundingClientRect().width,
      startClientX: event.clientX,
      originalDepartMinute: leg.departMinute,
      tentativeDepartMinute: leg.departMinute,
    };
    bar.classList.add('rotation-bar--dragging');
  });
}

/**
 * Live preview while dragging: move the bar under the cursor, snap to the
 * nearest whole minute, and check — before anything is committed — whether
 * dropping it there would still leave this one tail's day chaining
 * correctly (tailRotationProblems(), the same per-tail check
 * validateSchedule() applies to every tail, just scoped to this one so an
 * unrelated tail's existing problems don't bleed into this bar's color).
 * Turns the bar red the instant the hypothetical placement breaks the
 * chain, green again the instant it doesn't — the player sees the
 * conflict while they're still deciding where to drop it, not after.
 */
window.addEventListener('mousemove', (event) => {
  if (!dragState) return;
  const { leg, otherLegsSameTail, bar, trackWidthPx, startClientX, originalDepartMinute } = dragState;

  const deltaPx = event.clientX - startClientX;
  const deltaMinutes = (deltaPx / trackWidthPx) * MINUTES_PER_DAY;
  const newDepartMinute = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(originalDepartMinute + deltaMinutes)));
  dragState.tentativeDepartMinute = newDepartMinute;

  bar.style.left = `${(newDepartMinute / MINUTES_PER_DAY) * 100}%`;
  setBarTimingLabel(bar, leg, newDepartMinute);

  const hypotheticalLeg: ScheduleLeg = { ...leg, departMinute: newDepartMinute };
  const problems = tailRotationProblems(leg.tail, [...otherLegsSameTail, hypotheticalLeg]);
  bar.classList.toggle('rotation-bar--invalid', problems.length > 0);
});

/**
 * Drop: write the new depart time back into the real `state.schedule`
 * entry (this *is* the live object, so no lookup-and-replace needed), then
 * re-run the same whole-schedule validation the schedule editor and route
 * builder already trigger after any edit, so the sidebar's warning list
 * and every other panel agree with what the board now shows. A drag that
 * ends up back where it started is a no-op — still clears the drag
 * styling, but never touches `state` or re-validates for nothing.
 */
window.addEventListener('mouseup', () => {
  if (!dragState) return;
  const { state, leg, bar, tentativeDepartMinute, originalDepartMinute } = dragState;
  bar.classList.remove('rotation-bar--dragging');

  if (tentativeDepartMinute !== originalDepartMinute) {
    leg.departMinute = tentativeDepartMinute;
    syncScheduleRowTime(leg.legId, leg.departMinute);
    renderScheduleWarnings(validateSchedule(state.schedule, state.aircraft, state.positioningLegs));
    updateRotationBoard(state);
  } else {
    bar.classList.remove('rotation-bar--invalid');
  }

  dragState = null;
});

/**
 * Rebuild the board's rows from `state` — one row per active tail, one bar
 * per scheduled leg, positioned by percentage across the 24-hour width
 * (`left` from departMinute, `width` from blockMinutes). Each bar is
 * draggable (see attachDragHandlers()) to retime that one leg by hand —
 * the M12 answer to the M10 route builder's guessed depart times
 * sometimes landing on top of a tail's existing legs (see WEEK-FOUR.md):
 * rather than trying to make the guess smarter, drop the new leg
 * wherever and let the player see and fix the conflict here directly.
 *
 * `highlightLegIds` (also M12) marks specific bars — freshly added by the
 * route builder — with a glow and scrolls the first one into view, so
 * confirming a route on the map and landing here feels like "here's what
 * you just added, go place it," not "guess which of these bars is new."
 */
export function updateRotationBoard(state: SimState, highlightLegIds: string[] = []): void {
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
      if (highlightLegIds.includes(leg.legId)) bar.classList.add('rotation-bar--new');
      bar.style.left = `${(leg.departMinute / MINUTES_PER_DAY) * 100}%`;
      bar.style.width = `${(leg.blockMinutes / MINUTES_PER_DAY) * 100}%`;
      bar.textContent = `${leg.origin} → ${leg.dest}`;
      setBarTimingLabel(bar, leg, leg.departMinute);
      attachDragHandlers(bar, leg, track, state);

      track.appendChild(bar);
    }

    row.append(label, track);
    rowsContainer.appendChild(row);
  }

  if (highlightLegIds.length > 0) {
    rowsContainer.querySelector('.rotation-bar--new')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
