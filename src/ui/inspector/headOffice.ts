import { info, line, heading } from './dom';
import { money } from '../format';
import { cashAfterRows, showConfirm } from '../confirmModal';
import type { SimState } from '../../sim/state';
import * as ops from '../routeActions';
import type { ExecutiveOption, InnovationOption } from '../routeActions';
import { describeEffect, EXECUTIVE_LAPSE_DAYS, type ExecutiveRole } from '../../sim/executives';
import { formatNps, networkNps } from '../../sim/nps';
import { portraitElement, ROLE_COLOURS } from '../portraits';
import { innovationIconElement } from '../innovationIcons';
import { LADDER, tiersClimbed } from '../../sim/ladder';
import { RD_BUDGETS } from '../../sim/rd';
import { buyRights, dropRights, EARN_DAYS, LAPSE_DAYS, licencesAllowed, rightsBlocked, rightsCountries, rightsOffer } from '../../sim/rightsLicences';

/**
 * The Head office view (Network › Head office): the airline's decisions
 * that aren't made on the map: the executives' chairs
 * (sim/executives.ts), each opening to its candidates; and the
 * innovations the ladder opens (sim/innovations.ts), as a tech tree.
 */

/** One project: what it does, how far research has got, and a button to work on it, or why it can't be yet. */
function innovationCard(state: SimState, option: InnovationOption, changed: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'office-card';
  card.classList.toggle('is-adopted', option.adopted);
  card.classList.toggle('is-locked', !option.adopted && option.blocked !== null);
  const name = document.createElement('div');
  name.className = 'office-card-name';
  name.append(option.adopted ? `✓ ${option.name} ` : `${option.name} `, info(option.description));
  const cost = [`${Math.round(option.progress * 100)}% of ${money(option.oneOffPrice)}`, option.runningCost ? `${option.runningCost} ongoing` : null].filter(Boolean).join(' · ');
  const status = option.adopted ? (option.runningCost ? `Running · ${option.runningCost}` : 'Done') : cost;
  card.append(name, line(option.summary), line(status, 'inspector-line office-card-price'));
  if (option.adopted) return card;

  if (option.blocked) {
    card.append(line(option.blocked, 'inspector-line goal-ahead'));
    return card;
  }
  if (option.active) {
    card.append(line('In research', 'inspector-line'));
    return card;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub';
  button.textContent = option.progress > 0 ? 'Resume' : 'Research';
  button.addEventListener('click', () => {
    ops.startResearch(state, option.id);
    changed();
  });
  card.append(button);
  return card;
}

/** The R&D budget as a row of buttons, the day's speed from on-time performance beside it. */
function rdBar(state: SimState, changed: () => void): HTMLElement {
  const readout = ops.rdReadout(state);
  const bar = document.createElement('div');
  bar.className = 'rd-bar';
  const title = document.createElement('div');
  title.className = 'inspector-line';
  title.append(`R&D ${readout.perDay > 0 ? `${money(readout.perDay)}/day` : 'off'} · speed ×${readout.speed.toFixed(2)} `,
    info('Money feeds research: each day the budget is spent on the project you pick and becomes points. Good on-time performance speeds it up (×1.5 at the best, ×0.75 at the worst) because operating knowledge leads to breakthroughs. Some steps do nothing by themselves and only open the next one. Locked projects stay greyed until the ladder opens them.'));
  const row = document.createElement('div');
  row.className = 'rd-budgets';
  RD_BUDGETS.forEach((perDay, level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rd-budget';
    button.classList.toggle('is-on', readout.level === level);
    button.textContent = perDay === 0 ? 'Off' : money(perDay);
    button.addEventListener('click', () => {
      ops.setRdBudget(state, level);
      changed();
    });
    row.append(button);
  });
  bar.append(title, row);
  return bar;
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
 * The chairs as tiles, each with who holds it (their portrait, or an
 * empty chair) and, at a glance, what they do or how many candidates are
 * talking to you. Click one to open it: its holder, then each candidate
 * with what they'd do, cost and whether they'll come yet.
 */
function executivesSection(state: SimState, changed: () => void): HTMLElement[] {
  const chairs = ops.executiveOptions(state);
  const nodes: HTMLElement[] = [
    heading('Executives', 'You are the chief executive; these chairs are yours to fill, and more open as the airline climbs the ladder. The strongest candidates only talk to an airline passengers rate well. A hire with an NPS line leaves if the airline stays under it for 30 days in a row. Click a chair to see who it could be.'),
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
    tile.classList.toggle('is-locked', chair.opensAt !== null);
    tile.style.setProperty('--role', ROLE_COLOURS[chair.role] ?? '#8a93a6');
    tile.title = chair.opensAt ? `${chair.label} · opens at ${chair.opensAt}` : chair.label;
    const available = chair.candidates.filter((c) => !c.appointed && !c.blocked).length;
    const role = document.createElement('span');
    role.className = 'office-chair-role';
    role.textContent = chair.role.toUpperCase();
    const who = document.createElement('span');
    who.className = 'office-chair-who';
    who.textContent = chair.holder ? chair.holder.name : 'Vacant';
    const note = document.createElement('span');
    note.className = 'office-chair-note';
    note.textContent = chair.holder ? chair.holder.background : chair.opensAt ? `🔒 ${chair.opensAt}` : `${available} available`;
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
/** Set by a tap on a project, so the next draw scrolls its card into view. */
let showCardAfterRender = false;

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
      summary.textContent = option.adopted ? '✓ done' : option.active ? `Researching ${Math.round(option.progress * 100)}%` : option.progress > 0 ? `${Math.round(option.progress * 100)}% · paused` : option.bridge ? 'Opens the next step' : option.summary;
      node.classList.toggle('is-active', option.active);
      node.append(badge, name, summary);
      node.addEventListener('click', () => {
        selectedInnovation = selectedInnovation === option.id ? null : option.id;
        showCardAfterRender = selectedInnovation !== null;
        changed();
      });
      row.append(node);
    }
    tierEl.append(label, row);
    tree.append(tierEl);
  });
  const nodes: HTMLElement[] = [rdBar(state, changed), tree];
  const selected = options.find((option) => option.id === selectedInnovation);
  if (selected) {
    const card = innovationCard(state, selected, changed);
    nodes.push(card);
    // The card sits under the whole tree, so on a phone a tap high in the tree would show nothing without this.
    if (showCardAfterRender) requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    showCardAfterRender = false;
  }
  return nodes;
}

export function buildHeadOfficeView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Head office';
  root.append(title);

  root.append(...executivesSection(state, changed));
  root.append(...rightsSection(state, changed));

  root.append(
    heading('R&D', 'Projects the ladder opens (see Goals): each tier down the tree opens the ones branching from it. Pick one and the daily budget researches it; each finished project is yours for good. Click one for what it does and costs.'),
    ...techTree(state, changed),
  );
  return root;
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
