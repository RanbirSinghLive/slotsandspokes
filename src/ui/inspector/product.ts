import { classByCode } from '../../sim/aircraftClasses';
import { describeLayout, ECONOMY_SEATS_PER_BUSINESS, layoutFor, PREMIUM_SEAT_ROOM, type CabinLayout } from '../../sim/cabins';
import { MAX_TEMPLATES_PER_TYPE } from '../../sim/fleetCabins';
import type { ProductPlane, ProductType } from '../../sim/playerActions';
import type { SimState } from '../../sim/state';
import { showConfirm } from '../confirmModal';
import { money } from '../format';
import { planeIconElement } from '../planeIcons';
import * as ops from '../routeActions';
import { showFleetSeatMap, showSeatMap } from '../seatMap';
import { select } from '../selection';
import { heading, info, line } from './dom';
import { feesSection } from './fees';

/**
 * Product: the airline's cabins by type (sim/fleetCabins.ts). Each type
 * shows its standard cabin and how far the fleet is through it, the
 * templates saved for it, and every plane as a chip coloured by where it
 * stands. The seat maps themselves are ui/seatMap.ts: one for the whole
 * type, one per plane.
 */

const STANDING_TIP: Record<ProductPlane['standing'], string> = {
  standard: 'on the standard cabin',
  refit: 'refit ordered or in work',
  waiting: 'waiting its turn for the standard',
  own: 'kept on its own cabin',
  none: '',
};

/**
 * A bar of the cabin's room by class, J purple, W teal, Y grey: what a
 * cabin is at a glance, without reading the seat counts.
 */
function cabinBar(layout: CabinLayout): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'cabin-bar';
  const room = layout.business * ECONOMY_SEATS_PER_BUSINESS + layout.premium * PREMIUM_SEAT_ROOM + layout.economy;
  for (const [cabin, share] of [
    ['business', (layout.business * ECONOMY_SEATS_PER_BUSINESS) / room],
    ['premium', (layout.premium * PREMIUM_SEAT_ROOM) / room],
    ['economy', layout.economy / room],
  ] as const) {
    if (share <= 0) continue;
    const part = document.createElement('span');
    part.className = `cabin-bar-${cabin}`;
    part.style.width = `${share * 100}%`;
    bar.append(part);
  }
  return bar;
}

function iconButton(text: string, tip: string, run: () => void, className = 'product-tool'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.dataset.tip = tip;
  button.setAttribute('aria-label', tip);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    run();
  });
  return button;
}

function standardRow(state: SimState, product: ProductType, changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'product-standard';
  const { status } = product;
  if (!status.standard) {
    row.classList.add('is-none');
    row.append(line('No standard · each plane its own', 'product-standard-text'));
    row.append(iconButton('✎', 'Set a standard cabin for every plane of this type', () => showFleetSeatMap(state, product.typeCode, changed)));
    return row;
  }
  const layout = layoutFor(product.seats, status.standard);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'product-standard-open';
  open.dataset.tip = 'Standard cabin · tap to change it';
  open.append(cabinBar(layout), ` ${describeLayout(layout)}`);
  open.addEventListener('click', () => showFleetSeatMap(state, product.typeCode, changed));
  row.append(open);
  const progress = document.createElement('span');
  progress.className = 'product-progress';
  const following = status.planes - status.own;
  progress.textContent = `${status.onStandard}/${following}`;
  progress.dataset.tip =
    `${status.onStandard} of ${following} on it` +
    (status.refitting > 0 ? ` · ${status.refitting} in refit` : '') +
    (status.waiting > 0 ? ` · ${status.waiting} waiting, one per base at a time` : '') +
    (status.own > 0 ? ` · ${status.own} kept on their own` : '');
  progress.classList.toggle('is-done', following > 0 && status.onStandard === following);
  row.append(progress);
  row.append(
    iconButton('✕', 'Clear the standard · each plane keeps the cabin it has', () =>
      showConfirm({
        title: `Clear the ${classByCode(product.typeCode)?.name ?? product.typeCode} standard`,
        rows: [{ label: 'Standard', value: describeLayout(layout) }],
        facts: ['Refits already ordered still happen; no more are ordered. Deliveries arrive all economy.'],
        confirmLabel: 'Clear',
        run: () => {
          ops.setFleetCabin(state, product.typeCode, null);
          changed();
        },
      }),
    ),
  );
  return row;
}

function templateRow(state: SimState, product: ProductType, template: ProductType['templates'][number], changed: () => void): HTMLElement {
  const plan = { business: template.business, premium: template.premium };
  const layout = layoutFor(product.seats, plan);
  const isStandard = product.status.standard !== null && product.status.standard.business === plan.business && product.status.standard.premium === plan.premium;
  const row = document.createElement('div');
  row.className = 'product-template';
  row.classList.toggle('is-standard', isStandard);
  row.append(cabinBar(layout));

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'product-template-name';
  name.textContent = template.name;
  name.dataset.tip = 'Tap to rename';
  name.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'product-template-input';
    input.value = template.name;
    input.maxLength = 24;
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      if (keep && input.value.trim() && input.value.trim() !== template.name) ops.renameCabinTemplate(state, template.id, input.value);
      changed();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    name.replaceWith(input);
    input.focus();
    input.select();
  });
  row.append(name);

  // A template still on its default name is named by its seats already.
  if (template.name !== describeLayout(layout)) {
    const seats = document.createElement('span');
    seats.className = 'product-template-seats';
    seats.textContent = describeLayout(layout);
    row.append(seats);
  }

  if (isStandard) row.append(Object.assign(document.createElement('span'), { className: 'product-template-mark', textContent: '✓' }));
  else row.append(iconButton('⇩', 'Open on the fleet seat map to set it as the standard', () => showFleetSeatMap(state, product.typeCode, changed, plan)));
  row.append(
    iconButton('✕', 'Delete the template · planes keep their cabins', () => {
      ops.deleteCabinTemplate(state, template.id);
      changed();
    }),
  );
  if (isStandard) row.dataset.tip = 'The standard cabin';
  return row;
}

function planeChip(state: SimState, plane: ProductPlane, changed: () => void): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `product-plane is-${plane.standing}`;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'product-plane-open';
  open.append(`${plane.tail} `, cabinBar(plane.layout));
  open.dataset.tip = `${plane.tail} · ${describeLayout(plane.layout)}` + (STANDING_TIP[plane.standing] ? ` · ${STANDING_TIP[plane.standing]}` : '') + (plane.standing === 'refit' ? ' · tap to open the plane' : ' · tap for its seat map');
  open.addEventListener('click', () => {
    if (plane.standing === 'refit') select({ kind: 'aircraft', tail: plane.tail });
    else showSeatMap(state, plane.tail, changed);
  });
  chip.append(open);
  if (plane.standing === 'own') {
    chip.append(
      iconButton('↺', 'Follow the standard cabin again', () => {
        ops.followFleetCabin(state, plane.tail);
        changed();
      }, 'product-tool product-follow'),
    );
  }
  return chip;
}

function typeSection(state: SimState, product: ProductType, changed: () => void): HTMLElement[] {
  const cls = classByCode(product.typeCode);
  const name = cls?.name ?? product.typeCode;
  const header = heading(
    `${name} · ${product.planes.length}`,
    product.fits
      ? `The standard cabin is the one every ${name} should have: set it, and each morning one plane per base not on it is ordered a refit to it (about ${money(product.refitCost)}, ${product.refitDays} days out), the one flying least first. Deliveries arrive with it fitted. Templates are cabins saved under a name: load one on any ${name}'s seat map, or set it as the standard. Chips: teal on the standard, amber in refit, grey waiting, purple kept on its own (↺ puts it back).`
      : `A ${name} has no room for a cabin: every seat is economy.`,
  );
  header.prepend(planeIconElement(product.typeCode), ' ');
  const nodes: HTMLElement[] = [header];
  if (!product.fits) {
    header.classList.add('is-locked');
    nodes.push(line(`${product.seats}Y · no cabin options`, 'inspector-line is-muted'));
    return nodes;
  }
  if (product.planes.length === 0) header.classList.add('is-locked');
  nodes.push(standardRow(state, product, changed));

  const templates = document.createElement('div');
  templates.className = 'product-templates';
  for (const template of product.templates) templates.append(templateRow(state, product, template, changed));
  if (product.templates.length < MAX_TEMPLATES_PER_TYPE) {
    const add = iconButton('＋', `New template · design it on the ${name} fleet seat map and tap ＋ there`, () => showFleetSeatMap(state, product.typeCode, changed), 'product-template-add');
    templates.append(add);
  }
  nodes.push(templates);

  if (product.planes.length > 0) {
    const planes = document.createElement('div');
    planes.className = 'product-planes';
    for (const plane of product.planes) planes.append(planeChip(state, plane, changed));
    nodes.push(planes);
  }
  return nodes;
}

export function buildProductView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view product-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.append(
    'Product ',
    info(
      `Cabins for the whole fleet. A J seat takes the room of ${ECONOMY_SEATS_PER_BUSINESS} Y seats and a W seat ${PREMIUM_SEAT_ROOM}. Bars show each cabin's room: J purple, W teal, Y grey. Each plane can still be refitted on its own from its seat map (the seat icon on a Fleet row); one refitted off its type's standard keeps its own cabin.`,
    ),
  );
  root.append(title);
  const products = ops.productReadout(state);
  const standards = products.filter((product) => product.status.standard).length;
  const inRefit = products.reduce((sum, product) => sum + product.planes.filter((plane) => plane.standing === 'refit').length, 0);
  const templateCount = products.reduce((sum, product) => sum + product.templates.length, 0);
  root.append(line(`${standards} standard${standards === 1 ? '' : 's'} · ${inRefit} in refit · ${templateCount} template${templateCount === 1 ? '' : 's'}`));
  // Fees sit beside cabins: both are what a ticket buys, set airline-wide.
  root.append(...feesSection(state, changed));
  // Types the fleet flies first, then the rest greyed, so what's coming shows without crowding what's here.
  const ordered = [...products.filter((p) => p.fits && p.planes.length > 0), ...products.filter((p) => p.fits && p.planes.length === 0), ...products.filter((p) => !p.fits)];
  for (const product of ordered) root.append(...typeSection(state, product, changed));
  return root;
}
