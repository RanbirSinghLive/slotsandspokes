import { AIRCRAFT_CLASSES, classByCode, pluralClassName, type AircraftClass } from '../sim/aircraftClasses';
import { dayIndex } from '../sim/clock';
import { crewBases } from '../sim/crews';
import { ageDelayParameters, expectedAgeDelayMinutes } from '../sim/delays';
import { airlineCalled, classOpen, tierThatOpens } from '../sim/ladder';
import { cashNeededToLease, LEASE_RESERVE_DAYS, USEFUL_LIFE_YEARS } from '../sim/leasing';
import { daysUntilNextListing, holdDaysLeft, HOLD_DAYS, listingsOf, MARKET_RHYTHM, priceIndexOf, type MarketListing } from '../sim/market';
import { overheadAddedByNextPlane } from '../sim/overhead';
import { clearStandingOrder, setStandingOrder, standingOrderOf } from '../sim/standingOrders';
import { deliveryDays } from '../sim/fleetTiming';
import { select } from './selection';
import { showConfirm } from './confirmModal';
import { money, shortMoney } from './format';
import type { SimState } from '../sim/state';
import { info } from './inspector/dom';
import { renderInspector } from './inspector/inspector';
import { linkToMap } from './mapLink';
import { planeIconElement, TYPE_COLOURS } from './planeIcons';
import { glyph, type GlyphName } from './glyphs';
import { openFleet } from './fleetView';
import * as ops from './routeActions';
import { blockHourCostAtUsualFuel } from '../sim/economy';

/**
 * The fleet market's readouts (sim/market.ts), apart from the lease
 * buttons themselves (ui/mapMenu.ts):
 *
 *   - The Market half of the Fleet tab (ui/fleetView.ts): leases on
 *     order, then one card per class with its specs, the price trend, a
 *     standing-order bell and its shelf, one place per airframe the class
 *     can hold. A listed airframe leases from its tile, so a player can
 *     plan around the timers and lease without hunting for an airport.
 *   - A pop-up the moment the ladder opens a class to the player
 *     (sim/ladder.ts) — a whole new kind of airline becomes possible.
 *     Everyday arrivals and rival leases go in the ticker (ui/ticker.ts)
 *     instead.
 */

const stripEl = document.querySelector<HTMLElement>('#market-strip')!;
const debutModal = document.querySelector<HTMLElement>('#market-debut-modal')!;
const debutTitle = document.querySelector<HTMLElement>('#market-debut-title')!;
const debutBody = document.querySelector<HTMLElement>('#market-debut-body')!;
const debutClose = document.querySelector<HTMLButtonElement>('#market-debut-close')!;

debutClose.addEventListener('click', () => {
  debutModal.hidden = true;
});

const chipEl = document.querySelector<HTMLButtonElement>('#market-chip')!;
// The chip means the shelf, so it opens Fleet on its Market half.
chipEl.addEventListener('click', () => openFleet('market'));

let stripSignature = '';
let chipSignature = '';
let currentState: SimState | null = null;

/** Standing order choices: how old an airframe the order may take. */
const ORDER_AGES = [
  { label: '≤17y', maxAgeYears: 17 },
  { label: '≤20y', maxAgeYears: 20 },
  { label: 'any', maxAgeYears: 24 },
];

function openOrderDialog(state: SimState, code: string, name: string): void {
  const existing = standingOrderOf(state, code);
  if (existing) {
    showConfirm({
      title: `Standing order · ${name}`,
      rows: [{ label: 'Takes', value: `next ${name} ≤ ${existing.maxAgeYears} yrs, based ${state.homeAirport}` }, { label: 'Arrives', value: `${deliveryDays(state)}d after leasing` }],
      facts: ['Leases it the moment it is listed, then clears itself.'],
      confirmLabel: 'Remove order',
      run: () => {
        clearStandingOrder(state, code);
        stripSignature = '';
        chipSignature = '';
      },
    });
    return;
  }
  const rowsFor = (index: number) => [
    { label: 'Takes', value: `next ${name} ≤ ${ORDER_AGES[index].maxAgeYears} yrs` },
    { label: 'Based at', value: `${state.homeAirport} (home) · +${deliveryDays(state)}d` },
  ];
  showConfirm({
    title: `Standing order · ${name}`,
    rows: [],
    choices: { chips: ORDER_AGES.map((a) => ({ label: a.label, title: `Lease the youngest ${name} aged ${a.maxAgeYears} or less` })), selected: 1, rowsFor },
    facts: [`Leases the youngest match the moment one is listed, if cash covers ${30} days of lease. One plane, then the order clears.`],
    confirmLabel: 'Place order',
    run: (index) => {
      setStandingOrder(state, code, { maxAgeYears: ORDER_AGES[index].maxAgeYears });
      stripSignature = '';
      chipSignature = '';
    },
  });
}

/** The HUD chip: a plane and a count for every class listed that the player can lease; green when cash covers one, amber when not. */
function renderChip(state: SimState): void {
  const open = AIRCRAFT_CLASSES.filter((cls) => classOpen(state, cls.code)).map((cls) => ({ cls, listings: listingsOf(state, cls.code) })).filter((c) => c.listings.length > 0);
  const signature = open
    .map(({ cls, listings }) => `${cls.code}:${listings.map((l) => `${l.id}.${holdDaysLeft(state, l)}`).join(',')}:${standingOrderOf(state, cls.code)?.maxAgeYears ?? 0}:${Math.floor(state.cash / 10000)}`)
    .join('|');
  if (signature === chipSignature) return;
  chipSignature = signature;
  chipEl.hidden = open.length === 0;
  if (open.length === 0) return;
  const parts: Node[] = [];
  const lines: string[] = [];
  let anyAffordable = false;
  for (const { cls, listings } of open) {
    const cheapest = Math.min(...listings.map((l) => l.leasePricePerDay));
    const affordable = state.cash >= cashNeededToLease(cheapest);
    anyAffordable ||= affordable;
    const hold = Math.min(...listings.map((l) => holdDaysLeft(state, l)));
    const span = document.createElement('span');
    span.className = affordable ? 'market-chip-class is-affordable' : 'market-chip-class is-short';
    span.append(planeIconElement(cls.code), ` ${listings.length}`);
    // The ring: how much of the player-first hold is left before rivals may lease it.
    if (hold > 0) {
      const ring = document.createElement('i');
      ring.className = 'market-chip-ring';
      ring.style.setProperty('--left', `${Math.round((hold / HOLD_DAYS) * 100)}%`);
      span.append(ring);
    }
    parts.push(span);
    const order = standingOrderOf(state, cls.code);
    lines.push(
      `${cls.name} · ${listings.map((l) => `${l.ageYears}y ${money(l.leasePricePerDay)}/day`).join(' · ')}` +
        (hold > 0 ? ` · yours ${hold}d more` : ' · rivals may lease') +
        (affordable ? '' : ` · needs ${money(cashNeededToLease(cheapest))}`) +
        (order ? ` · order ≤${order.maxAgeYears}y` : ''),
    );
  }
  chipEl.classList.toggle('is-short', !anyAffordable);
  chipEl.replaceChildren(...parts);
  chipEl.title = lines.join('\n');
}

/** Bases a class can be leased into now (sim/playerActions.ts's planeOptions()), home first; the home's refusal when none can. */
function leaseBases(state: SimState, code: string): { bases: string[]; refusal: string | null } {
  const stations = [...new Set([state.homeAirport, ...Object.keys(crewBases(state))])];
  const bases: string[] = [];
  let refusal: string | null = null;
  for (const iata of stations) {
    const option = ops.planeOptions(state, iata).find((o) => o.code === code && o.powertrain !== 'electric');
    if (!option) continue;
    if (option.disabledReason) refusal ??= option.disabledReason;
    else bases.push(iata);
  }
  return { bases, refusal: bases.length > 0 ? null : refusal };
}

/** The lease confirm for one listed airframe: the player picks the base, the rows say what it adds. */
function openLeaseDialog(state: SimState, code: string, listing: MarketListing, bases: string[]): void {
  const cls = classByCode(code)!;
  const overhead = overheadAddedByNextPlane(state);
  const held = holdDaysLeft(state, listing);
  const arrives = dayIndex(state) + deliveryDays(state);
  const rowsFor = (index: number) => [
    { label: 'Airframe', value: `${cls.seats} seats · ${listing.ageYears} yrs (${Math.max(0, USEFUL_LIFE_YEARS - listing.ageYears)} left)` },
    { label: 'Late from age', value: `~${Math.round(expectedAgeDelayMinutes(listing.ageYears))} min/flight` },
    { label: 'Lease', value: `${money(listing.leasePricePerDay)}/day` },
    { label: 'Fleet overhead added', value: `${money(overhead)}/day` },
    { label: 'Running cost added', value: `${money(listing.leasePricePerDay + overhead)}/day` },
    { label: 'Based at', value: `${bases[index]} · arrives day ${arrives} (${deliveryDays(state)}d)` },
    ...(held > 0 ? [{ label: 'Held for you', value: `${held}d before rivals can lease it` }] : []),
  ];
  showConfirm({
    title: `Lease ${cls.name} · ${listing.ageYears} yrs`,
    rows: [],
    choices: {
      selected: 0,
      rowsFor,
      chips: bases.map((iata) => ({ label: iata, title: iata === state.homeAirport ? `Base it at ${iata} (home)` : `Base it at ${iata}` })),
    },
    facts: ['Standing lease. For a 90-day season lease, tap an airport on the map and choose Plane.', 'Crews are hired separately: have crews rated on this type at the base before its first flight.'],
    confirmLabel: 'Lease',
    run: (index) => {
      ops.leasePlane(state, bases[index], code, false, undefined, listing.id);
      stripSignature = '';
      chipSignature = '';
      renderInspector(state);
    },
  });
}

/** An empty or coming place on the shelf: dashed, with the days to the next airframe on the first one. */
function emptySlot(text: string, tip: string, timer = false): HTMLElement {
  const slot = document.createElement('div');
  slot.className = 'market-slot is-empty';
  if (timer) slot.append(glyph('timer'));
  slot.append(text);
  slot.dataset.tip = tip;
  return slot;
}

/** One listed airframe: age, rate, how often it leaves on time, the player-first hold, and the tap that leases it. */
function listingTile(state: SimState, code: string, listing: MarketListing, bases: string[], refusal: string | null): HTMLElement {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'market-slot';
  const affordable = state.cash >= cashNeededToLease(listing.leasePricePerDay);
  const blocked = refusal ?? (affordable ? null : `Needs ${money(cashNeededToLease(listing.leasePricePerDay))} on hand (${LEASE_RESERVE_DAYS} days of lease)`);
  tile.classList.toggle('is-short', blocked !== null);
  const onTime = ageDelayParameters(listing.ageYears).onTimeProbability;
  const age = document.createElement('span');
  age.className = 'market-slot-age';
  age.textContent = `${listing.ageYears}y`;
  const rate = document.createElement('span');
  rate.className = 'market-slot-rate';
  rate.textContent = shortMoney(listing.leasePricePerDay);
  // Taller bar = more on time, as in the lease fan's chips.
  const meter = document.createElement('i');
  meter.className = 'market-slot-meter';
  meter.style.setProperty('--fill', `${Math.round(onTime * 100)}%`);
  tile.append(meter, age, rate);
  const hold = holdDaysLeft(state, listing);
  if (hold > 0) {
    const ring = document.createElement('i');
    ring.className = 'market-slot-hold';
    ring.style.setProperty('--left', `${Math.round((hold / HOLD_DAYS) * 100)}%`);
    tile.append(ring);
  }
  tile.dataset.tip =
    `${listing.ageYears} yrs · ${money(listing.leasePricePerDay)}/day · tech dispatch ${Math.round(onTime * 100)}% · ~${Math.round(expectedAgeDelayMinutes(listing.ageYears))} min late/flight from age` +
    (hold > 0 ? ` · yours ${hold}d more` : ' · rivals may lease') +
    (blocked ? ` · ${blocked}` : ' · tap to lease');
  tile.disabled = blocked !== null;
  tile.addEventListener('click', () => currentState && openLeaseDialog(currentState, code, listing, bases));
  return tile;
}

/** Specs as icon-led chips: seats, range, cruise, cost per block hour. */
function specChips(code: string): HTMLElement {
  const cls = classByCode(code) as (AircraftClass & { cruiseKts?: number; costPerBlockHour?: number }) | undefined;
  const specs = document.createElement('div');
  specs.className = 'market-specs';
  const chip = (icon: GlyphName, text: string, tip: string) => {
    const el = document.createElement('span');
    el.className = 'market-spec';
    el.dataset.tip = tip;
    el.append(glyph(icon), ` ${text}`);
    return el;
  };
  if (!cls) return specs;
  specs.append(chip('seat', String(cls.seats), 'Seats, all economy, before any refit'), chip('globe', `${cls.rangeNm.toLocaleString()} nm`, 'Range: the longest sector it can fly'));
  if (cls.cruiseKts) specs.append(chip('timer', `${cls.cruiseKts} kt`, 'Cruise speed: sets block time'));
  if (cls.costPerBlockHour) specs.append(chip('coin', `${shortMoney(blockHourCostAtUsualFuel({ seats: 0, costPerBlockHour: cls.costPerBlockHour, costPerDeparture: 0 }))}/bh`, 'Running cost per block hour: fuel, crew time and wear, before the lease'));
  return specs;
}

function renderStrip(state: SimState): void {
  const today = dayIndex(state);
  const inbound = [...(state.inboundLeases ?? [])].sort((a, b) => a.arrivesDay - b.arrivesDay);
  const classes = AIRCRAFT_CLASSES.map((cls) => {
    const locked = !classOpen(state, cls.code);
    const listings = listingsOf(state, cls.code);
    return { cls, locked, listings, lease: locked ? { bases: [], refusal: null } : leaseBases(state, cls.code) };
  });
  const signature =
    `${today}:${Math.floor(state.cash / 10000)}:${state.aircraft.length}:` +
    inbound.map((l) => `${l.typeCode}.${l.base}.${l.arrivesDay}`).join(',') +
    '|' +
    classes
      .map(({ cls, locked, listings, lease }) =>
        [cls.code, locked, listings.map((l) => `${l.id}.${holdDaysLeft(state, l)}`).join(','), daysUntilNextListing(state, cls.code), standingOrderOf(state, cls.code)?.maxAgeYears ?? 0, priceIndexOf(state.market, cls.code).toFixed(2), lease.bases.join('.'), lease.refusal].join(':'),
      )
      .join('|');
  if (signature === stripSignature) return;
  stripSignature = signature;

  const parts: HTMLElement[] = [];

  // Leases signed and not yet delivered, soonest first: a dashed plane with its base and day.
  if (inbound.length > 0) {
    const orders = document.createElement('div');
    orders.className = 'market-orders';
    for (const lease of inbound) {
      const row = linkToMap(document.createElement('button'), { kind: 'airport', iata: lease.base });
      row.type = 'button';
      row.className = 'market-order';
      row.addEventListener('click', () => select({ kind: 'airport', iata: lease.base }));
      const left = Math.max(0, lease.arrivesDay - today);
      const total = Math.max(1, deliveryDays(state));
      const bar = document.createElement('i');
      bar.className = 'market-order-bar';
      bar.style.setProperty('--done', `${Math.round(Math.max(0, Math.min(1, 1 - left / total)) * 100)}%`);
      const icon = planeIconElement(lease.typeCode);
      icon.style.color = TYPE_COLOURS[lease.typeCode] ?? '';
      const text = document.createElement('span');
      text.textContent = `→ ${lease.base} · ${left}d`;
      row.append(icon, text, bar);
      row.dataset.tip = `On order: ${classByCode(lease.typeCode)?.name ?? lease.typeCode}, delivered at ${lease.base} on day ${lease.arrivesDay}; ${money(lease.leasePricePerDay)}/day from then.`;
      orders.append(row);
    }
    parts.push(orders);
  }

  const cards = document.createElement('div');
  cards.className = 'market-cards';
  for (const { cls, locked, listings, lease } of classes) {
    const card = document.createElement('section');
    card.className = `market-card${locked ? ' is-locked' : ''}`;
    card.style.setProperty('--type', TYPE_COLOURS[cls.code] ?? '#5ed6c8');

    const head = document.createElement('div');
    head.className = 'market-card-head';
    const icon = planeIconElement(cls.code);
    icon.classList.add('market-card-icon');
    const name = document.createElement('span');
    name.className = 'market-card-name';
    name.textContent = cls.name;
    head.append(icon, name);
    const flying = state.aircraft.filter((a) => a.typeCode === cls.code).length;
    const coming = inbound.filter((l) => l.typeCode === cls.code).length;
    if (flying + coming > 0) {
      const owned = document.createElement('span');
      owned.className = 'market-card-owned';
      owned.textContent = `${flying}${coming > 0 ? ` +${coming}` : ''}`;
      owned.dataset.tip = `${flying} in your fleet` + (coming > 0 ? ` · ${coming} on order` : '');
      head.append(owned);
    }
    // The lessor's price level: an arrow once it is 5% or more off the rate card.
    const price = locked ? 1 : priceIndexOf(state.market, cls.code);
    if (Math.abs(price - 1) >= 0.05) {
      const pct = Math.round(Math.abs(price - 1) * 100);
      const trend = document.createElement('span');
      trend.className = price > 1 ? 'market-trend is-up' : 'market-trend is-down';
      trend.textContent = `${price > 1 ? '▲' : '▼'}${pct}%`;
      trend.dataset.tip = `Lessor rates ${price > 1 ? `+${pct}% · shelf running short` : `−${pct}% · listings sitting`}. A lease keeps the rate it was signed at.`;
      head.append(trend);
    }
    if (locked) {
      const opener = tierThatOpens(cls.code);
      const lock = document.createElement('span');
      lock.className = 'market-card-lock';
      lock.append('🔒 ', info(`Opens as ${opener ? airlineCalled(opener) : 'a bigger airline'}. See Goals. Until then its listings are for rivals.`));
      head.append(lock);
    } else {
      // The bell places or removes a standing order for this class.
      const order = standingOrderOf(state, cls.code)?.maxAgeYears ?? 0;
      const bell = document.createElement('button');
      bell.type = 'button';
      bell.className = `market-bell${order ? ' is-set' : ''}`;
      bell.textContent = '🔔';
      bell.dataset.tip = order ? `Standing order ≤${order}y · tap to remove` : 'Standing order: lease the next one for you';
      bell.setAttribute('aria-label', bell.dataset.tip);
      bell.addEventListener('click', () => currentState && openOrderDialog(currentState, cls.code, cls.name));
      head.append(bell);
    }
    card.append(head, specChips(cls.code));

    // The shelf: one place per airframe it can hold, listed ones first.
    const rhythm = MARKET_RHYTHM[cls.code];
    const cap = rhythm?.cap ?? Math.max(1, listings.length);
    const next = daysUntilNextListing(state, cls.code);
    const shelf = document.createElement('div');
    shelf.className = 'market-shelf';
    const youngestFirst = [...listings].sort((a, b) => a.ageYears - b.ageYears || a.id - b.id);
    for (const listing of youngestFirst) {
      if (locked) {
        const slot = emptySlot(`${listing.ageYears}y`, `${listing.ageYears} yrs · ${money(listing.leasePricePerDay)}/day · rivals only until it opens`);
        slot.classList.add('is-rival');
        shelf.append(slot);
      } else {
        shelf.append(listingTile(state, cls.code, listing, lease.bases, lease.refusal));
      }
    }
    for (let i = listings.length; i < cap; i++) {
      shelf.append(i === listings.length ? emptySlot(`${next}d`, `Next ${cls.name} listed in ${next}d · first come first served`, true) : emptySlot('', 'Room on the shelf'));
    }
    if (listings.length >= cap) {
      // A full shelf: the next arrival is lost unless someone leases one first.
      const full = emptySlot(`${next}d`, `Shelf full: the ${cls.name} due in ${next}d is lost unless one is leased first`, true);
      full.classList.add('is-full');
      shelf.append(full);
    }
    card.append(shelf);
    if (!locked && lease.refusal && listings.length > 0) {
      const why = document.createElement('div');
      why.className = 'market-card-why';
      why.textContent = lease.refusal;
      card.append(why);
    }
    cards.append(card);
  }
  parts.push(cards);
  stripEl.replaceChildren(...parts);
}

// Classes already open when this page loaded aren't announced, only one
// the ladder opens while the player is watching.
let announced: Set<string> | null = null;

function pollUnlocks(state: SimState): void {
  const open = AIRCRAFT_CLASSES.filter((cls) => classOpen(state, cls.code)).map((cls) => cls.code);
  if (announced === null) {
    announced = new Set(open);
    return;
  }
  for (const code of open) {
    if (announced.has(code)) continue;
    announced.add(code);
    const cls = AIRCRAFT_CLASSES.find((c) => c.code === code);
    if (!cls) continue;
    const listed = listingsOf(state, code);
    debutTitle.textContent = `${pluralClassName(cls.name)} unlocked`;
    debutBody.textContent =
      `${cls.seats} seats · ` +
      (listed.length > 0 ? `${listed.length} listed from $${listed[0].leasePricePerDay.toLocaleString()}/day` : 'none listed yet') +
      ' · rivals lease from the same shelf. Tap an airport, then Plane, to lease one.';
    debutModal.hidden = false;
  }
}

export function updateMarket(state: SimState): void {
  currentState = state;
  renderStrip(state);
  renderChip(state);
  pollUnlocks(state);
}
