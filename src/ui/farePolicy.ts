import { dayIndex } from '../sim/clock';
import { FARE_POLICY_MAX, FARE_POLICY_MIN, pricingSummary, setFarePolicy } from '../sim/pricing';
import { networkHill } from '../sim/revenueHill';
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

let drawnSignature = '';
let dragging = false;

const percent = (level: number) => `${Math.round(level * 100)}%`;

function signatureOf(state: SimState): string {
  const { policy, stance, hand } = pricingSummary(state);
  return `${dayIndex(state)}|${policy}|${stance}|${hand}|${state.schedule.length}|${state.farePolicyMultiplier}`;
}

function rebuild(state: SimState): void {
  drawnSignature = signatureOf(state);
  const hill = networkHill(state);
  chartEl.replaceChildren();
  if (!hill || hill.policyRoutes === 0) {
    statusEl.textContent = hill ? `0 routes on policy · ${hill.byHand.routes} priced in their route view` : 'No routes yet';
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
  });
  chartEl.append(drawn.element);

  const renderStatus = () => {
    const level = state.farePolicyMultiplier;
    const { low, high } = hill.peakRange;
    const atTop = level >= low - 1e-9 && level <= high + 1e-9;
    const top = atTop ? 'the top could be here' : `top probably ${percent(low)}${high > low ? `–${percent(high)}` : ''}`;
    const byHand =
      hill.byHand.routes > 0
        ? ` · ${hill.byHand.gainPerDay >= 0 ? '+' : '−'}${money(Math.abs(hill.byHand.gainPerDay))}/day from ${hill.byHand.routes} priced by hand`
        : '';
    statusEl.textContent = `${percent(level)} · ${hill.policyRoutes} route${hill.policyRoutes === 1 ? '' : 's'} on policy · ${top}${byHand}`;
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
