import { forecastStance, type StanceForecast } from '../../sim/fareForecast';
import { rivalYieldFactor } from '../../sim/pressure';
import { policyFare, setFareStance, setHandFare, setMarketingSpend } from '../../sim/pricing';
import { demandAgainstSeats, marketSize } from '../../sim/marketSize';
import { summarizeMarket } from '../../sim/marketSummary';
import { rivalResponseChance } from '../../sim/rivalResponse';
import { routeFixedCosts } from '../../sim/routeCosts';
import { reliabilityDemandFactor, trailingMarketOtp } from '../../sim/routeOtp';
import { legsServingMarket, marketKey, recommendedFare } from '../../sim/schedule';
import type { FareStance, SimState } from '../../sim/state';
import { utilisationPools } from '../../sim/utilisation';
import { onTimeColor } from '../../render/mapmodes';
import { getMapPreview } from '../../render/preview';
import { WINDOW_DAYS, buildBipolarBars, dayLabel, money as pnlMoney } from '../pnlBars';
import { buildPoolRows } from '../poolBars';
import * as ops from '../routeActions';
import { rivalLinksOn } from './rival';

/**
 * The inspector's view of one route (ui/inspector/inspector.ts): what
 * flies it, its demand and rivals, the fare stances, the planes it draws
 * on, and its last week of margin and reliability. Built fresh from
 * `state` each time the inspector re-renders; nothing here is kept
 * between renders except the handle for redrawing the pools.
 */

export type RouteView = {
  root: HTMLElement;
  /** Redraw the plane pools with whatever the hovered radial button would change. */
  redrawPools: () => void;
};

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function signedMoney(amount: number): string {
  return `${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}`;
}

function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Build the view. `changed` is called after the player changes something
 * from inside it (a fare stance), so the inspector can rebuild.
 */
export function buildRouteView(state: SimState, a: string, b: string, changed: () => void): RouteView {
  const root = document.createElement('div');
  root.className = 'inspector-view';

  const summary = ops.summariseMarket(state, a, b);
  const readout = ops.marketReadout(state, a, b);

  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = `${a} – ${b}`;
  root.append(title);

  // Flights that should have flown and didn't: everything below that
  // forecasts a day assumes they operate, so say so first.
  const reliability = state.onTimeHistoryByMarket[marketKey(a, b)];
  const days = Math.min(WINDOW_DAYS, reliability?.arrived.length ?? 0);
  const operated = (reliability?.arrived.slice(-days) ?? []).reduce((sum, n) => sum + n, 0);
  if (days >= 2 && operated === 0) {
    root.append(
      line(
        `None of this route's flights has operated in the last ${days} days. The numbers below assume they do: see why under On-time.`,
        'inspector-line is-over',
      ),
    );
  }

  const fill = demandAgainstSeats(state, a, b, readout.legs, readout.seatsPerFlight);
  const short = fill.short;
  const presence = line(
    `${summary.rotations.length} flight${summary.rotations.length === 1 ? '' : 's'}/day · ${summary.byClass.map((c) => `${c.name} x${c.count}`).join(', ')}`,
  );
  presence.classList.toggle('is-over', short);
  root.append(presence);

  // The market in words (sim/marketSize.ts): how big the city pair is, and
  // how full a flight is today. A route you have only just opened has
  // almost no demand, however big the city pair is: demand is built by
  // flying it, over weeks (sim/marketDemand.ts). Saying so is what stops a
  // Huge market from reading as "add ten flights".
  root.append(
    line(
      `${marketSize(state, a, b)} market · ${readout.seatsPerFlight} seats a flight, ${fill.words}.` +
        (short ? ' Add a flight or a bigger plane.' : '') +
        (fill.thin ? ' It grows as you fly it: extra flights fly emptier for now.' : ''),
    ),
  );

  const rivals = state.competitorRoutes.filter(
    (route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a),
  );
  if (rivals.length > 0) {
    const factor = rivalYieldFactor(a, b, legsServingMarket(a, b, state.schedule), state.competitorRoutes);
    const cut = Math.round((1 - factor) * 100);
    // Their fare moves in response to yours (sim/competitors.ts), so it's
    // shown next to what you charge. Each name opens that rival's view.
    const rivalsLine = line('', 'inspector-line is-warn');
    rivalsLine.append(
      'Rivals: ',
      ...rivalLinksOn(state, a, b),
      ` (you: $${(state.routeSettings[marketKey(a, b)]?.fare ?? 0).toLocaleString()})` +
        (cut > 0 ? `. They cut your fares ${cut}%: more flights of your own reduce it.` : ''),
    );
    root.append(rivalsLine);
  }

  // Full and priced at a premium: rivals are coming for the passengers
  // this route turns away (sim/rivalResponse.ts). Said here, since the
  // fix (a flight, a bigger plane, or a lower fare) is on the route's ring.
  const response = rivalResponseChance(state, a, b);
  if (response > 0) {
    root.append(
      line(
        `Full and priced ${Math.round((state.routeSettings[marketKey(a, b)].fare / recommendedFare(a, b) - 1) * 100)}% above the going rate: rivals are adding flights to take the passengers you turn away (${Math.round(response * 100)}% chance a day).`,
        'inspector-line is-warn',
      ),
    );
  }

  const stances = buildStances(state, a, b, changed);
  if (stances) root.append(stances);
  root.append(...buildFareAndMarketing(state, a, b, changed));

  // The planes this route draws on, pooled at its base.
  const base = ops.routeBase(state, a, b);
  const poolsHeading = line(base ? `Planes based at ${base}:` : '');
  const pools = document.createElement('div');
  pools.className = 'inspector-pools';
  const redrawPools = () => {
    pools.replaceChildren(...(base ? buildPoolRows(utilisationPools(state, base), getMapPreview()?.effects, base) : []));
  };
  redrawPools();
  if (base) root.append(poolsHeading, pools);

  const history = buildRouteHistory(state, a, b);
  if (history) root.append(history);
  root.append(buildRouteOtp(state, a, b));

  return { root, redrawPools };
}

/** Fare slider range around the policy fare, and its step. */
const FARE_STEP = 5;
const FARE_MIN_FACTOR = 0.5;
const FARE_MAX_FACTOR = 1.5;
const MARKETING_STEP = 50;
const MARKETING_MAX = 1000;

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * The market's day at its current settings (sim/marketSummary.ts), in one
 * line, and under it what the route costs beyond its own flights: its
 * share of slot fees at each end and of its planes' class leases
 * (sim/routeCosts.ts), and the margin once they're paid.
 */
function describeEconomics(state: SimState, a: string, b: string): { text: string; losing: boolean; fixed: string; fullyLosing: boolean } {
  const settings = state.routeSettings[marketKey(a, b)];
  const summary = summarizeMarket(a, b, state, settings);
  const load = summary.totalSeats > 0 ? summary.pax / summary.totalSeats : 0;
  const costs = routeFixedCosts(state, a, b);
  const fullMargin = summary.margin - costs.slotsPerDay - costs.leasePerDay;
  const slotParts = costs.slots.filter((slot) => slot.perDay >= 0.5).map((slot) => `${slot.iata} ${money(slot.perDay)}`);
  const leaseParts = costs.lease.map(
    (entry) => `${entry.className} ${money(entry.perDay)} (${Math.round(entry.share * 100)}% of the class's flying, which uses ${Math.round(entry.poolUse * 100)}% of its day)`,
  );
  return {
    text:
      `A day at these settings: ${summary.pax} passengers, ${Math.round(load * 100)}% full, ${Math.round(summary.share * 100)}% share · ` +
      `${money(summary.revenue)} revenue, ${money(summary.cost)} cost, ${signedMoney(summary.margin)} margin · ` +
      (summary.seatCapped ? 'seats are the limit.' : 'demand is the limit.'),
    losing: summary.margin < 0,
    fixed:
      `After its share of fixed costs: ${signedMoney(fullMargin)}/day. ` +
      `Slots ${money(costs.slotsPerDay)}${slotParts.length > 0 ? ` (${slotParts.join(', ')})` : ''} · ` +
      `lease ${money(costs.leasePerDay)}${leaseParts.length > 0 ? `: ${leaseParts.join('; ')}` : ''}.`,
    fullyLosing: fullMargin < 0,
  };
}

/**
 * The market's two levers: its fare (set by hand here, which takes it off
 * the policy and off any stance) and its daily marketing spend
 * (sim/marketDemand.ts), with what a day looks like at the current
 * settings. Dragging updates the numbers in place; the whole view rebuilds
 * on release, so a rebuild never takes a slider out from under the pointer.
 */
function buildFareAndMarketing(state: SimState, a: string, b: string, changed: () => void): HTMLElement[] {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings) return [];

  const heading = document.createElement('h2');
  heading.textContent = 'Fare and marketing';

  const economics = line('');
  const fixedCosts = line('');
  fixedCosts.title =
    'Slot fees and leases are paid airline-wide each midnight. Slot fees are shared by each airport\'s movements; ' +
    'a class\'s leases by the minutes its planes fly, so flying a class less puts more of its lease on each route.';
  const redrawEconomics = () => {
    const { text, losing, fixed, fullyLosing } = describeEconomics(state, a, b);
    economics.textContent = text;
    economics.classList.toggle('is-over', losing);
    fixedCosts.textContent = fixed;
    fixedCosts.classList.toggle('is-over', fullyLosing);
  };

  // Fare: centred on the policy fare, stretched to include the current
  // fare if a stance has taken it outside that range.
  const base = policyFare(state, a, b);
  const fareSlider = document.createElement('input');
  fareSlider.type = 'range';
  fareSlider.step = String(FARE_STEP);
  fareSlider.min = String(Math.min(roundToStep(base * FARE_MIN_FACTOR, FARE_STEP), settings.fare));
  fareSlider.max = String(Math.max(roundToStep(base * FARE_MAX_FACTOR, FARE_STEP), settings.fare));
  fareSlider.value = String(settings.fare);
  fareSlider.setAttribute('aria-label', 'Fare');
  const fareValue = document.createElement('span');
  fareValue.className = 'lever-value';
  const pricedBy = () =>
    settings.fareIsOverridden ? 'by hand' : settings.fareStance ? (STANCES.find((s) => s.stance === settings.fareStance)?.name ?? '') : 'policy';
  const redrawFare = () => {
    fareValue.textContent = `$${settings.fare} · ${pricedBy()}`;
    fareValue.classList.toggle('lever-value--overridden', settings.fareIsOverridden);
  };
  fareSlider.addEventListener('input', () => {
    setHandFare(state, a, b, Number(fareSlider.value));
    redrawFare();
    redrawEconomics();
  });
  fareSlider.addEventListener('change', changed);
  const fareRow = document.createElement('div');
  fareRow.className = 'inspector-lever';
  const fareLabel = document.createElement('span');
  fareLabel.className = 'lever-label';
  fareLabel.textContent = 'Fare';
  fareRow.append(fareLabel, fareSlider, fareValue);
  if (settings.fareIsOverridden || settings.fareStance) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'lever-reset';
    reset.textContent = 'Policy';
    reset.title = `Back to the airline-wide fare policy ($${base})`;
    reset.addEventListener('click', () => {
      setFareStance(state, a, b, null);
      changed();
    });
    fareRow.append(reset);
  }

  const marketingSlider = document.createElement('input');
  marketingSlider.type = 'range';
  marketingSlider.min = '0';
  marketingSlider.max = String(MARKETING_MAX);
  marketingSlider.step = String(MARKETING_STEP);
  marketingSlider.value = String(settings.marketingSpend);
  marketingSlider.setAttribute('aria-label', 'Marketing spend');
  const marketingValue = document.createElement('span');
  marketingValue.className = 'lever-value';
  const redrawMarketing = () => {
    marketingValue.textContent = `$${settings.marketingSpend}/day`;
  };
  marketingSlider.addEventListener('input', () => {
    setMarketingSpend(state, a, b, Number(marketingSlider.value));
    redrawMarketing();
    redrawEconomics();
  });
  marketingSlider.addEventListener('change', changed);
  const marketingRow = document.createElement('div');
  marketingRow.className = 'inspector-lever';
  const marketingLabel = document.createElement('span');
  marketingLabel.className = 'lever-label';
  marketingLabel.textContent = 'Marketing';
  marketingRow.append(marketingLabel, marketingSlider, marketingValue);

  redrawFare();
  redrawMarketing();
  redrawEconomics();
  return [heading, fareRow, marketingRow, economics, fixedCosts];
}

const STANCES: { stance: FareStance; name: string }[] = [
  { stance: 'undercut', name: 'Undercut' },
  { stance: 'match', name: 'Match' },
  { stance: 'premium', name: 'Premium' },
];

/** One stance's forecast in a line: your fare and margin, then each rival's. */
function describeForecast(forecast: StanceForecast): string {
  const rivals = forecast.rivals.map((rival) =>
    rival.closesInDays !== null
      ? `${rival.airline} $${rival.fare}, ${signedMoney(rival.margin)}/day, gone in about ${rival.closesInDays} days`
      : `${rival.airline} $${rival.fare}, ${signedMoney(rival.margin)}/day`,
  );
  const response = forecast.responseChance > 0 ? ` · ${Math.round(forecast.responseChance * 100)}% a day they add a flight` : '';
  return `You $${forecast.fare}, ${signedMoney(forecast.margin)}/day · ${rivals.join('; ')}${response}`;
}

/**
 * On a market a rival also flies: the three fare stances (sim/pricing.ts),
 * each with where it would settle (sim/fareForecast.ts), and buttons to
 * pick one. Picking re-prices the market now and every day after. Null on
 * a market nobody else flies.
 */
function buildStances(state: SimState, a: string, b: string, changed: () => void): HTMLElement | null {
  const settings = state.routeSettings[marketKey(a, b)];
  const contested = state.competitorRoutes.some(
    (route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a),
  );
  if (!settings || !contested) return null;

  const block = document.createElement('div');
  block.className = 'stance-block';

  const current = STANCES.find((s) => s.stance === settings.fareStance);
  const heading = document.createElement('div');
  heading.className = 'stance-heading';
  heading.textContent = `Pricing against rivals: ${current ? current.name : settings.fareIsOverridden ? 'your own fare' : 'fare policy'} ($${settings.fare}). If nothing else changes:`;
  block.append(heading);

  for (const { stance, name } of STANCES) {
    const row = document.createElement('div');
    row.className = 'stance-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stance-button';
    button.classList.toggle('is-active', settings.fareStance === stance);
    button.textContent = name;
    button.addEventListener('click', () => {
      setFareStance(state, a, b, stance);
      changed();
    });
    const outcome = document.createElement('span');
    outcome.className = 'stance-outcome';
    outcome.textContent = describeForecast(forecastStance(state, a, b, stance));
    row.append(button, outcome);
    block.append(row);
  }

  if (current) {
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'stance-off';
    off.textContent = 'Back to fare policy';
    off.addEventListener('click', () => {
      setFareStance(state, a, b, null);
      changed();
    });
    block.append(off);
  }
  return block;
}

/**
 * This route's own recent trend: the route equivalent of the network's
 * "Last 7 Days" Margin chart (ui/pnlHistory.ts), sharing its bars
 * (ui/pnlBars.ts). Revenue and cost ride along in each bar's tooltip.
 * Null before the route has a finished day.
 */
function buildRouteHistory(state: SimState, a: string, b: string): HTMLElement | null {
  const history = ops.marketPnlHistory(state, a, b);
  const shownMargin = history.margin.slice(-WINDOW_DAYS);
  const shownRevenue = history.revenue.slice(-WINDOW_DAYS);
  const shownCost = history.cost.slice(-WINDOW_DAYS);
  if (shownMargin.length === 0) return null;

  const chart = document.createElement('div');
  chart.className = 'inspector-chart';
  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = 'Margin, last 7 days';
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  statEl.textContent = pnlMoney(shownMargin[shownMargin.length - 1]);
  header.append(labelEl, statEl);

  const bars = buildBipolarBars(shownMargin, (value, indexFromEnd) => {
    const i = shownMargin.length - indexFromEnd;
    return `${dayLabel(indexFromEnd)}: ${pnlMoney(shownRevenue[i])} revenue, ${pnlMoney(shownCost[i])} cost, ${pnlMoney(value)} margin`;
  });
  chart.append(header, bars);
  return chart;
}

/**
 * This route's reliability, day by day, and what it's doing to demand:
 * the evidence for deciding where a turn buffer is worth its aircraft
 * time. Bars are each finished day's on-time share, coloured on the same
 * scale as the On-Time map mode, so a red bar here is a red route there.
 */
function buildRouteOtp(state: SimState, a: string, b: string): HTMLElement {
  const history = state.onTimeHistoryByMarket[marketKey(a, b)];
  const arrived = history?.arrived.slice(-WINDOW_DAYS) ?? [];
  const onTime = history?.onTime.slice(-WINDOW_DAYS) ?? [];
  const cancelled = history?.cancelled.slice(-WINDOW_DAYS) ?? [];
  const trailing = trailingMarketOtp(state, a, b);
  const buffer = ops.currentTurnBuffer(state, a, b);

  const chart = document.createElement('div');
  chart.className = 'inspector-chart';

  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = 'On-time, last 7 days';
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  statEl.textContent = trailing.otp === null ? '—' : `${Math.round(trailing.otp * 100)}%`;
  if (trailing.otp !== null) statEl.style.color = onTimeColor(trailing.otp);
  header.append(labelEl, statEl);
  chart.append(header);

  if (arrived.length > 0) {
    const bars = document.createElement('div');
    bars.className = 'pnl-chart-bars';
    // Each day's bar is the share of its scheduled flights that flew *and*
    // arrived on time: a cancellation counts against it (sim/routeOtp.ts).
    arrived.forEach((count, i) => {
      const cancelledThatDay = cancelled[i] ?? 0;
      const flights = count + cancelledThatDay;
      const bar = document.createElement('div');
      bar.className = 'pnl-chart-bar';
      const share = flights > 0 ? onTime[i] / flights : 0;
      bar.style.height = flights > 0 ? `${Math.max(share * 100, 4)}%` : '1px';
      bar.style.background = flights > 0 ? onTimeColor(share) : 'rgba(255, 255, 255, 0.15)';
      const cancelledNote = cancelledThatDay > 0 ? `, ${cancelledThatDay} cancelled` : '';
      bar.title = flights > 0
        ? `${dayLabel(arrived.length - i)}: ${onTime[i]} of ${flights} on time${cancelledNote}`
        : `${dayLabel(arrived.length - i)}: no flights`;
      bars.appendChild(bar);
    });
    chart.append(bars);
  }

  chart.append(
    line(
      buffer === 0
        ? 'Turn buffer: none. A late arrival here makes the next flight late.'
        : `Turn buffer: +${buffer} min of extra ground time after each flight.`,
      'route-otp-line',
    ),
  );
  if (trailing.cancelled > 0) {
    chart.append(line(`${trailing.cancelled} cancelled this week. Cancellations count against reliability.`, 'route-otp-line is-problem'));
  }

  const factor = reliabilityDemandFactor(trailing.otp);
  if (trailing.otp === null) {
    chart.append(line('Reliability starts to affect demand after a few more flights.', 'route-otp-line'));
  } else if (factor >= 1) {
    chart.append(line(`Reliable: demand is growing ${factor.toFixed(1)}x as fast.`, 'route-otp-line'));
  } else if (factor >= 0) {
    chart.append(line(`Delays have slowed demand growth to ${Math.round(factor * 100)}% of normal.`, 'route-otp-line is-warning'));
  } else {
    chart.append(line('Delays are driving passengers away: demand is shrinking.', 'route-otp-line is-problem'));
  }
  return chart;
}
