import { capacityColor } from '../render/airports';
import { utilisationPools, type ClassPool } from '../sim/utilisation';
import type { SimState } from '../sim/state';

/**
 * Utilisation as four bars, one per aircraft class: how much of that
 * class's flying day is booked. A bar that is nearly full says "add a
 * plane of this class"; one that is nearly empty says the plane is idle
 * money. The same rows appear in two places: the always-on overlay in the
 * corner of the map (the whole fleet), and inside the airport and route
 * cards (just the planes based at that airport).
 *
 * Colour is the capacity ring's own scale (green to amber as it fills,
 * red once over-booked), so a red ring on the map and a red bar here mean
 * the same thing.
 */

const overlayEl = document.querySelector<HTMLElement>('#pool-bars')!;

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/** Rows for every class that has at least one plane. */
export function buildPoolRows(pools: ClassPool[]): HTMLElement[] {
  return pools
    .filter((pool) => pool.planes > 0)
    .map((pool) => {
      const row = document.createElement('div');
      row.className = 'pool-row';
      row.title = `${pool.planes} ${pool.name} plane${pool.planes === 1 ? '' : 's'}: ${hours(pool.usedMinutes)} of ${hours(pool.capacityMinutes)} flying hours booked`;

      const name = document.createElement('span');
      name.className = 'pool-name';
      name.textContent = `${pool.name} x${pool.planes}`;

      const bar = document.createElement('span');
      bar.className = 'pool-bar';
      const fill = document.createElement('span');
      fill.className = 'pool-fill';
      fill.style.width = `${Math.min(pool.share, 1) * 100}%`;
      fill.style.background = capacityColor(pool.share);
      bar.appendChild(fill);

      const value = document.createElement('span');
      value.className = 'pool-value';
      value.textContent = `${Math.round(pool.share * 100)}%`;
      if (pool.share >= 1) value.classList.add('is-over');

      row.append(name, bar, value);
      return row;
    });
}

let signature: string | null = null;

/**
 * Refresh the map overlay. Called every frame, so it only touches the DOM
 * when a number a player could see has actually changed.
 */
export function updatePoolBars(state: SimState): void {
  const pools = utilisationPools(state).filter((pool) => pool.planes > 0);
  const next = pools.map((pool) => `${pool.code}:${pool.planes}:${Math.round(pool.share * 100)}:${Math.round(pool.usedMinutes)}`).join('|');
  if (next === signature) return;
  signature = next;

  overlayEl.hidden = pools.length === 0;
  overlayEl.replaceChildren(...buildPoolRows(pools));
}
