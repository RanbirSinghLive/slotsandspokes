import { AIRCRAFT_CLASSES, pluralClassName } from '../../sim/aircraftClasses';
import { execNudge } from '../execNudge';
import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { A_OVERDUE, A_WINDOW, C_INTERVAL_CYCLES, C_INTERVAL_HOURS, D_INTERVAL_DAYS, D_INTERVAL_HOURS, D_WEAR_YEARS, D_WINDOW_DAYS, DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, HEAVY_WINDOW_DAYS, MX_HOLD_AT, OVERDUE_GRACE_DAYS, wornAge } from '../../sim/mxChecks';
import * as ops from '../routeActions';
import type { BaseCandidate, HeavyCheckReadout, LevelledBaseReadout, MxStationCard, StationClassReadout } from '../../sim/playerActions';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement, TYPE_COLOURS } from '../planeIcons';
import { glyph, pips } from '../glyphs';
import { select } from '../selection';
import { MX_RATING_FEE, MX_RATING_PER_DAY } from '../../sim/bases';
import { cashAfterRows, costRows, showConfirm } from '../confirmModal';
import { noneLine } from './bases';
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
  const nudge = execNudge(state, ['coo-maintenance', 'dom-bakare']);
  if (nudge) title.append(nudge);
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

  // Stations sit above the plane cards: they are where the fleet's maintenance capacity is decided.
  root.append(...buildHangar(state, changed), ...buildDueTimeline(state, changed), ...buildMxBases(state, changed), ...buildFleetBoard(state, changed), ...buildEngines(state, changed));
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
function buildHangar(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Hangar',
      `C checks in work and coming. A filled bay is a plane in its C check or a cabin refit, grounded until it's done. A dashed bay is a plane whose check is within ${HEAVY_WINDOW_DAYS} days or overdue: book it from the wrench when it is parked at base, or if it runs ${OVERDUE_GRACE_DAYS} days overdue it goes in whenever it is. Planes that go in together fill the bays and the rest are contracted out.`,
    ),
  ];
  const bays = box('mx-bays');
  for (const plane of ops.heavyCheckReadouts(state)) {
    const event = plane.inCheck ? aogFor(state, plane.tail) : undefined;
    if (!event && !plane.open) continue;
    const bay = box(`mx-bay ${event ? 'is-working' : 'is-waiting'}`);
    bay.append(box('mx-bay-tail', plane.tail), box('mx-bay-state', event ? `out in ${daysUntilReturn(state, event)}d` : plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d over`));
    if (!event) bay.classList.toggle('is-late', plane.dueIn <= 0);
    // The action sits on the bay itself: book when the plane is parked at base, else the tip says what it waits for.
    if (!event && plane.canBook) {
      const book = document.createElement('button');
      book.type = 'button';
      book.className = 'mx-bay-book';
      book.append(glyph('wrench'));
      book.dataset.tip = `Book C check · ${plane.tail}`;
      book.addEventListener('click', () => confirmHeavyBooking(state, plane, changed));
      bay.classList.add('is-bookable');
      bay.append(book);
    } else if (!event && plane.bookBlocker) {
      const wait = box('mx-bay-wait');
      wait.append(glyph('plane', plane.bookBlocker));
      bay.append(wait);
    }
    bays.append(bay);
  }
  // A cabin refit done in house holds a bay too (sim/cabins.ts): a filled bay marked with the seat icon.
  for (const event of state.aogs) {
    if (!event.refitTo || !event.inBay) continue;
    const bay = box('mx-bay is-working is-refit');
    bay.append(box('mx-bay-tail', event.tail), box('mx-bay-state', `refit · out in ${daysUntilReturn(state, event)}d`));
    bay.dataset.tip = `${event.tail} · cabin refit in a bay at ${event.base} · back in ${daysUntilReturn(state, event)}d`;
    bays.append(bay);
  }
  const capacity = ops.mxBaseReadout(state, 'heavy').bases.map((base) => `${base.iata} ${base.used}/${base.level} bays`).join(' · ');
  nodes.push(line(capacity || 'No hangar'));
  nodes.push(bays.childElementCount > 0 ? bays : noneLine('Hangar clear · no check or refit in work or within its window'));
  return nodes;
}

/** The C-check booking dialog, from the hangar bay or the plane's card. */
function confirmHeavyBooking(state: SimState, plane: HeavyCheckReadout, changed: () => void): void {
  const preview = ops.previewHeavyCheckBooking(state, plane.tail);
  if (!preview) return;
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
  });
}

/** The D-check booking dialog, from the card or the plane's marker on the due axis. */
function confirmDBooking(state: SimState, plane: HeavyCheckReadout, changed: () => void): void {
  const preview = ops.previewDCheckBooking(state, plane.tail);
  if (!preview) return;
  showConfirm({
    title: `Book D check · ${plane.tail}`,
    rows: [
      { label: 'Grounded', value: `${preview.days}d from tomorrow` },
      { label: 'Check cost', value: preview.cost > 0 ? money(preview.cost) : 'in house' },
      { label: 'Rotations', value: `${preview.rotations} · other planes cover them where pools allow` },
      ...(preview.cost > 0 ? cashAfterRows(state, preview.cost) : []),
    ],
    facts: ['A full overhaul: it also clears the C and A checks. Rotations nobody can cover are cancelled. Cancel the booking any time before it goes in.'],
    confirmLabel: 'Book check',
    run: () => {
      ops.bookDCheck(state, plane.tail);
      changed();
    },
  });
}

/** The puck on the due axis that is open, as `C:tail` or `D:tail`, kept across redraws. */
let openPuck: string | null = null;

/**
 * What a puck offers: induct the C check now (the booking), or push it
 * later by 1, 5 or 15 days for a fee, to spread checks that fall together.
 */
function puckMenu(state: SimState, plane: HeavyCheckReadout, changed: () => void): HTMLElement {
  const menu = box('mx-puck-menu');
  menu.append(box('mx-puck-who', `${plane.tail} · ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d over`}${plane.shiftDays > 0 ? ` · +${plane.shiftDays}/${plane.toleranceCap}d` : ''}${plane.toleranceWear > 0 ? ` · wear +${plane.toleranceWear.toFixed(1)}y` : ''}`));
  const action = (label: string | HTMLElement, tip: string | null, run: () => void, ready: boolean): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mx-puck-action';
    button.append(label);
    button.disabled = !ready;
    if (tip) button.dataset.tip = tip;
    button.addEventListener('click', run);
    return button;
  };
  const induct = plane.booked
    ? action(glyph('wrench'), 'C booked · tomorrow', () => undefined, false)
    : action(glyph('wrench'), plane.canBook ? 'Induct now · books it for tomorrow' : (plane.bookBlocker ?? `Opens ${HEAVY_WINDOW_DAYS}d before due`), () => confirmHeavyBooking(state, plane, changed), plane.canBook);
  induct.append(' induct');
  menu.append(induct);
  for (const step of plane.tolerance) {
    menu.append(
      action(`+${step.days}d · ${money(step.cost)}`, step.blocker ?? `Push the C check ${step.days}d later for ${money(step.cost)}`, () => {
        ops.toleranceHeavyCheck(state, plane.tail, step.days);
        changed();
      }, step.blocker === null),
    );
  }
  return menu;
}

/** What a D marker offers: book the overhaul now (it also does the C check), or take the booking back. */
function dPuckMenu(state: SimState, plane: HeavyCheckReadout, changed: () => void): HTMLElement {
  const menu = box('mx-puck-menu');
  menu.append(box('mx-puck-who', `${plane.tail} · D check ${plane.dDueIn > 0 ? `due ${plane.dDueIn}d` : `${-plane.dDueIn}d over`}`));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mx-puck-action';
  if (plane.dBooked) {
    button.append('D booked · tomorrow ✕');
    button.dataset.tip = 'Cancel the booking';
    button.addEventListener('click', () => {
      ops.cancelBookedDCheck(state, plane.tail);
      changed();
    });
  } else {
    button.append(glyph('wrench'), ' book D');
    button.disabled = !plane.dCanBook;
    button.dataset.tip = plane.dCanBook ? 'Book the D check · also does the C check' : (plane.dBookBlocker ?? 'Opens 60d before due');
    button.addEventListener('click', () => confirmDBooking(state, plane, changed));
  }
  menu.append(button);
  return menu;
}

/** The timeline's reach: the next month, which holds every booking window and leaves later checks off the axis. */
const TIMELINE_DAYS = 30;

/**
 * Every plane's heavy-check due date on one axis, today at the left: a
 * marker each, overdue ones stacked at the edge, so a fleet bunching up for
 * the hangar shows as a cluster. Markers that would overlap take a lane
 * of their own. A plane's D check shares the axis once it is due inside it:
 * read-only, since the D check is booked from its card.
 */
function buildDueTimeline(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading('C checks due', `Each plane's C check on a ${TIMELINE_DAYS}-day axis (due by days, hours or cycles, whichever is first), today at the left. The amber band is the window where a C check can be booked; a cluster of markers is planes that will want the hangar together. Overdue planes sit at the left edge. A violet D marker is a plane whose D check (the overhaul) falls due inside the axis; tap it to book. The D check also does the C check, so that plane's C marker dims when its D falls due first and goes once the D is booked.`),
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
  const MARKER_SPAN_PCT = 15;
  // C markers, then a D marker for each plane whose D check is due within the axis.
  const markers = [
    // A booked D check does the C check, so that plane's C marker is gone.
    ...readouts.filter((plane) => !plane.dBooked && plane.dueIn <= TIMELINE_DAYS).map((plane) => ({ plane, kind: 'C' as const, dueIn: plane.dueIn })),
    ...readouts.filter((plane) => !plane.dInCheck && plane.dDueIn <= TIMELINE_DAYS).map((plane) => ({ plane, kind: 'D' as const, dueIn: plane.dDueIn })),
  ].sort((a, b) => a.dueIn - b.dueIn);
  if (markers.length === 0) return [...nodes, line(`None due in ${TIMELINE_DAYS}d`)];
  for (const { plane, kind, dueIn } of markers) {
    const at = (Math.min(TIMELINE_DAYS, Math.max(0, dueIn)) / TIMELINE_DAYS) * 100;
    let lane = laneEnds.findIndex((end) => at - end >= MARKER_SPAN_PCT);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = at;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.style.left = `${at}%`;
    marker.style.top = `${lane * 18 + 2}px`;
    if (kind === 'D') {
      marker.className = `mx-marker is-d${dueIn <= 0 ? ' is-late is-edge' : ''}${plane.dBooked ? ' is-booked' : ''}${openPuck === `D:${plane.tail}` ? ' is-picked' : ''}`;
      marker.textContent = `D ${plane.tail.slice(-4)}`;
      marker.addEventListener('click', () => {
        openPuck = openPuck === `D:${plane.tail}` ? null : `D:${plane.tail}`;
        changed();
      });
      marker.dataset.tip = `${plane.tail} · D check ${plane.dBooked ? 'booked · tomorrow' : dueIn > 0 ? `due ${dueIn}d` : `${-dueIn}d overdue`} · tap for options`;
      axis.append(marker);
      continue;
    }
    // A D check restarts the C clock, so a C check that falls due after the same plane's D check is moot if the D goes in first.
    const coveredByD = !plane.dInCheck && plane.dDueIn <= dueIn;
    marker.className = `mx-marker${dueIn <= 0 ? ' is-late' : plane.open ? ' is-open' : ''}${plane.toleranceWear > 0 ? ' is-worn' : ''}${coveredByD ? ' is-covered' : ''}${openPuck === `C:${plane.tail}` ? ' is-picked' : ''}`;
    marker.textContent = `C ${plane.tail.slice(-4)}`;
    marker.addEventListener('click', () => {
      openPuck = openPuck === `C:${plane.tail}` ? null : `C:${plane.tail}`;
      changed();
    });
    marker.dataset.tip = `${plane.tail} · ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}${plane.shiftDays > 0 ? ` · pushed ${plane.shiftDays}/${plane.toleranceCap}d` : ''}${plane.toleranceWear > 0 ? ` · wearing +${plane.toleranceWear.toFixed(1)}y` : ''} · tap for options${coveredByD ? ` · D check due ${plane.dDueIn > 0 ? `in ${plane.dDueIn}d` : `${-plane.dDueIn}d ago`}: it also does the C check, so booking D first clears this one` : ''}`;
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
  const picked = readouts.find((plane) => openPuck === `C:${plane.tail}` || openPuck === `D:${plane.tail}`);
  if (picked) nodes.push(openPuck === `D:${picked.tail}` ? dPuckMenu(state, picked, changed) : puckMenu(state, picked, changed));
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
      `Release to service, plane by plane. Serviceable: nothing open. Watch: a deferred item, a C check in its window or under 2 years of life. Action: held at ${MX_HOLD_AT} deferred items or a C check overdue. C-check clock: every ${HEAVY_INTERVAL_DAYS} flying days, ${C_INTERVAL_HOURS} flight hours or ${C_INTERVAL_CYCLES} cycles, 2–4 days in the hangar with the plane grounded. Book it from ${HEAVY_WINDOW_DAYS} days before it's due; ${OVERDUE_GRACE_DAYS} days overdue it is grounded whenever it is at base. Items: each deferred item (no line check, or a night too short) wears the plane like ${DEFERRED_AGE_YEARS} more years; at ${MX_HOLD_AT} it is held for a morning and its first rotation cancelled. Tech: the share of flights that leave without a mechanical delay. AOG: today's chance of a fault grounding it. Life: years left before the airframe reaches its useful life.`,
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
      : `C ${plane.dueIn > 0 ? `due ${plane.dueIn}d` : `${-plane.dueIn}d overdue`}`;
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

    // The D-check lane: days through the overhaul interval, the booking window, and the overdue stretch that wears the plane.
    const dLane = box('mx-clock mx-clock-a mx-clock-d');
    const dSpan = D_INTERVAL_DAYS + D_WINDOW_DAYS;
    const dWindow = box('mx-clock-window');
    dWindow.style.left = `${((D_INTERVAL_DAYS - D_WINDOW_DAYS) / dSpan) * 100}%`;
    dWindow.style.width = `${(D_WINDOW_DAYS / dSpan) * 100}%`;
    const dGrace = box('mx-clock-grace');
    dGrace.style.left = `${(D_INTERVAL_DAYS / dSpan) * 100}%`;
    dGrace.style.width = `${(D_WINDOW_DAYS / dSpan) * 100}%`;
    const dFill = box('mx-clock-fill');
    dFill.style.width = `${Math.min(1, Math.max(0, (D_INTERVAL_DAYS - plane.dDueIn) / dSpan)) * 100}%`;
    const dDue = box('mx-clock-due');
    dDue.style.left = `${(D_INTERVAL_DAYS / dSpan) * 100}%`;
    dLane.append(dWindow, dGrace, dFill, dDue);
    const dLine = box(
      `mx-clock-text${plane.dDueIn < 0 ? ' mx-text-due' : ''}`,
      plane.dInCheck ? 'D check · in the hangar' : `D ${plane.dDueIn >= 0 ? `due ${plane.dDueIn}d` : `${-plane.dDueIn}d overdue · +${D_WEAR_YEARS} yrs wear`} · ${plane.dFlightHours}h`,
    );
    dLine.title = `D check: overhaul every ${D_INTERVAL_DAYS} flying days or ${D_INTERVAL_HOURS.toLocaleString('en-US')} flight hours. Booked, never forced; past due the plane wears like ${D_WEAR_YEARS} more years until it goes in.`;

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
    card.append(head, clock, aLane, aLine, dLane, dLine, row, wear, dials);
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
          confirmHeavyBooking(state, plane, changed),
        );
        wrap.append(book);
      }
    }
    // The D check is booked the same way, from 60 days before it's due.
    if (plane.dBooked) {
      const unbook = document.createElement('button');
      unbook.type = 'button';
      unbook.textContent = 'D booked · tomorrow ✕';
      unbook.title = 'Cancel the booking';
      unbook.className = 'mx-card-action';
      unbook.addEventListener('click', () => {
        ops.cancelBookedDCheck(state, plane.tail);
        changed();
      });
      wrap.append(unbook);
    } else if (plane.dCanBook) {
      const preview = ops.previewDCheckBooking(state, plane.tail);
      if (preview) {
        const book = document.createElement('button');
        book.type = 'button';
        book.textContent = `Book D check · ${preview.days}d${preview.cost > 0 ? ` · ${money(preview.cost)}` : ''}`;
        book.className = 'mx-card-action';
        book.addEventListener('click', () => confirmDBooking(state, plane, changed));
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
 * The maintenance stations (sim/bases.ts), one card each: the line base's
 * slots and the hangar's bays with tonight's use, and a chip per aircraft
 * class for the mechanics' ratings, counting that class's planes asleep
 * there tonight, so a class flying in and out unrated stands out. Then the
 * outstations planes sleep at without a base, each set to contract its
 * checks or defer them.
 */
function buildMxBases(state: SimState, changed: () => void): HTMLElement[] {
  const lineReadout = ops.mxBaseReadout(state, 'line');
  const heavyReadout = ops.mxBaseReadout(state, 'heavy');
  const stationHead = heading(
    'Stations',
    `Each maintenance station: its line base slots (wrench: planes it checks a night, most deferred items first) and hangar bays (planes in a C or D check at once), filled by tonight's use, red past full. Chips are the mechanics' ratings by class, with that class's planes asleep here tonight: solid is rated; dashed amber is a class sleeping here unrated, contracted or deferred like an outstation. A station's first rating is free; each further class costs ${money(MX_RATING_FEE)} and ${money(MX_RATING_PER_DAY)} a day. A new line base costs ${money(lineReadout.fee)}, a hangar ${money(heavyReadout.fee)}, then ${money(lineReadout.perLevelPerDay)} and ${money(heavyReadout.perLevelPerDay)} a day a level; home's first 3 of each are free.`,
  );
  stationHead.prepend(glyph('wrench', undefined, 'base-head-glyph'), ' ');
  const nodes: HTMLElement[] = [stationHead];
  const cards = ops.mxStationBoard(state);
  const board = new Set(cards.map((card) => card.iata));
  const list = box('mx-stations');
  for (const card of cards) list.append(stationCard(state, card, lineReadout.fee, heavyReadout.fee, changed));
  nodes.push(list, stationOpener(state, board, lineReadout, heavyReadout, changed));

  const stations = ops.mxStationsReadout(state).filter((station) => !board.has(station.iata));
  nodes.push(
    heading(
      'Outstations',
      'Airports with no maintenance base where planes sleep tonight. Contracted: the station does the line check, paid by the hour of work, and the plane gets no deferred item if the night is long enough. Deferred: no check and no cost, and a deferred item each night.',
    ),
  );
  if (stations.length === 0) {
    nodes.push(noneLine('None tonight · every plane sleeps at a station'));
    return nodes;
  }
  const outstations = document.createElement('div');
  outstations.className = 'inspector-rows';
  for (const station of stations) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata: station.iata });
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.append(glyph('moon', `${station.planes} plane${station.planes === 1 ? '' : 's'} sleeping here tonight`), ` ${station.iata} · ${station.planes}`);
    row.append(name, checkDetail(station.check, station.contractPerNight), checkToggle(state, station.iata, station.check, changed));
    outstations.append(row);
  }
  nodes.push(outstations);
  return nodes;
}

function checkDetail(check: 'contract' | 'defer', contractPerNight: number): HTMLElement {
  const detail = document.createElement('span');
  detail.className = 'inspector-row-detail';
  detail.textContent = check === 'contract' ? `contracted · ${money(contractPerNight)}/night` : 'deferred · ● each night';
  detail.classList.add(check === 'contract' ? 'is-contract' : 'is-deferred');
  if (check === 'defer') detail.classList.add('is-warn');
  return detail;
}

function checkToggle(state: SimState, iata: string, check: 'contract' | 'defer', changed: () => void): HTMLElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'base-close';
  toggle.textContent = check === 'contract' ? 'Defer' : 'Contract';
  toggle.title = check === 'contract' ? `Defer ${iata}'s unchecked nights: no cost, a deferred item each night` : `Contract ${iata}'s unchecked nights: paid by the hour of work`;
  toggle.addEventListener('click', () => {
    ops.setStationCheck(state, iata, check === 'contract' ? 'defer' : 'contract');
    changed();
  });
  return toggle;
}

const KIND_NAME = { line: 'line base', heavy: 'hangar' } as const;

/** Open, close or level a station's line base or hangar, each through the confirm window. */
function confirmBase(state: SimState, kind: 'line' | 'heavy', iata: string, action: 'open' | 'close' | 1 | -1, changed: () => void): void {
  if (action === 'open' || action === 'close') {
    const preview = ops.previewBaseChange(state, kind, action, iata);
    showConfirm({
      title: `${action === 'open' ? 'Open' : 'Close'} ${KIND_NAME[kind]} · ${iata}`,
      rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
      facts: preview.blocked ? [preview.blocked] : preview.facts,
      confirmLabel: action === 'open' ? `Open · ${money(preview.fee)}` : 'Close base',
      run: () => {
        if (action === 'open') ops.openMxBaseAt(state, kind, iata);
        else ops.closeMxBaseAt(state, kind, iata);
        changed();
      },
    });
    return;
  }
  const preview = ops.previewMxLevel(state, kind, iata, action);
  showConfirm({
    title: `${action === 1 ? 'Raise' : 'Lower'} ${KIND_NAME[kind]} · ${iata}`,
    rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
    facts: preview.blocked ? [preview.blocked] : preview.facts,
    confirmLabel: action === 1 ? `Raise · ${money(preview.fee)}` : 'Lower',
    run: () => {
      ops.changeMxLevel(state, kind, iata, action);
      changed();
    },
  });
}

function smallButton(text: string, tip: string, blocked: string | null, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'base-close';
  button.textContent = text;
  button.disabled = blocked !== null;
  button.title = blocked ?? tip;
  button.addEventListener('click', run);
  return button;
}

/** A station's line base or hangar: slots filled by tonight's use (red past full), − / + and ×; or a dashed button to open one. */
function capacityRow(state: SimState, iata: string, kind: 'line' | 'heavy', base: LevelledBaseReadout | null, openFee: number, changed: () => void): HTMLElement {
  const isLine = kind === 'line';
  const row = box(`mx-station-row is-${kind}`);
  const icon = glyph(isLine ? 'wrench' : 'hangar', isLine ? 'Line base' : 'Hangar');
  if (!base) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mx-station-open';
    open.append(icon, ` + ${money(openFee)}`);
    open.title = `Open a ${KIND_NAME[kind]} at ${iata} · ${money(openFee)}`;
    open.addEventListener('click', () => confirmBase(state, kind, iata, 'open', changed));
    row.append(open);
    return row;
  }
  const unit = isLine ? 'checked tonight' : 'bays held';
  const tip = `${isLine ? 'Line base' : 'Hangar'} L${base.level} · ${base.used}/${base.level} ${unit}${base.overflow > 0 ? ` · ${base.overflow} more rated plane${base.overflow === 1 ? '' : 's'} than slots, contracted` : ''}`;
  const slots = box('mx-station-slots');
  slots.append(icon, ' ', pips(base.used, base.level, tip, isLine ? 'wrench' : 'hangar'));
  if (base.overflow > 0) slots.append(' ', pips(base.overflow, base.overflow, tip, 'warn'));
  const count = document.createElement('span');
  count.className = 'mx-station-count';
  count.textContent = `${base.used}/${base.level}`;
  if (base.overflow > 0) count.classList.add('is-over');
  slots.append(' ', count);
  slots.title = tip;
  row.append(
    slots,
    smallButton('−', 'Level down', base.downBlocked, () => confirmBase(state, kind, iata, -1, changed)),
    smallButton('+', `Level up · ${money(base.upFee)}`, base.upBlocked, () => confirmBase(state, kind, iata, 1, changed)),
    smallButton('×', `Close the ${KIND_NAME[kind]}`, base.closeBlocked, () => confirmBase(state, kind, iata, 'close', changed)),
  );
  return row;
}

/** A class's rating chip: its plane in the class colour and its planes asleep here tonight. */
function ratingChip(state: SimState, card: MxStationCard, entry: StationClassReadout, changed: () => void): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'mx-rating';
  chip.style.setProperty('--puck', TYPE_COLOURS[entry.classCode] ?? '#8ab4ff');
  const sleepers = entry.sleeping > 0 ? ` · ${entry.sleeping} asleep here tonight` : '';
  const basedText = entry.based > 0 ? ` · ${entry.based} based` : '';
  const short = entry.sleeping - entry.checked;
  chip.append(planeIconElement(entry.classCode));
  if (entry.rated) {
    chip.classList.add('is-rated');
    if (entry.sleeping > 0) chip.append(` ${entry.sleeping}`);
    if (short > 0) chip.classList.add('is-short');
    const shortText = short > 0 ? ` · ${short} over the line base, ${card.check === 'contract' ? `contracted ${money(entry.contractPerNight)}/night` : 'deferred'}` : '';
    chip.title = entry.dropBlocked ?? `${entry.classCode} rated${sleepers}${shortText}${basedText} · tap to drop`;
    chip.disabled = entry.dropBlocked !== null;
    chip.addEventListener('click', () =>
      showConfirm({
        title: `Drop ${card.iata}'s ${entry.classCode} rating`,
        rows: [],
        facts: [
          `Saves ${money(MX_RATING_PER_DAY)} a day; rating again costs ${money(MX_RATING_FEE)}.`,
          ...(entry.sleeping > 0 ? [`${entry.sleeping} ${entry.classCode} asleep here tonight would be ${card.check === 'contract' ? 'contracted' : 'deferred'}.`] : []),
        ],
        confirmLabel: 'Drop rating',
        run: () => {
          ops.unrateStation(state, card.iata, entry.classCode);
          changed();
        },
      }),
    );
    return chip;
  }
  if (entry.sleeping > 0) {
    chip.classList.add('is-gap');
    chip.append(` ${entry.sleeping}`);
  } else {
    chip.prepend('+');
  }
  // Rating only moves planes into the line base where it has slots left tonight.
  const room = entry.sleeping > 0 && card.line && card.lineFree < entry.sleeping ? ` · line base has ${card.lineFree} slot${card.lineFree === 1 ? '' : 's'} left: raise it too` : '';
  const cost = entry.sleeping > 0 ? ` · ${card.check === 'contract' ? `contracted ${money(entry.contractPerNight)}/night` : 'deferred'}` : '';
  chip.title = entry.rateBlocked ?? `${entry.classCode} not rated${sleepers}${cost}${basedText}${room} · rate ${money(MX_RATING_FEE)} + ${money(MX_RATING_PER_DAY)}/day`;
  chip.disabled = entry.rateBlocked !== null;
  chip.addEventListener('click', () => {
    const preview = ops.previewMxRating(state, card.iata, entry.classCode);
    showConfirm({
      title: `Rate ${card.iata} for ${entry.classCode}`,
      rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
      facts: preview.blocked ? [preview.blocked] : [...preview.facts, ...(room ? [card.lineFree === 0 ? `Line base ${card.line!.used}/${card.line!.level} tonight: full, so they stay ${card.check === 'contract' ? 'contracted' : 'deferred'} until it is raised.` : `Line base ${card.line!.used}/${card.line!.level} tonight: only ${card.lineFree} more can be checked in house until it is raised.`] : [])],
      confirmLabel: `Rate · ${money(preview.fee)}`,
      run: () => {
        ops.rateStation(state, card.iata, entry.classCode);
        changed();
      },
    });
  });
  return chip;
}

function stationCard(state: SimState, card: MxStationCard, lineFee: number, heavyFee: number, changed: () => void): HTMLElement {
  const el = linkToMap(document.createElement('div'), { kind: 'airport', iata: card.iata });
  el.className = 'mx-station';
  if (card.classes.some((entry) => !entry.rated && entry.sleeping > 0) || (card.line?.overflow ?? 0) > 0) el.classList.add('is-warn');
  const head = box('mx-station-head');
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'inspector-link';
  const code = document.createElement('b');
  code.className = 'iata-plate';
  code.textContent = card.iata;
  name.append(code, ` ${card.name}`);
  name.addEventListener('click', () => select({ kind: 'airport', iata: card.iata }));
  const detail = document.createElement('span');
  detail.className = 'inspector-row-detail';
  const based = card.classes.reduce((total, entry) => total + entry.based, 0);
  detail.append(glyph('plane', `${based} plane${based === 1 ? '' : 's'} based`), ` ${based} · ${card.perDay > 0 ? `${money(card.perDay)}/day` : 'free'}`);
  head.append(name, detail);

  const capacity = box('mx-station-capacity');
  capacity.append(capacityRow(state, card.iata, 'line', card.line, lineFee, changed), capacityRow(state, card.iata, 'heavy', card.heavy, heavyFee, changed));

  const chips = box('mx-ratings');
  for (const entry of card.classes) chips.append(ratingChip(state, card, entry, changed));
  el.append(head, capacity, chips);

  if (card.unchecked > 0) {
    const tonight = box('mx-station-tonight');
    const what = document.createElement('span');
    what.append(glyph('moon', `${card.unchecked} asleep here tonight not checked in house`), ` ${card.unchecked} · `);
    tonight.append(what, checkDetail(card.check, card.contractPerNight), checkToggle(state, card.iata, card.check, changed));
    el.append(tonight);
  }
  return el;
}

/** One picker for a new station: a line base or a hangar at any known airport without one. */
function stationOpener(
  state: SimState,
  board: Set<string>,
  lineReadout: { candidates: BaseCandidate[]; fee: number },
  heavyReadout: { candidates: BaseCandidate[]; fee: number },
  changed: () => void,
): HTMLElement {
  const lineCandidates = lineReadout.candidates;
  const heavyCandidates = heavyReadout.candidates;
  const opener = box('base-open');
  const select_ = document.createElement('select');
  select_.className = 'base-open-select';
  const names = new Map([...lineCandidates, ...heavyCandidates].map((candidate) => [candidate.iata, candidate.name]));
  for (const iata of [...names.keys()].filter((code) => !board.has(code)).sort()) {
    const option = document.createElement('option');
    option.value = iata;
    option.textContent = `${iata} · ${names.get(iata)}`;
    select_.append(option);
  }
  const buttons = (['line', 'heavy'] as const).map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    button.append(glyph(kind === 'line' ? 'wrench' : 'hangar'), ` + ${money((kind === 'line' ? lineReadout : heavyReadout).fee)}`);
    button.addEventListener('click', () => confirmBase(state, kind, select_.value, 'open', changed));
    return { kind, button };
  });
  const refresh = () => {
    for (const { kind, button } of buttons) {
      const blocked = (kind === 'line' ? lineCandidates : heavyCandidates).find((candidate) => candidate.iata === select_.value)?.blocked ?? null;
      button.disabled = select_.value === '' || blocked !== null;
      button.title = blocked ?? `Open a ${KIND_NAME[kind]} at ${select_.value}`;
    }
  };
  select_.addEventListener('change', refresh);
  refresh();
  opener.append(select_, ...buttons.map((entry) => entry.button));
  return opener;
}

/** The spare engine pool: a row per class with its spares ready and a − / + to hold more. */
function buildEngines(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Engines',
      'Spare engines by aircraft class. An engine fault waits 4 days for a lease engine; with a spare ready the plane is back the next morning and the pulled engine goes to the shop for 20 days (paid then), rejoining the pool. Each spare costs its daily holding cost, in the shop or on the shelf, so a pool pays for a fleet that breaks engines often.',
    ),
  ];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const entry of ops.engineReadouts(state)) {
    const row = document.createElement('div');
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.append(glyph('engine'), ` ${entry.classCode} · `, pips(entry.ready, entry.held, `${entry.ready} of ${entry.held} spares ready; the rest are in the shop`, 'engine'));
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent = `${money(entry.held * entry.perDay)}/day · shop ${money(entry.shopVisit)}`;
    detail.title = `${money(entry.perDay)} a day for each spare`;
    const controls = box('base-level');
    for (const delta of [-1, 1] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'base-close';
      button.textContent = delta > 0 ? '+' : '−';
      button.title = delta > 0 ? `Hold another ${entry.classCode} spare · ${money(entry.perDay)}/day` : 'Give a spare back';
      button.addEventListener('click', () => {
        ops.changeSpareEngines(state, entry.classCode, delta);
        changed();
      });
      controls.append(button);
    }
    row.append(name, detail, controls);
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}
