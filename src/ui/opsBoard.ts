import { ON_TIME_GRACE_MINUTES } from '../sim/delays';
import { marketKey } from '../sim/schedule';
import type { SimState } from '../sim/state';
import { select } from './selection';

/**
 * The ops board: today's operation in one line under the clock, the way
 * an airline's operations centre reads it. DEP departed and landed, AIR
 * in the air now, TO GO still to leave, LATE landed late, CNX cancelled.
 * LATE opens the route with the most late flights today; CNX opens the
 * On-time tab, which breaks cancellations down by cause.
 */

const boardEl = document.querySelector<HTMLDivElement>('#ops-board')!;

type Today = { landed: number; airborne: number; toGo: number; late: number; cancelled: number; worst: { a: string; b: string } | null };

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
  return {
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
    el.title = title;
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
  const worst = now.worst;
  boardEl.replaceChildren(
    item('DEP', now.landed, 'Flights flown and landed today'),
    item('AIR', now.airborne, 'In the air now'),
    item('TO GO', now.toGo, 'Still to depart today'),
    item(
      'LATE',
      now.late,
      `Landed more than ${ON_TIME_GRACE_MINUTES} minutes late today` + (worst ? `. Worst: ${worst.a}–${worst.b}; click to open it.` : ''),
      worst ? () => select({ kind: 'route', a: worst.a, b: worst.b }) : undefined,
      now.late > 0,
    ),
    item('CNX', now.cancelled, 'Cancelled today; click for causes in the On-time tab', now.cancelled > 0 ? openOnTime : undefined, now.cancelled > 0),
  );
}
