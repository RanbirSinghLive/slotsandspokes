import { dayIndex } from '../../sim/clock';
import { info, line, heading, lineWithInfo } from './dom';
import { money } from '../format';
import { cashAfterRows, showConfirm } from '../confirmModal';
import { FUEL_PRICE_BASELINE } from '../../sim/fuel';
import { activeHedge, describeFuelPrice } from '../../sim/fuelPrice';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import type { ExecutiveOption, InnovationOption } from '../routeActions';
import { describeEffect, EXECUTIVE_LAPSE_DAYS, type ExecutiveRole } from '../../sim/executives';
import { formatNps, networkNps } from '../../sim/nps';
import { averagePerformance, contractsOf, paymentShare, performanceFactor, RENEW_MIN_PERFORMANCE, SNAP_BACK_SHARE, type Contract } from '../../sim/contracts';
import { select } from '../selection';
import { portraitElement, ROLE_COLOURS } from '../portraits';
import { innovationIconElement } from '../innovationIcons';
import { LADDER, tiersClimbed } from '../../sim/ladder';
import { buyRights, dropRights, EARN_DAYS, LAPSE_DAYS, licencesAllowed, rightsBlocked, rightsCountries, rightsOffer } from '../../sim/rightsLicences';

/**
 * The Head office view (Network › Head office): the airline's decisions
 * that aren't made on the map. Fuel, with its price chart and the hedge
 * (sim/fuelPrice.ts); contracts; the executives' three chairs
 * (sim/executives.ts), each opening to its candidates; and the
 * innovations the ladder opens (sim/innovations.ts), as a tech tree.
 */

/** One innovation: what it does and costs, and a button to adopt it, or why it can't be yet. */
function innovationCard(state: SimState, option: InnovationOption, changed: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'office-card';
  card.classList.toggle('is-adopted', option.adopted);
  card.classList.toggle('is-locked', !option.adopted && option.blocked !== null);
  const name = document.createElement('div');
  name.className = 'office-card-name';
  name.append(option.adopted ? `✓ ${option.name} ` : `${option.name} `, info(option.description));
  const price = [option.oneOffPrice > 0 ? `${money(option.oneOffPrice)} once` : null, option.runningCost ? `${option.runningCost} ongoing` : null]
    .filter(Boolean)
    .join(' · ');
  const status = option.adopted ? (option.runningCost ? `Running · ${option.runningCost}` : 'Adopted') : price;
  card.append(name, line(option.summary), line(status, 'inspector-line office-card-price'));
  if (option.adopted) return card;

  if (option.blocked) {
    card.append(line(option.blocked, 'inspector-line goal-ahead'));
    return card;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = 'Adopt';
  button.addEventListener('click', () => {
    const rows = [];
    if (option.oneOffPrice > 0) rows.push({ label: 'Price', value: `${money(option.oneOffPrice)} once` });
    if (option.runningCost) rows.push({ label: 'Running cost', value: option.runningCost });
    rows.push(...cashAfterRows(state, option.oneOffPrice));
    showConfirm({
      title: `Adopt ${option.name}`,
      rows,
      facts: [option.summary, 'Permanent: it cannot be undone' + (option.runningCost ? ', and the running cost runs for good.' : '.')],
      confirmLabel: 'Adopt',
      run: () => {
        ops.adoptInnovation(state, option.id);
        changed();
      },
    });
  });
  card.append(button);
  return card;
}

/** A button that opens a confirm window; confirming does it. */
function confirmButton(label: string, confirm: Omit<Parameters<typeof showConfirm>[0], 'run'>, act: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = label;
  button.addEventListener('click', () => showConfirm({ ...confirm, run: act }));
  return button;
}

/** One candidate: who they are, what they'd do and cost, and a button to hire them, or why not yet. */
function candidateCard(state: SimState, candidate: ExecutiveOption, role: string, holder: string | null, changed: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'office-card office-person';
  card.classList.toggle('is-locked', candidate.blocked !== null);
  const body = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'office-card-name';
  name.textContent = `${candidate.name} · ${candidate.background}`;
  body.append(
    name,
    line(candidate.flavor, 'inspector-line office-card-flavor'),
    line(describeEffect(candidate.effect)),
    line(`Sign ${money(candidate.signingFee)} · ${money(candidate.salaryPerDay)}/day`, 'inspector-line office-card-price'),
  );
  if (candidate.blocked) {
    body.append(line(candidate.blocked, 'inspector-line goal-ahead'));
  } else {
    body.append(
      confirmButton(
        holder ? `Replace ${holder}` : 'Appoint',
        {
          title: `${holder ? 'Replace' : 'Appoint'} ${role.toUpperCase()}: ${candidate.name}`,
          rows: [
            { label: 'Signing fee', value: money(candidate.signingFee) },
            { label: 'Salary', value: `${money(candidate.salaryPerDay)}/day` },
            ...cashAfterRows(state, candidate.signingFee),
          ],
          facts: [describeEffect(candidate.effect), ...(holder ? [`${holder} leaves, with no refund of their fee.`] : [])],
          confirmLabel: holder ? `Replace ${holder}` : 'Appoint',
        },
        () => {
          ops.appointExecutiveById(state, candidate.id);
          changed();
        },
      ),
    );
  }
  card.append(portraitElement(candidate.id, role, 44), body);
  return card;
}

/** The chair opened to show its holder and candidates, if any: one at a time, kept while the view rebuilds. */
let openChair: string | null = null;

/**
 * The three chairs as tiles, each with who holds it (their portrait, or an
 * empty chair) and, at a glance, what they do or how many candidates are
 * talking to you. Click one to open it: its holder, then each candidate
 * with what they'd do, cost and whether they'll come yet.
 */
function executivesSection(state: SimState, changed: () => void): HTMLElement[] {
  const chairs = ops.executiveOptions(state);
  const nodes: HTMLElement[] = [
    heading('Executives', 'You are the chief executive; these three chairs are yours to fill. The strongest candidates only talk to an airline passengers rate well. A hire with an NPS line leaves if the airline stays under it for 30 days in a row. Click a chair to see who it could be.'),
    line(`Airline NPS ${formatNps(networkNps(state))}`),
  ];
  const row = document.createElement('div');
  row.className = 'office-chairs';
  for (const chair of chairs) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'office-chair-tile';
    tile.classList.toggle('is-open', openChair === chair.role);
    tile.classList.toggle('is-filled', chair.holder !== null);
    tile.style.setProperty('--role', ROLE_COLOURS[chair.role] ?? '#8a93a6');
    tile.title = chair.label;
    const available = chair.candidates.filter((c) => !c.appointed && !c.blocked).length;
    const role = document.createElement('span');
    role.className = 'office-chair-role';
    role.textContent = chair.role.toUpperCase();
    const who = document.createElement('span');
    who.className = 'office-chair-who';
    who.textContent = chair.holder ? chair.holder.name : 'Vacant';
    const note = document.createElement('span');
    note.className = 'office-chair-note';
    note.textContent = chair.holder ? chair.holder.background : `${available} available`;
    tile.append(portraitElement(chair.holder?.id ?? null, chair.role, 56), role, who, note);
    tile.addEventListener('click', () => {
      openChair = openChair === chair.role ? null : chair.role;
      changed();
    });
    row.append(tile);
  }
  nodes.push(row);

  const chair = chairs.find((c) => c.role === openChair);
  if (chair) {
    const title = document.createElement('h4');
    title.className = 'office-chair';
    title.textContent = chair.label;
    nodes.push(title);
    if (chair.holder) {
      const card = document.createElement('div');
      card.className = 'office-card office-person is-adopted';
      const body = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'office-card-name';
      name.textContent = `✓ ${chair.holder.name} · ${chair.holder.background}`;
      body.append(
        name,
        line(describeEffect(chair.holder.effect)),
        line(`Since day ${chair.hiredDay} · ${money(chair.holder.salaryPerDay)}/day`, 'inspector-line office-card-price'),
        ...lapseLine(state, chair.role as ExecutiveRole, chair.holder.npsNeeded),
        confirmButton('Let go', {
          title: `Let ${chair.holder.name} go`,
          rows: [
            { label: 'Chair', value: chair.label },
            { label: 'Salary saved', value: `${money(chair.holder.salaryPerDay)}/day` },
          ],
          facts: [`You lose: ${describeEffect(chair.holder.effect)}`, 'Their signing fee is not refunded, and rehiring costs a new fee.'],
          confirmLabel: 'Let go',
        }, () => {
          ops.letExecutiveGo(state, chair.role as ExecutiveRole);
          changed();
        }),
      );
      card.append(portraitElement(chair.holder.id, chair.role, 44), body);
      nodes.push(card);
    }
    for (const candidate of chair.candidates) {
      if (!candidate.appointed) nodes.push(candidateCard(state, candidate, chair.role, chair.holder?.name ?? null, changed));
    }
  }
  return nodes;
}

/** Under their NPS line: how many days are left before the hire walks, in a warning line. Nothing otherwise. */
function lapseLine(state: SimState, role: ExecutiveRole, npsNeeded: number | null): HTMLElement[] {
  const below = state.executives[role]?.daysBelowLine ?? 0;
  if (below === 0 || npsNeeded === null) return [];
  return [line(`NPS under ${npsNeeded} · leaves in ${EXECUTIVE_LAPSE_DAYS - below}d`, 'inspector-line office-card-price')];
}

/** The innovation opened below the tree, if any, kept while the view rebuilds. */
let selectedInnovation: string | null = null;

/**
 * The innovations as a tech tree: the ladder's tiers down a spine (sim/ladder.ts),
 * lit once climbed, each branching to the programmes it opens. A node is
 * green when running, amber when it can be adopted, grey while its tier
 * is still ahead. Click one for what it does and costs, and to adopt it.
 */
function techTree(state: SimState, changed: () => void): HTMLElement[] {
  const options = ops.innovationOptions(state);
  const climbed = tiersClimbed(state);
  const tree = document.createElement('div');
  tree.className = 'tech-tree';
  LADDER.forEach((tier, index) => {
    const here = options.filter((option) => option.openedBy === tier.id);
    if (here.length === 0) return;
    const reached = climbed > index;
    const tierEl = document.createElement('div');
    tierEl.className = 'tech-tier';
    tierEl.classList.toggle('is-reached', reached);
    const label = document.createElement('div');
    label.className = 'tech-tier-label';
    label.textContent = reached ? tier.name : `${tier.name} · ahead`;
    const row = document.createElement('div');
    row.className = 'tech-nodes';
    for (const option of here) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'tech-node';
      node.classList.add(option.adopted ? 'is-adopted' : option.blocked ? 'is-locked' : 'is-available');
      node.classList.toggle('is-selected', selectedInnovation === option.id);
      const badge = document.createElement('span');
      badge.className = 'tech-node-badge';
      badge.append(innovationIconElement(option.id));
      const name = document.createElement('span');
      name.className = 'tech-node-name';
      name.textContent = option.name;
      const summary = document.createElement('span');
      summary.className = 'tech-node-summary';
      summary.textContent = option.adopted ? '✓ running' : option.summary;
      node.append(badge, name, summary);
      node.addEventListener('click', () => {
        selectedInnovation = selectedInnovation === option.id ? null : option.id;
        changed();
      });
      row.append(node);
    }
    tierEl.append(label, row);
    tree.append(tierEl);
  });
  const nodes: HTMLElement[] = [tree];
  const selected = options.find((option) => option.id === selectedInnovation);
  if (selected) nodes.push(innovationCard(state, selected, changed));
  return nodes;
}

const SVG = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 300;
const CHART_HEIGHT = 90;

function svgLine(x1: number, y1: number, x2: number, y2: number, className: string): SVGLineElement {
  const el = document.createElementNS(SVG, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('class', className);
  return el;
}

/**
 * The market price over the last days, with the usual price dashed and a
 * running hedge's locked price as a line across the days it covers. An
 * SVG built as DOM, like any other panel element: the canvas is the map's.
 */
function fuelChart(state: SimState): SVGSVGElement {
  const history = state.fuelPriceHistory ?? [];
  const hedge = state.fuelHedge;
  const today = dayIndex(state);
  const values = [...history, FUEL_PRICE_BASELINE, ...(hedge ? [hedge.lockedPrice] : [])];
  const low = Math.min(...values) - 0.05;
  const high = Math.max(...values) + 0.05;
  const days = Math.max(history.length, 2);
  const x = (i: number) => (i / (days - 1)) * CHART_WIDTH;
  const y = (price: number) => CHART_HEIGHT - ((price - low) / (high - low)) * CHART_HEIGHT;

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('class', 'fuel-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Fuel price over the last ${history.length} days`);
  svg.append(svgLine(0, y(FUEL_PRICE_BASELINE), CHART_WIDTH, y(FUEL_PRICE_BASELINE), 'fuel-chart-usual'));

  // The history's last entry is today; entry i is (length − 1 − i) days ago.
  if (hedge) {
    const firstDay = today - (history.length - 1);
    const from = Math.max(0, hedge.startDay - firstDay);
    const to = Math.min(history.length - 1, hedge.endDay - 1 - firstDay);
    if (to >= from) svg.append(svgLine(x(from), y(hedge.lockedPrice), x(to), y(hedge.lockedPrice), 'fuel-chart-hedge'));
  }
  if (history.length > 1) {
    const path = document.createElementNS(SVG, 'polyline');
    path.setAttribute('points', history.map((price, i) => `${x(i).toFixed(1)},${y(price).toFixed(1)}`).join(' '));
    path.setAttribute('class', 'fuel-chart-price');
    svg.append(path);
  }
  return svg;
}

/** Where the hedge stands: running and what it has saved, or how the last one ended. */
function hedgeStatus(state: SimState): HTMLElement | null {
  const hedge = state.fuelHedge;
  if (!hedge) return null;
  const net = hedge.saved - hedge.premium;
  const result = `vs market ${hedge.saved >= 0 ? '+' : ''}${money(hedge.saved)} · premium ${money(hedge.premium)} · net ${net >= 0 ? '+' : ''}${money(net)}`;
  if (activeHedge(state)) {
    return line(`Hedged at ${describeFuelPrice(hedge.lockedPrice)} to day ${hedge.endDay} · ${result}`, `inspector-line ${net >= 0 ? 'is-good' : ''}`);
  }
  return line(`Last hedge (days ${hedge.startDay}–${hedge.endDay}) · ${result}`);
}

/** One button per hedge length, each through a confirm window since the premium is spent for good. */
function hedgeButtons(state: SimState, changed: () => void): HTMLElement[] {
  const options = ops.hedgeOptions(state);
  const blocked = options.find((option) => option.blocked)?.blocked;
  if (options.every((option) => option.blocked)) return blocked ? [line(blocked, 'inspector-line goal-ahead')] : [];
  return options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-plan-hub';
    button.textContent = `Hedge ${option.days}d · ${money(option.premium)}`;
    button.disabled = option.blocked !== null;
    button.addEventListener('click', () => {
      showConfirm({
        title: `Hedge fuel ${option.days} days`,
        rows: [
          { label: 'Locked price', value: describeFuelPrice(option.lockedPrice) },
          { label: 'Runs to', value: `day ${dayIndex(state) + option.days}` },
          { label: 'Premium', value: `${money(option.premium)} (spent either way)` },
          { label: 'Fuel covered', value: money(option.covers) },
          ...cashAfterRows(state, option.premium),
        ],
        facts: ['If fuel rises you pay less than the market; if it falls you still pay today\'s price.'],
        confirmLabel: 'Hedge',
        run: () => {
          ops.hedgeFuel(state, option.days);
          changed();
        },
      });
    });
    return button;
  });
}

/** One line for the Network view: today's fuel price, and whether it's hedged. */
export function headOfficeSummary(state: SimState): string {
  const hedge = activeHedge(state);
  return `Fuel ${describeFuelPrice(state.fuelPriceIndex)}${hedge ? ` · hedged to day ${hedge.endDay}` : ''}`;
}

export function buildHeadOfficeView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Head office';
  root.append(title);

  const history = state.fuelPriceHistory ?? [];
  root.append(
    heading('Fuel', 'The price wanders from day to day and drifts back to the usual price; a fuel spike sends it up for weeks.'),
    line(`Today · ${describeFuelPrice(state.fuelPriceIndex)}`),
    fuelChart(state),
    line(`${history.length}d · dashed usual${state.fuelHedge ? ' · green locked' : ''}`, 'inspector-line goal-ahead'),
  );
  const status = hedgeStatus(state);
  if (status) root.append(status);
  root.append(
    lineWithInfo(
      'Hedge',
      "A hedge locks today's price on all your fuel. If fuel rises, you pay less than the market; if it falls, you still pay today's price. The premium is spent either way, so hedging at random loses money: it's a bet on where the price goes.",
    ),
    ...hedgeButtons(state, changed),
  );

  root.append(...contractsSection(state));
  root.append(...executivesSection(state, changed));
  root.append(...rightsSection(state, changed));

  root.append(
    heading('Innovations', 'Programmes the ladder opens (see Goals): each tier down the tree opens the ones branching from it. Each is yours to adopt, for good, if it pays for your airline. Click one for what it does and costs.'),
    ...techTree(state, changed),
  );
  return root;
}

/**
 * Contracts (sim/contracts.ts): offers to take up, running ones
 * with how they're paying, and the last few finished. Each opens its far
 * airport, where the market is drawn from.
 */
function contractsSection(state: SimState): HTMLElement[] {
  const contracts = contractsOf(state);
  const nodes: HTMLElement[] = [
    heading(
      'Contracts',
      `Route contracts for small, underserved communities, funded to keep them connected. Fly the market at least once a day each way and the contract pays so much a day for the term and sends contract riders. The riders, and half the pay, depend on the route's on-time, completion and NPS against stricter bars than ordinary passengers hold it to; the other half is guaranteed. A term kept up to the terms on average is renewed smaller; otherwise, when it ends, the market's built-up demand drops ${Math.round(SNAP_BACK_SHARE * 100)}%.`,
    ),
  ];
  if (contracts.length === 0) {
    nodes.push(line('None on offer', 'inspector-line goal-ahead'));
    return nodes;
  }
  const today = dayIndex(state);
  const order: Record<Contract['status'], number> = { active: 0, offered: 1, ended: 2, lapsed: 3 };
  for (const contract of [...contracts].sort((x, y) => order[x.status] - order[y.status] || x.id - y.id)) {
    const card = document.createElement('div');
    card.className = 'office-card';
    card.classList.toggle('is-adopted', contract.status === 'active');
    card.classList.toggle('is-locked', contract.status === 'ended' || contract.status === 'lapsed');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'inspector-link office-card-name';
    name.textContent = `${contract.a}–${contract.b}`;
    name.addEventListener('click', () => select({ kind: 'airport', iata: contract.b }));
    card.append(name);
    if (contract.status === 'offered') {
      card.append(
        line(`Offer · ${money(contract.paymentPerDay)}/day · ${contract.ridersPerDay} riders/day · ${contract.termDays}d`),
        line(`Fly both ways daily by day ${contract.offerEndsDay} · ${contract.offerEndsDay - today}d left`, 'inspector-line office-card-price'),
      );
    } else if (contract.status === 'active') {
      const performance = performanceFactor(state, contract);
      const renewals = contract.renewals ?? 0;
      card.append(
        line(`Running · ends day ${contract.endsDay} (${(contract.endsDay ?? today) - today}d)${renewals > 0 ? ` · renewed ${renewals}×` : ''}`),
        line(
          `Pay ${Math.round(paymentShare(performance) * 100)}% of ${money(contract.paymentPerDay)} · riders ${Math.round(contract.ridersPerDay * performance)}/${contract.ridersPerDay}`,
          performance < 0.5 ? 'inspector-line is-over' : 'inspector-line',
        ),
        line(`Term average ${Math.round(averagePerformance(contract) * 100)}% · renews at ${Math.round(RENEW_MIN_PERFORMANCE * 100)}% · paid ${money(contract.paidTotal)}`, 'inspector-line office-card-price'),
      );
    } else {
      card.append(line(contract.status === 'ended' ? `Ended · paid ${money(contract.paidTotal)}` : 'Lapsed, not taken up', 'inspector-line goal-ahead'));
    }
    nodes.push(card);
  }
  return nodes;
}

/**
 * Domestic rights abroad (sim/rightsLicences.ts): one card per foreign
 * country the airline has flown into, with a ring of earned days and the
 * state in an icon. Greyed, not hidden, until widebodies open.
 */
function rightsSection(state: SimState, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [
    heading(
      'Rights',
      `Domestic rights in a foreign country, for the late game (opens with widebodies). Fly international service into a country — two departures a day, 60% on time — for ${EARN_DAYS} days and it is offered. Buy it for a setup fee and a yearly levy. Fly a domestic leg there at least every ${LAPSE_DAYS} days or it lapses. Weekly domestic departures there are capped, and the cap grows with the time held. One licence once widebodies open, one more with each tier after.`,
    ),
  ];
  const countries = rightsCountries(state);
  const open = licencesAllowed(state) > 0;
  if (countries.length === 0) {
    nodes.push(line(open ? 'Fly abroad to earn' : '🔒 Widebodies', 'inspector-line goal-ahead'));
    return nodes;
  }
  for (const country of countries) {
    const offer = rightsOffer(state, country);
    const card = document.createElement('div');
    card.className = 'office-card';
    card.classList.toggle('is-adopted', offer.status === 'held');
    card.classList.toggle('is-locked', offer.status === 'locked' || offer.status === 'earning');
    const name = document.createElement('div');
    name.className = 'office-card-name';
    const icon = { locked: '🔒', earning: '◔', offered: '🔑', held: '🛡', home: '🛡' }[offer.status];
    name.append(`${icon} ${country} `, info(`${country} domestic rights · ${offer.progressDays}/${EARN_DAYS} days earned · setup ${money(offer.setup)} · ${money(offer.levyPerYear)}/yr`));
    card.append(name);
    if (offer.status === 'held') {
      card.append(
        line(`${offer.weeklyUsed}/${offer.weeklyCap} per week · ${money(offer.levyPerYear)}/yr`),
        confirmButton(
          'Give back',
          { title: `Give back ${country} rights`, rows: [{ label: 'Refund', value: 'None' }], facts: [`The earned ${EARN_DAYS} days start again.`], confirmLabel: 'Give back' },
          () => {
            dropRights(state, country);
            changed();
          },
        ),
      );
    } else if (offer.status === 'offered') {
      const blocked = rightsBlocked(state, country);
      const rows = [
        { label: 'Setup', value: money(offer.setup) },
        { label: 'Levy', value: `${money(offer.levyPerYear)}/yr` },
        ...cashAfterRows(state, offer.setup),
      ];
      card.append(line(`${money(offer.setup)} · ${money(offer.levyPerYear)}/yr`));
      if (blocked) card.append(line(blocked, 'inspector-line goal-ahead'));
      else {
        card.append(
          confirmButton('Buy', { title: `Buy ${country} domestic rights`, rows, facts: ['Starts at 14 domestic departures a week; the cap grows with time held.'], confirmLabel: 'Buy' }, () => {
            buyRights(state, country);
            changed();
          }),
        );
      }
    } else {
      card.append(line(`${offer.progressDays}/${EARN_DAYS}d`, 'inspector-line office-card-price'));
    }
    nodes.push(card);
  }
  return nodes;
}
