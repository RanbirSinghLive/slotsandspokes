import { dayIndex } from '../sim/clock';
import { FARE_POLICY_MAX, FARE_POLICY_MIN, fareClassPolicy, pricingSummary, putAllOnPolicy, putAllSeatsOnPolicy, seatPolicySummary, setFareClassPolicy, setFarePolicy } from '../sim/pricing';
import { CLASS_NAMES, CLASS_ORDER, CLASS_PRICE } from '../sim/fareClasses';
import { buildSeatSplitBar } from './seatSplitBar';
import { networkHill } from '../sim/revenueHill';
import { BRAND_DAYS, brandLevel, brandPosition, LOW_COST_LEVEL, networkFareLevelToday, PREMIUM_LEVEL } from '../sim/brand';
import { info } from './inspector/dom';
import type { SimState } from '../sim/state';
import { money } from './format';
import { drawHillChart } from './hillChart';

/**
 * The airline-wide fare policy (sim/pricing.ts), in the Routes screen: the
 * network hill (sim/revenueHill.ts), every route on the policy added up
 * across fare levels, with the level as a ball to drag. Below it, how many
 * routes it covers and what the routes priced by hand make against it. A
 * route's own fare and stance are in its route view (ui/inspector/route.ts).
 *
 * The hill is only rebuilt when what it's drawn from changes (a new day,
 * routes opened, closed or taken off the policy), never mid-drag.
 */

const LEVEL_STEP = 0.05;

const chartEl = document.querySelector<HTMLDivElement>('#fare-policy-hill')!;
const statusEl = document.querySelector<HTMLDivElement>('#fare-policy-status')!;
const seatsEl = document.querySelector<HTMLDivElement>('#seat-policy')!;

let drawnSignature = '';
/** The back-to-policy button, kept under the status line and replaced on each rebuild. */
let backButtonEl: HTMLButtonElement | null = null;
/** The brand line (sim/brand.ts), kept under the status line. */
let brandEl: HTMLDivElement | null = null;

function renderBrand(state: SimState): void {
  brandEl?.remove();
  const today = networkFareLevelToday(state);
  if (today === null) {
    brandEl = null;
    return;
  }
  const level = brandLevel(state);
  const heading = today < level - 0.03 ? ' · moving cheaper' : today > level + 0.03 ? ' · moving dearer' : '';
  brandEl = document.createElement('div');
  brandEl.className = 'inspector-line';
  brandEl.append(
    `Brand ${brandPosition(state)} · ${percent(level)} · today ${percent(today)}${heading} `,
    info(
      `What the airline is known for, from what it charges: every flight's fare against its going rate, weighted by seats, remembered over about ${BRAND_DAYS} days. Under ${percent(LOW_COST_LEVEL)} it's Low-cost: leisure and VFR travellers prefer you to a rival, business travellers less. Over ${percent(PREMIUM_LEVEL)} it's Premium: the reverse. It takes months to build and months to move.`,
    ),
  );
  statusEl.after(brandEl);
}
let dragging = false;

const percent = (level: number) => `${Math.round(level * 100)}%`;

function signatureOf(state: SimState): string {
  const { policy, stance, hand } = pricingSummary(state);
  const seats = seatPolicySummary(state);
  const split = fareClassPolicy(state);
  return `${dayIndex(state)}|${policy}|${stance}|${hand}|${state.schedule.length}|${state.farePolicyMultiplier}|${seats.byHand}|${split.saverShare}|${split.flexShare}`;
}

/** Every route off the policy (by hand or on a stance) back on it, in one press. Null when none are off. */
function backToPolicyButton(state: SimState, offPolicy: number): HTMLButtonElement | null {
  if (offPolicy === 0) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lever-reset';
  button.textContent = `↺ ${offPolicy}`;
  button.title = `Put all ${offPolicy} routes that are off policy back on it`;
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', () => {
    putAllOnPolicy(state);
    rebuild(state);
  });
  return button;
}

/**
 * The airline-wide seat split (sim/pricing.ts's setFareClassPolicy()): the
 * same bar as a route's, moving every route not set by hand. Rebuilt with
 * the hill, never mid-drag.
 */
function rebuildSeats(state: SimState): void {
  seatsEl.replaceChildren();
  const { routes, byHand } = seatPolicySummary(state);
  const status = document.createElement('div');
  const renderStatus = () => {
    const { saverShare, flexShare } = fareClassPolicy(state);
    const shares = [saverShare, flexShare, Math.max(0, 1 - saverShare - flexShare)];
    const parts = CLASS_ORDER.map((fareClass, i) => `${CLASS_NAMES[fareClass]} ${percent(shares[i])}`);
    status.textContent = `${parts.join(' · ')}${byHand > 0 ? ` · ${byHand} of ${routes} by hand` : ''}`;
  };
  const { bar } = buildSeatSplitBar({
    split: () => fareClassPolicy(state),
    move: (saver, flex) => {
      dragging = true;
      setFareClassPolicy(state, saver, flex);
      renderStatus();
    },
    done: () => {
      dragging = false;
      rebuild(state);
    },
  });
  const heading = document.createElement('h2');
  heading.append(
    'Seat policy ',
    info(
      `Every route sells Saver, Flex and Full seats at ${CLASS_ORDER.map((fareClass) => `${percent(CLASS_PRICE[fareClass])}`).join(' · ')} of the going fare (see a route view). This is the split every route not set by hand uses: drag the lines to move all of them at once. A route whose own lines you move leaves the policy; open its route view to change it, or put it back with the ↺ button here.`,
    ),
  );
  seatsEl.append(heading, bar, status);
  renderStatus();
  if (byHand > 0) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'lever-reset';
    back.textContent = `↺ ${byHand}`;
    back.title = `Put all ${byHand} routes with their own seat split back on policy`;
    back.setAttribute('aria-label', back.title);
    back.addEventListener('click', () => {
      putAllSeatsOnPolicy(state);
      rebuild(state);
    });
    seatsEl.append(back);
  }
}

function rebuild(state: SimState): void {
  drawnSignature = signatureOf(state);
  rebuildSeats(state);
  renderBrand(state);
  const hill = networkHill(state);
  chartEl.replaceChildren();
  backButtonEl?.remove();
  backButtonEl = null;
  if (!hill) {
    statusEl.textContent = 'No routes yet';
    return;
  }
  const offPolicy = hill.byHand.routes;
  backButtonEl = backToPolicyButton(state, offPolicy);
  if (backButtonEl) (brandEl ?? statusEl).after(backButtonEl);
  if (hill.policyRoutes === 0) {
    statusEl.textContent = 'No routes on policy';
    return;
  }
  const setLevel = (level: number) => {
    const next = Math.round(Math.min(FARE_POLICY_MAX, Math.max(FARE_POLICY_MIN, level)) / LEVEL_STEP) * LEVEL_STEP;
    if (Math.abs(next - state.farePolicyMultiplier) < 1e-9) return;
    dragging = true;
    setFarePolicy(state, next);
    drawn.moveBall();
    renderStatus();
  };
  const drawn = drawHillChart({
    points: hill.points.map((p) => ({ x: p.level, margin: p.margin, uncertainty: p.uncertainty, invites: p.invitesRivals })),
    low: FARE_POLICY_MIN,
    high: FARE_POLICY_MAX,
    observations: [],
    flags: [],
    peak: { x: hill.peak.level, margin: hill.peak.margin },
    peakRange: hill.peakRange,
    ticks: [{ x: 1, label: 'going 100%' }],
    format: percent,
    value: () => state.farePolicyMultiplier,
    setValue: setLevel,
    done: () => {
      dragging = false;
      rebuild(state);
    },
    step: LEVEL_STEP,
    ariaLabel: 'Fare policy',
    valueLabel: 'policy level',
  });
  chartEl.append(drawn.element);

  const renderStatus = () => {
    const level = state.farePolicyMultiplier;
    const { low, high } = hill.peakRange;
    const atTop = level >= low - 1e-9 && level <= high + 1e-9;
    const top = atTop ? 'at the top' : `top ${percent(low)}${high > low ? `–${percent(high)}` : ''}`;
    const byHand = offPolicy > 0 ? ` · off policy ${hill.byHand.gainPerDay >= 0 ? '+' : '−'}${money(Math.abs(hill.byHand.gainPerDay))}/day` : '';
    statusEl.textContent = `${percent(level)} · ${hill.policyRoutes} route${hill.policyRoutes === 1 ? '' : 's'} · ${top}${byHand}`;
  };
  renderStatus();
}

export function setupFarePolicy(state: SimState): void {
  rebuild(state);
}

/** Redraw the hill if routes or the day have changed since it was drawn. Called each frame the Routes screen shows. */
export function updateFarePolicy(state: SimState): void {
  if (dragging) return;
  if (signatureOf(state) !== drawnSignature) rebuild(state);
}
