import type { SimState } from '../sim/state';

const marketRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-rows')!;
const causeRowsBody = document.querySelector<HTMLTableSectionElement>('#ontime-causes-rows')!;

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
 * "no live inputs to lose focus on" shape ui/rotationBoard.ts's board
 * uses, not the "build once, patch in place" discipline ui/commercial.ts
 * and ui/panels.ts's schedule table need for their own live `<input>`s.
 * Exported anyway, for symmetry with every other panel's setup function
 * main.ts calls once at startup.
 */
export function setupOnTimePanel(): void {}

/**
 * Rebuild both tables from `state.onTimeByMarket` and
 * `state.delayMinutesByCause` — called whenever the On-Time panel
 * becomes visible, in case either changed while it wasn't (the same
 * "refresh on select, not every tick" pattern ui/rotationBoard.ts and
 * ui/commercial.ts already use).
 *
 * The per-route table is sorted worst-first: the point of this panel is
 * surfacing which routes are actually unreliable, not an alphabetical
 * ledger the player has to scan themselves.
 */
export function updateOnTimePanel(state: SimState): void {
  marketRowsBody.innerHTML = '';

  const marketRows = Object.entries(state.onTimeByMarket)
    .map(([key, { departed, onTime }]) => ({
      key,
      departed,
      onTime,
      pct: departed > 0 ? onTime / departed : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  for (const { key, departed, onTime, pct } of marketRows) {
    const [origin, dest] = key.split('-');
    const row = document.createElement('tr');

    const marketCell = document.createElement('td');
    marketCell.textContent = `${origin} ↔ ${dest}`;

    const departedCell = document.createElement('td');
    departedCell.textContent = String(departed);

    const onTimeCell = document.createElement('td');
    onTimeCell.textContent = String(onTime);

    const pctCell = document.createElement('td');
    pctCell.textContent = `${Math.round(pct * 100)}%`;
    const cls = onTimePctClass(pct);
    if (cls) pctCell.classList.add(cls);

    row.append(marketCell, departedCell, onTimeCell, pctCell);
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
}
