import aircraftTypesData from '../../data/aircraft-types.json';
import { airports, type Airport } from '../render/airports';
import { greatCircleDistanceNm } from '../sim/geo';
import { minuteOfDayToTimeString, renderScheduleWarnings, syncScheduleRow } from './panels';
import {
  computeBlockMinutes,
  isAircraftTypeAllowedAt,
  tailRotationProblems,
  validateSchedule,
  type ScheduleLeg,
} from '../sim/schedule';
import type { SimState } from '../sim/state';

const MINUTES_PER_DAY = 1440;
const HOUR_TICK_INTERVAL_MINUTES = 180; // every 3 hours

const axisTrack = document.querySelector<HTMLDivElement>('#rotation-axis-track')!;
const rowsContainer = document.querySelector<HTMLDivElement>('#rotation-rows')!;
const barTooltip = document.querySelector<HTMLDivElement>('#rotation-bar-tooltip')!;
const barTooltipTitle = document.querySelector<HTMLDivElement>('#rotation-bar-tooltip-title')!;
const barTooltipBody = document.querySelector<HTMLDivElement>('#rotation-bar-tooltip-body')!;

// A minimal local view of aircraft-types.json — rangeNm for the cross-tail
// drag's out-of-range check, cruiseKts so a leg reassigned to a different
// gauge gets its blockMinutes recomputed for the *new* plane's speed
// rather than keeping the old one's — same "small local type" pattern
// ui/routeBuilder.ts's own AircraftTypeSpec already uses.
type AircraftTypeSpec = { code: string; rangeNm: number; cruiseKts: number };
const aircraftTypesByCode = new Map<string, AircraftTypeSpec>(
  (aircraftTypesData as AircraftTypeSpec[]).map((type) => [type.code, type]),
);
const airportsByIata = new Map<string, Airport>(airports.map((airport) => [airport.iata, airport]));

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
 * Every row's track element, keyed by the tail it belongs to — rebuilt
 * alongside the rows themselves in updateRotationBoard(), and used only to
 * answer "which row is the cursor over right now" during a drag (see
 * findRowTrackAt() below). A tail with zero legs still gets an empty row
 * (updateRotationBoard() always creates one per aircraft), so a freshly
 * bought, idle plane is already a valid drop target.
 */
let rowTracksByTail: { tail: string; track: HTMLDivElement }[] = [];

function findRowTrackAt(clientY: number): { tail: string; track: HTMLDivElement } | null {
  for (const entry of rowTracksByTail) {
    const rect = entry.track.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return entry;
  }
  return null;
}

/**
 * One in-progress drag, module-level since a mouse can only ever drag one
 * bar at a time. `leg` is the *actual* object living in `state.schedule` —
 * iterating that array hands back real references, not copies — but we
 * deliberately don't write `leg.departMinute`/`leg.tail` until drop (see
 * the `mouseup` handler below): step() reads `state.schedule` on every
 * simulated minute, including while the rotation board is open and a drag
 * is in progress, so writing a half-finished drag straight into live state
 * would feed the simulation a value the player hasn't actually committed
 * to yet.
 *
 * `currentTail`/`currentTrack` track whichever row the bar is *currently*
 * hovering over mid-drag — starts equal to `originalTail`/the row it was
 * picked up from, and updates as the cursor crosses into a different
 * tail's row (see the mousemove handler's reparenting below). Comparing
 * `currentTail` against `originalTail` at drop time is what decides
 * whether this was a same-row retime or a cross-row reassignment.
 */
type DragState = {
  state: SimState;
  leg: ScheduleLeg;
  bar: HTMLDivElement;
  originalTail: string;
  originalDepartMinute: number;
  currentTail: string;
  currentTrack: HTMLDivElement;
  trackWidthPx: number;
  startClientX: number;
  tentativeDepartMinute: number;
};

let dragState: DragState | null = null;

/**
 * Show the custom hover tooltip for one bar, positioned just past the
 * cursor — the M12 replacement for relying on the bar's native `title`.
 * The route (origin → destination) leads as the title on purpose: that's
 * exactly the thing a short block time's narrow bar can't reliably show
 * as its own clipped inline text, which is the whole reason this exists.
 * Takes `departMinute` *and* `blockMinutes` as their own arguments, not
 * read off `leg`, so the same function can show either a bar's resting
 * state (hover) or its tentative dragged-to state (mid-drag, see the
 * mousemove handler below) — including, since M13, a tentative block time
 * that's shorter or longer than the leg's own, when a cross-tail drag is
 * hovering over a row whose aircraft cruises at a different speed.
 */
function showBarTooltip(leg: ScheduleLeg, departMinute: number, blockMinutes: number, clientX: number, clientY: number): void {
  barTooltipTitle.textContent = `${leg.origin} → ${leg.dest}`;
  const departTime = minuteOfDayToTimeString(departMinute);
  const arriveTime = minuteOfDayToTimeString(departMinute + blockMinutes);
  barTooltipBody.textContent = `${leg.legId} · ${departTime}–${arriveTime} (${blockMinutes} min)`;
  barTooltip.style.left = `${clientX + 14}px`;
  barTooltip.style.top = `${clientY + 14}px`;
  barTooltip.hidden = false;
}

export function hideBarTooltip(): void {
  barTooltip.hidden = true;
}

/**
 * Wire up dragging *and* hovering for one bar. Dragging moves it
 * horizontally within its own row to retime it (M12), or vertically into a
 * *different* tail's row to reassign which aircraft flies it (M13, see the
 * mousemove handler's reparenting below) — attached fresh every rebuild,
 * same "build once per render, not incrementally patched" simplicity the
 * rest of this file already uses.
 */
function attachDragHandlers(bar: HTMLDivElement, leg: ScheduleLeg, track: HTMLDivElement, state: SimState): void {
  bar.addEventListener('mouseenter', (event) => {
    if (!dragState) showBarTooltip(leg, leg.departMinute, leg.blockMinutes, event.clientX, event.clientY);
  });
  bar.addEventListener('mousemove', (event) => {
    if (!dragState) showBarTooltip(leg, leg.departMinute, leg.blockMinutes, event.clientX, event.clientY);
  });
  bar.addEventListener('mouseleave', () => {
    if (!dragState) hideBarTooltip();
  });

  bar.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return; // left-click drags only
    event.preventDefault();

    dragState = {
      state,
      leg,
      bar,
      originalTail: leg.tail,
      originalDepartMinute: leg.departMinute,
      currentTail: leg.tail,
      currentTrack: track,
      trackWidthPx: track.getBoundingClientRect().width,
      startClientX: event.clientX,
      tentativeDepartMinute: leg.departMinute,
    };
    bar.classList.add('rotation-bar--dragging');
  });
}

/**
 * Live preview while dragging: move the bar under the cursor (reparenting
 * it into a different row the instant the cursor crosses into one — see
 * below), snap the time to the nearest whole minute, and check — before
 * anything is committed — whether dropping it *here* would leave things
 * chaining correctly.
 *
 * Two tails can be affected by one drag, so two checks run:
 *   - the candidate tail's day, with this leg hypothetically added at the
 *     new time (tailRotationProblems() — the same per-tail chain/turn-
 *     time/closure check validateSchedule() applies to every tail, just
 *     scoped to one so an unrelated tail's own problems don't bleed in);
 *   - if the bar has actually moved to a *different* tail's row, that
 *     tail's *original* day with this leg removed — pulling a leg out of
 *     the middle of a closed rotation can just as easily break the tail
 *     being left behind as it can the one gaining a new leg.
 * A leg dragged onto a row whose aircraft can't actually reach this leg's
 * distance (checked against that type's rangeNm, the same hard limit the
 * M10 route builder enforces when a route is first drawn) is flagged the
 * same way — a real "physically impossible" problem, not just a scheduling
 * one, but scored through the same red/green feedback rather than a
 * separate mechanism.
 *
 * Turns the bar red the instant any of that is true, green again the
 * instant it isn't — the player sees the conflict while they're still
 * deciding where to drop it, not after.
 */
window.addEventListener('mousemove', (event) => {
  if (!dragState) return;
  const { leg, bar, originalTail, originalDepartMinute } = dragState;

  const targetEntry = findRowTrackAt(event.clientY);
  if (targetEntry && targetEntry.tail !== dragState.currentTail) {
    targetEntry.track.appendChild(bar);
    dragState.currentTail = targetEntry.tail;
    dragState.currentTrack = targetEntry.track;
    dragState.trackWidthPx = targetEntry.track.getBoundingClientRect().width;
  }
  const { currentTail, trackWidthPx } = dragState;

  const deltaPx = event.clientX - dragState.startClientX;
  const deltaMinutes = (deltaPx / trackWidthPx) * MINUTES_PER_DAY;
  const newDepartMinute = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(originalDepartMinute + deltaMinutes)));
  dragState.tentativeDepartMinute = newDepartMinute;

  // Looked up before the tooltip/chain-check below: hovering over a
  // different-tail row means this leg's block time is only tentative too
  // (see the M13 note on updateRotationBoard() for why blockMinutes has
  // to change with the gauge), and both the tooltip and the turn-time
  // preview need that tentative value, not the leg's still-original one.
  const candidateAircraft = dragState.state.aircraft.find((a) => a.tail === currentTail);
  const candidateType = candidateAircraft ? aircraftTypesByCode.get(candidateAircraft.typeCode) : undefined;
  const tentativeBlockMinutes =
    currentTail !== originalTail && candidateType
      ? computeBlockMinutes(leg.origin, leg.dest, candidateType.cruiseKts)
      : leg.blockMinutes;

  bar.style.left = `${(newDepartMinute / MINUTES_PER_DAY) * 100}%`;
  bar.style.width = `${(tentativeBlockMinutes / MINUTES_PER_DAY) * 100}%`;
  showBarTooltip(leg, newDepartMinute, tentativeBlockMinutes, event.clientX, event.clientY);

  const hypotheticalLeg: ScheduleLeg = { ...leg, tail: currentTail, departMinute: newDepartMinute, blockMinutes: tentativeBlockMinutes };
  const destOtherLegs = dragState.state.schedule.filter((l) => l.tail === currentTail && l.legId !== leg.legId);
  let problems = tailRotationProblems(currentTail, [...destOtherLegs, hypotheticalLeg]);
  if (currentTail !== originalTail) {
    const sourceRemainingLegs = dragState.state.schedule.filter((l) => l.tail === originalTail && l.legId !== leg.legId);
    problems = [...problems, ...tailRotationProblems(originalTail, sourceRemainingLegs)];
  }

  const originAirport = airportsByIata.get(leg.origin);
  const destAirport = airportsByIata.get(leg.dest);
  const outOfRange =
    !!candidateType &&
    !!originAirport &&
    !!destAirport &&
    greatCircleDistanceNm(originAirport, destAirport) > candidateType.rangeNm;

  // Week four's airport size constraints (Airport.maxAircraftType) get
  // the same "allow the drop, just flag it" treatment every other
  // in-progress-drag problem here already gets — not a hard block,
  // unlike the route builder's version of this same check, since a
  // drag's commit never blocks on anything (see the mouseup handler
  // below).
  const violatesAirportConstraint =
    !!candidateType &&
    (!isAircraftTypeAllowedAt(leg.origin, candidateType.code) || !isAircraftTypeAllowedAt(leg.dest, candidateType.code));

  bar.classList.toggle('rotation-bar--invalid', problems.length > 0 || outOfRange || violatesAirportConstraint);
});

/**
 * Drop: write the new depart time — and, if the bar ended up in a
 * different tail's row, the new tail — back into the real
 * `state.schedule` entry (this *is* the live object, so no lookup-and-
 * replace needed), then re-run the same whole-schedule validation the
 * schedule editor and route builder already trigger after any edit, so
 * the sidebar's warning list and every other panel agree with what the
 * board now shows. A drag that ends up back exactly where it started (same
 * tail, same time) is a no-op — still clears the drag styling, but never
 * touches `state` or re-validates for nothing.
 */
window.addEventListener('mouseup', () => {
  if (!dragState) return;
  const { state, leg, bar, tentativeDepartMinute, originalDepartMinute, currentTail, originalTail } = dragState;
  bar.classList.remove('rotation-bar--dragging');
  hideBarTooltip(); // the bar itself is about to be rebuilt (or the mouse has moved on); a stale tooltip helps no one

  if (tentativeDepartMinute !== originalDepartMinute || currentTail !== originalTail) {
    leg.departMinute = tentativeDepartMinute;
    leg.tail = currentTail;

    // Reassigned to a different tail: this leg now flies behind a
    // (possibly) different gauge, so its block time — locked in at
    // whichever plane's cruise speed was flying it when it was first
    // drawn — has to be recomputed for the new one. Everything else that
    // depends on "which plane is this" (seats/capacity in
    // ui/commercial.ts, cost in sim/economy.ts) already reads it fresh
    // off `state.aircraft` via the tail at flight time, so blockMinutes
    // was the one place a stale gauge could actually linger.
    if (currentTail !== originalTail) {
      const newAircraft = state.aircraft.find((a) => a.tail === currentTail);
      const newType = newAircraft ? aircraftTypesByCode.get(newAircraft.typeCode) : undefined;
      if (newType) {
        leg.blockMinutes = computeBlockMinutes(leg.origin, leg.dest, newType.cruiseKts);
      }
    }

    syncScheduleRow(leg);
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
 * draggable (see attachDragHandlers()) to retime that one leg by hand, or
 * drag it into a different tail's row to reassign it — the M12/M13 answer
 * to the M10 route builder's guessed depart times sometimes landing on
 * top of a tail's existing legs (see WEEK-FOUR.md): rather than trying to
 * make the guess smarter, drop the new leg wherever and let the player see
 * and fix the conflict here directly.
 *
 * `highlightLegIds` (also M12) marks specific bars — freshly added by the
 * route builder — with a glow and scrolls the first one into view, so
 * confirming a route on the map and landing here feels like "here's what
 * you just added, go place it," not "guess which of these bars is new."
 */
export function updateRotationBoard(state: SimState, highlightLegIds: string[] = []): void {
  rowsContainer.innerHTML = '';
  rowTracksByTail = [];

  for (const aircraft of state.aircraft) {
    const row = document.createElement('div');
    row.className = 'rotation-row';

    // Same raw typeCode the Fleet panel's own Type column shows
    // (ui/panels.ts) — no separate name lookup, so the two stay
    // trivially consistent with each other.
    const typeLabel = document.createElement('div');
    typeLabel.className = 'rotation-row-type';
    typeLabel.textContent = aircraft.typeCode;

    const label = document.createElement('div');
    label.className = 'rotation-row-label';
    label.textContent = aircraft.tail;

    const track = document.createElement('div');
    track.className = 'rotation-row-track';
    rowTracksByTail.push({ tail: aircraft.tail, track });

    for (const leg of state.schedule) {
      if (leg.tail !== aircraft.tail) continue;

      const bar = document.createElement('div');
      bar.className = 'rotation-bar';
      if (highlightLegIds.includes(leg.legId)) bar.classList.add('rotation-bar--new');
      bar.style.left = `${(leg.departMinute / MINUTES_PER_DAY) * 100}%`;
      bar.style.width = `${(leg.blockMinutes / MINUTES_PER_DAY) * 100}%`;
      bar.textContent = `${leg.origin} → ${leg.dest}`;
      attachDragHandlers(bar, leg, track, state);

      track.appendChild(bar);
    }

    row.append(typeLabel, label, track);
    rowsContainer.appendChild(row);
  }

  if (highlightLegIds.length > 0) {
    rowsContainer.querySelector('.rotation-bar--new')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
