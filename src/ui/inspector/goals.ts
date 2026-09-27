import { airlineCalled, currentTier, isMilestoneMet, LADDER, openedSoFar, tiersClimbed, type Milestone } from '../../sim/ladder';
import type { SimState } from '../../sim/state';
import { select } from '../selection';

/**
 * The Goals view (Network › Goals): the ladder (sim/ladder.ts), the tier
 * the airline is working on with each milestone's progress, what reaching
 * the next tier opens, the tiers already climbed, and the ones still
 * ahead. It's the game's answer to "what should I be doing?". The
 * innovations it opens are adopted at Head office (ui/inspector/headOffice.ts).
 */

function line(text: string, className = 'inspector-line'): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}

/** One milestone as a row: its name and what to do, then met (and when) or how close. */
function milestoneRow(state: SimState, milestone: Milestone): HTMLElement {
  const row = document.createElement('div');
  row.className = 'inspector-row goal-row';
  const met = isMilestoneMet(state, milestone.id);
  row.classList.toggle('is-met', met);
  const name = document.createElement('span');
  name.textContent = `${met ? '✓' : '○'} ${milestone.name}`;
  const detail = document.createElement('span');
  detail.className = 'inspector-row-detail';
  if (met) {
    detail.textContent = `met on day ${state.milestonesMet![milestone.id]}`;
  } else {
    const progress = milestone.progress(state);
    detail.textContent = progress ? `${milestone.description} Now: ${progress.current.toLocaleString()} of ${progress.target.toLocaleString()} ${progress.unit}.` : milestone.description;
  }
  row.append(name, detail);
  return row;
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
      line(
        `You're ${airlineCalled(tier)}. Meet ${tier.needed} of these ${tier.milestones.length} to ` +
          (next ? `become ${airlineCalled(next)}` : 'climb the last tier') +
          ` (${met} so far).`,
      ),
    );
    if (tier.opens.length > 0) root.append(line(`It opens: ${tier.opens.join('; ')}.`, 'inspector-line is-good'));
    const list = document.createElement('div');
    list.className = 'inspector-rows';
    list.append(...tier.milestones.map((milestone) => milestoneRow(state, milestone)));
    root.append(heading(tier.name), list);
  } else {
    root.append(line('Every tier climbed: your airline can take a passenger round the world.', 'inspector-line is-good'));
  }

  const opened = openedSoFar(state);
  if (opened.length > 0) root.append(heading('Opened so far'), ...opened.map((thing) => line(thing)));

  // The rest of the ladder, climbed and still ahead, so the whole shape is visible.
  root.append(heading('The ladder'));
  LADDER.forEach((each, i) => {
    const status = i < climbed ? 'climbed' : i === climbed ? 'working on it' : 'ahead';
    const row = line(`${each.name}: ${status}${each.opens.length > 0 ? ` · opens ${each.opens.join('; ')}` : ''}`);
    if (i > climbed) row.classList.add('goal-ahead');
    root.append(row);
  });

  // Innovations the ladder opens are adopted at Head office.
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'inspector-link';
  link.textContent = 'Adopt the innovations it opens at Head office ›';
  link.addEventListener('click', () => select({ kind: 'headOffice' }));
  root.append(heading('Innovations'), link);
  return root;
}
