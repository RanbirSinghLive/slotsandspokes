import { ON_TIME_GRACE_MINUTES } from '../sim/delays';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { CALL_TITLES, pendingCalls } from './callAlert';
import { openCallPopup } from './callPopup';
import { select } from './selection';

/**
 * The ops board: today's operation in one line under the clock. A bar
 * shows flights landed, in the air and still to go; LATE (landed late),
 * CALL and CNX (cancelled) appear only while there is something to see.
 * LATE opens the route with the most late flights today; CNX opens the
 * On-time tab, which breaks cancellations down by cause.
 */

const boardEl = document.querySelector<HTMLDivElement>('#ops-items')!;

type Today = { calls: string; landed: number; airborne: number; toGo: number; late: number; cancelled: number; worst: { a: string; b: string } | null };

function today(state: SimState): Today {
  const results = state.todayLegResults ?? {};
  const legById = new Map(state.schedule.map((leg) => [leg.legId, leg]));
  const landedIds = Object.keys(results);
  const lateByMarket = new Map<string, { a: string; b: string; count: number }>();
  let late = 0;
  for (const legId of landedIds) {
    if (results[legId].onTime) continue;
    late++;
    const leg = legById.get(legId);
    if (!leg) continue;
    const key = marketKey(leg.origin, leg.dest);
    const entry = lateByMarket.get(key) ?? { a: leg.origin, b: leg.dest, count: 0 };
    entry.count++;
    lateByMarket.set(key, entry);
  }
  const worst = [...lateByMarket.values()].sort((x, y) => y.count - x.count)[0] ?? null;
  const airborne = state.activeFlights.length;
  const cancelled = state.cancelledToday.length;
  const calls = pendingCalls(state).map((call) => `${call.tail} ${call.kind}`).join(',');
  return {
    calls,
    landed: landedIds.length,
    airborne,
    toGo: Math.max(0, state.schedule.length - landedIds.length - airborne - cancelled),
    late,
    cancelled,
    worst: worst ? { a: worst.a, b: worst.b } : null,
  };
}

let shown = '';

/** Called every frame from main.ts's render(); rebuilds only when a count changes. */
export function updateOpsBoard(state: SimState, openOnTime: () => void): void {
  const now = today(state);
  const signature = JSON.stringify(now);
  if (signature === shown) return;
  shown = signature;

  const item = (code: string, count: number, title: string, onClick?: () => void, warn = false) => {
    const el = document.createElement(onClick ? 'button' : 'span');
    el.className = 'ops-item';
    el.classList.toggle('is-warn', warn);
    el.dataset.tip = title;
    const label = document.createElement('span');
    label.className = 'ops-code';
    label.textContent = code;
    el.append(label, ` ${count}`);
    if (onClick) {
      (el as HTMLButtonElement).type = 'button';
      el.addEventListener('click', onClick);
    }
    return el;
  };
  // Today's flights as one bar: landed, in the air, still to go. The counts ride in the tip.
  const total = Math.max(1, now.landed + now.airborne + now.toGo);
  const bar = document.createElement('span');
  bar.className = 'ops-day';
  bar.dataset.tip = `Today · ${now.landed} flown · ${now.airborne} in the air · ${now.toGo} to go`;
  for (const [kind, count] of [['landed', now.landed], ['air', now.airborne], ['togo', now.toGo]] as const) {
    if (count === 0) continue;
    const seg = document.createElement('span');
    seg.className = `ops-day-${kind}`;
    seg.style.flexGrow = String(count / total);
    bar.append(seg);
  }
  const worst = now.worst;
  const callList = pendingCalls(state);
  boardEl.replaceChildren(
    bar,
    ...(now.late > 0
      ? [item(
          'LATE',
          now.late,
          `Landed more than ${ON_TIME_GRACE_MINUTES} minutes late today` + (worst ? `. Worst: ${worst.a}–${worst.b}; tap to open it.` : ''),
          worst ? () => select({ kind: 'route', a: worst.a, b: worst.b }) : undefined,
          true,
        )]
      : []),
    ...(callList.length > 0
      ? [item('CALL', callList.length, `Planes whose day will break: ${callList.map((call) => `${call.tail} (${CALL_TITLES[call.kind]})`).join(', ')}. Tap to open the worst.`, () => openCallPopup(state, callList[0].tail, callList[0].kind), true)]
      : []),
    ...(now.cancelled > 0 ? [item('CNX', now.cancelled, 'Cancelled today; tap for causes in the On-time tab', openOnTime, true)] : []),
  );
}
