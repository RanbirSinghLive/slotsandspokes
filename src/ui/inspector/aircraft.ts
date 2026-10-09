import { nightStopCostPerNight, nightStopLegs } from '../../sim/nightStops';
import { classByCode } from '../../sim/aircraftClasses';
import { dayIndex } from '../../sim/clock';
import { line, heading, lineWithInfo } from './dom';
import { gameDate, money } from '../format';
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
import { cashAfterRows, showConfirm } from '../confirmModal';
import { REBASE_DAYS, REBASE_FEE_LEASE_DAYS } from '../../sim/rebase';
import { CABIN_PRICE, cabinLayout, cabinOf } from '../../sim/cabins';
import { DEFERRED_AGE_YEARS, deferredItems, HEAVY_INTERVAL_DAYS, heavyBankedMinutes, heavyCheckDueIn, heavyCheckOpen, heavyCheckWorkMinutes, MX_HOLD_AT, tonightCheck } from '../../sim/mxChecks';
import { CREWS_PER_NEW_PLANE } from '../../sim/crews';

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
  root.append(
    lineWithInfo(
      `${state.aircraft.length} aircraft · leases ${money(leases)}/day`,
      'Each row: base · share of the usable day flown (over 100% cannot be flown) · OTP, arrivals on time of flown today · LF, load factor today · J, business cabin. AOG is grounded by a fault.',
    ),
  );

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
      (aircraft.rebase ? `${aircraft.rebase.from}→${aircraft.rebase.to} day ${aircraft.rebase.arrivesDay}` : (aircraft.baseAirport ?? 'no base')) +
      ` · ${Math.round(use.share * 100)}%` +
      (flown > 0 ? ` · OTP ${onTime}/${flown}` : '') +
      (loadFactor !== null ? ` · LF ${Math.round(loadFactor * 100)}%` : '') +
      (aogFor(state, aircraft.tail) ? (aogFor(state, aircraft.tail)?.refitTo ? ' · refit' : ' · AOG') : aircraft.refitPending ? ' · refit tomorrow' : '') +
      (aircraft.cabin ? ' · J' : '');
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
    line(`${seatsText(spec?.seats, cabinOf(aircraft))} · ${aircraft.ageYears} yrs · lease ${money(aircraft.leaseCostPerDay)}/day · base ${aircraft.baseAirport ?? 'none yet'}`),
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
  if (plane?.rebase) {
    const days = plane.rebase.arrivesDay - dayIndex(state);
    now.textContent = `Ferrying ${plane.rebase.from}→${plane.rebase.to} · based there day ${plane.rebase.arrivesDay} (${days}d) · lease still charged`;
    now.classList.add('is-warn');
  }
  const aog = aogFor(state, tail);
  if (aog) {
    const days = daysUntilReturn(state, aog);
    now.textContent = aog.refitTo
      ? `Refit · ${aog.base} · ${aog.refitTo === 'business' ? 'business cabin' : 'all economy'} · back ${days}d`
      : `AOG · ${aog.base} · ${aog.fault} · back ${days}d · expedite from ${aog.base}`;
    now.classList.add(aog.refitTo ? 'is-warn' : 'is-over');
  }
  root.append(now);
  // A seasonal lease (sim/seasonalLease.ts) goes back by itself.
  if (plane?.seasonalUntilDay !== undefined && plane.returningOnDay === undefined) {
    const left = plane.seasonalUntilDay - dayIndex(state);
    root.append(line(`Seasonal lease · back to the lessor ${gameDate(state, plane.seasonalUntilDay)} (${Math.max(0, left)}d) · its flights come off then`, 'inspector-line is-warn'));
  }
  // A night stop (sim/nightStops.ts): where it sleeps, and what a night there costs.
  const nightStop = nightStopLegs(state, tail);
  if (nightStop && plane) {
    const station = nightStop.morning.origin;
    root.append(
      lineWithInfo(
        `Night stop ${station} · out ${minuteOfDayToTimeString(nightStop.evening.departMinute)} · back ${minuteOfDayToTimeString(nightStop.morning.departMinute)} · ${money(nightStopCostPerNight(state, plane, station))}/night`,
        `It sleeps at ${station}, not at base: the crew's hotel every night, and the line check by the station's setting on the Mtc screen (free at a maintenance base). If its flight out is cancelled or held by the curfew, it sleeps at base and the morning flight from ${station} is cancelled. On the Schedule, push either half past its end of the day to bring it home.`,
      ),
    );
  }
  // Tonight's line check and the heavy check (sim/mxChecks.ts), in words.
  const tonight = tonightCheck(state, tail);
  if (tonight && plane) {
    const deferred = deferredItems(plane);
    const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
    const text = tonight.away
      ? `Tonight ☾✗ · ${tonight.station} · checks deferred · no line check`
      : `Tonight ☾${tonight.short ? `−${tonight.work - tonight.night}m` : tonight.contracted ? 'c' : '✓'} · ${tonight.station}${tonight.contracted ? ' contracted' : ''} · ${hours(tonight.night)} for ${hours(tonight.work)} of work`;
    const heavy = heavyCheckOpen(plane) ? ` · heavy ${Math.round(heavyBankedMinutes(plane) / 6) / 10}/${heavyCheckWorkMinutes(plane.typeCode) / 60}h` : ` · heavy due ${heavyCheckDueIn(plane)}d`;
    root.append(
      lineWithInfo(
        text + heavy + (deferred > 0 ? ` · ${'●'.repeat(Math.min(deferred, MX_HOLD_AT))} ${deferred} deferred` : ''),
        `The line check: each night the plane needs hangar work, more for more flights a day, between landing and an hour before its first departure. ☾✓ means tonight is at a maintenance base with time for it, ☾c a contracted check at a station without one, ☾−40m that it's that much short, ☾✗ a station set to defer, so no check. A short or missed check leaves a deferred item (●): each wears the plane like ${DEFERRED_AGE_YEARS} more years, and at ${MX_HOLD_AT} it's held a morning. The heavy check is hangar work every ${HEAVY_INTERVAL_DAYS} flying days, done from the spare hours of nights at a maintenance base. The Mtc screen lists every plane's, and its bases and stations.`,
        tonight.away || tonight.short || deferred >= MX_HOLD_AT - 1 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

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

  const cabinBlock = buildCabin(state, tail, changed);
  if (cabinBlock) root.append(cabinBlock);
  const rebaseBlock = buildRebase(state, tail, changed);
  if (rebaseBlock) root.append(rebaseBlock);
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

function seatsText(seats: number | undefined, cabin: 'economy' | 'business'): string {
  if (seats === undefined) return '? seats';
  if (cabin === 'economy') return `${seats} seats`;
  const layout = cabinLayout(seats, cabin);
  return `${layout.business}J + ${layout.economy}Y seats`;
}

/**
 * The plane's cabin (sim/cabins.ts): what it has, and the refit to the
 * other one with its forecast, cost and days out; or the refit ordered,
 * with a way to call it off.
 */
function buildCabin(state: SimState, tail: string, changed: () => void): HTMLElement | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const option = ops.refitOptionFor(state, tail);
  if (!option) return null;
  const block = document.createElement('div');
  block.className = 'inspector-return';
  block.append(
    heading(
      'Cabin',
      `A business cabin (J) up front: each business seat takes the room of 2.5 economy (Y) seats. Only business travellers buy it, at ${CABIN_PRICE}× the route's fare, and they value it well above an economy seat. It pays where business travellers are many and the plane has room; on a full leisure route the seats it takes would have sold. A refit starts the next morning the plane is at base and takes it out of service; its flying moves to spare planes of its class there, like an AOG. The forecast is the game's own, on its routes as they are now.`,
    ),
  );
  const now = cabinOf(aircraft) === 'business' ? 'Business cabin' : 'All economy';
  block.append(line(now));
  if (aircraft.refitPending) {
    block.append(line(`Refit to ${aircraft.refitPending} ordered · starts next morning at base`, 'inspector-line is-warn'));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'inspector-plan-hub';
    cancel.textContent = `Call off · ${money(option.cost)} back`;
    cancel.addEventListener('click', () =>
      showConfirm({
        title: `Call off ${tail} refit`,
        rows: [
          { label: 'Refunded', value: money(option.cost) },
          { label: 'Cash after', value: money(state.cash + option.cost) },
        ],
        facts: ['The plane keeps its current cabin and stays in service.'],
        confirmLabel: 'Call off',
        run: () => {
          ops.cancelRefit(state, tail);
          changed();
        },
      }),
    );
    block.append(cancel);
    return block;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  const verb = option.to === 'business' ? 'Fit business cabin' : 'Back to all economy';
  button.textContent = `${verb} · ${money(option.cost)} · ${option.days}d out`;
  button.disabled = option.blocked !== null;
  button.addEventListener('click', () =>
    showConfirm({
      title: `${verb} · ${tail}`,
      rows: [
        { label: 'Refit cost', value: money(option.cost) },
        { label: 'Out of service', value: `${option.days} days` },
        { label: 'Forecast', value: `${option.gainPerDay >= 0 ? '+' : '−'}${money(Math.abs(option.gainPerDay))}/day` },
        ...cashAfterRows(state, option.cost),
      ],
      facts: ['Starts next morning at base; the plane flies nothing while it is out. Calling it off before then refunds the cost.'],
      confirmLabel: `Order · ${money(option.cost)}`,
      run: () => {
        ops.orderRefit(state, tail, option.to);
        changed();
      },
    }),
  );
  const sign = option.gainPerDay >= 0 ? '+' : '−';
  const forecast = line(
    `Forecast ${sign}${money(Math.abs(option.gainPerDay))}/day on its routes` + (option.blocked ? ` · ${option.blocked}` : ''),
    option.gainPerDay < 0 ? 'inspector-line is-warn' : 'inspector-line',
  );
  block.append(button, forecast);
  return block;
}

/**
 * Moving the plane to another crew base (sim/rebase.ts): one two-step
 * button per base, cheapest first, with the crews rated on it there.
 */
function buildRebase(state: SimState, tail: string, changed: () => void): HTMLElement | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  if (!aircraft.baseAirport || aircraft.returningOnDay !== undefined || aircraft.rebase) return null;
  const { blocked, options } = ops.rebaseOptionsFor(state, tail);
  const block = document.createElement('div');
  block.className = 'inspector-return';
  block.append(
    heading(
      'Rebase',
      `Ferry it empty to another of your crew bases: the flight's cost plus ${REBASE_FEE_LEASE_DAYS} days of lease, and ${REBASE_DAYS} days away flying nothing. Crews stay where they are, so the new base needs ${CREWS_PER_NEW_PLANE} crews rated on it, like a delivery.`,
    ),
  );
  if (options.length === 0) {
    block.append(line(`One crew base · lease a plane at another airport to open a second`));
    return block;
  }
  if (blocked) block.append(line(blocked, 'inspector-line is-warn'));
  for (const option of options) {
    const button = linkToMap(document.createElement('button'), { kind: 'airport', iata: option.to });
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    const label = `Rebase to ${option.to} · ${money(option.fee)}${option.hops > 1 ? ` · ${option.hops} hops` : ''} · based day ${option.arrivesDay}`;
    button.textContent = label;
    button.disabled = option.blocked !== null;
    button.addEventListener('click', () =>
      showConfirm({
        title: `Rebase ${tail} · ${aircraft.baseAirport} → ${option.to}`,
        rows: [
          { label: 'Ferry cost', value: money(option.fee) },
          { label: 'Away', value: `${REBASE_DAYS} days, based day ${option.arrivesDay}` },
          { label: 'Crews at new base', value: `${option.crews}/${option.crewsNeeded}` },
          ...cashAfterRows(state, option.fee),
        ],
        facts: [
          `Flies nothing while ferrying and the lease is still charged. Crews stay where they are: ${option.to} needs ${CREWS_PER_NEW_PLANE} crews rated on this type.`,
        ],
        confirmLabel: `Rebase · ${money(option.fee)}`,
        run: () => {
          ops.rebasePlane(state, tail, option.to);
          changed();
        },
      }),
    );
    const short = option.crews < option.crewsNeeded;
    const name = classByCode(aircraft.typeCode)?.name ?? aircraft.typeCode;
    const detail = line(
      `${option.to} ${name} crews ${option.crews}/${option.crewsNeeded}${short ? ' · short' : ''}` + (option.blocked && option.blocked !== blocked ? ` · ${option.blocked}` : ''),
      short ? 'inspector-line is-warn' : 'inspector-line',
    );
    block.append(button, detail);
  }
  return block;
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
  button.addEventListener('click', () =>
    showConfirm({
      title: `Return ${tail} to lessor`,
      rows: [
        { label: 'Return fee', value: money(option.fee) },
        { label: 'Lease saved', value: `${money(option.saves)}/day` },
        ...cashAfterRows(state, option.fee),
      ],
      facts: ['Goes back for good; leasing another means a new airframe at the market rate.'],
      confirmLabel: `Return · ${money(option.fee)}`,
      run: () => {
        ops.returnPlane(state, tail);
        changed();
      },
    }),
  );
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
