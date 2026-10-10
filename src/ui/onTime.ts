import type { SimState } from '../sim/state';
import { delayIcon, type DelayCause } from './delayCodes';
import { glyph, type GlyphName } from './glyphs';

/**
 * The Routes screen's Reliability section: delay minutes by cause, and
 * cancellations by cause. Which route is late is the routes table's job,
 * sorted by on-time; this is what's making them late.
 */

const causeRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-causes-rows')!;
const cancelRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-cancel-rows')!;
const completionEl = document.querySelector<HTMLDivElement>('#ontime-completion')!;

/**
 * Cancellations, broken out the same way delay minutes are. Each cause
 * has a different answer — hiring crews ahead for crew, younger airframes
 * and a maintenance COO for mechanical, and nothing at all for weather —
 * so which one dominates is the whole point of showing them apart rather
 * than as one number.
 */
const CANCEL_CAUSE_LABELS: [keyof SimState['cancellationsByCause'], string, GlyphName, string][] = [
  ['crew', 'Crew shortage', 'people', '#b07ad9'],
  ['mechanical', 'Aircraft AOG', 'wrench', '#8a93a6'],
  ['weather', 'Airport closed', 'snow', '#4a90d9'],
  ['curfew', 'Delays ran past 22:00', 'moon', '#ffd166'],
  ['controller', 'Cancelled by you', 'user', '#7fd88f'],
  ['position', 'Aircraft out of position', 'mapPin', '#ffb347'],
  ['maintenance', 'Maintenance hold', 'hangar', '#5ed6c8'],
  ['airspace', 'Airspace closed', 'alert', '#ff5c5c'],
];

/** Each delay cause's bar colour, the same as the airport turnaround strip uses. */
const DELAY_BAR_COLOURS: Record<string, string> = {
  knockOn: '#ffb347',
  ground: '#b07ad9',
  congestion: '#ff5c5c',
  weather: '#4a90d9',
  age: '#8a93a6',
};

// A simple inline bar for the delay-codes table — 90px is this cause's
// share of total delay minutes at 100%, not tied to any other unit.
const MAX_SHARE_BAR_PX = 90;

type DelayCauseRow = { cause: Exclude<DelayCause, 'rotation' | 'executive'>; label: string; minutes: number };

/**
 * Real BTS-style delay-code names, mapped onto whichever step.ts
 * mechanic actually produces each one — not decorative relabeling, the
 * closest real-world category to what's actually happening: a
 * knock-on delay from an earlier leg on the same tail is literally
 * what the BTS calls "Late Aircraft"; age/reliability is the classic
 * "Carrier" delay; weather is weather.
 */
function delayCauseRows(state: SimState): DelayCauseRow[] {
  return [
    { cause: 'knockOn', label: 'Late Aircraft (knock-on)', minutes: state.delayMinutesByCause.knockOn },
    { cause: 'weather', label: 'Weather', minutes: state.delayMinutesByCause.weather },
    { cause: 'age', label: 'Carrier (aircraft age)', minutes: state.delayMinutesByCause.age },
    { cause: 'congestion', label: 'Airport congestion', minutes: state.delayMinutesByCause.congestion },
    { cause: 'ground', label: 'Ground handling', minutes: state.delayMinutesByCause.ground ?? 0 },
  ];
}

/**
 * Rebuild both tables from `state.delayMinutesByCause` and the
 * cancellation counts: called whenever the Routes screen is built, in
 * case either changed since ("refresh on show, not every tick").
 */
export function updateOnTimePanel(state: SimState): void {
  causeRowsBody.innerHTML = '';

  const causes = delayCauseRows(state).sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = causes.reduce((sum, cause) => sum + cause.minutes, 0);

  for (const cause of causes) {
    const share = totalMinutes > 0 ? cause.minutes / totalMinutes : 0;
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.append(delayIcon(cause.cause), ` ${cause.label}`);
    row.classList.toggle('is-zero', cause.minutes === 0);

    const minutesCell = document.createElement('td');
    minutesCell.textContent = `${cause.minutes.toLocaleString()} min`;

    const shareCell = document.createElement('td');
    const bar = document.createElement('span');
    bar.className = 'ontime-causes-share-bar';
    bar.style.width = `${Math.round(share * MAX_SHARE_BAR_PX)}px`;
    bar.style.background = DELAY_BAR_COLOURS[cause.cause];
    shareCell.append(bar, document.createTextNode(`${Math.round(share * 100)}%`));

    row.append(labelCell, minutesCell, shareCell);
    causeRowsBody.appendChild(row);
  }

  const completion =
    state.flightsScheduledTotal > 0
      ? (state.flightsScheduledTotal - state.flightsCancelledTotal) / state.flightsScheduledTotal
      : 1;
  completionEl.textContent =
    state.flightsScheduledTotal === 0
      ? 'Nothing scheduled yet'
      : `Completion ${Math.round(completion * 100)}% · CNX ${state.flightsCancelledTotal.toLocaleString()} of ` +
        `${state.flightsScheduledTotal.toLocaleString()} departures`;

  cancelRowsBody.innerHTML = '';
  const totalCancelled = state.flightsCancelledTotal;
  for (const [key, label, icon, colour] of CANCEL_CAUSE_LABELS) {
    const count = state.cancellationsByCause[key] ?? 0;
    const share = totalCancelled > 0 ? count / totalCancelled : 0;
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    const mark = glyph(icon, label);
    mark.style.color = colour;
    labelCell.append(mark, ` ${label}`);
    row.classList.toggle('is-zero', count === 0);

    const countCell = document.createElement('td');
    countCell.textContent = count.toLocaleString();

    const shareCell = document.createElement('td');
    const bar = document.createElement('span');
    bar.className = 'ontime-causes-share-bar';
    bar.style.width = `${Math.round(share * MAX_SHARE_BAR_PX)}px`;
    bar.style.background = colour;
    shareCell.append(bar, document.createTextNode(`${Math.round(share * 100)}%`));

    row.append(labelCell, countCell, shareCell);
    cancelRowsBody.appendChild(row);
  }
}
