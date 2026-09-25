import { forecastStance, type StanceForecast } from '../../sim/fareForecast';
import { rivalYieldFactor } from '../../sim/pressure';
import { setFareStance } from '../../sim/pricing';
import { rivalResponseChance } from '../../sim/rivalResponse';
import { reliabilityDemandFactor, trailingMarketOtp } from '../../sim/routeOtp';
import { legsServingMarket, marketKey, recommendedFare } from '../../sim/schedule';
import type { FareStance, SimState } from '../../sim/state';
import { utilisationPools } from '../../sim/utilisation';
import { onTimeColor } from '../../render/mapmodes';
import { getMapPreview } from '../../render/preview';
import { WINDOW_DAYS, buildBipolarBars, dayLabel, money as pnlMoney } from '../pnlBars';
import { buildPoolRows } from '../poolBars';
import * as ops from '../routeActions';

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

  const short = readout.demandNow > readout.seatsPerFlight;
  const presence = line(
    `${summary.rotations.length} flight${summary.rotations.length === 1 ? '' : 's'}/day · ${summary.byClass.map((c) => `${c.name} x${c.count}`).join(', ')}`,
  );
  presence.classList.toggle('is-over', short);
  root.append(presence);

  // A route you have only just opened has almost no demand, however big
  // the city pair is: demand is built by flying it, over weeks
  // (sim/marketDemand.ts). Saying so is what stops "20,000 potential" from
  // reading as "add ten flights".
  const young = readout.demandNow < 0.4 * readout.seatsPerFlight;
  root.append(
    line(
      `Per flight: ${readout.demandNow} passengers wanted${readout.demandPotential > readout.demandNow ? ` (${readout.demandPotential} potential)` : ''}, ${readout.seatsPerFlight} seats.` +
        (short ? ' Demand exceeds seats: add a flight or upgauge.' : '') +
        (young ? ' Demand is still growing: extra flights fly emptier for now.' : ''),
    ),
  );

  const rivals = state.competitorRoutes.filter(
    (route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a),
  );
  if (rivals.length > 0) {
    const factor = rivalYieldFactor(a, b, legsServingMarket(a, b, state.schedule), state.competitorRoutes);
    const cut = Math.round((1 - factor) * 100);
    root.append(
      line(
        // Their fare moves in response to yours (sim/competitors.ts), so
        // it's shown next to what you charge.
        `Rivals: ${rivals.map((r) => `${r.airline} ${r.dailyFrequency}/day at $${r.fare.toLocaleString()}`).join(', ')}` +
          ` (you: $${(state.routeSettings[marketKey(a, b)]?.fare ?? 0).toLocaleString()})` +
          (cut > 0 ? `. They cut your fares ${cut}%: more flights of your own reduce it.` : ''),
        'inspector-line is-warn',
      ),
    );
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
