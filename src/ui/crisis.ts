import { briefSettings } from '../sim/briefs';
import { dayIndex } from '../sim/clock';
import { openCrisis, previewCrisis, setCrisisWaived, type Crisis } from '../sim/crisis';
import { callPolicy } from '../sim/priority';
import type { SimState } from '../sim/state';
import { showConfirm } from './confirmModal';
import { money } from './format';

/**
 * The crisis forecast (sim/crisis.ts) on the page: a ⛈ chip in the HUD ops
 * row while a forecast is open, and a card with the numbers for both
 * answers. The card pops once when the forecast arrives (pausing the clock
 * if Pause on call is on) when the fleet's policy is ask; with priority
 * the chip only says the controller decides.
 */
const chipEl = document.querySelector<HTMLButtonElement>('#crisis-chip')!;

/** Forecasts already put in front of the player this visit. Screen state, not saved. */
const announced = new Set<number>();
let primed = false;

const POLICY_NOTE = { ask: '', priority: ' · ★ decides' } as const;

function percent(chance: number): string {
  return `${Math.round(chance * 100)}%`;
}

function showCard(state: SimState, crisis: Crisis): void {
  const preview = previewCrisis(state, crisis);
  const days = crisis.day - dayIndex(state);
  const decided = dayIndex(state) < crisis.day;
  showConfirm({
    title: `⛈ ${crisis.airport} · ${percent(crisis.chance)} · in ${days}d`,
    tone: 'priority',
    rows: [
      { label: `${preview.flights} flights · ${preview.passengers} pax`, value: `${money(preview.revenue)} a day` },
      { label: 'Fly on, storm comes', value: `−${money(preview.lossIfFlyOn)} · NPS −80 × ${preview.flights}` },
      { label: 'Fly on, storm misses', value: '$0' },
      { label: 'Waive the day', value: `−${money(preview.lossIfWaived)} · NPS −20 × ${preview.flights}` },
      { label: 'Waive wins above', value: percent(preview.breakEven) },
    ],
    facts: [
      'A closed airport cancels its flights and strands passengers (care bill). Waiving tells them ahead, so the bill is a quarter, but the day is lost even if the storm misses. Decide before the day begins.',
    ],
    confirmLabel: crisis.waived ? 'Undo waiver' : 'Waive the day',
    cancelLabel: crisis.waived ? 'Keep waived' : 'Fly on',
    run: () => {
      if (decided) setCrisisWaived(state, crisis.id, !crisis.waived);
      update(state, false);
    },
  });
}

function update(state: SimState, choosingHome: boolean): boolean {
  const crisis = openCrisis(state);
  chipEl.hidden = !crisis || choosingHome;
  if (!crisis) return false;
  const days = crisis.day - dayIndex(state);
  chipEl.textContent = `⛈ ${crisis.airport} ${percent(crisis.chance)}${crisis.waived ? ' ✂' : ''}`;
  chipEl.title = `Storm forecast · ${crisis.airport} · ${percent(crisis.chance)} · in ${days}d${crisis.waived ? ' · waived' : ''}${POLICY_NOTE[callPolicy(state)]}`;
  chipEl.onclick = () => showCard(state, crisis);
  return false;
}

/** Called once per rendered frame. Returns true on the frame a new forecast is put in front of the player, so the caller can pause. */
export function updateCrisis(state: SimState, choosingHome: boolean): boolean {
  update(state, choosingHome);
  const crisis = openCrisis(state);
  if (!primed) {
    for (const c of state.crises ?? []) announced.add(c.id);
    primed = true;
    return false;
  }
  if (!crisis || choosingHome || announced.has(crisis.id)) return false;
  if (document.querySelector('.modal-overlay:not([hidden])')) return false;
  announced.add(crisis.id);
  if (callPolicy(state) !== 'ask') return false;
  showCard(state, crisis);
  return briefSettings(state).callPause;
}

