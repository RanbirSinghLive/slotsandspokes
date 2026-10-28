import { airlineCalled, currentTier, gateMilestones, isMilestoneMet, LADDER, tierComplete, tierCounts, tierNeeded, tiersClimbed, type Milestone, type Tier } from '../../sim/ladder';
import { HOLD_DAYS, LEAD_RATIO, LEAD_ROUTES, nemesisStatus } from '../../sim/nemesis';
import { info, line, heading, titleWithSwitch } from './dom';
import { overviewSwitch } from '../screenGroups';
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
  badge.classList.toggle('is-extra', !!milestone.extra);
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
  const met = tierCounts(state, tier).gates;
  const needed = tierNeeded(state, tier);
  return `${tier.name} · ${Math.min(met, needed)} of ${needed}`;
}

/** How close an unmet milestone is, 0 to 1; milestones with nothing to count rank last. */
function closeness(state: SimState, milestone: Milestone): number {
  const progress = milestone.progress(state);
  return progress ? progress.current / Math.max(1, progress.target) : -1;
}

/** A tier as a collapsible row: climbed (✓), current (open) or ahead (greyed). Gate milestones first, then extras. */
function tierRow(state: SimState, tier: Tier, index: number, climbed: number): HTMLElement {
  const row = document.createElement('details');
  row.className = 'goal-tier';
  row.classList.toggle('is-climbed', index < climbed);
  row.classList.toggle('is-current', index === climbed);
  row.classList.toggle('is-ahead', index > climbed);
  row.open = index === climbed;
  const counts = tierCounts(state, tier);
  const needed = tierNeeded(state, tier);
  const summary = document.createElement('summary');
  const mark = index < climbed ? '✓ ' : index > climbed ? '🔒 ' : '';
  const extras = counts.extrasTotal > 0 ? ` · ★ ${counts.extras}/${counts.extrasTotal}` : '';
  summary.textContent = `${mark}${tier.name} · ${Math.min(counts.gates, needed)}/${needed}${extras}${tierComplete(state, tier) ? ' · complete' : ''}`;
  row.append(summary);
  if (tier.opens.length > 0) row.append(line(`Opens ${tier.opens.join(' · ')}`, 'inspector-line is-good'));
  const list = document.createElement('div');
  list.className = 'goal-badges';
  const applicable = tier.milestones.filter((milestone) => milestone.applies?.(state) ?? true);
  list.append(...applicable.map((milestone) => milestoneBadge(state, milestone)));
  row.append(list);
  return row;
}

export function buildGoalsView(state: SimState): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  root.append(titleWithSwitch('Goals', overviewSwitch('goals')));

  const climbed = tiersClimbed(state);
  const tier = currentTier(state);
  if (tier) {
    const next = LADDER[climbed + 1];
    const needed = tierNeeded(state, tier);
    root.append(
      line(`Now ${airlineCalled(tier)} · ${Math.min(tierCounts(state, tier).gates, needed)}/${needed} to ` + (next ? `become ${airlineCalled(next)}` : 'climb the last tier')),
    );
    // The nearest unmet gates: what to do next.
    const nearest = gateMilestones(tier)
      .filter((milestone) => !isMilestoneMet(state, milestone.id) && (milestone.applies?.(state) ?? true))
      .sort((a, b) => closeness(state, b) - closeness(state, a))
      .slice(0, 3);
    if (nearest.length > 0) {
      const strip = document.createElement('div');
      strip.className = 'goal-badges';
      strip.append(...nearest.map((milestone) => milestoneBadge(state, milestone)));
      root.append(heading('Next up'), strip);
    }
  } else {
    root.append(line('Top tier reached', 'inspector-line is-good'));
  }

  // The nemesis: out-fly it and hold the lead.
  const rivalry = nemesisStatus(state);
  if (rivalry) {
    const bar = document.createElement('div');
    bar.className = 'goal-badge';
    const name = document.createElement('div');
    name.className = 'goal-badge-name';
    name.append(`Out-fly ${rivalry.nemesis.airline} `, info(`The rival that has taken the most from your routes. Fly ${LEAD_ROUTES} or more routes beyond it, and ${LEAD_RATIO} times as many, and hold that lead for ${HOLD_DAYS} days in a row. Beating it retires it as your nemesis; a bigger rival then rises.`));
    const track = document.createElement('div');
    track.className = 'goal-badge-bar';
    const fill = document.createElement('div');
    fill.style.width = `${Math.min(100, (rivalry.leadDays / HOLD_DAYS) * 100)}%`;
    track.append(fill);
    const detail = document.createElement('div');
    detail.className = 'goal-badge-detail';
    detail.textContent = `Routes ${rivalry.yourRoutes} v ${rivalry.theirRoutes} · lead held ${rivalry.leadDays}/${HOLD_DAYS}d`;
    bar.append(name, track, detail);
    const strip = document.createElement('div');
    strip.className = 'goal-badges';
    strip.append(bar);
    root.append(heading('Nemesis'), strip);
  }

  // Every tier, climbed, current and ahead; ★ counts the extras that teach a mechanic.
  root.append(heading('The ladder'));
  LADDER.forEach((each, index) => root.append(tierRow(state, each, index, climbed)));

  // Innovations the ladder opens are adopted at Head office.
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inspector-link';
  link.textContent = 'Head office ›';
  link.addEventListener('click', () => select({ kind: 'headOffice' }));
  root.append(heading('Innovations'), link);
  return root;
}
