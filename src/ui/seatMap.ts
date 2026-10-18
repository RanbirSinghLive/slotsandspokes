import { chartLegend } from './chartLegend';
import { money } from './format';
import { info } from './inspector/dom';
import * as ops from './routeActions';
import { describeLayout, ECONOMY_SEATS_PER_BUSINESS, layoutFor, PREMIUM_SEAT_ROOM, sameSeatPlan, type SeatPlan } from '../sim/cabins';
import { classByCode } from '../sim/aircraftClasses';
import type { SimState } from '../sim/state';

/**
 * The seat map: a plane's cabin laid out seat by seat (J business, W premium
 * economy, Y economy; sim/cabins.ts). Steppers and taps on a seat set how
 * many of each, the forecast and the refit's cost follow, and the bar above
 * shows who flies the markets this type flies now, to fit the cabin to.
 */

const SEAT_COLOURS = { business: '#9d8cf0', premium: '#5ed6c8', economy: '#6c7691' };

/** Seats abreast, in groups split by aisles, for each cabin of each class. */
const ABREAST: Record<string, { business: number[]; premium: number[]; economy: number[] }> = {
  REGIONAL: { business: [1, 1], premium: [1, 2], economy: [2, 2] },
  NARROWBODY: { business: [2, 2], premium: [3, 3], economy: [3, 3] },
  WIDEBODY: { business: [1, 2, 1], premium: [2, 3, 2], economy: [3, 3, 3] },
};

type CabinKey = 'business' | 'premium' | 'economy';
const LETTER: Record<CabinKey, string> = { business: 'J', premium: 'W', economy: 'Y' };

function drawCabin(typeCode: string, layout: Record<CabinKey, number>, onSeat: (cabin: CabinKey) => void): HTMLElement {
  const plane = document.createElement('div');
  plane.className = 'seatmap';
  const groups = ABREAST[typeCode] ?? ABREAST.NARROWBODY;
  for (const cabin of ['business', 'premium', 'economy'] as CabinKey[]) {
    const count = layout[cabin];
    if (count === 0) continue;
    const perRow = groups[cabin].reduce((sum, n) => sum + n, 0);
    let placed = 0;
    let first = true;
    while (placed < count) {
      const row = document.createElement('div');
      row.className = `seat-row is-${cabin}`;
      const tag = document.createElement('span');
      tag.className = 'seat-tag';
      tag.textContent = first ? LETTER[cabin] : '';
      row.append(tag);
      first = false;
      for (const [index, width] of groups[cabin].entries()) {
        const block = document.createElement('span');
        block.className = 'seat-block';
        for (let i = 0; i < width; i++) {
          const seat = document.createElement('button');
          seat.type = 'button';
          seat.tabIndex = -1;
          seat.className = `seat is-${cabin}`;
          if (placed < count) {
            seat.setAttribute('aria-label', `${LETTER[cabin]} seat: tap to change`);
            seat.addEventListener('click', () => onSeat(cabin));
            placed++;
          } else {
            seat.disabled = true;
            seat.classList.add('is-empty');
          }
          block.append(seat);
        }
        row.append(block);
        if (index < groups[cabin].length - 1) row.append(Object.assign(document.createElement('span'), { className: 'seat-aisle' }));
      }
      plane.append(row);
      if (perRow === 0) break;
    }
  }
  return plane;
}

function splitBar(split: NonNullable<ReturnType<typeof ops.seatMapFor>>['split'], typeName: string): HTMLElement[] {
  if (!split) return [];
  const bar = document.createElement('div');
  bar.className = 'mix-bar';
  for (const segment of ['business', 'leisure', 'vfr'] as const) {
    const part = document.createElement('span');
    part.className = `mix-bar-${segment}`;
    part.style.width = `${split[segment] * 100}%`;
    bar.append(part);
  }
  const key = chartLegend([
    { mark: 'block', color: '#9d8cf0', label: `Biz ${Math.round(split.business * 100)}` },
    { mark: 'block', color: '#ffb347', label: `Leisure ${Math.round(split.leisure * 100)}` },
    { mark: 'block', color: '#f08bb5', label: `VFR ${Math.round(split.vfr * 100)}` },
  ]);
  const wrap = document.createElement('div');
  wrap.className = 'seatmap-split';
  wrap.dataset.tip = `Who flies the markets your ${typeName} fleet flies now, averaged over its flights`;
  wrap.append(bar, key);
  return [wrap];
}

/** Opens the seat map for a plane; ordering a refit runs `changed`. */
export function showSeatMap(state: SimState, tail: string, changed: () => void): void {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const map = ops.seatMapFor(state, tail);
  if (!aircraft || !map) return;
  const typeName = classByCode(map.typeCode)?.name ?? map.typeCode;
  let plan: SeatPlan = { ...map.current };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--confirm';
  const box = document.createElement('div');
  box.className = 'modal-box modal-box--confirm modal-box--seatmap';
  box.setAttribute('role', 'dialog');
  const title = document.createElement('h2');
  title.append(`Cabin · ${tail} `);
  title.append(
    info(
      `Set how many business (J), premium economy (W) and economy (Y) seats ${tail} has. A J seat takes the room of ${ECONOMY_SEATS_PER_BUSINESS} Y seats and a W seat ${PREMIUM_SEAT_ROOM}; J and W together may take 65% of the room. J sells to business travellers at 2.2× the fare, W at 1.45× to whoever values it, Y as before. Tap a seat to move it up a class. The bar is who flies the markets this type flies now: lean to business where it is large. Forecast is the game's own on the plane's routes as they are now; Best fit tries a grid of cabins through it. A refit starts the next morning the plane is at base, takes it out of service, and holds a hangar bay at its base when one rated for the class is free; otherwise it is contracted out by the hour. Its flying moves to spare planes of its class.`,
    ),
  );
  box.append(title);
  box.append(...splitBar(map.split, typeName));

  const mapHost = document.createElement('div');
  mapHost.className = 'seatmap-host';
  box.append(mapHost);

  const controls = document.createElement('div');
  controls.className = 'seatmap-controls';
  box.append(controls);

  const rows = document.createElement('div');
  rows.className = 'confirm-rows';
  box.append(rows);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const order = document.createElement('button');
  order.type = 'button';
  order.className = 'confirm-go';
  actions.append(cancel, order);
  box.append(actions);
  overlay.append(box);

  const clampPlan = (next: SeatPlan): SeatPlan => {
    const business = Math.max(0, Math.min(next.business, ops.maxBusinessSeats(map.seats, 0)));
    const premium = Math.max(0, Math.min(next.premium, ops.maxPremiumSeats(map.seats, business)));
    return { business, premium };
  };

  function stepper(cabin: 'business' | 'premium'): HTMLElement {
    const row = document.createElement('div');
    row.className = 'seatmap-step';
    const swatch = document.createElement('span');
    swatch.className = `seatmap-swatch is-${cabin}`;
    swatch.textContent = LETTER[cabin];
    swatch.style.setProperty('--seat', SEAT_COLOURS[cabin]);
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `One fewer ${LETTER[cabin]} seat`);
    const value = document.createElement('b');
    value.textContent = String(plan[cabin]);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `One more ${LETTER[cabin]} seat`);
    minus.disabled = plan[cabin] <= 0;
    const grown = { ...plan, [cabin]: plan[cabin] + 1 };
    plus.disabled = sameSeatPlan(clampPlan(grown), plan);
    minus.addEventListener('click', () => set({ ...plan, [cabin]: plan[cabin] - 1 }));
    plus.addEventListener('click', () => set(grown));
    row.append(swatch, minus, value, plus);
    return row;
  }

  function set(next: SeatPlan): void {
    plan = clampPlan(next);
    draw();
  }

  const nextClassUp = (cabin: CabinKey): SeatPlan => {
    // Y → W → J → Y, one seat at a time.
    if (cabin === 'economy') return { ...plan, premium: plan.premium + 1 };
    if (cabin === 'premium') return { business: plan.business + 1, premium: plan.premium - 1 };
    return { ...plan, business: plan.business - 1 };
  };

  function draw(): void {
    const forecast = ops.forecastSeatPlan(state, tail, plan);
    if (!forecast) return;
    const layout = forecast.layout;
    mapHost.replaceChildren(
      drawCabin(map!.typeCode, layout, (cabin) => {
        const next = nextClassUp(cabin);
        const clamped = clampPlan(next);
        // A tap that finds no room goes round to economy instead of doing nothing.
        set(sameSeatPlan(clamped, plan) ? { ...plan, business: 0, premium: 0 } : next);
      }),
    );
    controls.replaceChildren(stepper('business'), stepper('premium'));
    const economy = document.createElement('div');
    economy.className = 'seatmap-step';
    const swatch = document.createElement('span');
    swatch.className = 'seatmap-swatch is-economy';
    swatch.textContent = 'Y';
    swatch.style.setProperty('--seat', SEAT_COLOURS.economy);
    const value = document.createElement('b');
    value.textContent = String(layout.economy);
    economy.append(swatch, value);

    const best = document.createElement('button');
    best.type = 'button';
    best.className = 'seatmap-tool';
    best.textContent = '★';
    best.dataset.tip = 'Best fit · the cabin the forecast likes most';
    best.setAttribute('aria-label', 'Best fit');
    best.addEventListener('click', () => {
      const found = ops.bestSeatPlanFor(state, tail);
      if (found) set(found.plan);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'seatmap-tool';
    reset.textContent = '↺';
    reset.dataset.tip = 'Back to the cabin it has now';
    reset.setAttribute('aria-label', 'Reset');
    reset.addEventListener('click', () => set({ ...map!.current }));
    controls.append(economy, best, reset);

    const same = sameSeatPlan(plan, map!.current);
    const sign = forecast.gainPerDay >= 0 ? '+' : '−';
    const lines: [string, string, string?][] = [
      ['Seats', same ? `${describeLayout(layout)} · as now` : `${describeLayout(layout)} · was ${describeLayout(layoutFor(map!.seats, map!.current))}`],
      ['Forecast', same ? '—' : `${sign}${money(Math.abs(forecast.gainPerDay))}/day`, forecast.gainPerDay > 0 ? 'is-gain' : forecast.gainPerDay < 0 ? 'is-loss' : undefined],
      ['Refit cost', money(map!.cost)],
      ['Out of service', map!.bay ? `${map!.days} days · hangar bay` : `${map!.days} days · contracted ${money(map!.contractCost)}`],
      ['Cash after', money(state.cash - map!.cost - (map!.bay ? 0 : map!.contractCost))],
    ];
    rows.replaceChildren();
    for (const [label, text, tone] of lines) {
      const row = document.createElement('div');
      row.className = 'confirm-row';
      const left = document.createElement('span');
      left.textContent = label;
      const right = document.createElement('span');
      right.textContent = text;
      if (tone) right.className = tone;
      row.append(left, right);
      rows.append(row);
    }
    const blocked = same ? 'Same cabin as now' : forecast.blocked;
    order.disabled = blocked !== null;
    order.textContent = blocked ?? `Order · ${money(map!.cost)}`;
  }

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  order.addEventListener('click', () => {
    close();
    ops.orderRefit(state, tail, plan);
    changed();
  });
  document.body.append(overlay);
  draw();
}
