import { forecastStance, type StanceForecast } from '../../sim/fareForecast';
import { inboundAt } from '../../sim/fleetTiming';
import { crewShare } from '../../sim/crews';
import { info, line, lineWithInfo } from './dom';
import { ON_TIME_GRACE_MINUTES } from '../../sim/delays';
import { money } from '../format';
import { showConfirm } from '../confirmModal';
import { RIVAL_SQUEEZED_RESPITE_DAYS } from '../../sim/pressure';
import { brandInWords, formatNps, marketNps, networkNps } from '../../sim/nps';
import { rivalYieldFactor } from '../../sim/pressure';
import { policyFare, putSeatsOnPolicy, setFareClasses, setFareStance, setHandFare } from '../../sim/pricing';
import { CLASS_NAMES, CLASS_ORDER, CLASS_PRICE, DEFAULT_FARE_CLASSES, type FareClassTally } from '../../sim/fareClasses';
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
import { revenueHill, type RevenueHill } from '../../sim/revenueHill';
import { drawHillChart } from '../hillChart';
import { isSunRoute, marketSeasonOutlook } from '../../sim/seasons';
import { eventDraws, eventRunning, eventsOn } from '../../sim/demandEvents';
import { gameDate } from '../format';
import { fareWarOn, PEACE_LEVEL, WAR_LEVEL } from '../../sim/fareWars';
import { rivalRouteDailyResult } from '../../sim/rivalEconomics';
import { dayIndex } from '../../sim/clock';
import { effectiveFareClasses, saleBlockedReason, saleMarginChangePerDay, saleDaysLeft, SALE_COOLDOWN_DAYS, SALE_DAYS, SALE_GROWTH, SALE_SAVER_PRICE } from '../../sim/seatSale';
import { marketFareLevel } from '../../sim/fareStimulus';
import { CROWDING_WINDOW_MINUTES, crowdingWeight } from '../../sim/timeOfDay';
import { chartLegend } from '../chartLegend';
import { buildSeatSplitBar } from '../seatSplitBar';
import { formatFrequency, formatYield, marketYieldCents } from '../../sim/routeYield';
import { marketCharacterWord, marketMix } from '../../sim/marketCharacter';

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

/** Signed and short for a dense line: +$617, −$8.7k, +$12k. */
function shortSigned(amount: number): string {
  const size = Math.abs(amount);
  const text = size >= 10_000 ? `$${Math.round(size / 1000)}k` : size >= 1000 ? `$${(size / 1000).toFixed(1)}k` : `$${Math.round(size)}`;
  return `${amount < 0 ? '−' : '+'}${text}`;
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
    `${formatFrequency(state, a, b)} · ${summary.byClass.map((c) => `${c.name} ×${c.count}`).join(', ')} · LF ${formatLoadFactor(load)} · yield ${formatYield(marketYieldCents(state, a, b))}`,
    load.factor === null
      ? 'Load factor (LF): how full the planes fly, from the last 7 days of landings. None landed yet.'
      : `Load factor (LF): ${load.passengers.toLocaleString()} passengers in ${load.seats.toLocaleString()} seats over the last 7 days. Flights a day are counted each way. Yield: cents of fare per passenger per nautical mile, last 7 days.`,
  );
  presence.classList.toggle('is-over', short);
  root.append(presence);

  // NPS (sim/nps.ts): how passengers rate the airline here, about the last
  // month, and what that does against a rival.
  const brand = brandInWords(state, a, b, state.competitorRoutes);
  root.append(
    lineWithInfo(
      `NPS ${formatNps(marketNps(state, a, b))}${brand ? ` · ${brand}` : ''}`,
      `Net Promoter Score: how passengers rate you here over about the last month (airline-wide ${formatNps(networkNps(state))}). Late flights, old planes and fares above the rivals' pull it down. Against a rival, the better name wins some of the other's passengers.`,
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
  // What the fares flown here do to its growth (sim/fareStimulus.ts).
  const level = marketFareLevel(state, a, b);
  const fareGrowth = level === null ? '' : level < 0.9 ? ' · low fares growing it' : level > 1.1 ? ' · fares holding it back' : '';
  root.append(
    lineWithInfo(
      `${marketSize(state, a, b)} market · ${marketCharacterWord(a, b)}${fillWords}` +
        (short ? ' · demand exceeds seats' : '') +
        (fill.thin ? ' · still growing' : '') +
        fareGrowth,
      `A market's demand is built by flying it, over weeks, toward the size of the city pair (${readout.seatsPerFlight} seats a flight now). When demand exceeds seats, add a flight or a bigger plane; while it is still growing, extra flights fly emptier. Fares grow it too: everyone's fares here, weighted by seats${level === null ? '' : ` (now ${Math.round(level * 100)}% of the going rate)`}. Cheap fares build it faster and up to 1.3× its usual size; dear ones slow it and settle it smaller. The market is everyone's, so one built cheaply is one a rival can share. The bar is who flies it: business travellers barely mind the fare but want peak departures and frequency; leisure travellers chase the fare; VFR (visiting friends and relatives) sit between. A business trunk rewards frequency and peak slots, a sun route a sharp fare.`,
    ),
  );
  root.append(...characterBar(a, b));
  root.append(seasonLine(state, a, b));
  for (const event of eventsOn(state, a, b)) {
    const running = eventRunning(state, event);
    const today = dayIndex(state);
    const when = running ? `now · ${event.endDay - today + 1}d left` : `${gameDate(state, event.startDay)} · in ${event.startDay - today}d · ${event.endDay - event.startDay + 1}d`;
    const draws = eventDraws(event.kind).map((segment) => (segment === 'vfr' ? 'VFR' : segment)).join(' and ');
    root.append(
      lineWithInfo(
        `Event ${event.iata} ${event.name} · ${when} · ${draws} +${Math.round(event.lift * 100)}%`,
        'A demand event at one end: while it runs, every market touching that city has this many more of these travellers wanting to fly. Rivals don\'t plan for it, so a flight added, a bigger plane or a higher fare ahead of it is yours to take.',
        'inspector-line is-warn',
      ),
    );
  }

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
      cut > 0 ? ` · your fares −${cut}%` : '',
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

  // A contract on this market (sim/contracts.ts): the offer's
  // terms, or how the running one is paying.
  const contract = contractOn(state, a, b);
  if (contract) {
    const performance = performanceFactor(state, contract);
    root.append(
      lineWithInfo(
        contract.status === 'offered'
          ? `Contract offer · ${money(contract.paymentPerDay)}/day · ${contract.ridersPerDay} riders · ${contract.termDays}d · fly by day ${contract.offerEndsDay}`
          : `Contract · pay ${Math.round(paymentShare(performance) * 100)}% · riders ${Math.round(contract.ridersPerDay * performance)}/${contract.ridersPerDay} · ends day ${contract.endsDay}`,
        'A route contract: see Head office for its terms. The riders and half the pay depend on on-time, completion and NPS against stricter bars than ordinary passengers; when it ends without renewal, this market\'s demand drops.',
        contract.status === 'active' && performance < 0.5 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

  // A fare war running here (sim/fareWars.ts).
  const war = fareWarOn(state, marketKey(a, b));
  if (war) {
    const rivalRoute = rivals.find((route) => route.code === war.rival);
    const yours = summarizeMarket(a, b, state, state.routeSettings[marketKey(a, b)]).margin;
    const theirs = rivalRoute ? rivalRouteDailyResult(state, rivalRoute).margin : null;
    root.append(
      lineWithInfo(
        `Fare war · vs ${war.rival} · day ${dayIndex(state) - war.startDay + 1} · you ${shortSigned(yours)}/day` + (theirs !== null ? ` · ${war.rival} ${shortSigned(theirs)}/day` : ''),
        `You and ${war.rival} are both under ${Math.round(WAR_LEVEL * 100)}% of the going rate here. It ends when either of you prices back over ${Math.round(PEACE_LEVEL * 100)}%, or one of you leaves the route: a rival that keeps losing money closes its route.`,
        'inspector-line is-over',
      ),
    );
  }

  // Your own departures stacked close together, the same way (sim/timeOfDay.ts's crowdingWeight()).
  const crowdedLine = describeCrowding(state, a, b);
  if (crowdedLine) root.append(crowdedLine);

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

/** A flight with less than this crowding weight counts as crowded in the readout. */
const CROWDED_WEIGHT = 0.8;

/**
 * Departures crowding each other (sim/timeOfDay.ts's crowdingWeight()):
 * how many of the route's flights leave within the window of another the
 * same way, and the flights' worth of passengers that costs. Null when
 * none do.
 */
function describeCrowding(state: SimState, a: string, b: string): HTMLElement | null {
  const legs = state.schedule.filter((leg) => (leg.origin === a && leg.dest === b) || (leg.origin === b && leg.dest === a));
  const weights = legs.map((leg) => crowdingWeight(leg, state.schedule));
  const crowded = weights.filter((weight) => weight < CROWDED_WEIGHT).length;
  if (crowded === 0) return null;
  const lost = weights.reduce((sum, weight) => sum + (1 - weight), 0);
  return lineWithInfo(
    `Crowded · ${crowded} of ${legs.length} departures · −${lost.toFixed(1)} flights' worth of pax`,
    `Your flights leaving within ${CROWDING_WINDOW_MINUTES} minutes of each other the same way are wanted by the same passengers, so they split them: two at the same minute carry one flight's worth between them. Spread them on the Gantt (Fleet).`,
    'inspector-line is-warn',
  );
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
function describeEconomics(state: SimState, a: string, b: string): { text: string; detail: string; losing: boolean; fixed: string; fixedDetail: string; fullyLosing: boolean } {
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
    text: `Today at this fare · ${summary.pax} pax · LF ${Math.round(load * 100)}% · ${signedMoney(summary.margin)}/day`,
    detail:
      `The game's forecast for a day at these settings: revenue ${money(summary.revenue)}, flying costs ${money(summary.cost)}, ` +
      `${Math.round(summary.share * 100)}% of the market's passengers. ` +
      (summary.seatCapped
        ? 'Seat-capped: more want to fly than there are seats, so a higher fare loses passengers nobody could carry.'
        : 'Demand-capped: there are seats to spare, so a higher fare loses real passengers.'),
    losing: summary.margin < 0,
    fixed:
      `After lease, slots, overhead · ${signedMoney(fullMargin)}/day`,
    fixedDetail:
      `Lease ${money(costs.leasePerDay)}, slots ${money(costs.slotsPerDay)}, overhead ${money(costs.overheadPerDay)} a day. ` +
      (slotParts.length > 0 ? `Slots: ${slotParts.join(', ')}. ` : '') +
      (leaseParts.length > 0 ? `Lease: ${leaseParts.join('; ')}. ` : '') +
      'Slot fees, leases and network overhead are paid airline-wide each midnight. Slot fees are shared by each airport\'s movements; ' +
      'a class\'s leases by the minutes its planes fly, so flying a class less puts more of its lease on each route; ' +
      'overhead, which grows with the square of the fleet, by each route\'s share of all flying.',
    fullyLosing: fullMargin < 0,
  };
}

/**
 * The market's lever: its fare, as a ball on the revenue hill (set by hand
 * here, which takes it off the policy and off any stance), with what a day
 * looks like at it. Dragging updates the numbers in place; the whole view
 * rebuilds on release, so a rebuild never takes the ball out from under
 * the pointer.
 */
function buildFare(state: SimState, a: string, b: string, changed: () => void): HTMLElement[] {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings) return [];

  const heading = document.createElement('h2');
  heading.textContent = 'Fare';

  // Both lines keep their (i) while dragging redraws their text.
  const economics = line('');
  const economicsText = document.createElement('span');
  const economicsInfo = info('');
  economics.append(economicsText, ' ', economicsInfo);
  // The fully costed line keeps its (i) while the slider redraws its text.
  const fixedCosts = line('');
  const fixedText = document.createElement('span');
  const fixedInfo = info('');
  fixedCosts.append(fixedText, ' ', fixedInfo);
  const redrawEconomics = () => {
    const { text, detail, losing, fixed, fixedDetail, fullyLosing } = describeEconomics(state, a, b);
    economicsText.textContent = text;
    economicsInfo.dataset.info = detail;
    economics.classList.toggle('is-over', losing);
    fixedText.textContent = fixed;
    fixedInfo.dataset.info = fixedDetail;
    fixedCosts.classList.toggle('is-over', fullyLosing);
  };

  // The hill's range: centred on the policy fare, stretched to include the
  // current fare if a stance has taken it outside that range.
  const base = policyFare(state, a, b);
  const low = Math.min(roundToStep(base * FARE_MIN_FACTOR, FARE_STEP), settings.fare);
  const high = Math.max(roundToStep(base * FARE_MAX_FACTOR, FARE_STEP), settings.fare);
  const hill = revenueHill(state, a, b, low, high);
  const pricedBy = () =>
    settings.fareIsOverridden ? 'by hand' : settings.fareStance ? (STANCES.find((s) => s.stance === settings.fareStance)?.name ?? '') : 'policy';
  const fareValue = line('', 'inspector-line hill-readout');
  const redrawFare = () => {
    const range = hill?.peakRange;
    const flown = hill?.observations.length ?? 0;
    const atTop = range && settings.fare >= range.low && settings.fare <= range.high;
    fareValue.textContent =
      `$${settings.fare} · ${pricedBy()}` +
      (range ? (atTop ? ' · at the top' : ` · top $${range.low}${range.high > range.low ? `–${range.high}` : ''}`) : '') +
      ` · ${flown}d flown`;
    fareValue.classList.toggle('lever-value--overridden', settings.fareIsOverridden);
  };
  const setFare = (fare: number) => {
    const next = Math.min(high, Math.max(low, roundToStep(fare, FARE_STEP)));
    if (next === settings.fare) return;
    setHandFare(state, a, b, next);
    moveBall?.();
    redrawFare();
    redrawEconomics();
  };
  let moveBall: (() => void) | null = null;
  const nodes: HTMLElement[] = [heading];
  if (hill) {
    const drawn = drawHill(hill, low, high, () => settings.fare, setFare, changed);
    moveBall = drawn.moveBall;
    nodes.push(drawn.element);
  }
  nodes.push(fareValue);
  if (settings.fareIsOverridden || settings.fareStance) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'lever-reset';
    reset.textContent = `Back to policy $${base}`;
    reset.addEventListener('click', () => {
      setFareStance(state, a, b, null);
      changed();
    });
    nodes.push(reset);
  }

  redrawFare();
  redrawEconomics();
  return [...nodes, economics, fixedCosts, ...buildSeatSplit(state, a, b, changed, redrawEconomics)];
}

/**
 * Who flies the city pair (sim/marketCharacter.ts), as a bar of business,
 * leisure and VFR with its key; the market line above names it.
 */
function characterBar(a: string, b: string): HTMLElement[] {
  const mix = marketMix(a, b);
  const bar = document.createElement('div');
  bar.className = 'mix-bar';
  for (const segment of ['business', 'leisure', 'vfr'] as const) {
    const part = document.createElement('span');
    part.className = `mix-bar-${segment}`;
    part.style.width = `${mix[segment] * 100}%`;
    bar.append(part);
  }
  const key = chartLegend([
    { mark: 'block', color: '#9d8cf0', label: `business ${Math.round(mix.business * 100)}%` },
    { mark: 'block', color: '#ffb347', label: `leisure ${Math.round(mix.leisure * 100)}%` },
    { mark: 'block', color: '#5ed6c8', label: `VFR ${Math.round(mix.vfr * 100)}%` },
  ]);
  return [bar, key];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** A day of the year as people say it: "mid-Feb", "late Dec". */
function dayInWords(day: number): string {
  let month = 0;
  while (month < 11 && day >= MONTH_STARTS[month + 1]) month += 1;
  const into = day - MONTH_STARTS[month];
  return `${into < 10 ? 'early' : into < 20 ? 'mid' : 'late'}-${MONTHS[month]}`;
}

/** Where this market is in its year (sim/seasons.ts): today against an ordinary day, and its busiest and quietest. */
function seasonLine(state: SimState, a: string, b: string): HTMLElement {
  const year = marketSeasonOutlook(state, a, b);
  const pct = (level: number) => `${level >= 1 ? '+' : '−'}${Math.round(Math.abs(level - 1) * 100)}%`;
  return lineWithInfo(
    `Season ${pct(year.now)} now · peak ${pct(year.peak)} ${dayInWords(year.peakDay)} · low ${pct(year.low)} ${dayInWords(year.lowDay)}` + (isSunRoute(a, b) ? ' · sun route' : ''),
    'How many want to fly this market today against an ordinary day, from the calendar: leisure travellers peak in July and at Christmas, business travellers dip in August and over the holidays, VFR peak at Christmas and in summer. On a sun route (a warm end and a cold one) leisure peaks January to March instead. The busier the season, the fuller the planes at a fare, so the revenue hill and the forecasts move with it: add capacity or raise the fare ahead of a peak, and trim ahead of a low.',
  );
}

/** The seat bar's colours (style.css's .seat-split-*), for its key. */
const CLASS_COLORS: Record<string, string> = { saver: '#5ed6c8', flex: '#8a93a6', full: '#ffd166' };

/** A tally's numbers in a line: what sold in each class and what happened to people. */
function describeTally(tally: FareClassTally, perFlight = false): string {
  const n = (value: number) => Math.round(value);
  const parts = CLASS_ORDER.map((fareClass) => `${CLASS_NAMES[fareClass]} ${n(tally.sold[fareClass])}`);
  if (n(tally.cabinSold ?? 0) > 0) parts.unshift(`J ${n(tally.cabinSold ?? 0)}`);
  if (tally.saverSoldOut > 0 && perFlight === false) parts.push(`Saver out ${tally.saverSoldOut}/${tally.flights}`);
  if (n(tally.boughtUp) > 0) parts.push(`${n(tally.boughtUp)} up`);
  if (n(tally.diluted) > 0) parts.push(`${n(tally.diluted)} biz on Saver`);
  if (n(tally.businessTurnedAway) > 0) parts.push(`${n(tally.businessTurnedAway)} biz lost`);
  return parts.join(' · ');
}

/**
 * The route's seats split between fare classes (sim/fareClasses.ts), as a
 * seat-map bar with two handles: drag them to move the Saver–Flex and
 * Flex–Full lines. Under it, each class's share and price, what the split
 * would sell today (the forecast, live as you drag), and what it sold
 * yesterday.
 */
function buildSeatSplit(state: SimState, a: string, b: string, changed: () => void, redrawEconomics: () => void): HTMLElement[] {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings) return [];
  const split = () => settings.fareClasses ?? DEFAULT_FARE_CLASSES;
  // As sold today: a seat sale's split while one runs (sim/seatSale.ts).
  const selling = () => effectiveFareClasses(state, key);
  const heading = document.createElement('h2');
  heading.append(
    'Seats by fare ',
    info(
      'Every flight sells three fares from the route\'s base fare: Saver (75%), Flex (100%) and Full (140%), each with its share of the seats. Leisure travellers book first and take the cheapest open; VFR next; business last. When a class sells out, those willing to pay the next one buy up. A Saver still open when business books is sold to people who would have paid Full; held back too long, seats fly empty. Drag the lines to move the split. A route follows the airline-wide split (Routes screen) until you move its lines; the button puts it back.',
    ),
  );
  const legend = document.createElement('div');
  const forecast = line('', 'inspector-line seat-split-forecast');
  const yesterday = state.yesterdayFareClasses?.[key];
  const past = line(yesterday && yesterday.flights > 0 ? `Yesterday · ${describeTally(yesterday)}` : 'Yesterday · not flown', 'inspector-line seat-split-yesterday');

  const redraw = () => {
    const { saverShare, flexShare } = split();
    const shares = [saverShare, flexShare, Math.max(0, 1 - saverShare - flexShare)];
    legend.replaceChildren(
      chartLegend(
        CLASS_ORDER.map((fareClass, i) => ({
          mark: 'block' as const,
          color: CLASS_COLORS[fareClass],
          label: `${CLASS_NAMES[fareClass]} ${Math.round(shares[i] * 100)}% · $${Math.round(settings.fare * (fareClass === 'saver' && selling().saverPrice !== undefined ? selling().saverPrice! : CLASS_PRICE[fareClass]))}`,
        })),
      ),
    );
    forecast.textContent = `Today · ${describeTally(summarizeMarket(a, b, state, settings).fareClasses, true)}`;
  };

  const { bar } = buildSeatSplitBar({
    split,
    move: (saver, flex) => {
      setFareClasses(state, a, b, saver, flex);
      redraw();
      redrawEconomics();
    },
    done: changed,
  });
  redraw();
  const policy = line(settings.fareClassesByHand ? 'Seats set by hand' : 'Seats on policy', 'inspector-line');
  if (settings.fareClassesByHand) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'lever-reset';
    back.textContent = 'Put seats back on policy';
    back.addEventListener('click', () => {
      putSeatsOnPolicy(state, a, b);
      changed();
    });
    policy.append(' ', back);
  }
  return [heading, bar, policy, legend, forecast, past, buildSale(state, a, b, changed)];
}

/** A seat sale (sim/seatSale.ts): the one running, or a button to start one, or when the next can. */
function buildSale(state: SimState, a: string, b: string, changed: () => void): HTMLElement {
  const key = marketKey(a, b);
  const fare = state.routeSettings[key]?.fare ?? 0;
  const left = saleDaysLeft(state, key);
  const explain = `A seat sale: for ${SALE_DAYS} days Saver sells at ${Math.round(SALE_SAVER_PRICE * 100)}% of the fare on at least 40% of the seats, and the market builds ${SALE_GROWTH}× as fast while it runs. Rivals see it as a cut and may answer it. One every ${SALE_COOLDOWN_DAYS} days.`;
  if (left !== null) return lineWithInfo(`Seat sale · ${left}d left · Saver $${Math.round(fare * SALE_SAVER_PRICE)}`, explain, 'inspector-line is-warn');
  const blocked = saleBlockedReason(state, a, b);
  const row = document.createElement('div');
  row.className = 'inspector-line';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lever-reset';
  button.textContent = `Seat sale · ${SALE_DAYS}d · Saver $${Math.round(fare * SALE_SAVER_PRICE)}`;
  button.disabled = blocked !== null;
  const change = saleMarginChangePerDay(state, a, b);
  button.addEventListener('click', () => {
    showConfirm({
      title: `Seat sale ${a}–${b}`,
      rows: [
        { label: 'Length', value: `${SALE_DAYS} days` },
        { label: 'Saver fare', value: `$${Math.round(fare * SALE_SAVER_PRICE)} (${Math.round(SALE_SAVER_PRICE * 100)}% of $${Math.round(fare)})` },
        { label: 'Margin', value: `${shortSigned(change)}/day while on` },
        { label: 'Next sale', value: `${SALE_COOLDOWN_DAYS} days after the start` },
      ],
      facts: [`Market builds ${SALE_GROWTH}× as fast while it runs. Rivals see it as a fare cut and may answer it.`],
      confirmLabel: 'Start sale',
      run: () => {
        ops.startSeatSale(state, a, b);
        changed();
      },
    });
  });
  row.append(button, blocked ? ` ${blocked} ` : ` ${shortSigned(change)}/day while on `, info(explain + ' The figure is what a day of the sale makes against a normal day, at today\'s demand, before the growth it brings.'));
  if (!blocked && change < 0) row.classList.add('is-warn');
  return row;
}

/** A route's revenue hill (sim/revenueHill.ts) on the shared chart, in fares. */
function drawHill(
  hill: RevenueHill,
  low: number,
  high: number,
  fareNow: () => number,
  setFare: (fare: number) => void,
  done: () => void,
): { element: HTMLElement; moveBall: () => void } {
  return drawHillChart({
    points: hill.points.map((p) => ({ x: p.fare, margin: p.margin, uncertainty: p.uncertainty, invites: p.invitesRivals })),
    low,
    high,
    observations: hill.observations.map((o) => ({ x: o.fare, margin: o.margin })),
    flags: hill.rivals.map((r) => ({ x: r.fare, label: r.code })),
    peak: { x: hill.peak.fare, margin: hill.peak.margin },
    peakRange: hill.peakRange,
    ticks: [{ x: hill.goingRate, label: `going $${hill.goingRate}` }],
    format: (fare) => `$${Math.round(fare)}`,
    value: fareNow,
    setValue: setFare,
    done,
    step: FARE_STEP,
    ariaLabel: 'Fare',
    valueLabel: 'your fare',
  });
}

const STANCES: { stance: FareStance; name: string }[] = [
  { stance: 'undercut', name: 'Undercut' },
  { stance: 'match', name: 'Match' },
  { stance: 'premium', name: 'Premium' },
];

/** One stance's forecast in a line: your fare and margin, then each rival's. */
function describeForecast(forecast: StanceForecast): string {
  const rivals = forecast.rivals.map((rival) => {
    const adds = rival.flightsAdded >= 0.5 ? ` +${Math.round(rival.flightsAdded)} flt` : '';
    const gone = rival.closesInDays !== null ? ` exits ~${rival.closesInDays}d` : '';
    return `${rival.code} $${rival.fare}${adds}${gone}`;
  });
  const response = forecast.responseChance > 0 ? ` · ${Math.round(forecast.responseChance * 100)}%/day new flight` : '';
  return `$${forecast.fare} · ${shortSigned(forecast.margin)}/day · ${rivals.join(' · ')}${response}`;
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
  heading.textContent = `Vs rivals · ${current ? current.name : settings.fareIsOverridden ? 'by hand' : 'policy'}`;
  heading.append(
    ' ',
    info(`A stance re-prices this market against its rivals every day. Each row is where it would settle if nothing else changes: your fare and margin a day, then each rival's fare, the flights it would add (flt), and when it would pull out (after which the market stays clear of it for ${RIVAL_SQUEEZED_RESPITE_DAYS} days).`),
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
