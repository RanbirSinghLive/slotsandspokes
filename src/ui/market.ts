import { AIRCRAFT_CLASSES, pluralClassName } from '../sim/aircraftClasses';
import { daysUntilNextListing, hasDebuted, listingsOf, MARKET_RHYTHM } from '../sim/market';
import type { SimState } from '../sim/state';

/**
 * The fleet market's readouts (sim/market.ts), apart from the lease
 * buttons themselves (ui/mapMenu.ts):
 *
 *   - The Lessor strip in the Fleet tab: per class, what's listed and when
 *     the next one arrives, so a player can plan around the timers
 *     instead of checking the lease fan over and over.
 *   - A pop-up the first time a class reaches the market — the moment a
 *     whole new kind of airline becomes possible. Everyday arrivals and
 *     rival leases go in the ticker (ui/ticker.ts) instead.
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
    const when = `${next} day${next === 1 ? '' : 's'}`;
    const status = !hasDebuted(state, cls.code)
      ? `first arrives in ${when}`
      : listings.length === 0
        ? `none listed · next in ${when}`
        : `${listings.length} listed (${listings.map((l) => `${l.ageYears} yrs`).join(', ')}) · next in ${when}`;
    return { name: cls.name, status, empty: listings.length === 0 };
  });
  const signature = rows.map((row) => `${row.name}:${row.status}`).join('|');
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
      div.append(name, status);
      return div;
    }),
  );
}

// Classes already on the market when this page loaded aren't announced —
// only a debut that happens while the player is watching.
let announced: Set<string> | null = null;

function pollDebuts(state: SimState): void {
  const debuted = Object.keys(MARKET_RHYTHM).filter((code) => hasDebuted(state, code));
  if (announced === null) {
    announced = new Set(debuted);
    return;
  }
  for (const code of debuted) {
    if (announced.has(code)) continue;
    announced.add(code);
    const cls = AIRCRAFT_CLASSES.find((c) => c.code === code);
    if (!cls) continue;
    const listed = listingsOf(state, code);
    debutTitle.textContent = `${pluralClassName(cls.name)} are now on the market`;
    debutBody.textContent =
      `The lessor has its first ${listed.length === 1 ? cls.name : pluralClassName(cls.name)} (${cls.seats} seats) listed` +
      (listed[0] ? `, from $${listed[0].leasePricePerDay.toLocaleString()}/day` : '') +
      `. First come, first served: rivals lease from the same shelf. Tap an airport, then Plane, to lease one.`;
    debutModal.hidden = false;
  }
}

export function updateMarket(state: SimState): void {
  renderStrip(state);
  pollDebuts(state);
}
