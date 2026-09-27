import { airportLoad, dailyMovementsAt, slotCapacityPerDay } from '../../sim/airports';
import { daysUntilReturn, expediteCost, expediteRepair } from '../../sim/aog';
import { congestionParameters } from '../../sim/delays';
import { connectingPassengersThrough } from '../../sim/hubs';
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

/**
 * Build the view. `changed` is called after the player changes something
 * from inside it (an expedited repair, the hub planner), so the inspector
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
      `${presence.level} · ${presence.departures} departure${presence.departures === 1 ? '' : 's'}/day` +
        (connecting > 0 ? ` · ${connecting} connecting/day (${HUB_STYLES[hubStyleAt(state, iata)].name})` : ''),
    ),
  );

  // How many people want to fly from here, in words (sim/marketSize.ts);
  // the passengers you turn away are yours to count, so they stay a number.
  const unmet = unmetDemandByAirport(state).get(iata);
  if (unmet) {
    root.append(
      line(
        `Waiting to fly: ${airportDemandSize(unmet.latent)}` +
          (unmet.spilled >= 1 ? ` · you turn away ${Math.round(unmet.spilled).toLocaleString()} a day` : ''),
        unmet.spilled >= 1 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

  // How starved the airport is for service (sim/serviceLevel.ts): in
  // words, not numbers, since it's a judgement about where to go next.
  const service = describeServiceLevel(hungerAt(state, iata));
  root.append(line(`${service.label}: ${service.description}.`));

  root.append(...loadAndSlots(state, iata));
  root.append(...groundedPlanes(state, iata, changed));

  const hubButton = planHubButton(state, iata, changed);
  if (hubButton) root.append(hubButton);

  // The planes based here, pooled by class.
  const pools = document.createElement('div');
  pools.className = 'inspector-pools';
  const redrawPools = () => {
    pools.replaceChildren(...buildPoolRows(utilisationPools(state, iata), getMapPreview()?.effects, iata));
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
    root.append(line('No aircraft based here.'));
  }

  root.append(heading('Markets'), marketRows(state, iata));
  return { root, redrawPools };
}

/**
 * How busy the field is against its capacity (sim/airports.ts), what that
 * costs in congestion delays (the glow around the airport on the map,
 * spelled out), and what slots here cost (sim/slots.ts), priced from the
 * same traffic.
 */
function loadAndSlots(state: SimState, iata: string): HTMLElement[] {
  const load = airportLoad(state, iata);
  const { delayChance, maxDelayMinutes } = congestionParameters(load);
  const loadLine = line(
    `Airport load: ${Math.round(load * 100)}% at peak (${dailyMovementsAt(state, iata)} movements a day; slots stop at ${slotCapacityPerDay(state, iata)})` +
      (delayChance > 0
        ? `. Congestion delays ${Math.round(delayChance * 100)}% of flights here, up to ${maxDelayMinutes} min.`
        : '. No congestion.'),
  );
  loadLine.classList.toggle('is-warn', delayChance > 0 && load < 1);
  loadLine.classList.toggle('is-over', load >= 1);

  const held = slotsHeld(state, iata);
  const [next] = nextSlotFees(state, iata, 1);
  const nextText = next === null ? 'no slots left' : next === 0 ? 'next pair free' : `next pair $${next.toLocaleString()}/day`;
  const slotsLine = line(
    held > 0
      ? `Slots: ${held} pair${held === 1 ? '' : 's'} held, $${slotFeesPerDayAt(state, iata).toLocaleString()}/day · ${nextText}.`
      : `Slots: none held · ${nextText}.`,
  );
  return [loadLine, slotsLine];
}

/**
 * Planes based here that are grounded with an AOG (sim/aog.ts): what's
 * wrong, when they're back, and a button to pay for a day sooner. What
 * each AOG cancels goes in the ticker, not here.
 */
function groundedPlanes(state: SimState, iata: string, changed: () => void): HTMLElement[] {
  return state.aogs
    .filter((event) => event.base === iata)
    .map((event) => {
      const row = document.createElement('div');
      row.className = 'airport-aog-row';
      const days = daysUntilReturn(state, event);
      const text = document.createElement('span');
      text.textContent = `${event.tail} AOG (${event.fault}), back in ${days} day${days === 1 ? '' : 's'}`;
      row.append(text);
      const cost = expediteCost(state, event.tail);
      if (cost !== null) {
        const expedite = document.createElement('button');
        expedite.type = 'button';
        expedite.textContent = `Expedite: $${cost.toLocaleString()} for a day sooner`;
        expedite.disabled = state.cash < cost;
        if (expedite.disabled) expedite.title = `Needs $${cost.toLocaleString()} on hand.`;
        expedite.addEventListener('click', () => {
          expediteRepair(state, event.tail);
          changed();
        });
        row.append(expedite);
      }
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
  button.textContent = plan.urgency === 'none' ? 'Plan hub' : `Plan hub · about $${Math.round(plan.missedPerDay).toLocaleString()}/day missed`;
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
    list.append(line('No markets served.'));
    return list;
  }
  for (const [other, flights] of markets) {
    const margins = ops.marketPnlHistory(state, iata, other).margin;
    const lastMargin = margins.length > 0 ? margins[margins.length - 1] : null;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'inspector-row';
    const name = document.createElement('span');
    name.textContent = `${iata} – ${other}`;
    const detail = document.createElement('span');
    detail.className = 'inspector-row-detail';
    const load = marketLoadFactor(state, iata, other);
    detail.textContent =
      `${flights} flight${flights === 1 ? '' : 's'}/day · ${formatLoadFactor(load)} full` + (lastMargin === null ? '' : ` · ${pnlMoney(lastMargin)} yesterday`);
    if (lastMargin !== null && lastMargin < 0) detail.classList.add('is-over');
    row.append(name, detail);
    row.addEventListener('click', () => select({ kind: 'route', a: iata, b: other }));
    list.append(row);
  }
  return list;
}
