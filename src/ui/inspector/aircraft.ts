import { classByCode } from '../../sim/aircraftClasses';
import { dayIndex } from '../../sim/clock';
import { line, heading, lineWithInfo } from './dom';
import { money } from '../format';
import { aogFor, daysUntilReturn } from '../../sim/aog';
import { projectRestOfDay } from '../../sim/cascade';
import { minuteOfDay, minuteOfDayToTimeString } from '../../sim/clock';
import { formatLoadFactor, marketLoadFactor } from '../../sim/loadFactor';
import { ageDelayParameters, type DelayBreakdown } from '../../sim/delays';
import type { SimState } from '../../sim/state';
import { aircraftUtilisation, rotationsForTail } from '../../sim/utilisation';
import { planeIconElement } from '../planeIcons';
import * as ops from '../routeActions';
import { select, selectRoute } from '../selection';
import { linkToMap } from '../mapLink';

/**
 * The inspector's views of the player's own aircraft
 * (ui/inspector/inspector.ts): the Fleet list, and one plane's day. A
 * plane is the unit the whole schedule is built from, and how one late
 * leg spreads through the rest of a plane's day is the thing the map most
 * wants to teach; this is where that day reads in order, leg by leg, with
 * how late each one ran and why.
 */

function title(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.className = 'inspector-title';
  el.textContent = text;
  return el;
}

/** A home-local time of day for an absolute simMinute, as the HUD shows it. */
function clock(state: SimState, absoluteMinute: number): string {
  return minuteOfDayToTimeString(minuteOfDay(state, absoluteMinute));
}

/** Why a flight ran late, in words, biggest cause first: "knock-on 12, age 8". */
function describeCauses(delay: DelayBreakdown): string {
  const causes: [string, number][] = [
    ['knock-on', delay.knockOn],
    ['age', delay.age],
    ['weather', delay.weather],
    ['congestion', delay.congestion],
  ];
  return causes
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => `${name} ${minutes}`)
    .join(', ');
}

/** Where a plane is right now, in a few words. */
function whereNow(state: SimState, tail: string): string {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const flight = state.activeFlights.find((f) => f.tail === tail);
  if (flight) {
    const late = flight.arriveMinute - flight.scheduledArriveMinute;
    return `Airborne ${flight.origin}→${flight.dest} · ETA ${clock(state, flight.arriveMinute)}` + (late > 0 ? ` · +${late} min` : '');
  }
  return aircraft.atAirport ? `On ground · ${aircraft.atAirport}` : 'Not yet delivered';
}

/** Today's flown legs for a plane: how many, how many on time, and how full they flew. */
function todayOnTime(state: SimState, tail: string): { flown: number; onTime: number; loadFactor: number | null } {
  const results = state.todayLegResults ?? {};
  const legs = state.schedule.filter((leg) => leg.tail === tail && results[leg.legId]);
  const passengers = legs.reduce((sum, leg) => sum + results[leg.legId].passengers, 0);
  const seats = legs.reduce((sum, leg) => sum + (results[leg.legId].seats ?? 0), 0);
  return {
    flown: legs.length,
    onTime: legs.filter((leg) => results[leg.legId].onTime).length,
    loadFactor: seats > 0 ? passengers / seats : null,
  };
}

/** A button that opens a plane's view: every tail in the panel is one. */
export function aircraftLink(tail: string): HTMLButtonElement {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inspector-link';
  link.textContent = tail;
  link.addEventListener('click', () => select({ kind: 'aircraft', tail }));
  return link;
}

/** Every plane the airline has, each a row opening its view. */
export function buildFleetView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  root.append(title('Fleet'));

  if (state.aircraft.length === 0) {
    root.append(lineWithInfo('No aircraft', 'Tap an airport on the map and choose Plane to lease one.'));
    return root;
  }
  const leases = state.aircraft.reduce((sum, a) => sum + a.leaseCostPerDay, 0);
  root.append(line(`${state.aircraft.length} aircraft · leases ${money(leases)}/day`));

  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const aircraft of state.aircraft) {
    const use = aircraftUtilisation(state, aircraft.tail);
    const { flown, onTime, loadFactor } = todayOnTime(state, aircraft.tail);
    const row = linkToMap(document.createElement('button'), { kind: 'aircraft', tail: aircraft.tail });
    row.type = 'button';
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.append(planeIconElement(aircraft.typeCode), ` ${aircraft.tail}`);
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent =
      `${aircraft.baseAirport ?? 'no base'} · ${Math.round(use.share * 100)}% of day` +
      (flown > 0 ? ` · OTP ${onTime}/${flown}` : '') +
      (loadFactor !== null ? ` · LF ${Math.round(loadFactor * 100)}%` : '') +
      (aogFor(state, aircraft.tail) ? ' · AOG' : '');
    if (aogFor(state, aircraft.tail) || use.share > 1) detail.classList.add('is-over');
    row.append(name, detail);
    row.addEventListener('click', () => select({ kind: 'aircraft', tail: aircraft.tail }));
    list.append(row);
  }
  root.append(list);
  return root;
}

/**
 * One plane: what it is, where it is, and its whole day in order.
 * `changed` rebuilds the inspector after an action taken here.
 */
export function buildAircraftView(state: SimState, tail: string, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const spec = classByCode(aircraft.typeCode);
  root.append(title(`${tail} — ${spec?.name ?? aircraft.typeCode}`));

  const reliability = ageDelayParameters(aircraft.ageYears);
  root.append(
    line(`${spec?.seats ?? '?'} seats · ${aircraft.ageYears} yrs · lease ${money(aircraft.leaseCostPerDay)}/day · base ${aircraft.baseAirport ?? 'none yet'}`),
    // The age roll alone (sim/delays.ts), before knock-on, weather and
    // congestion: the part of its lateness that comes with the airframe.
    lineWithInfo(
      `Tech dispatch ${Math.round(reliability.onTimeProbability * 100)}% · ≤${reliability.maxDelayMinutes} min when not`,
      'The share of its flights that leave without a mechanical delay at this airframe\'s age; older planes have more, and longer ones. Knock-on, weather and congestion delays come on top.',
    ),
  );

  const now = line(whereNow(state, tail));
  const plane = state.aircraft.find((a) => a.tail === tail);
  if (plane?.returningOnDay !== undefined) {
    const days = plane.returningOnDay - dayIndex(state);
    now.textContent = `Returning · gone day ${plane.returningOnDay} (${days}d) · lease still charged`;
    now.classList.add('is-over');
  }
  const aog = aogFor(state, tail);
  if (aog) {
    const days = daysUntilReturn(state, aog);
    now.textContent = `AOG · ${aog.base} · ${aog.fault} · back ${days}d · expedite from ${aog.base}`;
    now.classList.add('is-over');
  }
  root.append(now);

  const use = aircraftUtilisation(state, tail);
  const useLine = lineWithInfo(`${Math.round(use.share * 100)}% of day · ${use.legs} legs`, 'The share of the usable day, 06:00–22:00 home time, its flying and turns take up. Over 100% cannot be flown.');
  if (use.share > 1) useLine.classList.add('is-over');
  root.append(useLine);

  root.append(heading('Today'), buildDay(state, tail));

  const rotations = rotationsForTail(state, tail);
  if (rotations.length > 0) {
    root.append(heading('Rotations'));
    const list = document.createElement('div');
    list.className = 'inspector-rows';
    for (const rotation of rotations) {
      const row = linkToMap(document.createElement('button'), { kind: 'route', a: rotation.airports[0], b: rotation.airports[1] });
      row.type = 'button';
      row.className = 'inspector-row';
      const name = document.createElement('span');
      name.textContent = rotation.airports.join(' → ');
      const detail = document.createElement('span');
      detail.className = 'inspector-row-detail';
      const load = marketLoadFactor(state, rotation.airports[0], rotation.airports[1]);
      detail.textContent =
        `${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)} · LF ${formatLoadFactor(load)}`;
      row.append(name, detail);
      // A rotation's first leg is its route: open that route's view.
      row.addEventListener('click', () => selectRoute(state, rotation.airports[0], rotation.airports[1]));
      list.append(row);
    }
    root.append(list);
  }

  const returnBlock = buildReturn(state, tail, changed);
  if (returnBlock) root.append(returnBlock);
  return root;
}

/**
 * The plane's day, every leg in order: flown (how late, why, what it
 * carried and made), in the air now, projected (how late it's heading
 * for, sim/cascade.ts), cancelled, or still to come.
 */
function buildDay(state: SimState, tail: string): HTMLElement {
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  const legs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (legs.length === 0) {
    list.append(line('No flights scheduled. Draw a route from its base to give it a day.'));
    return list;
  }

  const results = state.todayLegResults ?? {};
  const flight = state.activeFlights.find((f) => f.tail === tail);
  const projected = new Map(projectRestOfDay(state, tail).map((p) => [p.leg.legId, p]));

  for (const leg of legs) {
    const row = document.createElement('div');
    row.className = 'inspector-row inspector-day-row';
    const name = document.createElement('span');
    name.textContent = `${minuteOfDayToTimeString(leg.departMinute)} ${leg.origin} → ${leg.dest}`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';

    const result = results[leg.legId];
    const plan = projected.get(leg.legId);
    if (result) {
      const causes = describeCauses(result.delayByCause);
      const full = result.seats ? ` · LF ${Math.round((result.passengers / result.seats) * 100)}%` : '';
      detail.textContent =
        (result.onTime ? 'on time' : `+${result.arriveLateMinutes} min${causes ? ` (${causes})` : ''}`) +
        ` · ${result.passengers} pax${full} · ${money(result.margin)}`;
      if (!result.onTime) detail.classList.add('is-warn');
    } else if (flight?.legId === leg.legId) {
      const late = flight.arriveMinute - flight.scheduledArriveMinute;
      const causes = describeCauses(flight.delayByCause);
      detail.textContent = `airborne · ETA ${clock(state, flight.arriveMinute)}` + (late > 0 ? ` · +${late} min${causes ? ` (${causes})` : ''}` : '');
      if (late > 0) detail.classList.add('is-warn');
    } else if (state.cancelledToday.includes(leg.legId)) {
      detail.textContent = 'CNX';
      detail.classList.add('is-over');
    } else if (plan?.cancelled) {
      detail.textContent = 'CNX risk · curfew';
      detail.classList.add('is-over');
    } else if (plan && plan.lateMinutes > 0) {
      detail.textContent = `projected +${plan.lateMinutes} min`;
      detail.classList.add('is-warn');
    } else {
      detail.textContent = 'scheduled';
    }
    row.append(name, detail);
    list.append(row);
  }
  return list;
}

/**
 * Returning the plane to the lessor (sim/market.ts): its fee and what it
 * saves, or why it can't go. A two-step button, like the ring's, since a
 * return can't be undone.
 */
function buildReturn(state: SimState, tail: string, changed: () => void): HTMLElement | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  if (!aircraft.baseAirport) return null;
  const option = ops.returnOptions(state, aircraft.baseAirport).find((o) => o.tail === tail);
  if (!option) return null;

  const block = document.createElement('div');
  block.className = 'inspector-return';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = `Return to lessor · fee ${money(option.fee)} · saves ${money(option.saves)}/day`;
  button.disabled = option.blocked !== null;
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = `Confirm return of ${tail}`;
      button.classList.add('is-act');
      return;
    }
    ops.returnPlane(state, tail);
    changed();
  });
  block.append(button);
  if (option.blocked) block.append(line(option.blocked));
  // The usual reason it can't go back: it still flies. Offer to clear its day.
  if (state.schedule.some((leg) => leg.tail === tail)) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'inspector-plan-hub';
    clear.textContent = `Remove all ${tail} flights`;
    let clearArmed = false;
    clear.addEventListener('click', () => {
      if (!clearArmed) {
        clearArmed = true;
        clear.textContent = `Confirm: remove all ${tail} flights`;
        clear.classList.add('is-act');
        return;
      }
      ops.clearPlane(state, tail);
      changed();
    });
    block.append(clear);
  }
  return block;
}
