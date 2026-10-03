import { AIRCRAFT_CLASSES } from '../../sim/aircraftClasses';
import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, HEAVY_WINDOW_DAYS, MX_HOLD_AT, OVERDUE_GRACE_DAYS, wornAge } from '../../sim/mxChecks';
import * as ops from '../routeActions';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement } from '../planeIcons';
import { select } from '../selection';
import { baseSection, noneLine } from './bases';
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

  root.append(...buildChecks(state));
  root.append(...buildMxBases(state, changed));

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

const NIGHT_WORDS: Record<string, string> = { checked: 'checked', cleared: 'cleared 1', short: 'short', contracted: 'contracted', away: 'no check' };

/**
 * Checks (sim/mxChecks.ts): every plane's deferred items, last night's
 * line check, and its heavy check: when it's due, and the hours done at
 * night toward it.
 */
function buildChecks(state: SimState): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Checks',
      `Line check: every night at a maintenance base, the plane gets its hangar work, longer for more flights a day. Elsewhere the night is a contracted check or none, by the station's setting below. No check, or a night too short for the work, leaves a deferred item (●); a long night at a maintenance base clears one. Each item wears the plane like ${DEFERRED_AGE_YEARS} more years: more breakdowns and mechanical delays. At ${MX_HOLD_AT} it's held for a morning where it slept and its first rotation is cancelled. Heavy check: every ${HEAVY_INTERVAL_DAYS} flying days, 8–16 hours of hangar work, done at night: from ${HEAVY_WINDOW_DAYS} days before it's due, each night at a maintenance base puts its spare hours after the line check toward it. Long nights finish it without missing a flight; a day flown from first light to curfew makes slow progress. ${OVERDUE_GRACE_DAYS} days overdue, the plane is grounded until it's done. It clears every item.`,
    ),
  ];
  const readouts = ops.heavyCheckReadouts(state);
  if (readouts.length === 0) return [...nodes, line('No aircraft')];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const plane of readouts) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.append(planeIconElement(plane.typeCode), ` ${plane.tail} ${pips(plane.deferred)}`);
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    const night = plane.lastNight ? ` · night ${NIGHT_WORDS[plane.lastNight]}` : '';
    const heavy = plane.inCheck
      ? 'heavy check · grounded'
      : plane.open
        ? `heavy ${plane.bankedHours}/${plane.workHours}h · ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}`
        : `heavy due ${plane.dueIn}d`;
    detail.textContent = heavy + night;
    if (plane.deferred >= MX_HOLD_AT - 1 || plane.dueIn <= 0) detail.classList.add('is-warn');
    row.append(name, detail);
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}

/**
 * Maintenance bases (sim/bases.ts), and the stations where planes sleep
 * tonight without one, each set to contract its checks or defer them.
 */
function buildMxBases(state: SimState, changed: () => void): HTMLElement[] {
  const readout = ops.mxBaseReadout(state);
  const nodes = baseSection({
    title: 'Maintenance bases',
    info: `Where a night is a line check and banks heavy-check hours. Opening one costs ${money(readout.fee)} and ${money(readout.perDay)} a day; home's comes with the start. Anywhere else a plane sleeps, its check is contracted by the hour or deferred: see Stations.`,
    kind: 'mtc base',
    bases: readout.bases,
    candidates: readout.candidates,
    fee: readout.fee,
    perDay: readout.perDay,
    open: (iata) => ops.openMxBaseAt(state, iata),
    close: (iata) => ops.closeMxBaseAt(state, iata),
    changed,
  });
  nodes.push(
    heading(
      'Stations',
      'Airports where planes sleep tonight without a maintenance base. Contracted: the station does the line check, paid by the hour of work, and the plane gets no deferred item if the night is long enough; it banks nothing toward the heavy check. Deferred: no check and no cost, and a deferred item each night.',
    ),
  );
  if (readout.stations.length === 0) {
    nodes.push(noneLine('None tonight · every plane sleeps at a maintenance base'));
    return nodes;
  }
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const station of readout.stations) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: station.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.textContent = `${station.iata} · ${station.planes} plane${station.planes === 1 ? '' : 's'} tonight`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = station.check === 'contract' ? `contracted · ${money(station.contractPerNight)}/night` : 'deferred · ● each night';
    if (station.check === 'defer') detail.classList.add('is-warn');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'base-close';
    toggle.textContent = station.check === 'contract' ? 'Defer' : 'Contract';
    toggle.addEventListener('click', () => {
      ops.setStationCheck(state, station.iata, station.check === 'contract' ? 'defer' : 'contract');
      changed();
    });
    row.append(name, detail, toggle);
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}
