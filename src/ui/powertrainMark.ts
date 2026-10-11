import type { Aircraft } from '../sim/state';

/** A small mark for a hybrid or electric plane (sim/powertrain.ts), with its meaning on hover; null for the usual plane. */
export function powertrainMark(aircraft: Pick<Aircraft, 'powertrain'>): HTMLElement | null {
  if (!aircraft.powertrain) return null;
  const mark = document.createElement('span');
  mark.className = 'powertrain-mark';
  mark.textContent = aircraft.powertrain === 'electric' ? '⚡' : '◐';
  mark.title = aircraft.powertrain === 'electric' ? 'Electric: needs a charger at every stop' : 'Hybrid-electric: less fuel, new-build lease';
  return mark;
}
