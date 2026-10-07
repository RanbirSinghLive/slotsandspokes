import { dailyMovementsAt } from '../../sim/airports';
import { airportHours, FIRST_OPEN_HOUR, freeInHour, hoursWithRoom, OPEN_HOURS, peakHour, type AirportHours } from '../../sim/hours';
import { inboundAt } from '../../sim/fleetTiming';
import { money, shortMoney } from '../format';
import { cabinShare, crewShare } from '../../sim/crews';
import { hasCrewBase, mxLevel, outstationCheck } from '../../sim/bases';
import { line, heading, lineWithInfo } from './dom';
import { formatNps, marketNps } from '../../sim/nps';
import { daysUntilReturn } from '../../sim/aog';
import { congestionParameters } from '../../sim/delays';
import { barredSpokePairsAt, connectingPassengersThrough } from '../../sim/hubs';
import { planHub } from '../../sim/hubPlanner';
import { formatLoadFactor, marketLoadFactor } from '../../sim/loadFactor';
import { airportDemandSize } from '../../sim/marketSize';
import { describeServiceLevel, hungerAt } from '../../sim/serviceLevel';
import { HUB_STYLES, hubStyleAt } from '../../sim/hubStyle';
import { nextSlotFees, slotFeesPerDayAt, slotsHeld } from '../../sim/slots';
import type { SimState } from '../../sim/state';
import { unmetDemandByAirport } from '../../sim/unmetDemand';
import { utilisationPools } from '../../sim/utilisation';
import { airportPresence, airports } from '../../render/airports';
import { hasHubView } from '../../render/hubs';
import { getMapPreview } from '../../render/preview';
import { openHubPlanner } from '../hubPlanner';
import { money as pnlMoney } from '../pnlBars';
import { buildPoolRows } from '../poolBars';
import * as ops from '../routeActions';
import { select } from '../selection';
import { aircraftLink } from './aircraft';
import { linkToMap } from '../mapLink';
import { contractsOf } from '../../sim/contracts';
import { cargoGlyph } from '../../render/cargo';
import { airportCargo, bestCargoPartners, neededTonnes, producedTonnes, shortagePremium } from '../../sim/cargo';

/**
 * The inspector's view of one airport (ui/inspector/inspector.ts): how
 * much of an airline you are here, how busy the field is and what its
 * slots cost, the planes based here (and any grounded), the hub planner,
 * and every market you fly from it, each a link to that route's view.
 */

export type AirportView = {
  root: HTMLElement;
  /** Redraw the plane pools with whatever the hovered radial button would change. */
  redrawPools: () => void;
};

const namesByIata = new Map(airports.map((airport) => [airport.iata, airport.name]));

/**
 * Build the view. `changed` is called after the player changes something
 * from inside it (the hub planner), so the inspector
 * can rebuild.
 */
export function buildAirportView(state: SimState, iata: string, changed: () => void): AirportView {
  const root = document.createElement('div');
  root.className = 'inspector-view';

  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = `${iata} — ${namesByIata.get(iata) ?? iata}`;
  root.append(title);

  const presence = airportPresence(state, iata);
  const connecting = Math.round(connectingPassengersThrough(state, iata));
  root.append(
    line(
      `${presence.level} · ${presence.departures} dep/day` +
        (connecting > 0 ? ` · ${connecting} connecting/day · ${HUB_STYLES[hubStyleAt(state, iata)].name}` : ''),
    ),
  );
  const barredPairs = barredSpokePairsAt(state, iata);
  if (barredPairs > 0) {
    root.append(
      lineWithInfo(
        `${barredPairs} spoke ${barredPairs === 1 ? 'pair' : 'pairs'} can't connect · cabotage`,
        `Cabotage is carrying passengers between two airports in a country that isn't your home. Your airline can't sell a trip between two airports in one foreign country, whichever hub it changes planes at, so those pairs add no connecting passengers here.`,
      ),
    );
  }

  // Bases here (sim/bases.ts): opened on the Crews and Mtc screens.
  const crewBase = hasCrewBase(state, iata);
  const lineLevel = mxLevel(state, 'line', iata);
  const heavyLevel = mxLevel(state, 'heavy', iata);
  const mtcText = [lineLevel > 0 ? `line L${lineLevel}` : 'no line base', heavyLevel > 0 ? `hangar L${heavyLevel}` : 'no hangar'].join(' · ');
  root.append(
    lineWithInfo(
      [crewBase ? 'Crew base' : 'No crew base', lineLevel > 0 ? mtcText : `${mtcText} · nights ${outstationCheck(state, iata) === 'contract' ? 'contracted' : 'deferred'}`].join(' · '),
      'A crew base is where planes can be leased and based (open one on the Crews screen). A line base checks as many planes a night as its level; a hangar has a bay for each level and is where heavy-check hours are banked (the Mtc screen). A plane sleeping anywhere else, or past a base\'s capacity, has its check contracted or deferred, by the station\'s setting there.',
    ),
  );

  // How many people want to fly from here, in words (sim/marketSize.ts);
  // the passengers you turn away are yours to count, so they stay a number.
  const unmet = unmetDemandByAirport(state).get(iata);
  if (unmet) {
    root.append(
      line(
        `Demand ${airportDemandSize(unmet.latent).toLowerCase()}` +
          (unmet.spilled >= 1 ? ` · ${Math.round(unmet.spilled).toLocaleString()} pax/day turned away` : ''),
        unmet.spilled >= 1 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

  // How starved the airport is for service (sim/serviceLevel.ts): in
  // words, not numbers, since it's a judgement about where to go next.
  const service = describeServiceLevel(hungerAt(state, iata));
  root.append(lineWithInfo(service.label, `How well this airport is served by every airline: ${service.description}.`));

  root.append(...cargoLines(state, iata));

  // Contracts touching this airport (sim/contracts.ts).
  for (const contract of contractsOf(state)) {
    if ((contract.a !== iata && contract.b !== iata) || (contract.status !== 'offered' && contract.status !== 'active')) continue;
    root.append(
      lineWithInfo(
        contract.status === 'offered'
          ? `Contract offer · ${contract.a}–${contract.b} · ${money(contract.paymentPerDay)}/day · fly by day ${contract.offerEndsDay}`
          : `Contract · ${contract.a}–${contract.b} · ends day ${contract.endsDay}`,
        'A route contract: its terms are in Head office. Flying the market both ways daily starts an offer.',
        'inspector-line is-good',
      ),
    );
  }
  root.append(...loadAndSlots(state, iata));
  root.append(...groundedPlanes(state, iata));

  const hubButton = planHubButton(state, iata, changed);
  if (hubButton) root.append(hubButton);

  // The planes based here, pooled by class.
  const pools = document.createElement('div');
  pools.className = 'inspector-pools';
  const redrawPools = () => {
    pools.replaceChildren(...buildPoolRows(utilisationPools(state, iata), getMapPreview()?.effects, iata, (code) => crewShare(state, code, iata), (code) => inboundAt(state, iata, code).length, (code) => cabinShare(state, code, iata)));
  };
  redrawPools();
  const basedHere = utilisationPools(state, iata).some((pool) => pool.planes > 0);
  root.append(heading('Planes based here'));
  if (basedHere) {
    // Each plane by tail, opening its own day (ui/inspector/aircraft.ts).
    const tails = document.createElement('div');
    tails.className = 'inspector-line';
    state.aircraft
      .filter((aircraft) => aircraft.baseAirport === iata)
      .forEach((aircraft, i) => {
        if (i > 0) tails.append(', ');
        tails.append(aircraftLink(aircraft.tail));
      });
    root.append(pools, tails);
  } else {
    root.append(line('None'));
  }

  root.append(heading('Markets'), marketRows(state, iata));
  return { root, redrawPools };
}

/**
 * What the airport makes and needs, and its best matched partners among
 * the airports you can reach (sim/cargo.ts): the lanes the Cargo lens
 * draws, in words. A need shows its shortage premium while it is unmet.
 */
function cargoLines(state: SimState, iata: string): HTMLElement[] {
  const cargo = airportCargo(iata);
  const tonnes = (n: number) => `${n.toFixed(1)} t/d`;
  const makes = cargo.produces.map((id) => `${cargoGlyph(id)} ${tonnes(producedTonnes(iata, id))}`);
  const needs = cargo.needs.map((id) => {
    const premium = shortagePremium(state, iata, id);
    return `${cargoGlyph(id)} ${tonnes(neededTonnes(iata, id))}${premium >= 0.05 ? ` +${Math.round(premium * 100)}%` : ''}`;
  });
  const lines = [
    lineWithInfo(
      `▲ ${makes.join(' · ')}`,
      'Goods this airport ships out each day, from its trade. The first is its specialty. Freight earns where one end makes what the other needs, whatever the passenger demand: a small town can be a rich origin. Flights carry it in the hold the passengers\' bags leave free.',
    ),
    lineWithInfo(
      `▼ ${needs.join(' · ')}`,
      'Goods this airport takes in each day. A need nobody is filling pays a shortage premium (+%), which fades as you fill it and comes back if you stop, so the edge is temporary.',
    ),
  ];
  const flown = new Set(state.schedule.map((leg) => (leg.origin === iata ? leg.dest : leg.origin)));
  const partners = bestCargoPartners(iata, state.knownAirports, 4);
  if (partners.length > 0) {
    lines.push(
      lineWithInfo(
        'Cargo partners',
        'The airports you can reach whose goods best match this one\'s, by matched freight a day at the base rate, both ways, before the hold limit and any rival. A lane only earns on a market you fly.',
      ),
      ...partners.map((entry) =>
        line(`${entry.partner} · ${entry.goods.map((id) => cargoGlyph(id)).join('')} · ${shortMoney(entry.dollarsPerDay)}/day${flown.has(entry.partner) ? ' · flown' : ''}`, flown.has(entry.partner) ? 'inspector-line is-good' : 'inspector-line'),
      ),
    );
  }
  return lines;
}

/**
 * How busy the field is against its capacity (sim/airports.ts), what that
 * costs in congestion delays (the glow around the airport on the map,
 * spelled out), and what slots here cost (sim/slots.ts), priced from the
 * same traffic.
 */
function loadAndSlots(state: SimState, iata: string): HTMLElement[] {
  const hours = airportHours(state, iata);
  const peak = peakHour(hours);
  const load = peak.load;
  const { delayChance, maxDelayMinutes } = congestionParameters(load);
  const withRoom = hoursWithRoom(hours);
  const loadLine = lineWithInfo(
    `Peak ${Math.round(load * 100)}% at ${String(peak.hour).padStart(2, '0')}:00 · ${dailyMovementsAt(state, iata)} movements · room ${withRoom}/${OPEN_HOURS}h` +
      (delayChance > 0 ? ` · peak CONG ${Math.round(delayChance * 100)}%, ≤${maxDelayMinutes} min` : ''),
    'Movements are every airline\'s takeoffs and landings, judged hour by hour from 06:00 to 22:00. A full hour takes no new flights; the route planner starts a new one later, when there is room. As an hour fills, congestion (CONG) delays a growing share of the flights in it: the glow around the airport on the map shows its busiest hour.',
  );
  loadLine.classList.toggle('is-warn', delayChance > 0 && load < 1);
  loadLine.classList.toggle('is-over', load >= 1);

  const held = slotsHeld(state, iata);
  const [next] = nextSlotFees(state, iata, 1);
  const nextText = next === null ? 'full' : next === 0 ? 'next pair free' : `next pair ${money(next)}/day`;
  const slotsLine = lineWithInfo(
    held > 0 ? `Slots ${held} pair${held === 1 ? '' : 's'} · ${money(slotFeesPerDayAt(state, iata))}/day · ${nextText}` : `Slots none held · ${nextText}`,
    'Each daily departure needs a slot pair. The first pair at an airport nobody serves is free; after that the fee rises with how busy the field is, and is locked when taken. Unused slots are released at midnight.',
  );
  return [loadLine, hourStrip(hours), slotsLine];
}

/**
 * The airport's day by the hour, 06:00–22:00: a column per hour, yours
 * (blue) and rivals' (grey) stacked on one scale, with the hour's room as
 * a dashed line and a y-axis in movements. Pointing at a column puts its
 * numbers in the line under the chart; otherwise that line reads the
 * busiest hour.
 */
function hourStrip(hours: AirportHours): HTMLElement {
  const openHours = Array.from({ length: OPEN_HOURS }, (_, i) => FIRST_OPEN_HOUR + i);
  const capacity = hours.capacity[FIRST_OPEN_HOUR];
  const top = Math.max(1, capacity, ...openHours.map((hour) => hours.mine[hour] + hours.rivals[hour]));
  const pct = (n: number) => `${(n / top) * 100}%`;
  const one = (n: number) => String(Math.round(n * 10) / 10);
  const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  const describe = (hour: number) =>
    `${hourText(hour)} · you ${hours.mine[hour]} · rivals ${one(hours.rivals[hour])} · room ${Math.max(0, freeInHour(hours, hour))} of ${one(capacity)}`;

  const wrap = document.createElement('div');
  wrap.className = 'hour-chart';
  const axis = document.createElement('div');
  axis.className = 'hour-axis';
  for (const [value, label] of [
    [top, one(top)],
    [0, '0'],
  ] as const) {
    const tick = document.createElement('span');
    tick.style.bottom = pct(value);
    tick.textContent = label;
    axis.append(tick);
  }
  const strip = document.createElement('div');
  strip.className = 'hour-strip';
  const capLine = document.createElement('span');
  capLine.className = 'hour-strip-cap';
  capLine.style.bottom = pct(capacity);
  capLine.title = `Room ${one(capacity)} movements an hour`;
  strip.append(capLine);

  const readout = line('', 'inspector-line hour-readout');
  const peak = peakHour(hours).hour;
  const rest = `Peak ${describe(peak)}`;
  readout.textContent = rest;

  for (const hour of openHours) {
    const mine = hours.mine[hour];
    const rivals = hours.rivals[hour];
    const column = document.createElement('div');
    column.className = 'hour-strip-col';
    column.classList.toggle('is-full', freeInHour(hours, hour) < 1);
    column.classList.toggle('is-over', mine + rivals > capacity + 1e-6);
    const mineEl = document.createElement('span');
    mineEl.className = 'hour-strip-mine';
    mineEl.style.height = pct(mine);
    const rivalEl = document.createElement('span');
    rivalEl.className = 'hour-strip-rivals';
    rivalEl.style.height = pct(rivals);
    column.append(rivalEl, mineEl);
    column.addEventListener('mouseenter', () => {
      readout.textContent = describe(hour);
      column.classList.add('is-hover');
    });
    column.addEventListener('mouseleave', () => {
      readout.textContent = rest;
      column.classList.remove('is-hover');
    });
    if (hour % 4 === 2) {
      const tick = document.createElement('span');
      tick.className = 'hour-strip-tick';
      tick.textContent = String(hour).padStart(2, '0');
      column.append(tick);
    }
    strip.append(column);
  }
  wrap.append(axis, strip);
  const block = document.createElement('div');
  block.append(wrap, readout);
  return block;
}

/**
 * Planes based here that are grounded with an AOG (sim/aog.ts), one line
 * each; the repair and the button to expedite it are on the Maintenance
 * screen, where every AOG is.
 */
function groundedPlanes(state: SimState, iata: string): HTMLElement[] {
  return state.aogs
    .filter((event) => event.base === iata)
    .map((event) => {
      const row = line('', 'inspector-line is-over');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'inspector-link';
      link.textContent = `AOG · ${event.tail} · ${event.fault} · back ${daysUntilReturn(state, event)}d · Mtc ›`;
      link.addEventListener('click', () => select({ kind: 'maintenance' }));
      row.append(link);
      return row;
    });
}

/**
 * The Plan hub button (ui/hubPlanner.ts), on every airport you fly to,
 * coloured by how much value sim/hubPlanner.ts finds being missed there:
 * plain when the hub is fine, yellow when it's worth a look, red when it's
 * worth acting on. Null where you don't fly.
 */
function planHubButton(state: SimState, iata: string, changed: () => void): HTMLButtonElement | null {
  if (!hasHubView(state, iata)) return null;
  const plan = planHub(state, iata);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.classList.toggle('is-warn', plan.urgency === 'warn');
  button.classList.toggle('is-act', plan.urgency === 'act');
  button.textContent = plan.urgency === 'none' ? 'Plan hub' : `Plan hub · ~${shortMoney(plan.missedPerDay)}/day missed`;
  button.addEventListener('click', () => openHubPlanner(state, iata, changed));
  return button;
}

/**
 * Every market flown from this airport, busiest first: flights a day and
 * the last finished day's margin. Each row opens that route's view, a way
 * in that doesn't depend on hitting a thin line on the map.
 */
function marketRows(state: SimState, iata: string): HTMLElement {
  const flightsByOther = new Map<string, number>();
  for (const leg of state.schedule) {
    if (leg.origin === iata) flightsByOther.set(leg.dest, (flightsByOther.get(leg.dest) ?? 0) + 1);
    else if (leg.dest === iata) flightsByOther.set(leg.origin, (flightsByOther.get(leg.origin) ?? 0) + 1);
  }
  const list = document.createElement('div');
  list.className = 'inspector-rows';
  const markets = [...flightsByOther.entries()].sort((a, b) => b[1] - a[1]);
  if (markets.length === 0) {
    list.append(line('None'));
    return list;
  }
  for (const [other, flights] of markets) {
    const margins = ops.marketPnlHistory(state, iata, other).margin;
    const lastMargin = margins.length > 0 ? margins[margins.length - 1] : null;
    const row = linkToMap(document.createElement('button'), { kind: 'route', a: iata, b: other });
    row.type = 'button';
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.textContent = `${iata} – ${other}`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    const load = marketLoadFactor(state, iata, other);
    detail.textContent =
      `${flights}/day · LF ${formatLoadFactor(load)} · NPS ${formatNps(marketNps(state, iata, other))}` + (lastMargin === null ? '' : ` · ${pnlMoney(lastMargin)} yday`);
    if (lastMargin !== null && lastMargin < 0) detail.classList.add('is-over');
    row.append(name, detail);
    row.addEventListener('click', () => select({ kind: 'route', a: iata, b: other }));
    list.append(row);
  }
  return list;
}
