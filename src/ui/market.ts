import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { airlineCalled, classOpen, tierThatOpens } from '../sim/ladder';
import { daysUntilNextListing, listingsOf } from '../sim/market';
import type { SimState } from '../sim/state';
import { info } from './inspector/dom';

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
    const when = `${next}d`;
    const opener = tierThatOpens(cls.code);
    // A locked class is just locked: its listings are for rivals until the ladder opens it.
    const locked = !classOpen(state, cls.code);
    const status = locked
      ? 'Locked'
      : listings.length === 0
        ? `none · next ${when}`
        : `${listings.length} · ${listings.map((l) => l.ageYears).join(', ')} yrs · next ${when}`;
    const why = locked ? `Opens as ${opener ? airlineCalled(opener) : 'a bigger airline'}. See Goals.` : null;
    return { name: cls.name, status, why, empty: locked || listings.length === 0 };
  });
  const signature = rows.map((row) => `${row.name}:${row.status}:${row.why}`).join('|');
  if (signature === stripSignature) return;
  stripSignature = signature;
  stripEl.replaceChildren(
    ...rows.map((row) => {
      const div = document.createElement('div');
      div.className = 'market-row';
      div.classList.toggle('is-empty', row.empty);
      const name = document.createElement('span');
      name.textContent = row.name;
      const status = document.createElement('span');
      status.textContent = row.status;
      if (row.why) status.append(' ', info(row.why));
      div.append(name, status);
      return div;
    }),
  );
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
