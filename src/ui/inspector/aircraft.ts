import { classByCode } from '../../sim/aircraftClasses';
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

/**
 * The inspector's views of the player's own aircraft
 * (ui/inspector/inspector.ts): the Fleet list, and one plane's day. A
 * plane is the unit the whole schedule is built from, and how one late
 * leg spreads through the rest of a plane's day is the thing the map most
 * wants to teach; this is where that day reads in order, leg by leg, with
 * how late each one ran and why.
 */

function money(amount: number): string {
  return `${amount < 0 ? '−' : ''}$${Math.round(Math.abs(amount)).toLocaleString()}`;
}

function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}

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
    return `In the air ${flight.origin} → ${flight.dest}, lands ${clock(state, flight.arriveMinute)}` + (late > 0 ? ` (${late} min late)` : '');
  }
  return aircraft.atAirport ? `On the ground at ${aircraft.atAirport}` : 'Not yet delivered';
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
    root.append(line('No aircraft. Tap an airport on the map and choose Plane to lease one.'));
    return root;
  }
  const leases = state.aircraft.reduce((sum, a) => sum + a.leaseCostPerDay, 0);
  root.append(line(`${state.aircraft.length} aircraft · ${money(leases)}/day in leases.`));

  const list = document.createElement('div');
  list.className = 'inspector-rows';
  for (const aircraft of state.aircraft) {
    const use = aircraftUtilisation(state, aircraft.tail);
    const { flown, onTime, loadFactor } = todayOnTime(state, aircraft.tail);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.append(planeIconElement(aircraft.typeCode), ` ${aircraft.tail}`);
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    detail.textContent =
      `${aircraft.baseAirport ?? 'no base'} · ${Math.round(use.share * 100)}% of day` +
      (flown > 0 ? ` · ${onTime}/${flown} on time today` : '') +
      (loadFactor !== null ? ` · ${Math.round(loadFactor * 100)}% full` : '') +
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
    line(
      `${spec?.seats ?? '?'} seats · ${aircraft.ageYears} years old · ${money(aircraft.leaseCostPerDay)}/day lease · based at ${aircraft.baseAirport ?? 'nowhere yet'}`,
    ),
    // The age roll alone (sim/delays.ts), before knock-on, weather and
    // congestion: the part of its lateness that comes with the airframe.
    line(
      `At its age, ${Math.round(reliability.onTimeProbability * 100)}% of its flights leave without a mechanical delay; the rest run up to ${reliability.maxDelayMinutes} min late.`,
    ),
  );

  const now = line(whereNow(state, tail));
  const aog = aogFor(state, tail);
  if (aog) {
    const days = daysUntilReturn(state, aog);
    now.textContent = `AOG at ${aog.base} (${aog.fault}), back in ${days} day${days === 1 ? '' : 's'}. Expedite it from ${aog.base}'s view.`;
    now.classList.add('is-over');
  }
  root.append(now);

  const use = aircraftUtilisation(state, tail);
  const useLine = line(`Uses ${Math.round(use.share * 100)}% of the usable day (06:00–22:00) across ${use.legs} legs.`);
  if (use.share > 1) useLine.classList.add('is-over');
  root.append(useLine);

  root.append(heading('Today'), buildDay(state, tail));

  const rotations = rotationsForTail(state, tail);
  if (rotations.length > 0) {
    root.append(heading('Rotations'));
    const list = document.createElement('div');
    list.className = 'inspector-rows';
    for (const rotation of rotations) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'inspector-row';
      const name = document.createElement('span');
      name.textContent = rotation.airports.join(' → ');
      const detail = document.createElement('span');
      detail.className = 'inspector-row-detail';
      const load = marketLoadFactor(state, rotation.airports[0], rotation.airports[1]);
      detail.textContent =
        `${minuteOfDayToTimeString(rotation.departMinute)}–${minuteOfDayToTimeString(rotation.arriveMinute)} · route ${formatLoadFactor(load)} full`;
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
      const full = result.seats ? ` (${Math.round((result.passengers / result.seats) * 100)}% full)` : '';
      detail.textContent =
        (result.onTime ? 'on time' : `${result.arriveLateMinutes} min late${causes ? ` (${causes})` : ''}`) +
        ` · ${result.passengers} pax${full}, ${money(result.margin)}`;
      if (!result.onTime) detail.classList.add('is-warn');
    } else if (flight?.legId === leg.legId) {
      const late = flight.arriveMinute - flight.scheduledArriveMinute;
      const causes = describeCauses(flight.delayByCause);
      detail.textContent = `in the air, lands ${clock(state, flight.arriveMinute)}` + (late > 0 ? `, ${late} min late${causes ? ` (${causes})` : ''}` : '');
      if (late > 0) detail.classList.add('is-warn');
    } else if (state.cancelledToday.includes(leg.legId)) {
      detail.textContent = 'cancelled';
      detail.classList.add('is-over');
    } else if (plan?.cancelled) {
      detail.textContent = 'heading for a curfew cancellation';
      detail.classList.add('is-over');
    } else if (plan && plan.lateMinutes > 0) {
      detail.textContent = `heading for ${plan.lateMinutes} min late`;
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
  button.textContent = `Return to lessor: ${money(option.fee)} fee, saves ${money(option.saves)}/day`;
  button.disabled = option.blocked !== null;
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = `Click again to return ${tail}. It goes back on the market for anyone to lease.`;
      button.classList.add('is-act');
      return;
    }
    ops.returnPlane(state, tail);
    changed();
  });
  block.append(button);
  if (option.blocked) block.append(line(option.blocked));
  return block;
}
