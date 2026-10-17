import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { airlineCalled, classOpen, tierThatOpens } from '../sim/ladder';
import { cashNeededToLease } from '../sim/leasing';
import { daysUntilNextListing, holdDaysLeft, HOLD_DAYS, listingsOf, priceIndexOf } from '../sim/market';
import { clearStandingOrder, setStandingOrder, standingOrderOf } from '../sim/standingOrders';
import { deliveryDays } from '../sim/fleetTiming';
import { select } from './selection';
import { showConfirm } from './confirmModal';
import { money } from './format';
import type { SimState } from '../sim/state';
import { info } from './inspector/dom';
import { planeIconElement } from './planeIcons';

/**
 * The fleet market's readouts (sim/market.ts), apart from the lease
 * buttons themselves (ui/mapMenu.ts):
 *
 *   - The Lessor strip in the Fleet tab: per class, what's listed and when
 *     the next one arrives, so a player can plan around the timers
 *     instead of checking the lease fan over and over.
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
chipEl.addEventListener('click', () => select({ kind: 'fleet' }));

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

function renderStrip(state: SimState): void {
  const rows = AIRCRAFT_CLASSES.map((cls) => {
    const listings = listingsOf(state, cls.code);
    const next = daysUntilNextListing(state, cls.code);
    const opener = tierThatOpens(cls.code);
    // A locked class is just locked: its listings are for rivals until the ladder opens it.
    const locked = !classOpen(state, cls.code);
    return {
      code: cls.code,
      name: cls.name,
      listed: String(listings.length),
      ages: listings.length > 0 ? listings.map((l) => l.ageYears).join(' ') : '—',
      next: `${next}d`,
      holds: listings.map((l) => holdDaysLeft(state, l)),
      order: standingOrderOf(state, cls.code)?.maxAgeYears ?? 0,
      why: locked ? `Opens as ${opener ? airlineCalled(opener) : 'a bigger airline'}. See Goals.` : null,
      empty: locked || listings.length === 0,
      price: locked ? 1 : priceIndexOf(state.market, cls.code),
    };
  });
  const signature = rows.map((row) => `${row.name}:${row.listed}:${row.ages}:${row.next}:${row.why}:${row.holds.join('.')}:${row.order}:${row.price}`).join('|');
  if (signature === stripSignature) return;
  stripSignature = signature;

  // A grid: class, how many listed, their ages in years, days to the next arrival.
  const cell = (text: string, className = '') => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  };
  const header = [cell('Class'), cell('Listed', 'market-num'), cell('Ages (yrs)', 'market-num'), cell('Next', 'market-num')];
  header.forEach((span) => span.classList.add('market-head'));
  const cells: HTMLElement[] = [...header];
  for (const row of rows) {
    const name = cell('', row.empty ? 'is-empty' : '');
    name.append(planeIconElement(row.code), ` ${row.name}`);
    // The lessor's price level: an arrow once it is 5% or more off the rate card.
    if (!row.why && Math.abs(row.price - 1) >= 0.05) {
      const trend = document.createElement('span');
      const pct = Math.round(Math.abs(row.price - 1) * 100);
      trend.className = row.price > 1 ? 'market-trend is-up' : 'market-trend is-down';
      trend.textContent = row.price > 1 ? ' ▲' : ' ▼';
      trend.title = `Lessor rates ${row.price > 1 ? `+${pct}% · shelf running short` : `−${pct}% · listings sitting`}. A lease keeps the rate it was signed at.`;
      name.append(trend);
    }
    cells.push(name);
    if (row.why) {
      const locked = cell('🔒 Locked ', 'market-locked is-empty');
      locked.append(info(row.why));
      cells.push(locked);
    } else {
      const ages = cell(row.ages, 'market-num is-empty');
      if (row.holds.some((h) => h > 0)) ages.title = `Yours ${Math.max(...row.holds)}d more: rivals cannot lease these yet`;
      // The bell places or removes a standing order for this class.
      const bell = document.createElement('button');
      bell.type = 'button';
      bell.className = `market-bell${row.order ? ' is-set' : ''}`;
      bell.textContent = '🔔';
      bell.title = row.order ? `Standing order ≤${row.order}y · tap to remove` : 'Standing order: lease the next one for you';
      bell.addEventListener('click', () => currentState && openOrderDialog(currentState, row.code, row.name));
      const count = cell(row.listed, `market-num${row.empty ? ' is-empty' : ''}`);
      count.append(' ', bell);
      cells.push(count, ages, cell(row.next, 'market-num'));
    }
  }
  stripEl.replaceChildren(...cells);
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
