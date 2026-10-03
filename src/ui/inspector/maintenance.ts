import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, HEAVY_WINDOW_DAYS, MX_HOLD_AT, OVERDUE_GRACE_DAYS, wornAge } from '../../sim/mxChecks';
import * as ops from '../routeActions';
import type { HeavyCheckReadout } from '../../sim/playerActions';
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
 * - **Fleet**: a release-to-service board, a strip of how the fleet stands
 *   and a tech-log card per plane: heavy-check clock, deferred items, wear,
 *   tech and AOG figures.
 * - **Maintenance bases** and the **stations** planes sleep at without one.
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
      row.className = 'airport-aog-row mx-aog-row';
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

  root.append(...buildFleetBoard(state));
  root.append(...buildMxBases(state, changed));
  return root;
}

const NIGHT_WORDS: Record<string, string> = { checked: 'checked', cleared: 'cleared 1', short: 'short', contracted: 'contracted', away: 'no check' };

/** How a plane stands for release to service, worst first. */
type Standing = 'aog' | 'check' | 'due' | 'watch' | 'ok';
const STANDING_ORDER: Standing[] = ['aog', 'check', 'due', 'watch', 'ok'];
const STANDING_WORDS: Record<Standing, string> = { aog: 'AOG', check: 'IN HANGAR', due: 'ACTION', watch: 'WATCH', ok: 'SERVICEABLE' };

/** The heavy-check clock runs from the last check to the end of its grace, so the overdue stretch shows. */
const CLOCK_DAYS = HEAVY_INTERVAL_DAYS + OVERDUE_GRACE_DAYS;

function standingOf(state: SimState, plane: HeavyCheckReadout, life: number): Standing {
  if (plane.inCheck) return 'check';
  if (aogFor(state, plane.tail)) return 'aog';
  if (plane.deferred >= MX_HOLD_AT || plane.dueIn <= 0) return 'due';
  if (plane.deferred > 0 || plane.open || life <= 2) return 'watch';
  return 'ok';
}

function box(className: string, text = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

/**
 * The fleet's release-to-service board: a strip of how many planes stand
 * serviceable, on watch, due for action, in the hangar or on the ground,
 * then a tech-log card for each plane, worst first. Each card carries the
 * heavy-check clock (the days since its last check, the window where
 * nights at a maintenance base count toward it, the due mark and the
 * overdue grace beyond it), its deferred items as slots that fill toward
 * the hold, and how worn it is.
 */
function buildFleetBoard(state: SimState): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Fleet',
      `Release to service, plane by plane. Serviceable: nothing open. Watch: a deferred item, a heavy check in its window or under 2 years of life. Action: held at ${MX_HOLD_AT} deferred items or a heavy check overdue. Heavy-check clock: every ${HEAVY_INTERVAL_DAYS} flying days, 8–16 hours of hangar work done at night; from ${HEAVY_WINDOW_DAYS} days before it's due, each night at a maintenance base banks its spare hours toward it. ${OVERDUE_GRACE_DAYS} days overdue, the plane is grounded until it's done. Items: each deferred item (no line check, or a night too short) wears the plane like ${DEFERRED_AGE_YEARS} more years; at ${MX_HOLD_AT} it is held for a morning and its first rotation cancelled. Tech: the share of flights that leave without a mechanical delay. AOG: today's chance of a fault grounding it. Life: years left before the airframe reaches its useful life.`,
    ),
  ];
  const readouts = ops.heavyCheckReadouts(state);
  if (readouts.length === 0) return [...nodes, line('No aircraft')];

  const cards = readouts.map((plane) => {
    const aircraft = state.aircraft.find((a) => a.tail === plane.tail)!;
    const life = Math.max(0, USEFUL_LIFE_YEARS - aircraft.ageYears);
    return { plane, aircraft, life, standing: standingOf(state, plane, life) };
  });
  cards.sort((x, y) => STANDING_ORDER.indexOf(x.standing) - STANDING_ORDER.indexOf(y.standing) || x.plane.dueIn - y.plane.dueIn);

  // The strip: one segment per standing, as wide as its share of the fleet.
  const strip = box('mx-strip');
  const legend = box('mx-strip-legend');
  for (const standing of STANDING_ORDER) {
    const count = cards.filter((c) => c.standing === standing).length;
    if (count === 0) continue;
    const segment = box(`mx-strip-seg mx-${standing}`);
    segment.style.flexGrow = String(count);
    segment.title = `${STANDING_WORDS[standing]} · ${count}`;
    strip.append(segment);
    const key = box('mx-strip-key');
    key.append(box(`mx-lamp mx-${standing}`), `${count} ${STANDING_WORDS[standing]}`);
    legend.append(key);
  }
  const tech = cards.reduce((sum, c) => sum + ageDelayParameters(wornAge(c.aircraft)).onTimeProbability, 0) / cards.length;
  legend.append(box('mx-strip-key mx-strip-tech', `Fleet tech ${Math.round(tech * 100)}%`));
  nodes.push(strip, legend);

  const list = box('mx-cards');
  for (const { plane, aircraft, life, standing } of cards) {
    const card = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: plane.tail });
    card.type = 'button';
    card.className = `mx-card mx-card-${standing}`;
    card.addEventListener('click', () => select({ kind: 'aircraft', tail: plane.tail }));

    const head = box('mx-card-head');
    const who = box('mx-card-who');
    who.append(box(`mx-lamp mx-${standing}`), planeIconElement(plane.typeCode), ` ${plane.tail} · ${plane.base}`);
    const status = box('mx-card-status');
    if (plane.lastNight) status.append(box('mx-card-night', `night ${NIGHT_WORDS[plane.lastNight]}`));
    status.append(box(`mx-card-standing mx-text-${standing}`, STANDING_WORDS[standing]));
    head.append(who, status);

    // The heavy-check clock.
    const daysSince = HEAVY_INTERVAL_DAYS - plane.dueIn;
    const clock = box('mx-clock');
    const windowZone = box('mx-clock-window');
    windowZone.style.left = `${((HEAVY_INTERVAL_DAYS - HEAVY_WINDOW_DAYS) / CLOCK_DAYS) * 100}%`;
    windowZone.style.width = `${(HEAVY_WINDOW_DAYS / CLOCK_DAYS) * 100}%`;
    const graceZone = box('mx-clock-grace');
    graceZone.style.left = `${(HEAVY_INTERVAL_DAYS / CLOCK_DAYS) * 100}%`;
    graceZone.style.width = `${(OVERDUE_GRACE_DAYS / CLOCK_DAYS) * 100}%`;
    const fill = box('mx-clock-fill');
    fill.style.width = `${Math.min(1, Math.max(0, daysSince / CLOCK_DAYS)) * 100}%`;
    const dueMark = box('mx-clock-due');
    dueMark.style.left = `${(HEAVY_INTERVAL_DAYS / CLOCK_DAYS) * 100}%`;
    clock.append(windowZone, graceZone, fill, dueMark);
    const clockText = plane.inCheck
      ? 'Heavy check · in the hangar'
      : `Heavy ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}` + (plane.open ? ` · banked ${plane.bankedHours}/${plane.workHours}h` : '');
    const clockLine = box('mx-clock-text', clockText);

    // Deferred items as slots filling toward the hold.
    const slots = box('mx-slots');
    for (let i = 0; i < MX_HOLD_AT; i++) slots.append(box(`mx-slot${i < plane.deferred ? ` is-filled${plane.deferred >= MX_HOLD_AT ? ' is-held' : ''}` : ''}`));
    const items = box('mx-items');
    items.append('Items ', slots);

    // Instruments.
    const chance = aogChance(state, aircraft) * 100;
    const techNow = Math.round(ageDelayParameters(wornAge(aircraft)).onTimeProbability * 100);
    const wear = box('mx-wear');
    const wearFill = box('mx-wear-fill');
    wearFill.style.width = `${Math.min(100, (aircraft.ageYears / USEFUL_LIFE_YEARS) * 100)}%`;
    wear.append(wearFill);
    const dials = box('mx-dials', `${aircraft.ageYears} yrs · life ${life} · tech ${techNow}% · AOG ${chance < 1 ? chance.toFixed(1) : Math.round(chance)}%/day`);

    const row = box('mx-card-row');
    row.append(items, clockLine);
    card.append(head, clock, row, wear, dials);
    list.append(card);
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
