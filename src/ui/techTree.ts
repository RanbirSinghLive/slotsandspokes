import { loadTechTree, isTechNodeUnlocked, canUnlockTechNode, unlockTechNode, type TechNode } from '../sim/techTree';
import type { SimState } from '../sim/state';

/**
 * The Tech Tree tab (week six): one branch built so far, Fuel Efficiency
 * — see data/tech-tree.json for the node list and sim/techTree.ts for the
 * unlock rules. Built once at startup, same "build the rows once, mutate
 * on events" shape ui/commercial.ts already uses, since nothing here
 * needs a periodic rebuild — only an Unlock click or switching back into
 * this tab (in case Reputation moved while looking elsewhere) changes
 * anything.
 */

const branchEl = document.querySelector<HTMLDivElement>('#tech-tree-fuel-branch')!;
const summaryEl = document.querySelector<HTMLDivElement>('#tech-tree-fuel-summary')!;

const allNodes = loadTechTree();
const fuelNodes = allNodes.filter((node) => node.branch === 'fuel-efficiency').sort((a, b) => a.tier - b.tier);

type NodeRefs = { card: HTMLDivElement; button: HTMLButtonElement; statusEl: HTMLDivElement };
const refsById = new Map<string, NodeRefs>();

function previousTierOf(node: TechNode): TechNode | undefined {
  return allNodes.find((n) => n.branch === node.branch && n.tier === node.tier - 1);
}

function buildCard(node: TechNode, state: SimState): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'tech-node';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'tech-node-header expandable-header';
  const tierEl = document.createElement('span');
  tierEl.className = 'tech-node-tier';
  tierEl.textContent = `Tier ${node.tier}`;
  const nameEl = document.createElement('span');
  nameEl.className = 'tech-node-name';
  nameEl.textContent = node.name;
  const chevron = document.createElement('span');
  chevron.className = 'expand-chevron';
  header.append(tierEl, nameEl, chevron);

  const flavorEl = document.createElement('p');
  flavorEl.className = 'tech-node-flavor';
  flavorEl.textContent = node.flavor;
  flavorEl.hidden = true;
  header.addEventListener('click', () => {
    flavorEl.hidden = !flavorEl.hidden;
    header.classList.toggle('expanded', !flavorEl.hidden);
  });

  const effectEl = document.createElement('div');
  effectEl.className = 'tech-node-effect';
  effectEl.textContent = `-${Math.round((1 - node.fuelEfficiencyFactor) * 100)}% fuel-sensitive cost`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tech-node-unlock';
  button.addEventListener('click', () => {
    unlockTechNode(state, node);
    renderAll(state);
  });

  const statusEl = document.createElement('div');
  statusEl.className = 'tech-node-status';

  card.append(header, flavorEl, effectEl, button, statusEl);
  refsById.set(node.id, { card, button, statusEl });
  return card;
}

function renderNode(node: TechNode, state: SimState): void {
  const refs = refsById.get(node.id);
  if (!refs) return;

  const unlocked = isTechNodeUnlocked(state, node);
  const unlockable = canUnlockTechNode(state, node, allNodes);
  refs.card.classList.toggle('tech-node--unlocked', unlocked);
  refs.button.disabled = unlocked || !unlockable;

  if (unlocked) {
    refs.button.textContent = 'Unlocked';
    refs.statusEl.textContent = '';
    return;
  }

  refs.button.textContent = `Unlock — ${node.reputationCost} Reputation`;

  const previousTier = previousTierOf(node);
  if (previousTier && !isTechNodeUnlocked(state, previousTier)) {
    refs.statusEl.textContent = `Requires ${previousTier.name} first.`;
  } else if (state.reputation < node.reputationCost) {
    refs.statusEl.textContent = `Need ${Math.ceil(node.reputationCost - state.reputation)} more Reputation.`;
  } else {
    refs.statusEl.textContent = '';
  }
}

function renderAll(state: SimState): void {
  for (const node of fuelNodes) renderNode(node, state);

  const cumulativePct = Math.round((1 - state.fuelEfficiencyMultiplier) * 100);
  summaryEl.textContent =
    cumulativePct > 0
      ? `Fuel efficiency initiatives are cutting fuel-sensitive cost by ${cumulativePct}% versus an unmodified fleet.`
      : 'No fuel efficiency initiatives adopted yet.';
}

/** Called once at startup, same shape every other panel's setup function already uses. */
export function setupTechTreePanel(state: SimState): void {
  for (const node of fuelNodes) branchEl.appendChild(buildCard(node, state));
  renderAll(state);
}

/** Called whenever the Tech Tree tab becomes visible, same "refresh on select" pattern the rest of the sidebar uses. */
export function updateTechTreePanel(state: SimState): void {
  renderAll(state);
}
