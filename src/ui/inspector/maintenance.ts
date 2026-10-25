import { AIRCRAFT_CLASSES, pluralClassName } from '../../sim/aircraftClasses';
import { execNudge } from '../execNudge';
import { aogChance, aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { ageDelayParameters } from '../../sim/delays';
import { USEFUL_LIFE_YEARS } from '../../sim/leasing';
import { LINE_INTERVAL_NIGHTS, A_OVERDUE, A_WINDOW, C_INTERVAL_CYCLES, C_INTERVAL_HOURS, D_INTERVAL_DAYS, D_INTERVAL_HOURS, D_WEAR_YEARS, D_WINDOW_DAYS, DEFERRED_AGE_YEARS, HEAVY_INTERVAL_DAYS, HEAVY_WINDOW_DAYS, MX_HOLD_AT, wornAge } from '../../sim/mxChecks';
import * as ops from '../routeActions';
import type { EngineReadout, HeavyCheckReadout, LevelledBaseReadout, MxStationCard, OutstationReadout, StationClassReadout } from '../../sim/playerActions';
import type { SimState } from '../../sim/state';
import { ENGINE_SHOP_DAYS, ENGINE_WAIT_DAYS, type EngineSupport } from '../../sim/enginePool';
import { dayIndex } from '../../sim/clock';
import { money, shortMoney } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement, TYPE_COLOURS } from '../planeIcons';
import { glyph, pips } from '../glyphs';
import { select } from '../selection';
import { MX_RATING_FEE, MX_RATING_PER_DAY } from '../../sim/bases';
import { costRows, showConfirm } from '../confirmModal';
import { confirmDBooking, confirmHeavyBooking } from '../checkBooking';
import { noneLine } from './bases';
import { heading, line, titleWithSwitch, viewSwitch } from './dom';

/** The Mtc screen's three views; the one shown is remembered across visits. */
type MtcView = 'stations' | 'fleet' | 'engines';
const VIEW_KEY = 'slotsandspokes-mtc-view';

function loadView(): MtcView {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'stations' || saved === 'fleet' || saved === 'engines') return saved;
  } catch {
    // Storage can be blocked; the screen opens on Stations.
  }
  return 'stations';
}

let view: MtcView = loadView();

function setView(next: MtcView): void {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Not remembered; fine.
  }
}

/**
 * The Maintenance screen (Mtc on the rail, under Crews): the fleet's
 * technical side, in three views.
 *
 * - **Stations**: every plane grounded (AOG) with the button to pay a day
 *   off the repair, then a card per maintenance station: its line base, its
 *   hangar bays with the planes in them and the ones coming due, and its
 *   ratings; then the outstations planes sleep at without one. New stations
 *   are opened from the airport's panel or map ring.
 * - **Fleet**: a release-to-service board and a tech-log card per plane,
 *   grouped by type: check clocks, deferred items, wear.
 * - **Engines**: each class's engine support plan and its book.
 *
 * What an AOG cancels goes in the ticker, and a plane's own view keeps its
 * own figures; this is the board across the fleet.
 */
export function buildMaintenanceView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const stationCount = ops.mxStationBoard(state).length;
  const views = viewSwitch<MtcView>(
    [
      { id: 'stations', icon: glyph('hangar'), tip: `Stations: AOG, ${stationCount} station${stationCount === 1 ? '' : 's'} with their line slots, hangar bays and ratings, and outstations`, badge: state.aogs.length },
      { id: 'fleet', icon: glyph('plane'), tip: 'Fleet: release to service and every plane\'s check clocks, by type' },
      { id: 'engines', icon: glyph('engine'), tip: 'Engines: the engine support plan by class' },
    ],
    view,
    (next) => {
      setView(next);
      changed();
    },
  );
  root.append(titleWithSwitch('Maintenance', views, execNudge(state, ['coo-maintenance', 'dom-bakare'])));

  const repairsToday = state.todayCostByCategory.maintenance;
  root.append(line(`${state.aogs.length} AOG · ${state.aircraft.length} aircraft` + (repairsToday > 0 ? ` · expedited ${money(repairsToday)} today` : '')));

  if (view === 'fleet') root.append(...buildFleetBoard(state, changed));
  else if (view === 'engines') root.append(...buildEngines(state, changed));
  else root.append(...buildAogs(state, changed), ...buildMxBases(state, changed));
  return root;
}

/** Every plane grounded: what's wrong, when it's back, and the button to pay a day off the repair. */
function buildAogs(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading('AOG', 'Aircraft on ground: a fault keeps the plane out until it is repaired. Its flying moves to other planes at its base where they have time; the rest is cancelled until it is back. Expediting pays to bring it back a day sooner.'),
  ];
  if (state.aogs.length === 0) return [...nodes, line('None')];
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
    nodes.push(row);
  }
  return nodes;
}

const NIGHT_WORDS: Record<string, string> = { checked: 'checked', cleared: 'cleared 1', short: 'short', free: 'not due', contracted: 'contracted', away: 'missed' };

/** How a plane stands for release to service, worst first. */
type Standing = 'aog' | 'check' | 'due' | 'watch' | 'ok';
const STANDING_ORDER: Standing[] = ['aog', 'check', 'due', 'watch', 'ok'];
const STANDING_WORDS: Record<Standing, string> = { aog: 'AOG', check: 'IN HANGAR', due: 'ACTION', watch: 'WATCH', ok: 'SERVICEABLE' };

/** Days past due the heavy-check clock shows, for a plane kept away from base on its due morning. */
const OVERDUE_SHOWN_DAYS = 7;
/** The heavy-check clock runs from the last check a week past due, so an overdue stretch shows. */
const CLOCK_DAYS = HEAVY_INTERVAL_DAYS + OVERDUE_SHOWN_DAYS;

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
 * A station's hangar bays: a filled bay for each plane in its C or D check
 * or a cabin refit there, with the days until it's out, an empty bay for
 * each one free, and a dashed bay for each plane based here whose C check
 * is within its window or overdue, so the hangar's coming load shows on the
 * station that will take it. A waiting bay carries its action: book when
 * the plane is parked at base, else a tip saying what it waits for.
 */
function hangarBays(state: SimState, iata: string, level: number, readouts: HeavyCheckReadout[], changed: () => void): HTMLElement {
  const bays = box('mx-bays mx-station-bays');
  const inHangar = state.aogs.filter((event) => event.base === iata && (event.check === true || event.inBay === true));
  for (const event of inHangar) {
    const plane = readouts.find((entry) => entry.tail === event.tail);
    const refit = event.refitTo !== undefined && event.inBay === true;
    const what = refit ? 'refit' : plane?.dInCheck ? 'D' : 'C';
    const bay = box(`mx-bay is-working${refit ? ' is-refit' : ''}`);
    bay.append(box('mx-bay-tail', event.tail), box('mx-bay-state', `${what} · out ${daysUntilReturn(state, event)}d`));
    bay.dataset.tip = `${event.tail} · ${refit ? 'cabin refit' : `${what} check`} in a bay at ${iata} · back in ${daysUntilReturn(state, event)}d`;
    bays.append(bay);
  }
  for (let free = inHangar.length; free < level; free++) {
    const bay = box('mx-bay is-free');
    bay.dataset.tip = `Bay free at ${iata} tonight`;
    bays.append(bay);
  }
  for (const plane of readouts) {
    if (plane.base !== iata || plane.inCheck || !plane.open) continue;
    const bay = box('mx-bay is-waiting');
    bay.classList.toggle('is-late', plane.dueIn <= 0);
    bay.append(box('mx-bay-tail', plane.tail), box('mx-bay-state', plane.dueIn > 0 ? `C ${plane.dueIn}d` : `C ${-plane.dueIn}d over`));
    if (level === 0) bay.dataset.tip = `${plane.tail} · C ${plane.dueIn > 0 ? `due in ${plane.dueIn}d` : `${-plane.dueIn}d overdue`} · no hangar at ${iata}: contracted out`;
    if (plane.canBook) {
      const book = document.createElement('button');
      book.type = 'button';
      book.className = 'mx-bay-book';
      book.append(glyph('wrench'));
      book.dataset.tip = `Book C check · ${plane.tail}`;
      book.addEventListener('click', () => confirmHeavyBooking(state, plane, changed));
      bay.classList.add('is-bookable');
      bay.append(book);
    } else if (plane.bookBlocker) {
      const wait = box('mx-bay-wait');
      wait.append(glyph('plane', plane.bookBlocker));
      bay.append(wait);
    }
    bays.append(bay);
  }
  return bays;
}

/**
 * The fleet's release-to-service board: a strip of how many planes stand
 * serviceable, on watch, due for action, in the hangar or on the ground,
 * then a tech-log card for each plane, worst first. Each card carries the
 * heavy-check clock (the days since its last check, the window where
 * nights at a maintenance base count toward it, the due mark and the
 * overdue stretch beyond it), its deferred items as slots that fill toward
 * the hold, and how worn it is.
 */
function buildFleetBoard(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Fleet',
      `Release to service, plane by plane. Serviceable: nothing open. Watch: a deferred item, a C check in its window or under 2 years of life. Action: held at ${MX_HOLD_AT} deferred items or a C check overdue. C-check clock: every ${HEAVY_INTERVAL_DAYS} flying days, ${C_INTERVAL_HOURS} flight hours or ${C_INTERVAL_CYCLES} cycles, 2–4 days in the hangar with the plane grounded. It goes in by itself the morning it falls due at base; book it earlier from ${HEAVY_WINDOW_DAYS} days before to pick a quiet week. Items: each deferred item (no line check, or a night too short) wears the plane like ${DEFERRED_AGE_YEARS} more years; at ${MX_HOLD_AT} it is held for a morning and its first rotation cancelled. Tech: the share of flights that leave without a mechanical delay. AOG: today's chance of a fault grounding it. Life: years left before the airframe reaches its useful life.`,
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
    graceZone.style.width = `${(OVERDUE_SHOWN_DAYS / CLOCK_DAYS) * 100}%`;
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
    dLine.title = `D check: overhaul every ${D_INTERVAL_DAYS} flying days or ${D_INTERVAL_HOURS.toLocaleString('en-US')} flight hours. It goes in by itself the morning it falls due at base, or earlier when booked; past due (away from base) the plane wears like ${D_WEAR_YEARS} more years until it goes in.`;

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
    // Book the C check early once its window is open, to pick the week instead of taking its due day.
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
    `Each maintenance station: its line base slots (wrench: planes it checks a night, most deferred items first) and its hangar bays as tiles: filled is a plane in its C or D check or a refit, grounded until out; free is an empty bay; dashed is a plane based here whose C check is within ${HEAVY_WINDOW_DAYS} days or overdue. It goes in by itself the morning it falls due at base; its wrench books it earlier when parked there. Planes past the bays are contracted out. Chips are the mechanics' ratings by class, with that class's planes asleep here tonight: solid is rated; dashed amber is a class sleeping here unrated. Each plane needs a line check once every ${LINE_INTERVAL_NIGHTS} nights, and a base checks planes early when it has room, so a level covers several planes. One due and missed (past the slots, an unrated class) gets a deferred item each night; nothing is contracted. A station's first rating is free; each further class costs ${money(MX_RATING_FEE)} and ${money(MX_RATING_PER_DAY)} a day. A new line base costs ${money(lineReadout.fee)}, a hangar ${money(heavyReadout.fee)}, then ${money(lineReadout.perLevelPerDay)} and ${money(heavyReadout.perLevelPerDay)} a day a level; home's first 3 of each are free. Open a new station from its airport's panel or map ring (Bases).`,
  );
  stationHead.prepend(glyph('wrench', undefined, 'base-head-glyph'), ' ');
  const nodes: HTMLElement[] = [stationHead];
  const cards = ops.mxStationBoard(state);
  const board = new Set(cards.map((card) => card.iata));
  const readouts = ops.heavyCheckReadouts(state);
  const list = box('mx-stations');
  for (const card of cards) list.append(stationCard(state, card, lineReadout.fee, heavyReadout.fee, readouts, changed));
  nodes.push(list);
  if (cards.length === 0) nodes.push(noneLine('No station · open one from an airport\'s panel'));

  // Planes coming due a C check whose base has no station at all: contracted out, shown so none goes unseen.
  const homeless = [...new Set(readouts.filter((plane) => plane.base && !board.has(plane.base) && plane.open && !plane.inCheck).map((plane) => plane.base!))];
  for (const iata of homeless) {
    const row = linkToMap(document.createElement('div'), { kind: 'airport', iata });
    row.className = 'mx-station is-warn';
    const head = box('mx-station-head');
    const code = document.createElement('b');
    code.className = 'iata-plate';
    code.textContent = iata;
    const note = document.createElement('span');
    note.className = 'inspector-row-detail is-warn';
    note.append(glyph('hangar', `No hangar at ${iata}: C checks for planes based here are contracted out`), ' contracted');
    head.append(code, note);
    row.append(head, hangarBays(state, iata, 0, readouts, changed));
    nodes.push(row);
  }

  const stations = ops.mxStationsReadout(state).filter((station) => !board.has(station.iata));
  nodes.push(
    heading(
      'Outstations',
      `Airports with no maintenance base of yours where planes sleep tonight. Line checks are only done at your own line bases, so a plane due one here misses it and gets a deferred item each night until it's checked.`,
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
    row.append(name, outstationDetail(station));
    outstations.append(row);
  }
  nodes.push(outstations);
  return nodes;
}

/** An outstation's night: how many planes there are due a line check they miss. */
function outstationDetail(station: OutstationReadout): HTMLElement {
  const detail = document.createElement('span');
  detail.className = 'inspector-row-detail';
  detail.textContent = station.due > 0 ? `${station.due} due · missed ●` : 'none due';
  if (station.due > 0) detail.classList.add('is-deferred', 'is-warn');
  detail.title = station.due > 0 ? `${station.due} of the planes asleep at ${station.iata} tonight are due a line check: no line base here, so each gets a deferred item.` : `No plane asleep at ${station.iata} tonight is due a line check.`;
  return detail;
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
  const tip = `${isLine ? 'Line base' : 'Hangar'} L${base.level} · ${base.used}/${base.level} ${unit}${base.overflow > 0 ? ` · ${base.overflow} more rated plane${base.overflow === 1 ? '' : 's'} than slots, ${isLine ? 'missed ●' : 'contracted'}` : ''}`;
  const slots = box('mx-station-slots');
  // The hangar's bays are drawn as tiles under the card, so its row only counts them.
  slots.append(icon);
  if (isLine) slots.append(' ', pips(base.used, base.level, tip, 'wrench'));
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
    const shortText = short > 0 ? ` · ${short} due and over the line base, ● each night` : '';
    chip.title = entry.dropBlocked ?? `${entry.classCode} rated${sleepers}${shortText}${basedText} · tap to drop`;
    chip.disabled = entry.dropBlocked !== null;
    chip.addEventListener('click', () =>
      showConfirm({
        title: `Drop ${card.iata}'s ${entry.classCode} rating`,
        rows: [],
        facts: [
          `Saves ${money(MX_RATING_PER_DAY)} a day; rating again costs ${money(MX_RATING_FEE)}.`,
          ...(entry.sleeping > 0 ? [`${entry.sleeping} ${entry.classCode} asleep here tonight would get a deferred item on each night they're due.`] : []),
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
  const room = entry.missed > 0 && card.line && card.lineFree < entry.missed ? ` · line base has ${card.lineFree} slot${card.lineFree === 1 ? '' : 's'} left: raise it too` : '';
  const cost = entry.missed > 0 ? ` · ${entry.missed} due, missed ●` : '';
  chip.title = entry.rateBlocked ?? `${entry.classCode} not rated${sleepers}${cost}${basedText}${room} · rate ${money(MX_RATING_FEE)} + ${money(MX_RATING_PER_DAY)}/day`;
  chip.disabled = entry.rateBlocked !== null;
  chip.addEventListener('click', () => {
    const preview = ops.previewMxRating(state, card.iata, entry.classCode);
    showConfirm({
      title: `Rate ${card.iata} for ${entry.classCode}`,
      rows: costRows(preview.fee, preview.kindPerDayBefore, preview.kindPerDayAfter, preview.cashAfter),
      facts: preview.blocked ? [preview.blocked] : [...preview.facts, ...(room ? [card.lineFree === 0 ? `Line base ${card.line!.used}/${card.line!.level} tonight: full, so they keep deferring until it is raised.` : `Line base ${card.line!.used}/${card.line!.level} tonight: only ${card.lineFree} more can be checked in house until it is raised.`] : [])],
      confirmLabel: `Rate · ${money(preview.fee)}`,
      run: () => {
        ops.rateStation(state, card.iata, entry.classCode);
        changed();
      },
    });
  });
  return chip;
}

function stationCard(state: SimState, card: MxStationCard, lineFee: number, heavyFee: number, readouts: HeavyCheckReadout[], changed: () => void): HTMLElement {
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
  el.append(head, capacity);
  const level = card.heavy?.level ?? 0;
  const bays = hangarBays(state, card.iata, level, readouts, changed);
  if (bays.childElementCount > 0) el.append(bays);
  el.append(chips);

  if (card.unchecked > 0) {
    const tonight = box('mx-station-tonight');
    const what = document.createElement('span');
    what.append(glyph('moon', `${card.unchecked} asleep here tonight due a line check and missing it: a deferred item each`), ` ${card.unchecked} · `);
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail is-deferred is-warn';
    detail.textContent = 'due · missed ●';
    tonight.append(what, detail);
    el.append(tonight);
  }
  return el;
}

const ENGINE_PLAN_NAMES: Record<EngineSupport, string> = { adhoc: 'Ad hoc', pool: 'Spares', pbh: 'PBH' };

/** Engine support: per class, the plan in force (ad hoc, own spares or power by the hour), its spares, and its book. */
function buildEngines(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Engines',
      `How each aircraft class gets an engine when one fails. Ad hoc pays nothing until then, and the plane waits ${ENGINE_WAIT_DAYS} more days for a lease engine. Own spares (Spares) cost a holding fee a day each; a fault swaps one in and the plane is back the next morning, while the pulled engine spends ${ENGINE_SHOP_DAYS} days in the shop, paid then. Power by the hour (PBH) is a fee on every flight hour; a fault is back the next morning with no shop bill. PBH suits a few planes, spares a big fleet, ad hoc a fleet whose flying others can cover. Changing a plan starts a new book.`,
    ),
  ];
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const entry of ops.engineReadouts(state)) {
    const card = box('engine-card');
    const row = document.createElement('div');
    row.className = 'inspector-row base-row';
    const name = document.createElement('span');
    name.append(glyph('engine'), ` ${entry.classCode} · ${entry.planes} · ≈${entry.faultsPerYear.toFixed(1)}/yr`);
    name.dataset.tip = `${entry.planes} plane${entry.planes === 1 ? '' : 's'} · about ${entry.faultsPerYear.toFixed(1)} engine faults a year at today's breakdown chances`;
    row.append(name);
    if (entry.plan === 'pool') {
      row.append(pips(entry.ready, entry.held, `${entry.ready} of ${entry.held} spares ready; the rest are in the shop`, 'engine'));
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
      row.append(controls);
    }
    const pbhPerDay = entry.hoursPerDay * entry.pbhPerHour;
    const plans: { plan: EngineSupport; text: string; tip: string }[] = [
      { plan: 'adhoc', text: 'Ad hoc · $0', tip: `Nothing a day · an engine fault waits ${entry.waitDays} more days` },
      { plan: 'pool', text: `Spares · ${money(Math.max(1, entry.held) * entry.perDay)}/d`, tip: `${money(entry.perDay)} a day a spare · back next morning · shop ${money(entry.shopVisit)} a fault` },
      { plan: 'pbh', text: `PBH · ≈${money(pbhPerDay)}/d`, tip: `${money(entry.pbhPerHour)} a flight hour · ${entry.hoursPerDay.toFixed(0)} h a day scheduled · back next morning, no shop bill` },
    ];
    const buttons = document.createElement('div');
    buttons.className = 'rd-budgets';
    for (const option of plans) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rd-budget';
      button.classList.toggle('is-on', option.plan === entry.plan);
      button.textContent = option.text;
      button.dataset.tip = option.tip;
      button.addEventListener('click', () => {
        if (option.plan === entry.plan) return;
        ops.setEngineSupport(state, entry.classCode, option.plan);
        changed();
      });
      buttons.append(button);
    }
    card.append(row, buttons, ...engineBookCells(state, entry));
    list.append(card);
  }
  nodes.push(list);
  return nodes;
}

/** A class's book since its plan was set, as four cells the way the fuel book shows. */
function engineBookCells(state: SimState, entry: EngineReadout): HTMLElement[] {
  const record = entry.book;
  if (!record) return [line(`${ENGINE_PLAN_NAMES[entry.plan]} · no book yet`, 'inspector-line goal-ahead')];
  const net = record.protectedValue - record.lostValue - record.spent;
  const grid = box('fuel-book');
  const cell = (label: string, text: string, tone: number, tip: string) => {
    const el = box('fuel-book-cell');
    el.classList.toggle('is-good', tone > 0);
    el.classList.toggle('is-bad', tone < 0);
    const top = document.createElement('span');
    top.className = 'fuel-book-label';
    top.textContent = label;
    const value = document.createElement('span');
    value.textContent = text;
    el.append(top, value);
    el.dataset.tip = tip;
    return el;
  };
  const days = record.daysSaved - record.daysWaited;
  grid.append(
    cell('Faults', String(record.faults), 0, 'Engine faults on this plan'),
    cell('Days', `${days > 0 ? '+' : ''}${days}`, days, `Plane-days back sooner than ad hoc · ${record.daysSaved} saved · ${record.daysWaited} waited on a lease engine`),
    cell('Spent', shortMoney(-record.spent), -record.spent, 'Holding, shop visits and PBH fees'),
    cell('Net', `${net > 0 ? '+' : ''}${shortMoney(net)}`, net, `Est. flying the saved days kept (${money(record.protectedValue)}) − flying the waits lost (${money(record.lostValue)}) − spent. At each plane's margin a day; other planes covering its flying make it less.`),
  );
  return [grid, line(`${ENGINE_PLAN_NAMES[entry.plan]} · since day ${record.sinceDay} · ${dayIndex(state) - record.sinceDay}d`, 'inspector-line goal-ahead')];
}
