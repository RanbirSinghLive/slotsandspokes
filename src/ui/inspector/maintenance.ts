import { AIRCRAFT_CLASSES } from '../../sim/aircraftClasses';
import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, MX_HOLD_AT, OVERDUE_GRACE_DAYS, wornAge } from '../../sim/mxChecks';
import { dayIndex } from '../../sim/clock';
import * as ops from '../routeActions';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement } from '../planeIcons';
import { select } from '../selection';
import { heading, line } from './dom';

/**
 * The Maintenance screen (Mtc on the rail, under Crews): the fleet's
 * technical side in one place.
 *
 * - **AOG**: every plane grounded, what's wrong, when it's back, and the
 *   button to pay a day off the repair.
 * - **Fleet health**: every plane by type, its age, how often it leaves
 *   without a mechanical delay, today's chance of going AOG, and the years
 *   of useful life its lease has left.
 *
 * What an AOG cancels goes in the ticker, and a plane's own view keeps its
 * own figures; this is the board across the fleet.
 */
export function buildMaintenanceView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Maintenance';
  root.append(title);

  const repairsToday = state.todayCostByCategory.maintenance;
  root.append(line(`${state.aogs.length} AOG · ${state.aircraft.length} aircraft` + (repairsToday > 0 ? ` · expedited ${money(repairsToday)} today` : '')));

  root.append(
    heading('AOG', 'Aircraft on ground: a fault keeps the plane out until it is repaired. Its flying moves to other planes at its base where they have time; the rest is cancelled until it is back. Expediting pays to bring it back a day sooner.'),
  );
  if (state.aogs.length === 0) {
    root.append(line('None'));
  } else {
    for (const event of state.aogs) {
      const row = linkToMap(document.createElement('div'), { kind: 'aircraft', tail: event.tail });
      row.className = 'airport-aog-row';
      const text = document.createElement('button');
      text.type = 'button';
      text.className = 'inspector-link';
      const aircraft = state.aircraft.find((a) => a.tail === event.tail);
      if (aircraft) text.append(planeIconElement(aircraft.typeCode), ' ');
      text.append(`${event.tail} · ${event.base} · ${event.fault} · back ${daysUntilReturn(state, event)}d` + (event.uncoveredRoutes.length > 0 ? ` · CNX ${event.uncoveredRoutes.join(', ')}` : ''));
      text.addEventListener('click', () => select({ kind: 'aircraft', tail: event.tail }));
      row.append(text);
      const cost = expediteCost(state, event.tail);
      if (cost !== null) {
        const expedite = document.createElement('button');
        expedite.type = 'button';
        expedite.textContent = `Expedite 1d · ${money(cost)}`;
        expedite.disabled = state.cash < cost;
        if (expedite.disabled) expedite.title = `Needs $${cost.toLocaleString()} on hand.`;
        expedite.addEventListener('click', () => {
          expediteRepair(state, event.tail);
          changed();
        });
        row.append(expedite);
      }
      root.append(row);
    }
  }

  root.append(...buildChecks(state, changed));

  root.append(
    heading(
      'Fleet health',
      'Tech: the share of its flights that leave without a mechanical delay, which falls with age. AOG: today\'s chance of a fault grounding it, higher for older planes, busy airports and long days. Life: years left before the airframe reaches its useful life.',
    ),
  );
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const cls of AIRCRAFT_CLASSES) {
    const planes = state.aircraft.filter((a) => a.typeCode === cls.code).sort((a, b) => b.ageYears - a.ageYears);
    for (const aircraft of planes) {
      const row = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: aircraft.tail });
      row.type = 'button';
      row.className = 'inspector-row';
      const name = document.createElement('span');
      name.append(planeIconElement(aircraft.typeCode), ` ${aircraft.tail}`);
      const detail = document.createElement('span');
      detail.className = 'inspector-row-detail';
      const tech = Math.round(ageDelayParameters(wornAge(aircraft)).onTimeProbability * 100);
      const chance = aogChance(state, aircraft) * 100;
      const life = Math.max(0, USEFUL_LIFE_YEARS - aircraft.ageYears);
      detail.textContent = aogFor(state, aircraft.tail)
        ? `AOG · ${aircraft.ageYears} yrs`
        : `${aircraft.ageYears} yrs · tech ${tech}% · AOG ${chance < 1 ? chance.toFixed(1) : Math.round(chance)}%/day · life ${life} yrs`;
      if (aogFor(state, aircraft.tail) || life <= 2) detail.classList.add('is-over');
      row.append(name, detail);
      row.addEventListener('click', () => select({ kind: 'aircraft', tail: aircraft.tail }));
      list.append(row);
    }
  }
  root.append(state.aircraft.length > 0 ? list : line('No aircraft'));
  return root;
}

/** Deferred items as pips, one per item up to the hold: "●●○". */
function pips(deferred: number): string {
  return '●'.repeat(Math.min(deferred, MX_HOLD_AT)) + '○'.repeat(Math.max(0, MX_HOLD_AT - deferred));
}

const NIGHT_WORDS: Record<string, string> = { checked: 'checked', cleared: 'cleared 1', short: 'short', away: 'away' };

/**
 * Checks (sim/mxChecks.ts): every plane's deferred items, last night's
 * line check, and its heavy check, due or planned, with a button to plan
 * it for tomorrow (or call it off) and whether its pool covers it.
 */
function buildChecks(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Checks',
      `Line check: every night at base, the plane gets its hangar work, longer for more flights a day. A night away from base, or too short for the work, leaves a deferred item (●); a long night clears one. Each item wears the plane like ${DEFERRED_AGE_YEARS} more years: more breakdowns and mechanical delays. At ${MX_HOLD_AT} it's held at base for a morning and its first rotation is cancelled. Heavy check: every ${HEAVY_INTERVAL_DAYS} flying days, a day or more out of service at base, its flying moved to spare planes of its class there. Plan it here; ${OVERDUE_GRACE_DAYS} days overdue it's forced, for twice as long. It clears every item.`,
    ),
  ];
  const readouts = ops.heavyCheckReadouts(state);
  if (readouts.length === 0) return [...nodes, line('No aircraft')];
  const today = dayIndex(state);
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const plane of readouts) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.append(planeIconElement(plane.typeCode), ` ${plane.tail} ${pips(plane.deferred)}`);
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    const due = plane.dueIn > 0 ? `heavy due ${plane.dueIn}d` : `heavy ${-plane.dueIn}d overdue`;
    const night = plane.lastNight ? ` · night ${NIGHT_WORDS[plane.lastNight]}` : '';
    detail.append(`${due}${night} `);
    if (plane.inCheck) {
      detail.append('· in check');
    } else if (plane.plannedDay !== null) {
      const cover = plane.uncoveredHours > 0 ? ` · ~${plane.uncoveredHours}h CNX` : ' · covered';
      detail.append(`· day ${plane.plannedDay}${plane.forced ? ' forced' : ''} · ${plane.days}d${cover} `);
      if (!plane.forced) detail.append(actionButton('Unplan', () => ops.cancelHeavyCheck(state, plane.tail), changed));
    } else {
      const cover = plane.uncoveredHours > 0 ? `~${plane.uncoveredHours}h CNX` : 'covered';
      detail.append(actionButton(`Check tomorrow · ${plane.days}d · ${cover}`, () => ops.planHeavyCheck(state, plane.tail, today + 1), changed));
    }
    if (plane.deferred >= MX_HOLD_AT - 1 || plane.dueIn <= 0) detail.classList.add('is-warn');
    row.append(name, detail);
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}

function actionButton(label: string, run: () => unknown, changed: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lever-reset';
  button.textContent = label;
  button.addEventListener('click', () => {
    run();
    changed();
  });
  return button;
}
