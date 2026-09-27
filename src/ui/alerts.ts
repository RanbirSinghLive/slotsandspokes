import { describeShock } from '../sim/shocks';
import { select, type Selection } from './selection';
import { scheduleProblems } from './panels';
import { runwayAlertMessage } from './runway';
import type { SimState } from '../sim/state';

/**
 * The Paradox "outliner" idea: real problems shouldn't only be visible to
 * whoever happens to have the right sidebar tab open. Schedule problems
 * (`scheduleProblems()`), planes grounded for want of crews, a shock and
 * a shrinking runway are exactly what a player misses for days at a time.
 *
 * This strip is always visible regardless of which tab is open, and each
 * row is clickable: it jumps straight to the view or tab that explains it, the
 * same "click the alert, go to the problem" flow EU4/HoI4's own outliner
 * uses. `tab` is a plain string rather than main.ts's SidebarTab type —
 * this module is imported by main.ts, never the other way around, so it
 * can't depend on a type main.ts owns.
 */
export type Alert = {
  /**
   * Which problem this is, stable while the problem lasts even as its
   * wording changes ("about 9 days" becomes "about 8 days" tomorrow), so
   * dismissing it sticks.
   */
  key: string;
  message: string;
  /** The sidebar tab that explains it, when a tab does. */
  tab: string;
  /** The inspector view that explains it, when one does: opened instead of the tab. */
  view?: Selection;
};

/** How many rows show before collapsing into "+N more" — a handful of aircraft shouldn't need scrolling to read. */
const MAX_VISIBLE_ALERTS = 4;

function collectAlerts(state: SimState): Alert[] {
  const alerts: Alert[] = scheduleProblems(state).map((message) => ({ key: `schedule:${message}`, message, tab: 'fleet' }));

  // Planes grounded for want of crews (sim/crews.ts), one row per tail,
  // named, opening its base: the airport view's crew bar and Hire buttons.
  for (const tail of state.groundedTails) {
    const base = state.aircraft.find((aircraft) => aircraft.tail === tail)?.baseAirport;
    alerts.push({
      key: `grounded:${tail}`,
      message: `${tail} is grounded — not enough crews at ${base ?? 'its base'} to fly it today`,
      tab: 'fleet',
      view: base ? { kind: 'airport', iata: base } : undefined,
    });
  }

  // A shock running now (sim/shocks.ts): a condition of the whole world
  // for weeks, so it sits in the strip for as long as it lasts.
  const shock = describeShock(state);
  if (shock) alerts.push({ key: shock.key, message: shock.headline, tab: 'fleet' });

  // Cash running out ends the game, so it goes first: of everything in
  // this strip, it's the one problem that can't be fixed after the fact.
  const runway = runwayAlertMessage(state);
  if (runway) alerts.unshift({ key: 'runway', message: runway, tab: 'fleet', view: { kind: 'money' } });

  return alerts;
}

const stripEl = document.querySelector<HTMLDivElement>('#alert-strip')!;
const listEl = document.querySelector<HTMLDivElement>('#alert-strip-list')!;

let signature: string | null = null;

/**
 * Keys of alerts the player has closed with ×. A dismissal lasts as long
 * as the problem does: once an alert stops appearing its key is dropped
 * from here, so if the same problem comes back later it shows again, as
 * news. A Set is fine because this is screen state, like which tab is
 * open, not part of SimState: it isn't saved, and a reload shows
 * everything again.
 */
const dismissed = new Set<string>();

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
  const allAlerts = collectAlerts(state);
  // Forget dismissals for problems that have cleared (see `dismissed`).
  const current = new Set(allAlerts.map((a) => a.key));
  for (const key of dismissed) if (!current.has(key)) dismissed.delete(key);
  const alerts = allAlerts.filter((a) => !dismissed.has(a.key));

  const nextSignature = alerts.map((a) => a.tab + ':' + a.message).join('|');
  if (nextSignature === signature) return;
  signature = nextSignature;

  stripEl.hidden = alerts.length === 0;
  listEl.innerHTML = '';

  const visible = alerts.slice(0, MAX_VISIBLE_ALERTS);
  for (const alert of visible) {
    const item = document.createElement('div');
    item.className = 'alert-item';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'alert-row';
    row.textContent = alert.message;
    row.addEventListener('click', () => (alert.view ? select(alert.view) : onNavigate(alert.tab)));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'alert-dismiss';
    close.textContent = '×';
    close.title = 'Dismiss. It comes back if this problem clears and happens again.';
    close.setAttribute('aria-label', `Dismiss: ${alert.message}`);
    close.addEventListener('click', () => {
      dismissed.add(alert.key);
      updateAlerts(state, onNavigate);
    });

    item.append(row, close);
    listEl.appendChild(item);
  }

  if (alerts.length > MAX_VISIBLE_ALERTS) {
    const more = document.createElement('div');
    more.className = 'alert-row alert-row--more';
    more.textContent = `+${alerts.length - MAX_VISIBLE_ALERTS} more`;
    listEl.appendChild(more);
  }
}
