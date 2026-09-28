import { forecastStance, type StanceForecast } from '../../sim/fareForecast';
import { inboundAt } from '../../sim/fleetTiming';
import { crewShare } from '../../sim/crews';
import { info, line, lineWithInfo } from './dom';
import { ON_TIME_GRACE_MINUTES } from '../../sim/delays';
import { money } from '../format';
import { RIVAL_SQUEEZED_RESPITE_DAYS } from '../../sim/pressure';
import { brandInWords, formatNps, marketNps, networkNps } from '../../sim/nps';
import { rivalYieldFactor } from '../../sim/pressure';
import { policyFare, setFareStance, setHandFare } from '../../sim/pricing';
import { demandAgainstSeats, marketSize } from '../../sim/marketSize';
import { summarizeMarket } from '../../sim/marketSummary';
import { formatLoadFactor, marketLoadFactor } from '../../sim/loadFactor';
import { moneyOnTable } from '../../sim/attractiveness';
import { describeShock } from '../../sim/shocks';
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
import { contractOn, paymentShare, performanceFactor } from '../../sim/contracts';

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

function signedMoney(amount: number): string {
  return `${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}`;
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
        `CNX · nothing operated in ${days}d · figures below assume it does · see On-time`,
        'inspector-line is-over',
      ),
    );
  }

  const fill = demandAgainstSeats(state, a, b, readout.legs, readout.seatsPerFlight);
  const short = fill.short;
  // Load factor (sim/loadFactor.ts), the route's headline number: how full
  // its planes flew over the last week, from its own landings.
  const load = marketLoadFactor(state, a, b);
  const presence = lineWithInfo(
    `${summary.rotations.length}/day · ${summary.byClass.map((c) => `${c.name} ×${c.count}`).join(', ')} · LF ${formatLoadFactor(load)}`,
    load.factor === null
      ? 'Load factor (LF): how full the planes fly, from the last 7 days of landings. None landed yet.'
      : `Load factor (LF): ${load.passengers.toLocaleString()} passengers in ${load.seats.toLocaleString()} seats over the last 7 days.`,
  );
  presence.classList.toggle('is-over', short);
  root.append(presence);

  // NPS (sim/nps.ts): how passengers rate the airline here, about the last
  // month, and what that does against a rival.
  const brand = brandInWords(state, a, b, state.competitorRoutes);
  root.append(
    lineWithInfo(
      `NPS ${formatNps(marketNps(state, a, b))} · airline ${formatNps(networkNps(state))}${brand ? ` · ${brand}` : ''}`,
      'Net Promoter Score: how passengers rate you here over about the last month. Late flights, old planes and fares above the rivals\' pull it down. Against a rival, the better name wins some of the other\'s passengers.',
    ),
  );

  // The market in words (sim/marketSize.ts): how big the city pair is, and
  // how full a flight is today. A route you have only just opened has
  // almost no demand, however big the city pair is: demand is built by
  // flying it, over weeks (sim/marketDemand.ts). Saying so is what stops a
  // Huge market from reading as "add ten flights".
  // Once the route has flown, its load factor above says how full it is;
  // the forecast in words is only for a route with no record yet.
  const fillWords = load.factor === null ? ` · ${fill.words}` : '';
  root.append(
    lineWithInfo(
      `${marketSize(state, a, b)} market · ${readout.seatsPerFlight} seats/flight${fillWords}` +
        (short ? ' · demand exceeds seats' : '') +
        (fill.thin ? ' · still growing' : ''),
      'A market\'s demand is built by flying it, over weeks, toward the size of the city pair. When demand exceeds seats, add a flight or a bigger plane; while it is still growing, extra flights fly emptier.',
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
      'Rivals ',
      ...rivalLinksOn(state, a, b),
      ` · you $${(state.routeSettings[marketKey(a, b)]?.fare ?? 0).toLocaleString()}` + (cut > 0 ? ` · your fares −${cut}%` : ''),
    );
    if (cut > 0) rivalsLine.append(' ', info('Rival flights on a market pull your fares down. More flights of your own reduce the cut.'));
    root.append(rivalsLine);
  }

  // Full and priced at a premium: rivals are coming for the passengers
  // this route turns away (sim/rivalResponse.ts). Said here, since the
  // fix (a flight, a bigger plane, or a lower fare) is on the route's ring.
  const response = rivalResponseChance(state, a, b);
  if (response > 0) {
    root.append(
      line(
        `Full at +${Math.round((state.routeSettings[marketKey(a, b)].fare / recommendedFare(a, b) - 1) * 100)}% over the going rate · rivals adding flights · ${Math.round(response * 100)}%/day`,
        'inspector-line is-warn',
      ),
    );
  }

  // A government contract on this market (sim/contracts.ts): the offer's
  // terms, or how the running one is paying.
  const contract = contractOn(state, a, b);
  if (contract) {
    const performance = performanceFactor(state, contract);
    root.append(
      lineWithInfo(
        contract.status === 'offered'
          ? `GOV offer · ${money(contract.paymentPerDay)}/day · ${contract.ridersPerDay} riders · ${contract.termDays}d · fly by day ${contract.offerEndsDay}`
          : `GOV contract · pay ${Math.round(paymentShare(performance) * 100)}% · riders ${Math.round(contract.ridersPerDay * performance)}/${contract.ridersPerDay} · ends day ${contract.endsDay}`,
        'A government route contract: see Head office for its terms. The riders and half the pay depend on on-time, completion and NPS against stricter bars than ordinary passengers; when it ends without renewal, this market\'s demand drops.',
        contract.status === 'active' && performance < 0.5 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

  // A shock running now (sim/shocks.ts), if it touches this route.
  const shockLine = describeShock(state)?.onRoute(a, b);
  if (shockLine) root.append(line(shockLine, 'inspector-line is-warn'));

  const rivalsView = describeRivalsView(state, a, b);
  if (rivalsView) root.append(rivalsView);

  const stances = buildStances(state, a, b, changed);
  if (stances) root.append(stances);
  root.append(...buildFare(state, a, b, changed));

  // The planes this route draws on, pooled at its base.
  const base = ops.routeBase(state, a, b);
  const poolsHeading = line(base ? `Planes at ${base}` : '');
  const pools = document.createElement('div');
  pools.className = 'inspector-pools';
  const redrawPools = () => {
    pools.replaceChildren(...(base ? buildPoolRows(utilisationPools(state, base), getMapPreview()?.effects, base, (code) => crewShare(state, code, base), (code) => inboundAt(state, base, code).length) : []));
  };
  redrawPools();
  if (base) root.append(poolsHeading, pools);

  const history = buildRouteHistory(state, a, b);
  if (history) root.append(history);
  root.append(buildRouteOtp(state, a, b));

  return { root, redrawPools };
}

/**
 * The route as a rival sees it (sim/attractiveness.ts): the money it leaves
 * on the table and why, what the player's moats keep back, and what a
 * rival's slots would cost. The warning before anyone comes, and the
 * reason they would: turned-away passengers and a fat margin draw them;
 * more flights, a hub feeding the route, and dear or full slots keep them
 * out. Null when there's nothing on the table.
 */
function describeRivalsView(state: SimState, a: string, b: string): HTMLElement | null {
  const table = moneyOnTable(state, a, b);
  const draws: string[] = [];
  if (table.turnedAway >= 1) draws.push(`you turn away about ${Math.round(table.turnedAway)} passengers a day`);
  if (table.fullyCostedMargin > 0) draws.push(`you make ${money(table.fullyCostedMargin)} a day after costs`);
  if (draws.length === 0) return null;

  const kept: string[] = [`your frequency keeps ${Math.round(table.dominance * 100)}% of it`];
  if (table.hubFeed >= 0.01) kept.push(`your hub's connections ${Math.round(table.hubFeed * 100)}%`);
  if (table.loyalty > 0) kept.push(`your loyalty scheme ${Math.round(table.loyalty * 100)}%`);
  const slots =
    table.rivalSlotFees === null
      ? 'and an airport here is full, so no rival can get in'
      : `and a rival would pay ${money(table.rivalSlotFees)} a day in slots`;
  const text = table.perDay >= 1 ? `Rivals see ~${money(table.perDay)}/day here` : 'Rivals see nothing worth taking';
  const why =
    table.perDay >= 1
      ? `${capitalise(draws.join(' and '))}; ${kept.join(', ')}, ${slots}. Turned-away passengers and a fat margin draw rivals; more flights, a hub feeding the route, and dear or full slots keep them out.`
      : `${capitalise(draws.join(' and '))}, but ${kept.join(', ')}, ${slots}.`;
  return lineWithInfo(text, why, table.perDay >= RIVALS_VIEW_WARN_PER_DAY ? 'inspector-line is-warn' : 'inspector-line');
}

/** Money on the table (a day) at which the rivals' view turns amber: enough to be worth a rival's while. */
const RIVALS_VIEW_WARN_PER_DAY = 1000;

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fare slider range around the policy fare, and its step. */
const FARE_STEP = 5;
const FARE_MIN_FACTOR = 0.5;
const FARE_MAX_FACTOR = 1.5;

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * The market's day at its current settings (sim/marketSummary.ts), in one
 * line, and under it what the route costs beyond its own flights: its
 * share of slot fees at each end and of its planes' class leases
 * (sim/routeCosts.ts), and the margin once they're paid.
 */
function describeEconomics(state: SimState, a: string, b: string): { text: string; losing: boolean; fixed: string; fixedDetail: string; fullyLosing: boolean } {
  const settings = state.routeSettings[marketKey(a, b)];
  const summary = summarizeMarket(a, b, state, settings);
  const load = summary.totalSeats > 0 ? summary.pax / summary.totalSeats : 0;
  const costs = routeFixedCosts(state, a, b);
  const fullMargin = summary.margin - costs.slotsPerDay - costs.leasePerDay - costs.overheadPerDay;
  const slotParts = costs.slots.filter((slot) => slot.perDay >= 0.5).map((slot) => `${slot.iata} ${money(slot.perDay)}`);
  const leaseParts = costs.lease.map(
    (entry) => `${entry.className} ${money(entry.perDay)} (${Math.round(entry.share * 100)}% of the class's flying, which uses ${Math.round(entry.poolUse * 100)}% of its day)`,
  );
  return {
    text:
      `Per day · ${summary.pax} pax · LF ${Math.round(load * 100)}% · share ${Math.round(summary.share * 100)}% · ` +
      `rev ${money(summary.revenue)} · cost ${money(summary.cost)} · margin ${signedMoney(summary.margin)} · ` +
      (summary.seatCapped ? 'seat-capped' : 'demand-capped'),
    losing: summary.margin < 0,
    fixed:
      `Fully costed ${signedMoney(fullMargin)}/day · slots ${money(costs.slotsPerDay)} · lease ${money(costs.leasePerDay)} · overhead ${money(costs.overheadPerDay)}`,
    fixedDetail:
      (slotParts.length > 0 ? `Slots: ${slotParts.join(', ')}. ` : '') +
      (leaseParts.length > 0 ? `Lease: ${leaseParts.join('; ')}. ` : '') +
      'Slot fees, leases and network overhead are paid airline-wide each midnight. Slot fees are shared by each airport\'s movements; ' +
      'a class\'s leases by the minutes its planes fly, so flying a class less puts more of its lease on each route; ' +
      'overhead, which grows with the square of the fleet, by each route\'s share of all flying.',
    fullyLosing: fullMargin < 0,
  };
}

/**
 * The market's lever: its fare (set by hand here, which takes it off the
 * policy and off any stance), with what a day looks like at it. Dragging
 * updates the numbers in place; the whole view rebuilds on release, so a
 * rebuild never takes the slider out from under the pointer.
 */
function buildFare(state: SimState, a: string, b: string, changed: () => void): HTMLElement[] {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings) return [];

  const heading = document.createElement('h2');
  heading.textContent = 'Fare';

  const economics = line('');
  // The fully costed line keeps its (i) while the slider redraws its text.
  const fixedCosts = line('');
  const fixedText = document.createElement('span');
  const fixedInfo = info('');
  fixedCosts.append(fixedText, ' ', fixedInfo);
  const redrawEconomics = () => {
    const { text, losing, fixed, fixedDetail, fullyLosing } = describeEconomics(state, a, b);
    economics.textContent = text;
    economics.classList.toggle('is-over', losing);
    fixedText.textContent = fixed;
    fixedInfo.dataset.info = fixedDetail;
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

  redrawFare();
  redrawEconomics();
  return [heading, fareRow, economics, fixedCosts];
}

const STANCES: { stance: FareStance; name: string }[] = [
  { stance: 'undercut', name: 'Undercut' },
  { stance: 'match', name: 'Match' },
  { stance: 'premium', name: 'Premium' },
];

/** One stance's forecast in a line: your fare and margin, then each rival's. */
function describeForecast(forecast: StanceForecast): string {
  const rivals = forecast.rivals.map((rival) => {
    const adds = rival.flightsAdded >= 0.5 ? ` · +${Math.round(rival.flightsAdded)}/day` : '';
    const gone = rival.closesInDays !== null ? ` · exits ~${rival.closesInDays}d, then ${RIVAL_SQUEEZED_RESPITE_DAYS}d clear` : '';
    return `${rival.airline} $${rival.fare} ${signedMoney(rival.margin)}/day${adds}${gone}`;
  });
  const response = forecast.responseChance > 0 ? ` · ${Math.round(forecast.responseChance * 100)}%/day they add a flight` : '';
  return `You $${forecast.fare} ${signedMoney(forecast.margin)}/day · ${rivals.join('; ')}${response}`;
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
  heading.textContent = `Vs rivals · ${current ? current.name : settings.fareIsOverridden ? 'by hand' : 'policy'} · $${settings.fare}`;
  heading.append(
    ' ',
    info('A stance re-prices this market against its rivals every day. Each row is where it would settle if nothing else changes: your fare and margin, then each rival\'s, the flights it would add, and whether it would pull out.'),
  );
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
  labelEl.textContent = 'Margin · 7d';
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
  labelEl.textContent = 'On-time · 7d';
  labelEl.append(' ', info(`Each bar is a day: the share of scheduled flights that flew and arrived within ${ON_TIME_GRACE_MINUTES} minutes. Cancellations count against it. A reliable route grows its demand faster; a late one slows or shrinks it. A turn buffer adds ground time so one late arrival doesn't make the next flight late.`));
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
        ? 'Turn buffer none · delays carry to the next flight'
        : `Turn buffer +${buffer} min`,
      'route-otp-line',
    ),
  );
  if (trailing.cancelled > 0) {
    chart.append(line(`CNX ${trailing.cancelled} this week`, 'route-otp-line is-problem'));
  }

  const factor = reliabilityDemandFactor(trailing.otp);
  if (trailing.otp === null) {
    chart.append(line('Demand growth · too few flights to judge', 'route-otp-line'));
  } else if (factor >= 1) {
    chart.append(line(`Demand growth ×${factor.toFixed(1)} · reliable`, 'route-otp-line'));
  } else if (factor >= 0) {
    chart.append(line(`Demand growth ${Math.round(factor * 100)}% of normal · delays`, 'route-otp-line is-warning'));
  } else {
    chart.append(line('Demand shrinking · delays', 'route-otp-line is-problem'));
  }
  return chart;
}
