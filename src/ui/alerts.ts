import { scheduleProblems } from './panels';
import type { SimState } from '../sim/state';

/**
 * The Paradox "outliner" idea: real problems shouldn't only be visible to
 * whoever happens to have the right sidebar tab open. `scheduleProblems()`
 * (schedule/utilisation) has existed since week seven but only ever
 * rendered inside the Fleet tab's own warnings list; crew-caused grounding
 * (`state.groundedTails`) only ever showed as a bare count in the Crew
 * tab. Both are exactly the kind of thing a player misses for days at a
 * time — an aircraft quietly grounded, a rotation quietly over 100%.
 *
 * This strip is always visible regardless of which tab is open, and each
 * row is clickable: it jumps straight to the tab that explains it, the
 * same "click the alert, go to the problem" flow EU4/HoI4's own outliner
 * uses. `tab` is a plain string rather than main.ts's SidebarTab type —
 * this module is imported by main.ts, never the other way around, so it
 * can't depend on a type main.ts owns.
 */
export type Alert = { message: string; tab: string };

/** How many rows show before collapsing into "+N more" — a handful of aircraft shouldn't need scrolling to read. */
const MAX_VISIBLE_ALERTS = 4;

function collectAlerts(state: SimState): Alert[] {
  const alerts: Alert[] = scheduleProblems(state).map((message) => ({ message, tab: 'fleet' }));

  // Crew-grounded tails: real, and previously visible only as a bare
  // count on the Crew tab ("N aircraft with no base — assign one before
  // they can be worked" is the schedule-side version of this same idea;
  // this is the crew-side one). One row per tail, named, so a click
  // doesn't just say "something's wrong" — it says what.
  for (const tail of state.groundedTails) {
    alerts.push({ message: `${tail} is grounded — not enough crew to fly it today`, tab: 'crew' });
  }

  return alerts;
}

const stripEl = document.querySelector<HTMLDivElement>('#alert-strip')!;
const listEl = document.querySelector<HTMLDivElement>('#alert-strip-list')!;

let signature: string | null = null;

/**
 * Refresh the strip from `state`. Called once per rendered frame from
 * main.ts's render(), same as the ticker — cheap even every frame, since
 * `collectAlerts()` is at most a couple of O(aircraft)/O(legs) passes over
 * a fleet CLAUDE.md itself caps at "well under 100." Guarded by a
 * signature so the DOM (and its click handlers) are only rebuilt when the
 * alert list actually changes, not 60 times a second — the same fix
 * ui/panels.ts's renderFleet()/renderRotations() needed after a per-frame
 * rebuild silently broke their own buttons.
 */
export function updateAlerts(state: SimState, onNavigate: (tab: string) => void): void {
  const alerts = collectAlerts(state);
  const nextSignature = alerts.map((a) => a.tab + ':' + a.message).join('|');
  if (nextSignature === signature) return;
  signature = nextSignature;

  stripEl.hidden = alerts.length === 0;
  listEl.innerHTML = '';

  const visible = alerts.slice(0, MAX_VISIBLE_ALERTS);
  for (const alert of visible) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'alert-row';
    row.textContent = alert.message;
    row.addEventListener('click', () => onNavigate(alert.tab));
    listEl.appendChild(row);
  }

  if (alerts.length > MAX_VISIBLE_ALERTS) {
    const more = document.createElement('div');
    more.className = 'alert-row alert-row--more';
    more.textContent = `+${alerts.length - MAX_VISIBLE_ALERTS} more`;
    listEl.appendChild(more);
  }
}
