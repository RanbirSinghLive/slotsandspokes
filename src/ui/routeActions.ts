import type { HubStyle } from '../sim/hubStyle';
import * as actions from '../sim/playerActions';
import type { SimState } from '../sim/state';
import { renderScheduleWarnings, scheduleProblems } from './panels';

/**
 * The player's actions as the map menu and the side panel call them. The
 * rules are all in sim/playerActions.ts, where the headless player uses
 * them too; this only adds what the page needs after a change: the
 * schedule warnings redrawn for the new schedule.
 */

export {
  adoptInnovation,
  appointExecutiveById,
  executiveOptions,
  letExecutiveGo,
  currentTurnBuffer,
  hedgeFuel,
  hedgeOptions,
  innovationOptions,
  marketPnlHistory,
  marketReadout,
  planeOptions,
  previewAddFlight,
  previewGauge,
  previewHubStyle,
  previewRemoveFlight,
  previewRemoveRoute,
  previewTurnBuffer,
  returnOptions,
  routeBase,
  rotationsServing,
  summariseMarket,
  leasePlane,
  type MarketPnlHistory,
  type MarketSummary,
  type ExecutiveOption,
  type InnovationOption,
  type Outcome,
  type PlaneOption,
} from '../sim/playerActions';

/** Redraw the schedule warnings after a change that worked, and pass its outcome on. */
function afterChange<T extends actions.Outcome>(state: SimState, outcome: T): T {
  if (outcome.ok) renderScheduleWarnings(scheduleProblems(state));
  return outcome;
}

export function addFlight(state: SimState, a: string, b: string) {
  return afterChange(state, actions.addFlight(state, a, b));
}

export function removeFlight(state: SimState, a: string, b: string) {
  return afterChange(state, actions.removeFlight(state, a, b));
}

export function applyGauge(state: SimState, a: string, b: string, direction: 1 | -1) {
  return afterChange(state, actions.applyGauge(state, a, b, direction));
}

export function setTurnBuffer(state: SimState, a: string, b: string, minutes: number) {
  return afterChange(state, actions.setTurnBuffer(state, a, b, minutes));
}

export function setHubStyle(state: SimState, iata: string, style: HubStyle) {
  return afterChange(state, actions.setHubStyle(state, iata, style));
}

export function removeRoute(state: SimState, a: string, b: string) {
  return afterChange(state, actions.removeRoute(state, a, b));
}

export function returnPlane(state: SimState, tail: string) {
  return afterChange(state, actions.returnPlane(state, tail));
}
