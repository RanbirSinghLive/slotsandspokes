import { chartLegend } from './chartLegend';
import { money } from './format';
import { info } from './inspector/dom';
import * as ops from './routeActions';
import { describeLayout, ECONOMY_SEATS_PER_BUSINESS, layoutFor, PREMIUM_SEAT_ROOM, sameSeatPlan, type SeatPlan } from '../sim/cabins';
import { classByCode } from '../sim/aircraftClasses';
import { MAX_TEMPLATES_PER_TYPE } from '../sim/fleetCabins';
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

/**
 * What a seat map edits: one plane, or every plane of a type (the Product
 * screen). The dialog is the same; where the forecast, best fit and the
 * button's action come from differ.
 */
type SeatMapSource = {
  title: string;
  explanation: string;
  typeCode: string;
  seats: number;
  /** The plan it opens on, and ↺ goes back to. */
  start: SeatPlan;
  /** The plan it has now, for "as now" and "was". */
  current: SeatPlan;
  split: NonNullable<ReturnType<typeof ops.seatMapFor>>['split'];
  forecast: (plan: SeatPlan) => { gainPerDay: number; blocked: string | null };
  best: () => SeatPlan | null;
  bestTip: string;
  rows: (plan: SeatPlan) => [string, string, string?][];
  goLabel: (plan: SeatPlan) => string;
  go: (plan: SeatPlan) => void;
};

/** Opens the seat map for a plane; ordering a refit runs `changed`. */
export function showSeatMap(state: SimState, tail: string, changed: () => void, startPlan?: SeatPlan): void {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const map = ops.seatMapFor(state, tail);
  if (!aircraft || !map) return;
  const standard = state.fleetCabins?.[map.typeCode];
  openSeatMap(
    state,
    {
      title: `Cabin · ${tail}`,
      explanation: `Set how many business (J), premium economy (W) and economy (Y) seats ${tail} has. A J seat takes the room of ${ECONOMY_SEATS_PER_BUSINESS} Y seats and a W seat ${PREMIUM_SEAT_ROOM}; J and W together may take 65% of the room. J sells to business travellers at 2.2× the fare, W at 1.45× to whoever values it, Y as before. Tap a seat to move it up a class, or a saved template to load it. The bar is who flies the markets this type flies now: lean to business where it is large. Forecast is the game's own on the plane's routes as they are now; Best fit tries a grid of cabins through it. A refit starts the next morning the plane is at base, takes it out of service, and holds a hangar bay at its base when one rated for the class is free; otherwise it is contracted out by the hour. Its flying moves to spare planes of its class. Refitted off its type's standard cabin, it keeps its own until told to follow the standard again (Product).`,
      typeCode: map.typeCode,
      seats: map.seats,
      start: startPlan ?? map.current,
      current: map.current,
      split: map.split,
      forecast: (plan) => {
        const forecast = ops.forecastSeatPlan(state, tail, plan) ?? { gainPerDay: 0, blocked: 'Cannot be refitted' };
        return { gainPerDay: forecast.gainPerDay, blocked: sameSeatPlan(plan, map.current) ? 'Same cabin as now' : forecast.blocked };
      },
      best: () => ops.bestSeatPlanFor(state, tail)?.plan ?? null,
      bestTip: 'Best fit · the cabin the forecast likes most',
      rows: (plan) => {
        const offStandard = standard !== undefined && !sameSeatPlan(plan, standard);
        return [
          ['Refit cost', money(map.cost)],
          ['Out of service', map.bay ? `${map.days} days · hangar bay` : `${map.days} days · contracted ${money(map.contractCost)}`],
          ['Cash after', money(state.cash - map.cost - (map.bay ? 0 : map.contractCost))],
          ...(offStandard ? [['Standard', `${describeLayout(layoutFor(map.seats, standard))} · off it, keeps its own`, 'is-warn'] as [string, string, string]] : []),
        ];
      },
      goLabel: () => `Order · ${money(map.cost)}`,
      go: (plan) => {
        ops.orderRefit(state, tail, plan);
        changed();
      },
    },
    changed,
  );
}

/**
 * Opens the seat map for every plane of a type (the Product screen): its
 * forecast is the whole fleet's, and the button makes the plan the type's
 * standard cabin, rolled out one refit per base at a time.
 */
export function showFleetSeatMap(state: SimState, typeCode: string, changed: () => void, startPlan?: SeatPlan): void {
  const product = ops.productReadout(state).find((entry) => entry.typeCode === typeCode);
  if (!product || !product.fits) return;
  const typeName = classByCode(typeCode)?.name ?? typeCode;
  const standard = product.status.standard;
  const current = standard ?? mostCommonPlan(state, typeCode);
  openSeatMap(
    state,
    {
      title: `Cabin · ${typeName} fleet`,
      explanation: `The cabin for every ${typeName}. Set as standard, it is what each one should have: every morning, at each base, one plane of the type not on it is ordered a refit to it (${money(product.refitCost)} each, ${product.refitDays} days out), so a base never has more than one out for it at once; the one flying least goes first. Planes delivered later arrive with it fitted. A plane refitted to something else keeps its own until told to follow again. Save a template to keep the plan under a name. Forecast is every ${typeName} that follows the standard swapped at once, through the game's own forecast on the routes they fly now.`,
      typeCode,
      seats: product.seats,
      start: startPlan ?? current,
      current,
      split: product.split,
      forecast: (plan) => ({ gainPerDay: ops.forecastTypeCabin(state, typeCode, plan).gainPerDay, blocked: standard && sameSeatPlan(plan, standard) ? 'The standard now' : null }),
      best: () => ops.bestTypeCabin(state, typeCode)?.plan ?? null,
      bestTip: `Best fit · the cabin the forecast likes most across the ${typeName} fleet`,
      rows: (plan) => {
        const toRefit = product.planes.filter((plane) => plane.standing !== 'own' && !sameSeatPlan(planOfLayout(plane.layout), plan)).length;
        return [
          ['Refits', toRefit === 0 ? '—' : `${toRefit} × ${money(product.refitCost)} · ${product.refitDays}d out each`],
          ['Deliveries', 'arrive fitted'],
        ];
      },
      goLabel: () => 'Set as standard',
      go: (plan) => {
        ops.setFleetCabin(state, typeCode, plan);
        changed();
      },
    },
    changed,
  );
}

function planOfLayout(layout: { business: number; premium: number }): SeatPlan {
  return { business: layout.business, premium: layout.premium };
}

/** The seat plan most of a type's planes have, for a fleet seat map with no standard yet. */
function mostCommonPlan(state: SimState, typeCode: string): SeatPlan {
  const product = ops.productReadout(state).find((entry) => entry.typeCode === typeCode);
  const counts = new Map<string, { plan: SeatPlan; n: number }>();
  for (const plane of product?.planes ?? []) {
    const plan = planOfLayout(plane.layout);
    const key = `${plan.business}/${plan.premium}`;
    counts.set(key, { plan, n: (counts.get(key)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.plan ?? { business: 0, premium: 0 };
}

function openSeatMap(state: SimState, source: SeatMapSource, changed: () => void): void {
  const map = source;
  const typeName = classByCode(map.typeCode)?.name ?? map.typeCode;
  let plan: SeatPlan = { ...map.start };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--confirm';
  const box = document.createElement('div');
  box.className = 'modal-box modal-box--confirm modal-box--seatmap';
  box.setAttribute('role', 'dialog');
  const title = document.createElement('h2');
  title.append(`${map.title} `);
  title.append(info(map.explanation));
  box.append(title);
  box.append(...splitBar(map.split, typeName));

  const templatesHost = document.createElement('div');
  templatesHost.className = 'seatmap-templates';
  box.append(templatesHost);

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

  function drawTemplates(): void {
    const saved = (state.cabinTemplates ?? []).filter((template) => template.typeCode === map.typeCode);
    const chips = saved.map((template) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'seatmap-template';
      const templatePlan = { business: template.business, premium: template.premium };
      chip.classList.toggle('is-on', sameSeatPlan(templatePlan, plan));
      const layout = describeLayout(layoutFor(map.seats, templatePlan));
      chip.textContent = template.name;
      chip.dataset.tip = `${layout} · tap to load`;
      chip.addEventListener('click', () => set(templatePlan));
      return chip;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'seatmap-template is-add';
    add.textContent = '＋';
    const already = saved.find((template) => sameSeatPlan({ business: template.business, premium: template.premium }, plan));
    add.disabled = already !== undefined || saved.length >= MAX_TEMPLATES_PER_TYPE;
    add.dataset.tip = already ? `Saved as ${already.name}` : saved.length >= MAX_TEMPLATES_PER_TYPE ? `${MAX_TEMPLATES_PER_TYPE} templates is the most a type keeps` : 'Save this cabin as a template';
    add.setAttribute('aria-label', 'Save as template');
    add.addEventListener('click', () => {
      ops.saveCabinTemplate(state, map.typeCode, plan);
      changed();
      draw();
    });
    templatesHost.replaceChildren(...chips, add);
  }

  function draw(): void {
    const forecast = map.forecast(plan);
    const layout = layoutFor(map.seats, plan);
    drawTemplates();
    mapHost.replaceChildren(
      drawCabin(map.typeCode, layout, (cabin) => {
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
    best.dataset.tip = map.bestTip;
    best.setAttribute('aria-label', 'Best fit');
    best.addEventListener('click', () => {
      const found = map.best();
      if (found) set(found);
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'seatmap-tool';
    reset.textContent = '↺';
    reset.dataset.tip = 'Back to the cabin it has now';
    reset.setAttribute('aria-label', 'Reset');
    reset.addEventListener('click', () => set({ ...map.current }));
    controls.append(economy, best, reset);

    const same = sameSeatPlan(plan, map.current);
    const sign = forecast.gainPerDay >= 0 ? '+' : '−';
    const lines: [string, string, string?][] = [
      ['Seats', same ? `${describeLayout(layout)} · as now` : `${describeLayout(layout)} · was ${describeLayout(layoutFor(map.seats, map.current))}`],
      ['Forecast', same ? '—' : `${sign}${money(Math.abs(forecast.gainPerDay))}/day`, forecast.gainPerDay > 0 ? 'is-gain' : forecast.gainPerDay < 0 ? 'is-loss' : undefined],
      ...map.rows(plan),
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
    order.disabled = forecast.blocked !== null;
    order.textContent = forecast.blocked ?? map.goLabel(plan);
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
    map.go(plan);
  });
  document.body.append(overlay);
  draw();
}
