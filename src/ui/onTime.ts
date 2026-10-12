import type { SimState } from '../sim/state';
import { delayIcon, type DelayCause } from './delayCodes';
import { glyph, type GlyphName } from './glyphs';

/**
 * The Routes screen's Reliability lens: delay minutes by cause, and
 * cancellations by cause, each one stacked bar with an icon legend. Which route is late is the routes table's job,
 * sorted by on-time; this is what's making them late.
 */

const causeBarEl = document.querySelector<HTMLDivElement>('#ontime-causes-bar')!;
const cancelBarEl = document.querySelector<HTMLDivElement>('#ontime-cancel-bar')!;

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
  ['waived', 'Waived ahead of a storm', 'snow', '#8ec5ff'],
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

type Segment = { icon: HTMLElement; label: string; count: number; unit: string; colour: string };

/** One stacked bar and its legend. Causes with nothing in them are left off; an empty breakdown says so. */
function drawStack(into: HTMLElement, segments: Segment[]): void {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) {
    into.textContent = 'None yet';
    return;
  }
  const shown = segments.filter((segment) => segment.count > 0).sort((x, y) => y.count - x.count);
  const bar = document.createElement('div');
  bar.className = 'cause-bar';
  const legend = document.createElement('div');
  legend.className = 'cause-legend';
  for (const segment of shown) {
    const share = Math.round((segment.count / total) * 100);
    const tip = `${segment.label} · ${segment.count.toLocaleString()} ${segment.unit} · ${share}%`;
    const piece = document.createElement('i');
    piece.style.flex = `${segment.count} 0 0`;
    piece.style.background = segment.colour;
    piece.dataset.tip = tip;
    bar.append(piece);
    const item = document.createElement('span');
    item.dataset.tip = tip;
    item.append(segment.icon, ` ${share}%`);
    legend.append(item);
  }
  into.replaceChildren(bar, legend);
}

/**
 * Rebuild both bars from `state.delayMinutesByCause` and the cancellation
 * counts: called whenever the Routes screen is built, in case either
 * changed since ("refresh on show, not every tick").
 */
export function updateOnTimePanel(state: SimState): void {
  drawStack(
    causeBarEl,
    delayCauseRows(state).map((cause) => ({
      icon: delayIcon(cause.cause),
      label: cause.label,
      count: cause.minutes,
      unit: 'min',
      colour: DELAY_BAR_COLOURS[cause.cause],
    })),
  );
  drawStack(
    cancelBarEl,
    CANCEL_CAUSE_LABELS.map(([key, label, icon, colour]) => {
      const mark = glyph(icon, label);
      mark.style.color = colour;
      return { icon: mark, label, count: state.cancellationsByCause[key] ?? 0, unit: 'flights', colour };
    }),
  );
}
