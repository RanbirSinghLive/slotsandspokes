import { currentTier, isMilestoneMet, LADDER, openedSoFar, tiersClimbed, type Milestone } from '../../sim/ladder';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import type { InnovationOption } from '../routeActions';

/**
 * The Goals view (Network › Goals): the ladder (sim/ladder.ts), the tier
 * the airline is working on with each milestone's progress, what reaching
 * the next tier opens, the tiers already climbed, and the ones still
 * ahead. It's the game's answer to "what should I be doing?". Below the
 * ladder, the innovations it opens (sim/innovations.ts), each adopted
 * here.
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

function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

/** One innovation: what it does and costs, and a button to adopt it, or why it can't be yet. */
function innovationCard(state: SimState, option: InnovationOption, changed: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'innovation-card';
  card.classList.toggle('is-adopted', option.adopted);
  card.classList.toggle('is-locked', !option.adopted && option.blocked !== null);
  const name = document.createElement('div');
  name.className = 'innovation-name';
  name.textContent = option.adopted ? `✓ ${option.name}` : option.name;
  const price = [option.oneOffPrice > 0 ? `${money(option.oneOffPrice)} once` : null, option.runningCost]
    .filter(Boolean)
    .join(', then ');
  const status = option.adopted ? (option.runningCost ? `Running: ${option.runningCost}.` : 'Adopted.') : `Costs ${price}.`;
  card.append(name, line(option.description), line(status, 'inspector-line innovation-price'));
  if (option.adopted) return card;

  if (option.blocked) {
    card.append(line(option.blocked, 'inspector-line goal-ahead'));
    return card;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = `Adopt ${option.name.toLowerCase()}`;
  // Two clicks, since it can't be undone and a running cost runs for good.
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = option.runningCost
        ? `Click again to adopt. It can't be dropped: ${option.runningCost} from now on.`
        : `Click again to pay ${money(option.oneOffPrice)}. It can't be undone.`;
      button.classList.add('is-act');
      return;
    }
    ops.adoptInnovation(state, option.id);
    changed();
  });
  card.append(button);
  return card;
}

/** One line saying where the airline stands, for the Network view's Goals row. */
export function goalsSummary(state: SimState): string {
  const tier = currentTier(state);
  if (!tier) return 'Every tier climbed';
  const met = tier.milestones.filter((milestone) => isMilestoneMet(state, milestone.id)).length;
  return `${tier.name} · ${Math.min(met, tier.needed)} of ${tier.needed}`;
}

export function buildGoalsView(state: SimState, changed: () => void): HTMLElement {
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
        `You're a ${tier.name.toLowerCase()} airline. Meet ${tier.needed} of these ${tier.milestones.length} to ` +
          (next ? `become a ${next.name.toLowerCase()} one` : 'climb the last tier') +
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

  root.append(
    heading('Innovations'),
    line('Programmes the ladder opens. Each is yours to adopt, for good, if it pays for your airline.'),
    ...ops.innovationOptions(state).map((option) => innovationCard(state, option, changed)),
  );
  return root;
}
