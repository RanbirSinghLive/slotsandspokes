import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { airlineCalled, classOpen, tierThatOpens } from '../sim/ladder';
import { daysUntilNextListing, listingsOf } from '../sim/market';
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

let stripSignature = '';

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
      why: locked ? `Opens as ${opener ? airlineCalled(opener) : 'a bigger airline'}. See Goals.` : null,
      empty: locked || listings.length === 0,
    };
  });
  const signature = rows.map((row) => `${row.name}:${row.listed}:${row.ages}:${row.next}:${row.why}`).join('|');
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
    cells.push(name);
    if (row.why) {
      const locked = cell('🔒 Locked ', 'market-locked is-empty');
      locked.append(info(row.why));
      cells.push(locked);
    } else {
      cells.push(cell(row.listed, `market-num${row.empty ? ' is-empty' : ''}`), cell(row.ages, 'market-num is-empty'), cell(row.next, 'market-num'));
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
  renderStrip(state);
  pollUnlocks(state);
}
