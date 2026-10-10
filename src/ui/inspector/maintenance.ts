import { AIRCRAFT_CLASSES, pluralClassName } from '../../sim/aircraftClasses';
import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { A_OVERDUE, A_WINDOW, C_INTERVAL_CYCLES, C_INTERVAL_HOURS, DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, HEAVY_WINDOW_DAYS, MX_HOLD_AT, OVERDUE_GRACE_DAYS, wornAge } from '../../sim/mxChecks';
import * as ops from '../routeActions';
import type { HeavyCheckReadout } from '../../sim/playerActions';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement, TYPE_COLOURS } from '../planeIcons';
import { select } from '../selection';
import { MX_RATING_FEE, MX_RATING_PER_DAY } from '../../sim/bases';
import { cashAfterRows, costRows, showConfirm } from '../confirmModal';
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

  root.append(...buildHangar(state), ...buildDueTimeline(state), ...buildFleetBoard(state, changed));
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

/** Types folded shut on the Fleet board, kept across redraws. */
const collapsedTypes = new Set<string>();

/**
 * The hangar: a bay for each plane in its heavy check, with the days until
 * it's out, and a dashed bay for each plane whose check is next to come
 * due (its window open or overdue), so the hangar's coming load shows.
 */
function buildHangar(state: SimState): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Hangar',
      `C checks in work and coming. A filled bay is a plane in its C check, grounded until it's done. A dashed bay is a plane whose check is within ${HEAVY_WINDOW_DAYS} days or overdue: nights at a hangar bank hours toward it while it holds one of the hangar's bays (the nearest due first), and if it runs ${OVERDUE_GRACE_DAYS} days overdue it goes in whenever it is.`,
    ),
  ];
  const bays = box('mx-bays');
  for (const plane of ops.heavyCheckReadouts(state)) {
    const event = plane.inCheck ? aogFor(state, plane.tail) : undefined;
    if (!event && !plane.open) continue;
    const bay = box(`mx-bay ${event ? 'is-working' : plane.inBay ? 'is-banking' : 'is-waiting'}`);
    bay.append(box('mx-bay-tail', plane.tail), box('mx-bay-state', event ? `out in ${daysUntilReturn(state, event)}d` : `${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d over`} · ${plane.inBay ? 'in bay' : 'queued'}`));
    if (!event) bay.classList.toggle('is-late', plane.dueIn <= 0);
    bays.append(bay);
  }
  const capacity = ops.mxBaseReadout(state, 'heavy').bases.map((base) => `${base.iata} ${base.used}/${base.level} bays`).join(' · ');
  nodes.push(line(capacity || 'No hangar'));
  nodes.push(bays.childElementCount > 0 ? bays : noneLine('Hangar clear · no C check in work or within its window'));
  return nodes;
}

/** The timeline's reach: the longest wait to a heavy check is its whole interval. */
const TIMELINE_DAYS = HEAVY_INTERVAL_DAYS;

/**
 * Every plane's heavy-check due date on one axis, today at the left: a
 * marker each, overdue ones stacked at the edge, so a fleet bunching up for
 * the hangar shows as a cluster. Markers that would overlap take a lane
 * of their own.
 */
function buildDueTimeline(state: SimState): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading('C checks due', `Each plane's C check on a ${TIMELINE_DAYS}-day axis (due by days, hours or cycles, whichever is first), today at the left. The amber band is the window where nights at a maintenance base bank hours; a cluster of markers is planes that will want the hangar together. Overdue planes sit at the left edge.`),
  ];
  const readouts = ops.heavyCheckReadouts(state).filter((p) => !p.inCheck);
  if (readouts.length === 0) return [...nodes, line('No planes outside the hangar')];

  const axis = box('mx-axis');
  const windowBand = box('mx-axis-window');
  windowBand.style.left = '0';
  windowBand.style.width = `${(HEAVY_WINDOW_DAYS / TIMELINE_DAYS) * 100}%`;
  axis.append(windowBand);
  // Lanes: a marker takes the first lane whose last marker is far enough left.
  const laneEnds: number[] = [];
  const MARKER_SPAN_PCT = 11;
  for (const plane of readouts) {
    const at = (Math.min(TIMELINE_DAYS, Math.max(0, plane.dueIn)) / TIMELINE_DAYS) * 100;
    let lane = laneEnds.findIndex((end) => at - end >= MARKER_SPAN_PCT);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = at;
    const marker = box(`mx-marker${plane.dueIn <= 0 ? ' is-late' : plane.open ? ' is-open' : ''}`, plane.tail.slice(-4));
    marker.style.left = `${at}%`;
    marker.style.top = `${lane * 18 + 2}px`;
    marker.title = `${plane.tail} · ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}`;
    axis.append(marker);
  }
  axis.style.height = `${laneEnds.length * 18 + 6}px`;
  const ticks = box('mx-axis-ticks');
  for (const day of [0, 10, 20, 30]) {
    const tick = box('mx-axis-tick', day === 0 ? 'today' : `${day}d`);
    tick.style.left = `${(day / TIMELINE_DAYS) * 100}%`;
    ticks.append(tick);
  }
  nodes.push(axis, ticks);
  return nodes;
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
function buildFleetBoard(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Fleet',
      `Release to service, plane by plane. Serviceable: nothing open. Watch: a deferred item, a C check in its window or under 2 years of life. Action: held at ${MX_HOLD_AT} deferred items or a C check overdue. C-check clock: every ${HEAVY_INTERVAL_DAYS} flying days, ${C_INTERVAL_HOURS} flight hours or ${C_INTERVAL_CYCLES} cycles, 8–16 hours of hangar work done at night; from ${HEAVY_WINDOW_DAYS} days before it's due, each night at a maintenance base banks its spare hours toward it. ${OVERDUE_GRACE_DAYS} days overdue, the plane is grounded until it's done. Items: each deferred item (no line check, or a night too short) wears the plane like ${DEFERRED_AGE_YEARS} more years; at ${MX_HOLD_AT} it is held for a morning and its first rotation cancelled. Tech: the share of flights that leave without a mechanical delay. AOG: today's chance of a fault grounding it. Life: years left before the airframe reaches its useful life.`,
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
  const cardOf = ({ plane, aircraft, life, standing }: (typeof cards)[number]): HTMLElement => {
    // The card is a button, so its actions sit beside it, not inside.
    const wrap = box('mx-card-wrap');
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
      ? 'C check · in the hangar'
      : `C ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}` + (plane.open ? ` · banked ${plane.bankedHours}/${plane.workHours}h` : '');
    const clockLine = box('mx-clock-text', `${clockText} · ${plane.flightHours}h · ${plane.cycles} cyc · ${money(plane.reserve)} due`);

    // The A-check lane: progress through its interval (hours or cycles), the window where nights bank
    // hours, and the overdue stretch past the due mark that adds deferred items.
    const aLane = box('mx-clock mx-clock-a');
    const aWindow = box('mx-clock-window');
    aWindow.style.left = `${(A_WINDOW / A_OVERDUE) * 100}%`;
    aWindow.style.width = `${((1 - A_WINDOW) / A_OVERDUE) * 100}%`;
    const aGrace = box('mx-clock-grace');
    aGrace.style.left = `${(1 / A_OVERDUE) * 100}%`;
    aGrace.style.width = `${((A_OVERDUE - 1) / A_OVERDUE) * 100}%`;
    const aFill = box('mx-clock-fill');
    aFill.style.width = `${Math.min(1, Math.max(0, plane.aProgress / A_OVERDUE)) * 100}%`;
    const aDue = box('mx-clock-due');
    aDue.style.left = `${(1 / A_OVERDUE) * 100}%`;
    aLane.append(aWindow, aGrace, aFill, aDue);
    const aLine = box('mx-clock-text', `A ${Math.round(plane.aProgress * 100)}%` + (plane.aOpen ? ` · banked ${plane.aBankedHours}/${plane.aWorkHours}h` : ''));

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
    card.append(head, clock, aLane, aLine, row, wear, dials);
    wrap.append(card);
    // Book the C check once its window is open, instead of waiting out the overdue grace.
    if (plane.booked) {
      const unbook = document.createElement('button');
      unbook.type = 'button';
      unbook.textContent = 'C booked · tomorrow ✕';
      unbook.title = 'Cancel the booking';
      unbook.className = 'mx-card-action';
      unbook.addEventListener('click', () => {
        ops.cancelBookedCheck(state, plane.tail);
        changed();
      });
      wrap.append(unbook);
    } else if (plane.canBook) {
      const preview = ops.previewHeavyCheckBooking(state, plane.tail);
      if (preview) {
        const book = document.createElement('button');
        book.type = 'button';
        book.textContent = `Book C check · ${preview.days}d${preview.cost > 0 ? ` · ${money(preview.cost)}` : ''}`;
        book.className = 'mx-card-action';
        book.addEventListener('click', () =>
          showConfirm({
            title: `Book C check · ${plane.tail}`,
            rows: [
              { label: 'Grounded', value: `${preview.days}d from tomorrow` },
              { label: 'Check cost', value: preview.cost > 0 ? money(preview.cost) : 'in house' },
              { label: 'Rotations', value: `${preview.rotations} · other planes cover them where pools allow` },
              ...(preview.cost > 0 ? cashAfterRows(state, preview.cost) : []),
            ],
            facts: ['Rotations nobody can cover are cancelled. Cancel the booking any time before it goes in.'],
            confirmLabel: 'Book check',
            run: () => {
              ops.bookHeavyCheck(state, plane.tail);
              changed();
            },
          }),
        );
        wrap.append(book);
      }
    }
    return wrap;
  };

  // One folding group per type, worst plane first within it.
  for (const cls of AIRCRAFT_CLASSES) {
    const group = cards.filter((c) => c.plane.typeCode === cls.code);
    if (group.length === 0) continue;
    const collapsed = collapsedTypes.has(cls.code);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'timeline-group';
    header.style.setProperty('--puck', TYPE_COLOURS[cls.code] ?? '#5ed6c8');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.append(`${collapsed ? '▸' : '▾'} `, planeIconElement(cls.code), ` ${pluralClassName(cls.name)} ×${group.length}`);
    // The group's lamps stay visible when it's folded.
    const lamps = box('mx-group-lamps');
    for (const card of group) lamps.append(box(`mx-lamp mx-${card.standing}`));
    header.append(lamps);
    header.addEventListener('click', () => {
      if (collapsedTypes.has(cls.code)) collapsedTypes.delete(cls.code);
      else collapsedTypes.add(cls.code);
      changed();
    });
    list.append(header);
    if (!collapsed) for (const card of group) list.append(cardOf(card));
  }
  nodes.push(list);
  return nodes;
}

/**
 * Line bases and hangars (sim/bases.ts), the ratings of each station's
 * mechanics, and the stations where planes sleep tonight without an
 * in-house check, each set to contract its checks or defer them.
 */
function buildMxBases(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  for (const kind of ['line', 'heavy'] as const) {
    const readout = ops.mxBaseReadout(state, kind);
    const isLine = kind === 'line';
    nodes.push(
      ...baseSection({
        title: isLine ? 'Line bases' : 'Hangars',
        info: isLine
          ? `Where a night is a line check. The level is how many planes it checks a night, most deferred items first; a plane past that, or of a class it isn't rated for, is treated like a night at an outstation. Opening one costs ${money(readout.fee)}, then ${money(readout.perLevelPerDay)} a day for each level; home starts at level 3, free.`
          : `Where C checks are done. The level is the number of bays: only that many planes, the ones nearest due, bank hours toward their C check on a night here; the rest wait. Planes in a forced check take a bay too. Opening one costs ${money(readout.fee)}, then ${money(readout.perLevelPerDay)} a day for each level; home starts at level 3, free. A station without one banks nothing.`,
        kind: isLine ? 'line base' : 'hangar',
        bases: readout.bases,
        candidates: readout.candidates,
        fee: readout.fee,
        perDay: readout.perLevelPerDay,
        preview: (action, iata) => ops.previewBaseChange(state, kind, action, iata),
        open: (iata) => ops.openMxBaseAt(state, kind, iata),
        close: (iata) => ops.closeMxBaseAt(state, kind, iata),
        level: { preview: (iata, delta) => ops.previewMxLevel(state, kind, iata, delta), change: (iata, delta) => ops.changeMxLevel(state, kind, iata, delta) },
        changed,
      }),
    );
  }
  nodes.push(...buildRatings(state, changed));
  const stations = ops.mxStationsReadout(state);
  nodes.push(
    heading(
      'Stations',
      'Airports where planes sleep tonight without an in-house line check: no line base, a full one, or a class the mechanics are not rated for. Contracted: the station does the line check, paid by the hour of work, and the plane gets no deferred item if the night is long enough. Deferred: no check and no cost, and a deferred item each night.',
    ),
  );
  if (stations.length === 0) {
    nodes.push(noneLine('None tonight · every plane is checked at a line base'));
    return nodes;
  }
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const station of stations) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: station.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.textContent = `${station.iata} · ${station.planes} plane${station.planes === 1 ? '' : 's'} tonight · ${station.reason}`;
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

/**
 * Each station's mechanics' ratings: a chip per aircraft class, filled where
 * rated (click to drop), dashed where not (click to rate, with its price).
 */
function buildRatings(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Ratings',
      `Mechanics are rated by aircraft class, like crews. Planes of an unrated class are treated like a night at an outstation, at a line base or a hangar. A station's first rating is free; each further class costs ${money(MX_RATING_FEE)} and ${money(MX_RATING_PER_DAY)} a day, so a mixed fleet costs more to maintain.`,
    ),
  ];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const entry of ops.mxRatingsReadout(state)) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: entry.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.textContent = `${entry.iata} · ${entry.name}`;
    const chips = box('mx-ratings');
    for (const classCode of entry.rated) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mx-rating is-rated';
      chip.textContent = classCode;
      const blocked = entry.dropBlocked[classCode];
      chip.disabled = blocked !== null && blocked !== undefined;
      chip.title = blocked ?? `Rated · click to drop`;
      chip.addEventListener('click', () => {
        ops.unrateStation(state, entry.iata, classCode);
        changed();
      });
      chips.append(chip);
    }
    for (const option of entry.options) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mx-rating';
      chip.textContent = `+ ${option.classCode}`;
      chip.disabled = option.blocked !== null;
      chip.title = option.blocked ?? `Rate for ${option.classCode} · ${money(MX_RATING_FEE)}`;
      chip.addEventListener('click', () => {
        const preview = ops.previewMxRating(state, entry.iata, option.classCode);
        showConfirm({
          title: `Rate ${entry.iata} for ${option.classCode}`,
          rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
          facts: preview.blocked ? [preview.blocked] : preview.facts,
          confirmLabel: `Rate · ${money(preview.fee)}`,
          run: () => {
            ops.rateStation(state, entry.iata, option.classCode);
            changed();
          },
        });
      });
      chips.append(chip);
    }
    row.append(name, chips);
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}
