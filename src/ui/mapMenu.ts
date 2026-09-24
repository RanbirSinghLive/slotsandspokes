import { nearestAirportCandidate, airportPresence, type Airport } from '../render/airports';
import { findNearestOwnRoute } from '../render/routes';
import { projection } from '../render/projection';
import { utilisationPools } from '../sim/utilisation';
import { unmetDemandByAirport } from '../sim/unmetDemand';
import { rivalYieldFactor } from '../sim/pressure';
import { legsServingMarket, marketKey, recommendedFare } from '../sim/schedule';
import { rivalResponseChance } from '../sim/rivalResponse';
import { TURN_BUFFER_CHOICES } from '../sim/turnBuffer';
import { connectingPassengersThrough, spokesOf } from '../sim/hubs';
import { HUB_STYLES, HUB_STYLE_ORDER, hubStyleAt } from '../sim/hubStyle';
import { reliabilityDemandFactor, trailingMarketOtp } from '../sim/routeOtp';
import { onTimeColor } from '../render/mapmodes';
import { hasHubView } from '../render/hubs';
import { planHub } from '../sim/hubPlanner';
import { daysUntilReturn, expediteCost, expediteRepair } from '../sim/aog';
import { openHubPlanner } from './hubPlanner';
import { buildPoolRows } from './poolBars';
import { getMapPreview, setMapPreview, type MapPreview } from '../render/preview';
import type { SimState } from '../sim/state';
import { candidateTailsAt } from '../sim/rotations';
import { armRouteBuilderAt, describeSlotQuotes } from './routeBuilder';
import { nextSlotFees, slotFeesPerDayAt, slotsHeld } from '../sim/slots';
import { hideCompetitionTooltip } from './competitionTooltip';
import { hideRadial, showRadial, updateRadial, type RadialAction } from './radial';
import * as ops from './routeActions';
import { planeIconInner } from './planeIcons';
import { AIRCRAFT_CLASSES } from '../sim/aircraftClasses';
import { airportCapacityPerDay, airportLoad, dailyMovementsAt } from '../sim/airports';
import { congestionParameters } from '../sim/delays';
import { USEFUL_LIFE_YEARS } from '../sim/leasing';
import { WINDOW_DAYS, buildBipolarBars, dayLabel, money as pnlMoney } from './pnlBars';

/**
 * Click something on the map, get an info card and a ring of actions for
 * it. Two kinds of thing can be clicked:
 *
 * - An **airport**: draw a route from it, or add a plane based there.
 * - A **route** (the line between two airports): add or remove a flight,
 *   move a flight up or down a size class, or remove the whole route.
 *
 * This module only decides which actions each ring has and what the card
 * says. Drawing the ring is ui/radial.ts; what an action does to the
 * network is ui/routeActions.ts, and through it the route builder's own
 * planning, so nothing here re-implements a rule.
 *
 * main.ts's mousedown handler gives the route builder first refusal on
 * every map click (it owns the map while a route is being drawn), and only
 * calls in here once it has said no.
 */

const MAX_MARKET_ROWS = 6;
// Short enough to fit a button: the full names are in each button's label.
const HUB_STYLE_ICON_TEXT = { rolling: 'Roll', banked: 'Bank', tight: 'Tight' } as const;
const CARD_OFFSET_PX = 16;

const cardEl = document.querySelector<HTMLElement>('#airport-detail-popover')!;
const titleEl = document.querySelector<HTMLElement>('#airport-detail-title')!;
const presenceEl = document.querySelector<HTMLElement>('#airport-detail-presence')!;
const loadEl = document.querySelector<HTMLElement>('#airport-detail-load')!;
const slotsEl = document.querySelector<HTMLElement>('#airport-detail-slots')!;
const aogEl = document.querySelector<HTMLElement>('#airport-detail-aog')!;
const basedEl = document.querySelector<HTMLElement>('#airport-detail-based')!;
const marketsEl = document.querySelector<HTMLElement>('#airport-detail-markets')!;
const routeHistoryEl = document.querySelector<HTMLElement>('#airport-detail-route-history')!;
const routeOtpEl = document.querySelector<HTMLElement>('#airport-detail-otp')!;
const poolsEl = document.querySelector<HTMLElement>('#airport-detail-pools')!;
const demandEl = document.querySelector<HTMLElement>('#airport-detail-demand')!;
const hintEl = document.querySelector<HTMLElement>('#airport-detail-hint')!;
const planHubButton = document.querySelector<HTMLButtonElement>('#airport-detail-plan-hub')!;

const ICON = {
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7.5 16.5 16.5 7.5"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  gaugeUp: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  gaugeDown: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  remove: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  // An arrow curving back: handing a plane back to the lessor.
  returnPlane: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  // Three spokes meeting at a hub.
  hub: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V3"/><path d="M9.8 13.3 4.5 17"/><path d="M14.2 13.3 19.5 17"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
};

/** A short label drawn as the button's icon, for choices that are numbers rather than things. */
function textIcon(text: string, fontSize = 10): string {
  const baseline = 12 + fontSize * 0.36;
  return `<text x="12" y="${baseline}" text-anchor="middle" font-size="${fontSize}" font-weight="600" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">${text}</text>`;
}

type Open = { kind: 'airport'; airport: Airport } | { kind: 'route'; a: string; b: string };

let open: Open | null = null;
let openState: SimState | null = null;
let anchorX = 0;
let anchorY = 0;
// The result of the last action, kept in the hint line until the pointer
// moves onto another button, so a click that changes something visibly
// elsewhere on the map still says what it did.
let notice: string | null = null;
let hover: { text: string; problem: boolean } | null = null;
let cardPoolBase: string | null = null;
let cardPoolState: SimState | null = null;

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

export function hideMapMenu(): void {
  cardEl.hidden = true;
  hideRadial();
  setMapPreview(null);
  cardPoolBase = null;
  cardPoolState = null;
  open = null;
  openState = null;
  notice = null;
  hover = null;
}

function renderHint(): void {
  const text = hover?.text ?? notice ?? '';
  hintEl.textContent = text;
  hintEl.classList.toggle('is-problem', !!hover?.problem);
}

function onHint(text: string | null, problem: boolean): void {
  hover = text === null ? null : { text, problem };
  renderHint();
}

function positionCard(): void {
  cardEl.style.left = `${anchorX + CARD_OFFSET_PX}px`;
  cardEl.style.top = `${anchorY + CARD_OFFSET_PX}px`;

  const rect = cardEl.getBoundingClientRect();
  const overflowX = rect.right - window.innerWidth;
  const overflowY = rect.bottom - window.innerHeight;
  if (overflowX > 0) cardEl.style.left = `${anchorX + CARD_OFFSET_PX - overflowX - 8}px`;
  if (overflowY > 0) cardEl.style.top = `${anchorY + CARD_OFFSET_PX - overflowY - 8}px`;
}

// --- Airports -----------------------------------------------------------

/** The class pools for the planes based at `base`, as bars; `emptyText` when there are none. */
function fillPools(base: string | null, state: SimState, emptyText: string): void {
  cardPoolBase = base;
  cardPoolState = state;
  const pools = base ? utilisationPools(state, base) : [];
  basedEl.textContent = pools.every((pool) => pool.planes === 0) ? emptyText : `Planes based at ${base}:`;
  renderCardPools();
}

/** Redraw the card's bars, applying whatever the hovered button would change. */
function renderCardPools(): void {
  if (!cardPoolBase || !cardPoolState) {
    poolsEl.replaceChildren();
    return;
  }
  const pools = utilisationPools(cardPoolState, cardPoolBase);
  poolsEl.replaceChildren(...buildPoolRows(pools, getMapPreview()?.effects, cardPoolBase));
}

function onPreview(preview: MapPreview | null): void {
  setMapPreview(preview);
  renderCardPools();
}

function fillAirportCard(airport: Airport, state: SimState): void {
  titleEl.textContent = `${airport.iata} — ${airport.name}`;
  // Only a route card shows a route's own history.
  routeHistoryEl.hidden = true;
  routeHistoryEl.replaceChildren();
  routeOtpEl.hidden = true;
  routeOtpEl.replaceChildren();

  const presence = airportPresence(state, airport.iata);
  const connecting = Math.round(connectingPassengersThrough(state, airport.iata));
  presenceEl.textContent =
    `${presence.level} · ${presence.departures} departure${presence.departures === 1 ? '' : 's'}/day` +
    (connecting > 0 ? ` · ${connecting} connecting/day (${HUB_STYLES[hubStyleAt(state, airport.iata)].name})` : '');
  presenceEl.classList.remove('airport-detail-over');

  fillAirportLoad(airport.iata, state);

  const unmet = unmetDemandByAirport(state).get(airport.iata);
  const round = (n: number) => Math.round(n).toLocaleString();
  demandEl.textContent = unmet
    ? `Waiting: ${round(unmet.latent)} potential riders/day${unmet.spilled >= 1 ? `, ${round(unmet.spilled)} turned away` : ''}`
    : '';
  demandEl.classList.toggle('airport-detail-over', !!unmet && unmet.spilled >= 1);

  fillPools(airport.iata, state, 'No aircraft based here.');
  fillAogs(airport.iata, state);
  fillPlanHubButton(airport.iata, state);

  // Every market this airport touches, either direction, with how many
  // legs serve it.
  const frequencyByOther = new Map<string, number>();
  for (const leg of state.schedule) {
    if (leg.origin === airport.iata) frequencyByOther.set(leg.dest, (frequencyByOther.get(leg.dest) ?? 0) + 1);
    else if (leg.dest === airport.iata) frequencyByOther.set(leg.origin, (frequencyByOther.get(leg.origin) ?? 0) + 1);
  }
  const markets = [...frequencyByOther.entries()].sort((a, b) => b[1] - a[1]);
  if (markets.length === 0) {
    marketsEl.replaceChildren(document.createTextNode('No markets served.'));
  } else {
    const shown = markets.slice(0, MAX_MARKET_ROWS);
    const rest = markets.length - shown.length;
    const nodes: (Node | string)[] = ['Markets: '];
    // Each one opens that route's own ring (gauge, add/remove flight),
    // same place clicking its line on the map goes. The line only takes a
    // click within a few pixels of itself and loses to a nearby airport
    // dot, so on a short route, or one zoomed far out, it can be nearly
    // unclickable — this is a way in that doesn't depend on screen
    // geometry at all.
    shown.forEach(([other, freq], i) => {
      if (i > 0) nodes.push(', ');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'market-link';
      link.textContent = `${other} (${freq})`;
      link.addEventListener('click', (event) => {
        event.stopPropagation();
        openRouteMenu(airport.iata, other, state, anchorX, anchorY);
      });
      nodes.push(link);
    });
    if (rest > 0) nodes.push(`, +${rest} more`);
    marketsEl.replaceChildren(...nodes);
  }
}

/**
 * How busy the field is against its capacity (sim/airports.ts), and what
 * that's costing in congestion delays — the same number the glow around
 * the airport on the map encodes, spelled out.
 */
function fillAirportLoad(iata: string, state: SimState): void {
  const load = airportLoad(state, iata);
  const { delayChance, maxDelayMinutes } = congestionParameters(load);
  loadEl.textContent =
    `Airport load: ${Math.round(load * 100)}% at peak (${dailyMovementsAt(state, iata)} of ${airportCapacityPerDay(iata)} movements/day)` +
    (delayChance > 0
      ? `. Congestion delays ${Math.round(delayChance * 100)}% of flights here, up to ${maxDelayMinutes} min.`
      : '. No congestion.');
  loadEl.classList.toggle('airport-detail-warn', delayChance > 0 && load < 1);
  loadEl.classList.toggle('airport-detail-over', load >= 1);

  // Slots (sim/slots.ts): what you hold here, and what the next pair
  // would cost — priced from this same traffic, so a busy airport reads
  // as both congested above and expensive here.
  const held = slotsHeld(state, iata);
  const [next] = nextSlotFees(state, iata, 1);
  const nextText = next === null ? 'no slots left' : next === 0 ? 'next pair free' : `next pair $${next.toLocaleString()}/day`;
  slotsEl.textContent =
    held > 0
      ? `Slots: ${held} pair${held === 1 ? '' : 's'} held, $${slotFeesPerDayAt(state, iata).toLocaleString()}/day · ${nextText}.`
      : `Slots: none held · ${nextText}.`;
}

/**
 * Planes based here that are grounded with an AOG (sim/aog.ts): what's
 * wrong, when they're back, and a button to pay for a day sooner. What
 * each AOG cancels goes in the ticker, not here.
 */
function fillAogs(iata: string, state: SimState): void {
  aogEl.replaceChildren(
    ...state.aogs
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
          expedite.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation();
            const result = expediteRepair(state, event.tail);
            notice = result.ok ? result.message : result.reason;
            refresh();
          });
          row.append(expedite);
        }
        return row;
      }),
  );
}

/**
 * The Plan hub button (ui/hubPlanner.ts): on every airport you fly to, so
 * it's always where a player looks for it, and coloured by how much value
 * sim/hubPlanner.ts finds being missed there — plain when the hub is fine,
 * yellow when it's worth a look, red when it's worth acting on.
 */
function fillPlanHubButton(iata: string, state: SimState): void {
  planHubButton.hidden = !hasHubView(state, iata);
  if (planHubButton.hidden) return;
  const plan = planHub(state, iata);
  planHubButton.classList.toggle('is-warn', plan.urgency === 'warn');
  planHubButton.classList.toggle('is-act', plan.urgency === 'act');
  planHubButton.textContent =
    plan.urgency === 'none' ? 'Plan hub' : `Plan hub · about $${Math.round(plan.missedPerDay).toLocaleString()}/day missed`;
}

planHubButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (open?.kind !== 'airport' || !openState) return;
  openHubPlanner(openState, open.airport.iata, refresh);
});

function airportActions(airport: Airport, state: SimState): RadialAction[] {
  const hasPlane = candidateTailsAt(state, airport.iata).length > 0;

  // Returning a lease early (sim/market.ts): one choice per plane based
  // here. Only a plane with nothing scheduled can go; the rest say why.
  const returnChoices: RadialAction[] = ops.returnOptions(state, airport.iata).map((option) => ({
    id: `return:${option.tail}`,
    label:
      `Return ${option.tail} (${option.name}, ${option.ageYears} yrs) for a $${option.fee.toLocaleString()} fee, ` +
      `saving $${option.saves.toLocaleString()}/day. It goes back on the market for anyone to lease.`,
    icon: planeIconInner(state.aircraft.find((a) => a.tail === option.tail)?.typeCode ?? ''),
    large: true,
    angleDeg: 0,
    confirm: true,
    disabledReason: option.blocked ?? undefined,
    onSelect: () => {
      const result = ops.returnPlane(state, option.tail);
      notice = result.ok ? result.message : result.reason;
      refresh();
      return false;
    },
  }));

  const planeChoices: RadialAction[] = ops.planeOptions(state, airport.iata).map((option) => ({
    id: `plane:${option.code}`,
    // The actual airframe on offer (sim/market.ts): its age is what
    // explains its price and how late it'll run.
    label: option.listing
      ? `Lease a ${option.name} (${option.seats} seats, ${option.listing.ageYears} yrs old, ` +
        `${Math.max(0, USEFUL_LIFE_YEARS - option.listing.ageYears)} yrs of life left) for ${money(option.listing.leasePricePerDay)}/day` +
        (option.listed > 1 ? ` · ${option.listed - 1} more listed` : ' · the last one listed')
      : `Lease a ${option.name}`,
    // Each class has its own silhouette (ui/planeIcons.ts), so the four
    // choices are told apart by shape rather than by guessing at size.
    icon: planeIconInner(option.code),
    large: true,
    angleDeg: 0,
    disabledReason: option.disabledReason,
    preview: option.preview,
    onSelect: () => {
      const result = ops.leasePlane(state, airport.iata, option.code);
      notice = result.ok ? result.message : result.reason;
      refresh();
    },
  }));

  // Hub style (sim/hubStyle.ts): each choice planned up front, like the
  // route card's turn buffer, so one the base can't absorb is greyed out
  // with the reason, and hovering one previews its effect on the pools.
  const current = hubStyleAt(state, airport.iata);
  const spokeCount = spokesOf(state, airport.iata).size;
  const styleChoices: RadialAction[] = HUB_STYLE_ORDER.map((style) => {
    const spec = HUB_STYLES[style];
    const isCurrent = style === current;
    const plan = isCurrent ? null : ops.previewHubStyle(state, airport.iata, style);
    const connectingAfter = Math.round(
      connectingPassengersThrough({ ...state, hubStyles: { ...state.hubStyles, [airport.iata]: style } }, airport.iata),
    );
    return {
      id: `hub:${style}`,
      label: `${spec.name}${isCurrent ? ' (current)' : ''}: ${spec.description} About ${connectingAfter} connecting/day.`,
      icon: textIcon(HUB_STYLE_ICON_TEXT[style], 7),
      angleDeg: 0,
      selected: isCurrent,
      disabledReason: plan && !plan.ok ? plan.reason : undefined,
      preview: plan?.ok ? plan.preview : undefined,
      onSelect: () => {
        if (isCurrent) return false;
        const result = ops.setHubStyle(state, airport.iata, style);
        notice = result.ok ? result.message : result.reason;
        refresh();
        return false;
      },
    };
  });

  return [
    {
      id: 'hub-style',
      label: `Hub style (now ${HUB_STYLES[current].name}): how flights here are grouped, trading connections against congestion and aircraft time`,
      icon: ICON.hub,
      angleDeg: -165,
      disabledReason:
        spokeCount < 2 ? `Fly from ${airport.iata} to at least two airports first: connections need two routes to meet.` : undefined,
      children: styleChoices,
    },
    {
      id: 'route',
      label: 'Draw a route from here',
      icon: ICON.route,
      angleDeg: -115,
      disabledReason: hasPlane ? undefined : `No plane is based at ${airport.iata}. Use Plane to add one.`,
      onSelect: () => {
        armRouteBuilderAt(airport);
        hideMapMenu();
      },
    },
    { id: 'plane', label: 'Add a plane based here', icon: ICON.plane, angleDeg: -65, children: planeChoices },
    {
      id: 'return',
      label: 'Return a plane to the lessor',
      icon: ICON.returnPlane,
      angleDeg: 150,
      disabledReason: returnChoices.length === 0 ? `No planes are based at ${airport.iata}.` : undefined,
      children: returnChoices,
    },
  ];
}

function openAirportMenu(airport: Airport, state: SimState): void {
  const point = projection([airport.lon, airport.lat]);
  anchorX = point ? point[0] : anchorX;
  anchorY = point ? point[1] : anchorY;

  open = { kind: 'airport', airport };
  openState = state;
  notice = null;
  hover = null;

  fillAirportCard(airport, state);
  cardEl.hidden = false;
  positionCard();
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: airportActions(airport, state), onHint, onPreview });
}

// --- Routes ---------------------------------------------------------------

function fillRouteCard(a: string, b: string, state: SimState): void {
  const summary = ops.summariseMarket(state, a, b);
  const readout = ops.marketReadout(state, a, b);

  titleEl.textContent = `${a} – ${b}`;
  presenceEl.textContent = `${summary.rotations.length} flight${summary.rotations.length === 1 ? '' : 's'}/day · ${summary.byClass.map((c) => `${c.name} x${c.count}`).join(', ')}`;
  presenceEl.classList.remove('airport-detail-over');

  const short = readout.demandNow > readout.seatsPerFlight;
  // A route you have only just opened has almost no demand, however big
  // the city pair is: demand is built by flying it, over weeks
  // (sim/marketDemand.ts). Saying so is what stops "20,000 potential" from
  // reading as "add ten flights".
  const young = readout.demandNow < 0.4 * readout.seatsPerFlight;
  demandEl.textContent = '';
  demandEl.classList.remove('airport-detail-over');
  presenceEl.classList.toggle('airport-detail-over', short);
  marketsEl.textContent =
    `Per flight: ${readout.demandNow} passengers wanted${readout.demandPotential > readout.demandNow ? ` (${readout.demandPotential} potential)` : ''}, ${readout.seatsPerFlight} seats.` +
    (short ? ' Demand exceeds seats: add a flight or upgauge.' : '') +
    (young ? ' Demand is still growing: extra flights fly emptier for now.' : '');
  const rivals = state.competitorRoutes.filter(
    (route) => (route.origin === a && route.dest === b) || (route.origin === b && route.dest === a),
  );
  if (rivals.length > 0) {
    const factor = rivalYieldFactor(a, b, legsServingMarket(a, b, state.schedule), state.competitorRoutes);
    const cut = Math.round((1 - factor) * 100);
    demandEl.textContent =
      // Their fare now moves in response to yours (sim/competitors.ts), so
      // it's shown next to what you charge.
      `Rivals: ${rivals.map((r) => `${r.airline} ${r.dailyFrequency}/day at $${r.fare.toLocaleString()}`).join(', ')}` +
      ` (you: $${(state.routeSettings[marketKey(a, b)]?.fare ?? 0).toLocaleString()})` +
      (cut > 0 ? `. They cut your fares ${cut}%: more flights of your own reduce it.` : '');
    demandEl.classList.add('airport-detail-over');
  }

  // Full and priced at a premium: rivals are coming for the passengers
  // this route turns away (sim/rivalResponse.ts). Said on the card, since
  // the fix — a flight or a bigger plane, or a lower fare — is on this ring.
  const response = rivalResponseChance(state, a, b);
  if (response > 0) {
    const warning = `Full and priced ${Math.round((state.routeSettings[marketKey(a, b)].fare / recommendedFare(a, b) - 1) * 100)}% above the going rate: rivals are adding flights to take the passengers you turn away (${Math.round(response * 100)}% chance a day).`;
    demandEl.textContent = demandEl.textContent ? `${demandEl.textContent} ${warning}` : warning;
    demandEl.classList.add('airport-detail-over');
  }

  fillPools(ops.routeBase(state, a, b), state, '');
  // A route card has no single airport to describe.
  loadEl.textContent = '';
  slotsEl.textContent = '';
  aogEl.replaceChildren();
  planHubButton.hidden = true;
  fillRouteHistory(state, a, b);
  fillRouteOtp(state, a, b);
}

/**
 * This route's reliability, day by day, and what it's doing to demand —
 * the evidence for deciding where a turn buffer is worth its aircraft
 * time. Bars are each finished day's on-time share, coloured on the same
 * scale as the On-Time map mode, so a red bar here is a red route there.
 */
function fillRouteOtp(state: SimState, a: string, b: string): void {
  const history = state.onTimeHistoryByMarket[marketKey(a, b)];
  const arrived = history?.arrived.slice(-WINDOW_DAYS) ?? [];
  const onTime = history?.onTime.slice(-WINDOW_DAYS) ?? [];
  const cancelled = history?.cancelled.slice(-WINDOW_DAYS) ?? [];
  const trailing = trailingMarketOtp(state, a, b);
  const buffer = ops.currentTurnBuffer(state, a, b);

  const header = document.createElement('div');
  header.className = 'pnl-chart-header';
  const labelEl = document.createElement('span');
  labelEl.textContent = 'On-time, last 7 days';
  const statEl = document.createElement('span');
  statEl.className = 'pnl-chart-stat';
  statEl.textContent = trailing.otp === null ? '—' : `${Math.round(trailing.otp * 100)}%`;
  if (trailing.otp !== null) statEl.style.color = onTimeColor(trailing.otp);
  header.append(labelEl, statEl);

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

  const bufferLine = document.createElement('div');
  bufferLine.className = 'route-otp-line';
  bufferLine.textContent =
    buffer === 0
      ? 'Turn buffer: none. A late arrival here makes the next flight late.'
      : `Turn buffer: +${buffer} min of extra ground time after each flight.`;

  const demandLine = document.createElement('div');
  demandLine.className = 'route-otp-line';
  const factor = reliabilityDemandFactor(trailing.otp);
  let cancelledLine: HTMLElement | null = null;
  if (trailing.cancelled > 0) {
    cancelledLine = document.createElement('div');
    cancelledLine.className = 'route-otp-line is-problem';
    cancelledLine.textContent = `${trailing.cancelled} cancelled this week. Cancellations count against reliability.`;
  }
  if (trailing.otp === null) {
    demandLine.textContent = 'Reliability starts to affect demand after a few more flights.';
  } else if (factor >= 1) {
    demandLine.textContent = `Reliable: demand is growing ${factor.toFixed(1)}x as fast.`;
  } else if (factor >= 0) {
    demandLine.textContent = `Delays have slowed demand growth to ${Math.round(factor * 100)}% of normal.`;
    demandLine.classList.add('is-warning');
  } else {
    demandLine.textContent = 'Delays are driving passengers away: demand is shrinking.';
    demandLine.classList.add('is-problem');
  }

  const nodes: Node[] = [header];
  if (arrived.length > 0) nodes.push(bars);
  nodes.push(bufferLine);
  if (cancelledLine) nodes.push(cancelledLine);
  nodes.push(demandLine);
  routeOtpEl.replaceChildren(...nodes);
  routeOtpEl.hidden = false;
}

/**
 * This route's own recent trend — the route-card equivalent of the
 * sidebar's network-wide "Last 7 Days" Margin chart (ui/pnlHistory.ts),
 * sharing the same bars (ui/pnlBars.ts) at a smaller size. Only Margin is
 * shown, since there's room for one chart here, not three — Revenue and
 * Cost still ride along in each bar's tooltip instead of getting their
 * own row.
 */
function fillRouteHistory(state: SimState, a: string, b: string): void {
  const history = ops.marketPnlHistory(state, a, b);
  const shownMargin = history.margin.slice(-WINDOW_DAYS);
  const shownRevenue = history.revenue.slice(-WINDOW_DAYS);
  const shownCost = history.cost.slice(-WINDOW_DAYS);

  if (shownMargin.length === 0) {
    routeHistoryEl.hidden = true;
    routeHistoryEl.replaceChildren();
    return;
  }

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

  routeHistoryEl.replaceChildren(header, bars);
  routeHistoryEl.hidden = false;
}

/** What the add-flight button says, including how thin the demand would be spread. */
function addFlightLabel(className: string, readout: ReturnType<typeof ops.marketReadout>): string {
  const seats = AIRCRAFT_CLASSES.find((c) => c.name === className)?.seats ?? 0;
  const wantedAfter = Math.round(readout.demandTotal / (readout.legs + 2));
  const thin = wantedAfter < 0.4 * seats ? ', mostly empty for now' : '';
  return `Add a ${className} flight (about ${wantedAfter} passengers wanted per flight after, ${seats} seats${thin})`;
}

function routeActions(a: string, b: string, state: SimState): RadialAction[] {
  const gaugeUp = ops.previewGauge(state, a, b, 1);
  const gaugeDown = ops.previewGauge(state, a, b, -1);
  const addFlight = ops.previewAddFlight(state, a, b);
  const removeFlight = ops.previewRemoveFlight(state, a, b);
  const removeRoute = ops.previewRemoveRoute(state, a, b);
  const readout = ops.marketReadout(state, a, b);
  const buffer = ops.currentTurnBuffer(state, a, b);

  const act = (result: ops.Outcome<{ message: string }>): boolean => {
    notice = result.ok ? result.message : result.reason;
    refresh();
    return false;
  };

  // Each buffer choice is planned up front, so a choice the base can't
  // afford is greyed out with the reason before it's ever clicked.
  const bufferChoices: RadialAction[] = TURN_BUFFER_CHOICES.map((minutes) => {
    const isCurrent = minutes === buffer;
    const plan = isCurrent ? null : ops.previewTurnBuffer(state, a, b, minutes);
    return {
      id: `buffer:${minutes}`,
      label: isCurrent
        ? `+${minutes} min after each flight (current)`
        : `Set the turn buffer to +${minutes} min after each flight on ${a}–${b}` +
          (plan?.ok && plan.moved > 0 ? `. Moves ${plan.moved} rotation${plan.moved === 1 ? '' : 's'} to another plane to make room` : ''),
      icon: textIcon(minutes === 0 ? '0' : `+${minutes}`),
      angleDeg: 0,
      selected: isCurrent,
      disabledReason: plan && !plan.ok ? plan.reason : undefined,
      preview: plan?.ok ? plan.preview : undefined,
      onSelect: () => (isCurrent ? false : act(ops.setTurnBuffer(state, a, b, minutes))),
    };
  });

  return [
    {
      id: 'turn-buffer',
      label: `Turn buffer (now +${buffer} min): extra ground time after each flight soaks up delays, but uses aircraft time`,
      icon: ICON.clock,
      angleDeg: 150,
      children: bufferChoices,
    },
    {
      id: 'gauge-down',
      label: gaugeDown.ok
        ? `Downgauge one flight: ${gaugeDown.fromName} to ${gaugeDown.toName} (hold to downgauge several)`
        : 'Downgauge one flight',
      icon: ICON.gaugeDown,
      angleDeg: -170,
      repeatable: true,
      disabledReason: gaugeDown.ok ? undefined : gaugeDown.reason,
      preview: gaugeDown.ok ? gaugeDown.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, -1)),
    },
    {
      id: 'gauge-up',
      label: gaugeUp.ok
        ? `Upgauge one flight: ${gaugeUp.fromName} to ${gaugeUp.toName} (hold to upgauge several)`
        : 'Upgauge one flight',
      icon: ICON.gaugeUp,
      angleDeg: -132,
      repeatable: true,
      disabledReason: gaugeUp.ok ? undefined : gaugeUp.reason,
      preview: gaugeUp.ok ? gaugeUp.preview : undefined,
      onSelect: () => act(ops.applyGauge(state, a, b, 1)),
    },
    {
      id: 'flight-down',
      label: 'Remove one flight (hold to remove several)',
      icon: ICON.minus,
      angleDeg: -94,
      repeatable: true,
      disabledReason: removeFlight.ok ? undefined : removeFlight.reason,
      preview: removeFlight.ok ? removeFlight.preview : undefined,
      onSelect: () => act(ops.removeFlight(state, a, b)),
    },
    {
      id: 'flight-up',
      label: addFlight.ok
        ? `${addFlightLabel(addFlight.className, readout)}. ${describeSlotQuotes(addFlight.plan.slotQuotes)} Hold to add several.`
        : 'Add a flight',
      icon: ICON.plus,
      angleDeg: -56,
      repeatable: true,
      disabledReason: addFlight.ok ? undefined : addFlight.reason,
      preview: addFlight.ok ? addFlight.preview : undefined,
      onSelect: () => act(ops.addFlight(state, a, b)),
    },
    {
      id: 'remove-route',
      label: 'Remove this route',
      icon: ICON.remove,
      angleDeg: -18,
      confirm: true,
      preview: removeRoute.ok ? removeRoute.preview : undefined,
      onSelect: () => {
        const result = ops.removeRoute(state, a, b);
        notice = result.ok ? result.message : result.reason;
        if (result.ok) {
          hideMapMenu();
          return false;
        }
        refresh();
        return false;
      },
    },
  ];
}

function openRouteMenu(a: string, b: string, state: SimState, x: number, y: number): void {
  anchorX = x;
  anchorY = y;
  open = { kind: 'route', a, b };
  openState = state;
  notice = null;
  hover = null;

  fillRouteCard(a, b, state);
  cardEl.hidden = false;
  positionCard();
  renderHint();
  showRadial({ x: anchorX, y: anchorY, actions: routeActions(a, b, state), onHint, onPreview });
}

// --- Shared ---------------------------------------------------------------

/** Rebuild the card and the ring after an action changed the network, keeping them open. */
function refresh(): void {
  if (!open || !openState) return;
  const state = openState;
  // The button that was hovered has just been replaced, so it will never
  // report the pointer leaving; without this its hint would stay on screen
  // over the result of the click.
  hover = null;
  setMapPreview(null);

  if (open.kind === 'airport') {
    fillAirportCard(open.airport, state);
    updateRadial(airportActions(open.airport, state));
  } else {
    // A route with nothing flying it any more has nothing left to act on.
    if (ops.rotationsServing(state, open.a, open.b).length === 0) {
      const message = notice;
      hideMapMenu();
      notice = message;
      return;
    }
    fillRouteCard(open.a, open.b, state);
    updateRadial(routeActions(open.a, open.b, state));
  }
  renderHint();
}

// Below this fraction of the airport's own hit radius, the airport wins
// outright, full stop — no ratio comparison against a route. A route's
// arc starts exactly at its airport, so right on top of the airport dot
// itself the route's ratio is *also* near 0 (a click there really is on
// the line, technically, at the one point where it and the dot coincide).
// Without this floor, clicking dead-center on an airport with an outgoing
// route could occasionally hand the click to the route instead, on
// nothing more than sub-pixel rounding — found by testing this exact
// scenario after the ratio comparison below was first written.
const AIRPORT_SURE_WIN_RATIO = 0.5;

/**
 * First-refusal handler, same shape as ui/routeBuilder.ts's own
 * `handleRouteBuilderMouseDown`: returns whether this module consumed the
 * click, so main.ts knows not to start a pan.
 *
 * Outside the sure-win zone above, airport and route are compared by
 * `ratio` (distance divided by that target's own hit radius — see
 * nearestAirportCandidate()'s comment in render/airports.ts), not by
 * "airport checked first." A route's line only gets an 8px tolerance
 * against an airport's 14px, so on a short route (or the map zoomed out)
 * most of the line used to sit inside both endpoints' airport radii and
 * could never win at all — checking the ratio instead means a click
 * genuinely close to the line, but not close enough to either airport to
 * count as "on" it, now correctly goes to the route.
 */
export function handleMapMenuMouseDown(event: MouseEvent, state: SimState): boolean {
  const airport = nearestAirportCandidate(event.clientX, event.clientY);
  const route = findNearestOwnRoute(event.clientX, event.clientY, state);

  const airportWins = airport && (airport.ratio <= AIRPORT_SURE_WIN_RATIO || !route || airport.ratio <= route.ratio);
  if (airportWins) {
    hideCompetitionTooltip();
    openAirportMenu(airport.airport, state);
    return true;
  }

  if (route) {
    hideCompetitionTooltip();
    openRouteMenu(route.origin, route.dest, state, event.clientX, event.clientY);
    return true;
  }

  return false;
}

/** Whether the info card and ring are showing, so the hover tooltip can stay out of their way. */
export function isMapMenuOpen(): boolean {
  return open !== null;
}

export function handleMapMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open) hideMapMenu();
}
