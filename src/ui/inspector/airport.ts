import { airportLoad, dailyMovementsAt, slotCapacityPerDay } from '../../sim/airports';
import { inboundAt } from '../../sim/fleetTiming';
import { money, shortMoney } from '../format';
import { crewShare } from '../../sim/crews';
import { line, heading, lineWithInfo } from './dom';
import { formatNps, marketNps } from '../../sim/nps';
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
import { linkToMap } from '../mapLink';
import { contractsOf } from '../../sim/contracts';

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
      `${presence.level} · ${presence.departures} dep/day` +
        (connecting > 0 ? ` · ${connecting} connecting/day · ${HUB_STYLES[hubStyleAt(state, iata)].name}` : ''),
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

  // Government contracts touching this airport (sim/contracts.ts).
  for (const contract of contractsOf(state)) {
    if ((contract.a !== iata && contract.b !== iata) || (contract.status !== 'offered' && contract.status !== 'active')) continue;
    root.append(
      lineWithInfo(
        contract.status === 'offered'
          ? `GOV offer · ${contract.a}–${contract.b} · ${money(contract.paymentPerDay)}/day · fly by day ${contract.offerEndsDay}`
          : `GOV contract · ${contract.a}–${contract.b} · ends day ${contract.endsDay}`,
        'A government route contract: its terms are in Head office. Flying the market both ways daily starts an offer.',
        'inspector-line is-good',
      ),
    );
  }
  root.append(...loadAndSlots(state, iata));
  root.append(...groundedPlanes(state, iata, changed));

  const hubButton = planHubButton(state, iata, changed);
  if (hubButton) root.append(hubButton);

  // The planes based here, pooled by class.
  const pools = document.createElement('div');
  pools.className = 'inspector-pools';
  const redrawPools = () => {
    pools.replaceChildren(...buildPoolRows(utilisationPools(state, iata), getMapPreview()?.effects, iata, (code) => crewShare(state, code, iata), (code) => inboundAt(state, iata, code).length));
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
  root.append(...crewSection(state, iata, changed));

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
  const loadLine = lineWithInfo(
    `Load ${Math.round(load * 100)}% at peak · ${dailyMovementsAt(state, iata)}/${slotCapacityPerDay(state, iata)} movements` +
      (delayChance > 0 ? ` · congestion delays ${Math.round(delayChance * 100)}% of flights, ≤${maxDelayMinutes} min` : ' · no congestion'),
    'Movements are every airline\'s takeoffs and landings a day. Slots stop at the second number. As the peak hour fills, congestion delays a growing share of flights: the glow around the airport on the map.',
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
      text.textContent = `AOG · ${event.tail} · ${event.fault} · back ${days}d`;
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

/**
 * The crew base here (sim/crews.ts), class by class: how its crews stand
 * against its planes (their bars are the thin ones under the plane pools
 * above), and buttons to hire, retrain from another class, or let crews
 * go. Nothing where there's no base.
 */
function crewSection(state: SimState, iata: string, changed: () => void): HTMLElement[] {
  const readout = ops.crewReadout(state, iata);
  if (!readout) return [];
  return [heading('Crews', crewExplanation(readout)), ...crewRows(state, iata, changed)];
}

/** How crews work, for the (i) beside a Crews heading. */
export function crewExplanation(readout: { leadDays: number; retrainDays: number }): string {
  return `Crews are rated for one class. Hiring takes ${readout.leadDays} days; retraining from another class takes ${readout.retrainDays} and costs half a hire. Enough crews keep shifts to 8 hours; fewer means late legs flown tired, and too few grounds planes. Spare crews cost standby pay.`;
}

/**
 * A base's crews, class by class: how they stand against its planes, and
 * buttons to hire, retrain from another class, or release. Shared by the
 * airport view and the Crews screen (ui/inspector/crews.ts).
 */
export function crewRows(state: SimState, iata: string, changed: () => void): HTMLElement[] {
  const readout = ops.crewReadout(state, iata);
  if (!readout) return [];
  const nodes: HTMLElement[] = [];
  const button = (label: string, disabled: boolean, act: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'inspector-plan-hub';
    el.textContent = label;
    el.disabled = disabled;
    el.addEventListener('click', () => {
      act();
      changed();
    });
    return el;
  };
  for (const crew of readout.classes) {
    const spare = crew.crews - crew.ideal;
    const joining = crew.arriving > 0 ? ` · +${crew.arriving} joining` : '';
    const status =
      crew.crews < crew.minimum
        ? `short · need ${crew.minimum} · planes grounded`
        : crew.crews < crew.ideal
          ? `stretched · ${crew.ideal} for 8h shifts`
          : spare > 0
            ? `${spare} spare · ${money(crew.standbyPerDay)}/day each`
            : crew.ideal > 0
              ? 'right-sized'
              : 'no planes here';
    nodes.push(line(`${crew.name} ×${crew.crews} · ${status}${joining}`, crew.crews < crew.minimum ? 'inspector-line is-over' : 'inspector-line'));
    const row = document.createElement('div');
    row.className = 'crew-buttons';
    row.append(button(`Hire 1 · ${money(crew.hireFee)}`, !crew.open || state.cash < crew.hireFee, () => ops.hireCrewsAt(state, iata, crew.classCode, 1)));
    // Retrain one from whichever other class has the most spare.
    const donor = readout.classes
      .filter((other) => other.classCode !== crew.classCode && other.crews - other.ideal > 0)
      .sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
    if (donor && crew.open) {
      row.append(button(`Retrain 1 from ${donor.name} · ${money(crew.retrainFee)}`, state.cash < crew.retrainFee, () => ops.retrainCrewsAt(state, iata, donor.classCode, crew.classCode, 1)));
    }
    if (spare > 0) row.append(button('Release 1', false, () => ops.releaseCrewsAt(state, iata, crew.classCode, 1)));
    nodes.push(row);
  }
  return nodes;
}
