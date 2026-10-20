import { cashAfterRows, showConfirm } from './confirmModal';
import { money } from './format';
import * as ops from './routeActions';
import type { HeavyCheckReadout } from '../sim/playerActions';
import type { SimState } from '../sim/state';

/**
 * The heavy-check booking dialogs, shared by the Mtc screen (hangar bays,
 * plane cards) and the pipeline's tips (ui/pipeline.ts).
 */

/** The C-check booking dialog, from the hangar bay, the plane's card or its mark in the pipeline. */
export function confirmHeavyBooking(state: SimState, plane: HeavyCheckReadout, changed: () => void): void {
  const preview = ops.previewHeavyCheckBooking(state, plane.tail);
  if (!preview) return;
  showConfirm({
    title: `Book C check · ${plane.tail}`,
    rows: [
      { label: 'Grounded', value: `${preview.days}d from tomorrow` },
      { label: 'Check cost', value: preview.cost > 0 ? money(preview.cost) : 'in house' },
      { label: 'Rotations', value: `${preview.rotations} · other planes cover them where pools allow` },
      ...(preview.cost > 0 ? cashAfterRows(state, preview.cost) : []),
    ],
    facts: ['Rotations nobody can cover are cancelled. Cancel the booking any time before it goes in.'],
    confirmLabel: 'Book check',
    run: () => {
      ops.bookHeavyCheck(state, plane.tail);
      changed();
    },
  });
}

/** The D-check booking dialog, from the card or the plane's mark in the pipeline. */
export function confirmDBooking(state: SimState, plane: HeavyCheckReadout, changed: () => void): void {
  const preview = ops.previewDCheckBooking(state, plane.tail);
  if (!preview) return;
  showConfirm({
    title: `Book D check · ${plane.tail}`,
    rows: [
      { label: 'Grounded', value: `${preview.days}d from tomorrow` },
      { label: 'Check cost', value: preview.cost > 0 ? money(preview.cost) : 'in house' },
      { label: 'Rotations', value: `${preview.rotations} · other planes cover them where pools allow` },
      ...(preview.cost > 0 ? cashAfterRows(state, preview.cost) : []),
    ],
    facts: ['A full overhaul: it also clears the C and A checks. Rotations nobody can cover are cancelled. Cancel the booking any time before it goes in.'],
    confirmLabel: 'Book check',
    run: () => {
      ops.bookDCheck(state, plane.tail);
      changed();
    },
  });
}
