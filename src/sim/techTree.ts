import techTreeData from '../../data/tech-tree.json';
import type { SimState } from './state';

/**
 * Week six's tech tree: the first real spender for Reputation
 * (sim/reputation.ts), which has had nothing to spend on since the day it
 * was built (see WEEK-SIX.md's "carried forward" section). One branch
 * exists so far — fuel efficiency, each tier permanently reducing
 * `SimState.fuelEfficiencyMultiplier` (the hook sim/fuel.ts's cost model
 * left in place for exactly this). More branches can join this same
 * `TechNode` list later; nothing here assumes fuel efficiency is the only
 * one, but nothing else is built yet either.
 */
export type TechBranch = 'fuel-efficiency';

export type TechNode = {
  id: string;
  branch: TechBranch;
  /** Position within its branch, 1-based — nodes unlock in order, not freely. */
  tier: number;
  name: string;
  /** A short, real historical note the node is themed on — shown in the tech tree UI, EU4-style. */
  flavor: string;
  /** One-time Reputation cost to unlock. Not an ongoing drag — see unlockTechNode()'s own comment for why. */
  reputationCost: number;
  /** Multiplies directly into SimState.fuelEfficiencyMultiplier on unlock (0.95 = a 5% cut). */
  fuelEfficiencyFactor: number;
};

export function loadTechTree(): TechNode[] {
  return techTreeData as TechNode[];
}

export function isTechNodeUnlocked(state: SimState, node: TechNode): boolean {
  return state.unlockedTechNodeIds.includes(node.id);
}

/**
 * Whether `node` can be unlocked right now: not already owned, its
 * branch's previous tier (if any) already unlocked — nodes are a linear
 * chain per branch, not a free-for-all — and enough Reputation banked to
 * afford it.
 */
export function canUnlockTechNode(state: SimState, node: TechNode, allNodes: TechNode[]): boolean {
  if (isTechNodeUnlocked(state, node)) return false;
  if (state.reputation < node.reputationCost) return false;
  const previousTier = allNodes.find((n) => n.branch === node.branch && n.tier === node.tier - 1);
  if (previousTier && !isTechNodeUnlocked(state, previousTier)) return false;
  return true;
}

/**
 * Spend Reputation to unlock `node` — a one-time payment for a permanent
 * effect, not an ongoing drag. That's the deliberate shape for a genuine
 * investment like a fuel-efficiency upgrade, as opposed to a customer-
 * hostile lever like ancillary bag fees, which WEEK-SIX.md's own design
 * notes already reasoned should cost Reputation on an ongoing basis
 * instead of a locked one-time unlock. Callers (ui/techTree.ts) must
 * check canUnlockTechNode() first; this doesn't re-check anything.
 */
export function unlockTechNode(state: SimState, node: TechNode): void {
  state.reputation -= node.reputationCost;
  state.unlockedTechNodeIds.push(node.id);
  state.fuelEfficiencyMultiplier *= node.fuelEfficiencyFactor;
}
