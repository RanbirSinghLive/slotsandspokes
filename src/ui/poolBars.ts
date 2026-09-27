import { CAPACITY_RING_RED, capacityColor } from '../render/airports';
import { crewReadout, type CrewReadout } from '../sim/playerActions';
import { USABLE_DAY_MINUTES, utilisationPools, type ClassPool, type PoolEffect } from '../sim/utilisation';
import { getMapPreview } from '../render/preview';
import { planeIconElement } from './planeIcons';
import { select } from './selection';
import type { SimState } from '../sim/state';

/**
 * Utilisation as four bars, one per aircraft class: how much of that
 * class's flying day is booked. A bar that is nearly full says "add a
 * plane of this class"; one that is nearly empty says the plane is idle
 * money. The same rows appear in two places: the always-on overlay in the
 * corner of the map (the whole fleet), and in the side panel's airport and
 * route views (just the planes based at that airport).
 *
 * Colour is the capacity ring's own scale (green to amber as it fills,
 * red once over-booked), so a red ring on the map and a red bar here mean
 * the same thing.
 */

const overlayEl = document.querySelector<HTMLElement>('#pool-bars')!;

// The overlay is the quickest way to the Fleet list: clicking it opens the
// Fleet view in the side panel, so no one has to hunt for a plane's dot.
overlayEl.title = 'Open the Fleet list';
overlayEl.addEventListener('click', () => select({ kind: 'fleet' }));

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/**
 * Rows for every class that has at least one plane. `effects` are what a
 * hovered button would change (see render/preview.ts): a row it touches
 * shows a ghost segment for the change and "now -> then". With `base` set,
 * only effects at that base count (the airport and route views); without
 * it, all of them (the whole-fleet overlay).
 */
export function buildPoolRows(pools: ClassPool[], effects: PoolEffect[] = [], base?: string): HTMLElement[] {
  const touching = (pool: ClassPool) => effects.filter((e) => e.classCode === pool.code && (base === undefined || e.base === base));

  return pools
    .filter((pool) => pool.planes > 0 || touching(pool).some((e) => (e.planes ?? 0) > 0))
    .map((pool) => {
      const mine = touching(pool);
      const minutesDelta = mine.reduce((total, e) => total + e.minutes, 0);
      const planesDelta = mine.reduce((total, e) => total + (e.planes ?? 0), 0);
      const changed = minutesDelta !== 0 || planesDelta !== 0;

      const nextPlanes = pool.planes + planesDelta;
      const nextCapacity = pool.capacityMinutes + planesDelta * USABLE_DAY_MINUTES;
      const nextUsed = Math.max(0, pool.usedMinutes + minutesDelta);
      const nextShare = nextCapacity > 0 ? nextUsed / nextCapacity : 0;
      const shownShare = changed ? nextShare : pool.share;

      const row = document.createElement('div');
      row.className = 'pool-row';
      row.title = `${pool.planes} ${pool.name} plane${pool.planes === 1 ? '' : 's'}: ${hours(pool.usedMinutes)} of ${hours(pool.capacityMinutes)} flying hours booked`;

      const name = document.createElement('span');
      name.className = 'pool-name';
      name.append(planeIconElement(pool.code), planesDelta !== 0 ? `${pool.name} x${pool.planes}→${nextPlanes}` : `${pool.name} x${pool.planes}`);
      // A plane out with an AOG (sim/aog.ts): just a red "−1" here. What it
      // cancels is reported in the ticker, not in this display.
      if (pool.grounded > 0) {
        const grounded = document.createElement('span');
        grounded.className = 'pool-grounded';
        grounded.textContent = ` −${pool.grounded}`;
        grounded.title = `${pool.grounded} grounded with an AOG`;
        name.append(grounded);
      }

      const bar = document.createElement('span');
      bar.className = 'pool-bar';
      const fill = document.createElement('span');
      fill.className = 'pool-fill';
      fill.style.width = `${Math.min(pool.share, 1) * 100}%`;
      fill.style.background = capacityColor(pool.share);
      bar.appendChild(fill);

      if (changed) {
        const from = Math.min(pool.share, 1);
        const to = Math.min(nextShare, 1);
        const ghost = document.createElement('span');
        ghost.className = to > from ? 'pool-ghost is-add' : 'pool-ghost is-free';
        ghost.style.left = `${Math.min(from, to) * 100}%`;
        ghost.style.width = `${Math.abs(to - from) * 100}%`;
        if (to > from) ghost.style.background = capacityColor(nextShare);
        bar.appendChild(ghost);
      }

      const value = document.createElement('span');
      value.className = 'pool-value';
      value.textContent = changed ? `${Math.round(pool.share * 100)}% → ${Math.round(nextShare * 100)}%` : `${Math.round(pool.share * 100)}%`;
      if (shownShare > 1.0001) value.classList.add('is-over');

      row.append(name, bar, value);
      return row;
    });
}

/**
 * A crew base's crews as a pool row (sim/crews.ts): duty hours its planes
 * need against what its crews fly at ideal shifts. Past full, shifts run
 * long and crews tire; red when there are fewer crews than the legal
 * minimum, so planes are grounded.
 */
export function buildCrewRow(crew: CrewReadout): HTMLElement {
  const share = crew.availableHours > 0 ? crew.bookedHours / crew.availableHours : crew.bookedHours > 0 ? 2 : 0;
  const short = crew.crews < crew.minimum;
  const row = document.createElement('div');
  row.className = 'pool-row';
  row.title =
    `${crew.crews} crew${crew.crews === 1 ? '' : 's'}${crew.arriving > 0 ? ` (+${crew.arriving} joining)` : ''}: ` +
    `${Math.round(crew.bookedHours)} of ${Math.round(crew.availableHours)} duty hours booked at 8-hour shifts. ` +
    `Its planes need ${crew.ideal} for fresh crews, ${crew.minimum} at the least.`;
  const name = document.createElement('span');
  name.className = 'pool-name';
  name.textContent = `Crews x${crew.crews}${crew.arriving > 0 ? ` +${crew.arriving}` : ''}`;
  const bar = document.createElement('span');
  bar.className = 'pool-bar';
  const fill = document.createElement('span');
  fill.className = 'pool-fill';
  fill.style.width = `${Math.min(share, 1) * 100}%`;
  fill.style.background = short ? CAPACITY_RING_RED : capacityColor(share);
  bar.appendChild(fill);
  const value = document.createElement('span');
  value.className = 'pool-value';
  value.textContent = `${Math.round(share * 100)}%`;
  if (share > 1.0001 || short) value.classList.add('is-over');
  row.append(name, bar, value);
  return row;
}

let signature: string | null = null;

/**
 * Refresh the map overlay. Called every frame, so it only touches the DOM
 * when a number a player could see has actually changed.
 */
export function updatePoolBars(state: SimState): void {
  const pools = utilisationPools(state);
  const effects = getMapPreview()?.effects ?? [];
  // Home's crews (sim/crews.ts) under its planes.
  const crew = crewReadout(state, state.homeAirport);
  const next =
    pools.map((pool) => `${pool.code}:${pool.planes}:${pool.grounded}:${Math.round(pool.share * 100)}:${Math.round(pool.usedMinutes)}`).join('|') +
    `#${effects.map((e) => `${e.base}${e.classCode}${Math.round(e.minutes)}:${e.planes ?? 0}`).join(',')}` +
    `#${crew ? `${crew.crews}:${crew.arriving}:${Math.round(crew.bookedHours)}:${crew.minimum}` : ''}`;
  if (next === signature) return;
  signature = next;

  overlayEl.hidden = pools.every((pool) => pool.planes === 0);
  overlayEl.replaceChildren(...buildPoolRows(pools, effects), ...(crew ? [buildCrewRow(crew)] : []));
}
