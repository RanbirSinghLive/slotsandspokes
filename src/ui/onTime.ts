import type { SimState } from '../sim/state';

const marketRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-rows')!;
const causeRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-causes-rows')!;
const cancelRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-cancel-rows')!;
const completionEl = document.querySelector<HTMLDivElement>('#ontime-completion')!;

/**
 * Week six: cancellations, broken out the same way delay minutes are.
 * Each cause has a different answer available — reserve depth for crew,
 * maintenance staffing and younger airframes for mechanical, and nothing
 * at all for weather — so which one dominates is the whole point of
 * showing them apart rather than as one number.
 */
const CANCEL_CAUSE_LABELS: [keyof SimState['cancellationsByCause'], string][] = [
  ['crew', 'Crew shortage'],
  ['mechanical', 'Unscheduled maintenance'],
  ['weather', 'Airport closed'],
  ['curfew', 'Delays ran past 22:00'],
];

// Below BAD_THRESHOLD: red, matching the app's existing "flag a real
// problem" color (#ff8080, same as schedule warnings and out-of-range
// routes). Between BAD_THRESHOLD and WARN_THRESHOLD: amber (#ffd166,
// same as thin-market). At or above WARN_THRESHOLD: no color at all —
// only bad and borderline performance gets flagged, same "don't add a
// third color for the fine case" convention those other spots use.
const BAD_THRESHOLD = 0.7;
const WARN_THRESHOLD = 0.9;

// A simple inline bar for the delay-codes table — 90px is this cause's
// share of total delay minutes at 100%, not tied to any other unit.
const MAX_SHARE_BAR_PX = 90;

type DelayCauseRow = { label: string; minutes: number };

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
    { label: 'Late Aircraft (knock-on)', minutes: state.delayMinutesByCause.knockOn },
    { label: 'Weather', minutes: state.delayMinutesByCause.weather },
    { label: 'Carrier (aircraft age)', minutes: state.delayMinutesByCause.age },
  ];
}

function onTimePctClass(pct: number): string | null {
  if (pct < BAD_THRESHOLD) return 'ontime-pct-bad';
  if (pct < WARN_THRESHOLD) return 'ontime-pct-warn';
  return null;
}

/**
 * Nothing to build once at startup — both tables below are fully
 * rebuilt by updateOnTimePanel() every time the panel opens, same
 * "no live inputs to lose focus on" shape ui/panels.ts's fleet and
 * rotations tables use, not the "build once, patch in place" discipline
 * ui/commercial.ts needs for its own live `<input>`s.
 * Exported anyway, for symmetry with every other panel's setup function
 * main.ts calls once at startup.
 */
export function setupOnTimePanel(): void {}

/**
 * Rebuild both tables from `state.onTimeByMarket` and
 * `state.delayMinutesByCause` — called whenever the On-Time panel
 * becomes visible, in case either changed while it wasn't (the same
 * "refresh on select, not every tick" pattern ui/commercial.ts already
 * uses).
 *
 * The per-route table is sorted worst-first: the point of this panel is
 * surfacing which routes are actually unreliable, not an alphabetical
 * ledger the player has to scan themselves.
 */
export function updateOnTimePanel(state: SimState): void {
  marketRowsBody.innerHTML = '';

  const marketRows = Object.entries(state.onTimeByMarket)
    .map(([key, { arrived, onTime }]) => ({
      key,
      arrived,
      onTime,
      pct: arrived > 0 ? onTime / arrived : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  for (const { key, arrived, onTime, pct } of marketRows) {
    const [origin, dest] = key.split('-');
    const row = document.createElement('tr');

    const marketCell = document.createElement('td');
    marketCell.textContent = `${origin} ↔ ${dest}`;

    const arrivedCell = document.createElement('td');
    arrivedCell.textContent = String(arrived);

    const onTimeCell = document.createElement('td');
    onTimeCell.textContent = String(onTime);

    const pctCell = document.createElement('td');
    pctCell.textContent = `${Math.round(pct * 100)}%`;
    const cls = onTimePctClass(pct);
    if (cls) pctCell.classList.add(cls);

    row.append(marketCell, arrivedCell, onTimeCell, pctCell);
    marketRowsBody.appendChild(row);
  }

  causeRowsBody.innerHTML = '';

  const causes = delayCauseRows(state).sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = causes.reduce((sum, cause) => sum + cause.minutes, 0);

  for (const cause of causes) {
    const share = totalMinutes > 0 ? cause.minutes / totalMinutes : 0;
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = cause.label;

    const minutesCell = document.createElement('td');
    minutesCell.textContent = `${cause.minutes.toLocaleString()} min`;

    const shareCell = document.createElement('td');
    const bar = document.createElement('span');
    bar.className = 'ontime-causes-share-bar';
    bar.style.width = `${Math.round(share * MAX_SHARE_BAR_PX)}px`;
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
      ? 'Nothing scheduled yet.'
      : `${Math.round(completion * 100)}% completion factor — ${state.flightsCancelledTotal.toLocaleString()} of ` +
        `${state.flightsScheduledTotal.toLocaleString()} scheduled departures cancelled.`;

  cancelRowsBody.innerHTML = '';
  const totalCancelled = state.flightsCancelledTotal;
  for (const [key, label] of CANCEL_CAUSE_LABELS) {
    const count = state.cancellationsByCause[key];
    const share = totalCancelled > 0 ? count / totalCancelled : 0;
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = label;

    const countCell = document.createElement('td');
    countCell.textContent = count.toLocaleString();

    const shareCell = document.createElement('td');
    const bar = document.createElement('span');
    bar.className = 'ontime-causes-share-bar';
    bar.style.width = `${Math.round(share * MAX_SHARE_BAR_PX)}px`;
    shareCell.append(bar, document.createTextNode(`${Math.round(share * 100)}%`));

    row.append(labelCell, countCell, shareCell);
    cancelRowsBody.appendChild(row);
  }
}
