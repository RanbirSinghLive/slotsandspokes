import { formatLoadFactor, marketLoadFactor } from '../sim/loadFactor';
import { formatNps, marketNps } from '../sim/nps';
import { minuteOfDay } from '../sim/clock';
import { classByCode } from '../sim/aircraftClasses';
import type { ProjectedLeg } from '../sim/cascade';
import { ON_TIME_GRACE_MINUTES } from '../sim/delays';
import { airportLoad } from '../sim/airports';
import type { ActiveFlight, SimState } from '../sim/state';
import { minuteOfDayToTimeString } from './panels';
import { flightNumber } from '../sim/flightNumbers';
import { delayIcon, delayCodeFor, type DelayCause } from './delayCodes';

/**
 * What hovering a moving plane tells you: why *this* flight is late, in
 * delay codes, and where that lateness goes next. Hovering the route line
 * tells you about the route; hovering the plane tells you about the
 * flight. Real DOM, like every other readout (CLAUDE.md).
 *
 * The codes add up to the flight's total lateness on arrival:
 * Each cause is an icon (ui/delayCodes.ts) with its IATA-style code:
 *   rotation    left late because the inbound aircraft was late
 *   knock-on    the rushed turnaround that follows (sim/delays.ts)
 *   age         this airframe's own unreliability, worse with age
 *   weather     weather at the departure airport
 *   congestion  the busier of its two airports (sim/airports.ts)
 *   executive   minutes a flight-ops executive clawed back
 */

const MAX_REST_OF_DAY_ROWS = 5;

const tooltipEl = document.querySelector<HTMLElement>('#flight-tooltip')!;

/** An absolute simMinute as a home-local time of day, the same clock the HUD shows. */
function clock(state: SimState, absoluteMinute: number): string {
  return minuteOfDayToTimeString(minuteOfDay(state, absoluteMinute));
}

function row(cause: DelayCause, text: string, minutes: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'flight-tooltip-code';
  const codeEl = document.createElement('span');
  codeEl.className = 'flight-tooltip-code-id';
  codeEl.append(delayIcon(cause, text));
  codeEl.append(delayCodeFor(cause).code);
  const textEl = document.createElement('span');
  textEl.textContent = text;
  const minutesEl = document.createElement('span');
  minutesEl.className = 'flight-tooltip-code-minutes';
  minutesEl.textContent = `${minutes > 0 ? '+' : ''}${minutes}m`;
  el.append(codeEl, textEl, minutesEl);
  return el;
}

function line(text: string, className?: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

export function showFlightTooltip(
  flight: ActiveFlight,
  restOfDay: ProjectedLeg[],
  state: SimState,
  screenX: number,
  screenY: number,
): void {
  const aircraft = state.aircraft.find((a) => a.tail === flight.tail);
  const className = classByCode(aircraft?.typeCode ?? '')?.name ?? '';
  const lateOnArrival = flight.arriveMinute - flight.scheduledArriveMinute;
  const leftLate = flight.departMinute - flight.scheduledDepartMinute;
  const rolled =
    flight.delayByCause.age + flight.delayByCause.weather + flight.delayByCause.knockOn + flight.delayByCause.congestion;
  const executiveSaving = flight.delayMinutes - rolled;

  const nodes: HTMLElement[] = [
    line(`${flightNumber(state.schedule, state.schedule.find((leg) => leg.legId === flight.legId) ?? { ...flight, blockMinutes: 0 })} · ${flight.tail} · ${className}`, 'flight-tooltip-title'),
    line(`${flight.origin}→${flight.dest} · ETA ${clock(state, flight.arriveMinute)}`),
    // Its passengers are only settled when it lands, so the route's recent
    // load factor stands in (sim/loadFactor.ts).
    line(`Route LF ${formatLoadFactor(marketLoadFactor(state, flight.origin, flight.dest))} · NPS ${formatNps(marketNps(state, flight.origin, flight.dest))}`),
  ];

  if (flight.detourMinutes) nodes.push(line(`Round airspace closure · +${flight.detourMinutes} min filed`, 'is-late'));

  if (lateOnArrival <= 0) {
    nodes.push(line('On time', 'is-good'));
  } else if (lateOnArrival <= ON_TIME_GRACE_MINUTES) {
    nodes.push(line(`+${lateOnArrival} min · on time (≤${ON_TIME_GRACE_MINUTES})`, 'is-good'));
  } else {
    nodes.push(line(`+${lateOnArrival} min`, 'is-late'));
  }

  const codes: HTMLElement[] = [];
  if (leftLate > 0) codes.push(row('rotation', 'Late inbound aircraft', leftLate));
  if (flight.delayByCause.knockOn > 0) codes.push(row('knockOn', 'Rushed turnaround', flight.delayByCause.knockOn));
  if (flight.delayByCause.age > 0) codes.push(row('age', `Aircraft, ${aircraft?.ageYears ?? 0} yrs`, flight.delayByCause.age));
  if (flight.delayByCause.weather > 0) codes.push(row('weather', `Weather at ${flight.origin}`, flight.delayByCause.weather));
  if (flight.delayByCause.congestion > 0) {
    const busier = airportLoad(state, flight.origin) >= airportLoad(state, flight.dest) ? flight.origin : flight.dest;
    codes.push(row('congestion', `Congestion at ${busier}`, flight.delayByCause.congestion));
  }
  if (executiveSaving < 0) codes.push(row('executive', 'Flight-ops executive', executiveSaving));
  if (codes.length > 0) {
    nodes.push(line('Delay codes', 'flight-tooltip-section'));
    nodes.push(...codes);
  }

  if (restOfDay.length === 0) {
    nodes.push(line('Last flight of its day', 'flight-tooltip-section'));
  } else {
    nodes.push(line('Rest of day · projected', 'flight-tooltip-section'));
    for (const projected of restOfDay.slice(0, MAX_REST_OF_DAY_ROWS)) {
      const status = projected.cancelled
        ? 'CNX · curfew'
        : projected.onTime
          ? 'on time'
          : `+${projected.lateMinutes} min`;
      nodes.push(
        line(
          `${projected.leg.origin} → ${projected.leg.dest}  ${clock(state, projected.projectedDepartMinute)}  ${status}`,
          projected.onTime ? 'is-good' : 'is-late',
        ),
      );
    }
    if (restOfDay.length > MAX_REST_OF_DAY_ROWS) nodes.push(line(`+${restOfDay.length - MAX_REST_OF_DAY_ROWS} more`));
    const recovers = restOfDay.findIndex((projected) => projected.onTime);
    const cancellations = restOfDay.filter((projected) => projected.cancelled).length;
    if (cancellations > 0) {
      nodes.push(
        line(
          `${cancellations} CNX at curfew · a turn buffer on ${flight.origin}–${flight.dest} would absorb it`,
          'flight-tooltip-hint',
        ),
      );
    } else if (!restOfDay[restOfDay.length - 1].onTime) {
      // The buffer that helps is the one on the route being flown now: it
      // pads the turn right after this flight (sim/turnBuffer.ts).
      nodes.push(
        line(`Delay carries all day · a turn buffer on ${flight.origin}–${flight.dest} would absorb it`, 'flight-tooltip-hint'),
      );
    } else if (recovers > 0) {
      nodes.push(line(`Recovers after ${recovers} more late flight${recovers === 1 ? '' : 's'}`, 'flight-tooltip-hint'));
    }
  }

  tooltipEl.replaceChildren(...nodes);
  tooltipEl.hidden = false;

  // Beside the plane rather than under the pointer, and kept on the map
  // rather than spilling over the sidebar.
  tooltipEl.style.left = `${screenX + 16}px`;
  tooltipEl.style.top = `${screenY + 16}px`;
  const rect = tooltipEl.getBoundingClientRect();
  const mapRight = document.querySelector<HTMLCanvasElement>('#map')!.getBoundingClientRect().right;
  if (rect.right > mapRight) tooltipEl.style.left = `${Math.max(8, screenX - rect.width - 16)}px`;
  if (rect.bottom > window.innerHeight) tooltipEl.style.top = `${screenY - rect.height - 16}px`;
}

export function hideFlightTooltip(): void {
  tooltipEl.hidden = true;
}
