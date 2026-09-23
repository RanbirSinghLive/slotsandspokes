import { classByCode } from '../sim/aircraftClasses';
import type { ProjectedLeg } from '../sim/cascade';
import { ON_TIME_GRACE_MINUTES } from '../sim/delays';
import type { ActiveFlight, SimState } from '../sim/state';
import { minuteOfDayToTimeString } from './panels';

/**
 * What hovering a moving plane tells you: why *this* flight is late, in
 * delay codes, and where that lateness goes next. Hovering the route line
 * tells you about the route; hovering the plane tells you about the
 * flight. Real DOM, like every other readout (CLAUDE.md).
 *
 * The codes add up to the flight's total lateness on arrival:
 *   ROT   left late because the inbound aircraft was late
 *   TURN  the knock-on of that rushed turnaround (sim/delays.ts)
 *   ACFT  this airframe's own unreliability, worse with age
 *   WX    weather at the departure airport
 *   COO   minutes a flight-ops executive clawed back
 */

const MINUTES_PER_DAY = 1440;
const MAX_REST_OF_DAY_ROWS = 5;

const tooltipEl = document.querySelector<HTMLElement>('#flight-tooltip')!;

function clock(absoluteMinute: number): string {
  return minuteOfDayToTimeString(absoluteMinute % MINUTES_PER_DAY);
}

function row(code: string, text: string, minutes: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'flight-tooltip-code';
  const codeEl = document.createElement('span');
  codeEl.className = 'flight-tooltip-code-id';
  codeEl.textContent = code;
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
  const rolled = flight.delayByCause.age + flight.delayByCause.weather + flight.delayByCause.knockOn;
  const executiveSaving = flight.delayMinutes - rolled;

  const nodes: HTMLElement[] = [
    line(`${flight.tail} · ${className}`, 'flight-tooltip-title'),
    line(`${flight.origin} → ${flight.dest}, lands ${clock(flight.arriveMinute)}`),
  ];

  if (lateOnArrival <= 0) {
    nodes.push(line('On time', 'is-good'));
  } else if (lateOnArrival <= ON_TIME_GRACE_MINUTES) {
    nodes.push(line(`${lateOnArrival} min late: still counts as on time (${ON_TIME_GRACE_MINUTES} min grace)`, 'is-good'));
  } else {
    nodes.push(line(`${lateOnArrival} min late`, 'is-late'));
  }

  const codes: HTMLElement[] = [];
  if (leftLate > 0) codes.push(row('ROT', 'Late inbound aircraft', leftLate));
  if (flight.delayByCause.knockOn > 0) codes.push(row('TURN', 'Rushed turnaround', flight.delayByCause.knockOn));
  if (flight.delayByCause.age > 0) codes.push(row('ACFT', `Aircraft (${aircraft?.ageYears ?? 0} yrs old)`, flight.delayByCause.age));
  if (flight.delayByCause.weather > 0) codes.push(row('WX', `Weather at ${flight.origin}`, flight.delayByCause.weather));
  if (executiveSaving < 0) codes.push(row('COO', 'Flight-ops executive', executiveSaving));
  if (codes.length > 0) {
    nodes.push(line('Delay codes', 'flight-tooltip-section'));
    nodes.push(...codes);
  }

  if (restOfDay.length === 0) {
    nodes.push(line('Last flight of its day.', 'flight-tooltip-section'));
  } else {
    nodes.push(line('Rest of its day, if nothing else goes wrong', 'flight-tooltip-section'));
    for (const projected of restOfDay.slice(0, MAX_REST_OF_DAY_ROWS)) {
      const status = projected.onTime ? 'on time' : `+${projected.lateMinutes}m late`;
      nodes.push(
        line(
          `${projected.leg.origin} → ${projected.leg.dest}  ${clock(projected.projectedDepartMinute)}  ${status}`,
          projected.onTime ? 'is-good' : 'is-late',
        ),
      );
    }
    if (restOfDay.length > MAX_REST_OF_DAY_ROWS) nodes.push(line(`+${restOfDay.length - MAX_REST_OF_DAY_ROWS} more`));
    const recovers = restOfDay.findIndex((projected) => projected.onTime);
    if (!restOfDay[restOfDay.length - 1].onTime) {
      // The buffer that helps is the one on the route being flown now: it
      // pads the turn right after this flight (sim/turnBuffer.ts).
      nodes.push(
        line(`The delay never clears today. A turn buffer on ${flight.origin}–${flight.dest} would absorb it.`, 'flight-tooltip-hint'),
      );
    } else if (recovers > 0) {
      nodes.push(line(`Back on time after ${recovers} more late flight${recovers === 1 ? '' : 's'}.`, 'flight-tooltip-hint'));
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
