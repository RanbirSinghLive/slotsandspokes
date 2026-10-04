import { connectingUnderStyle } from '../sim/hubs';
import { HUB_STYLES, hubStyleAt, type HubStyle } from '../sim/hubStyle';
import type { SimState } from '../sim/state';
import { showConfirm, type ConfirmRow } from './confirmModal';
import * as ops from './routeActions';

/**
 * The confirm step for switching a hub's style, shared by the map menu and
 * the Plan hub window. `done` gets the outcome of the switch.
 */
export function confirmHubStyle(state: SimState, hub: string, style: HubStyle, done: (result: ops.Outcome<{ message: string }>) => void): void {
  const plan = ops.previewHubStyle(state, hub, style);
  if (!plan.ok) {
    done(plan);
    return;
  }
  const before = hubStyleAt(state, hub);
  const rows: ConfirmRow[] = [
    { label: 'Style', value: `${HUB_STYLES[before].name} → ${HUB_STYLES[style].name}` },
    { label: 'Connecting', value: `${Math.round(connectingUnderStyle(state, hub, before))}/day → ${Math.round(connectingUnderStyle(state, hub, style))}/day` },
    { label: 'Ground time', value: `+${HUB_STYLES[before].hubWaitMinutes} min → +${HUB_STYLES[style].hubWaitMinutes} min per arrival` },
  ];
  if (plan.moved > 0) rows.push({ label: 'Rotations moved', value: `${plan.moved} to another plane` });
  showConfirm({
    title: `Run ${hub} as ${HUB_STYLES[style].name}`,
    rows,
    facts: [HUB_STYLES[style].description],
    confirmLabel: `Switch to ${HUB_STYLES[style].name}`,
    run: () => done(ops.setHubStyle(state, hub, style)),
  });
}
