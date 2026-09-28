import { airlineCalled, LADDER, milestoneById, tiersClimbed } from '../sim/ladder';
import type { SimState } from '../sim/state';

/**
 * The milestone stamp: when a milestone is met, or a tier climbed, a
 * short stamp lands over the map ("MILESTONE · FIRST IN"), then fades.
 * The ladder is the game's reward loop, so reaching a rung should feel
 * like something, not only a ticker line. The ticker says it too
 * (ui/ticker.ts); each keeps its own "seen" record, so neither steals the
 * other's news.
 */

const stampEl = document.querySelector<HTMLDivElement>('#milestone-stamp')!;

/** How long a stamp stays before the next one (or none) replaces it. */
const STAMP_MS = 2800;

let seenMilestones: Set<string> | null = null;
let seenTiers = 0;
/** Stamps waiting their turn, so two milestones met at one rollover both show. */
const queue: { kicker: string; title: string }[] = [];
let showingUntil = 0;

function showNext(now: number): void {
  const next = queue.shift();
  if (!next) {
    stampEl.hidden = true;
    return;
  }
  stampEl.replaceChildren();
  const kicker = document.createElement('div');
  kicker.className = 'stamp-kicker';
  kicker.textContent = next.kicker;
  const title = document.createElement('div');
  title.className = 'stamp-title';
  title.textContent = next.title;
  stampEl.append(kicker, title);
  // Restart the landing animation for each new stamp.
  stampEl.hidden = false;
  stampEl.classList.remove('is-landing');
  void stampEl.offsetWidth;
  stampEl.classList.add('is-landing');
  showingUntil = now + STAMP_MS;
}

/** Called every frame from main.ts's render(). The first call only records where the airline stands. */
export function updateStamps(state: SimState, now: number): void {
  const met = Object.keys(state.milestonesMet ?? {});
  const climbed = tiersClimbed(state);
  if (seenMilestones === null) {
    seenMilestones = new Set(met);
    seenTiers = climbed;
    return;
  }
  for (const id of met) {
    if (seenMilestones.has(id)) continue;
    seenMilestones.add(id);
    const milestone = milestoneById(id);
    if (milestone) queue.push({ kicker: 'Milestone', title: milestone.name });
  }
  for (; seenTiers < climbed; seenTiers++) {
    const next = LADDER[seenTiers + 1];
    queue.push({ kicker: 'Promoted', title: next ? `Now ${airlineCalled(next)}` : 'Top tier' });
  }
  if (now >= showingUntil && (queue.length > 0 || !stampEl.hidden)) showNext(now);
}
