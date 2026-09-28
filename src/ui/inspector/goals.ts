import { airlineCalled, currentTier, isMilestoneMet, LADDER, openedSoFar, tiersClimbed, type Milestone } from '../../sim/ladder';
import { info, line, heading } from './dom';
import type { SimState } from '../../sim/state';
import { select } from '../selection';

/**
 * The Goals view (Network › Goals): the ladder (sim/ladder.ts), the tier
 * the airline is working on with each milestone's progress, what reaching
 * the next tier opens, the tiers already climbed, and the ones still
 * ahead. It's the game's answer to "what should I be doing?". The
 * innovations it opens are adopted at Head office (ui/inspector/headOffice.ts).
 */

/**
 * One milestone as a badge: its name (what to do in its (i)), and a bar
 * filling toward it, or the day it was met, stamped.
 */
function milestoneBadge(state: SimState, milestone: Milestone): HTMLElement {
  const badge = document.createElement('div');
  badge.className = 'goal-badge';
  const met = isMilestoneMet(state, milestone.id);
  badge.classList.toggle('is-met', met);
  const name = document.createElement('div');
  name.className = 'goal-badge-name';
  name.append(`${milestone.name} `, info(milestone.description));
  badge.append(name);
  if (met) {
    const stamp = document.createElement('div');
    stamp.className = 'goal-badge-stamp';
    stamp.textContent = `Met · day ${state.milestonesMet![milestone.id]}`;
    badge.append(stamp);
    return badge;
  }
  const progress = milestone.progress(state);
  if (progress) {
    const bar = document.createElement('div');
    bar.className = 'goal-badge-bar';
    const fill = document.createElement('div');
    fill.style.width = `${Math.min(100, (progress.current / Math.max(1, progress.target)) * 100)}%`;
    bar.append(fill);
    const detail = document.createElement('div');
    detail.className = 'goal-badge-detail';
    detail.textContent = `${progress.current.toLocaleString()}/${progress.target.toLocaleString()} ${progress.unit}`;
    badge.append(bar, detail);
  } else {
    const detail = document.createElement('div');
    detail.className = 'goal-badge-detail';
    detail.textContent = milestone.description;
    badge.append(detail);
  }
  return badge;
}

/** One line saying where the airline stands, for the Network view's Goals row. */
export function goalsSummary(state: SimState): string {
  const tier = currentTier(state);
  if (!tier) return 'Every tier climbed';
  const met = tier.milestones.filter((milestone) => isMilestoneMet(state, milestone.id)).length;
  return `${tier.name} · ${Math.min(met, tier.needed)} of ${tier.needed}`;
}

export function buildGoalsView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Goals';
  root.append(title);

  const climbed = tiersClimbed(state);
  const tier = currentTier(state);
  if (tier) {
    const met = tier.milestones.filter((milestone) => isMilestoneMet(state, milestone.id)).length;
    const next = LADDER[climbed + 1];
    root.append(
      line(`Now ${airlineCalled(tier)} · ${met}/${tier.needed} to ` + (next ? `become ${airlineCalled(next)}` : 'climb the last tier')),
    );
    if (tier.opens.length > 0) root.append(line(`Opens ${tier.opens.join(' · ')}`, 'inspector-line is-good'));
    const list = document.createElement('div');
    list.className = 'goal-badges';
    list.append(...tier.milestones.map((milestone) => milestoneBadge(state, milestone)));
    root.append(heading(tier.name), list);
  } else {
    root.append(line('Top tier reached', 'inspector-line is-good'));
  }

  const opened = openedSoFar(state);
  if (opened.length > 0) root.append(heading('Opened so far'), ...opened.map((thing) => line(thing)));

  // The whole ladder as a row of rungs, climbed, current and ahead, each
  // with what it opens in its tooltip.
  const ladder = document.createElement('div');
  ladder.className = 'goal-ladder';
  LADDER.forEach((each, i) => {
    const rung = document.createElement('span');
    rung.className = 'goal-rung';
    rung.classList.toggle('is-climbed', i < climbed);
    rung.classList.toggle('is-current', i === climbed);
    rung.textContent = `${i < climbed ? '✓ ' : ''}${each.name}`;
    if (each.opens.length > 0) rung.title = `Opens ${each.opens.join(' · ')}`;
    ladder.append(rung);
  });
  root.append(heading('The ladder'), ladder);

  // Innovations the ladder opens are adopted at Head office.
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inspector-link';
  link.textContent = 'Head office ›';
  link.addEventListener('click', () => select({ kind: 'headOffice' }));
  root.append(heading('Innovations'), link);
  return root;
}
