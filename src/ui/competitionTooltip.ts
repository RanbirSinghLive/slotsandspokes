import { airports } from '../render/airports';
import type { CompetitionHover, Operator } from '../render/competition';
import { operatorsForAirport, operatorsForMarket } from '../render/competition';
import { PLAYER_AIRLINE } from '../sim/airline';
import { airportPresence } from '../render/airports';
import { connectingPassengersThrough } from '../sim/hubs';
import type { SimState } from '../sim/state';

const tooltip = document.querySelector<HTMLDivElement>('#competition-tooltip')!;
const titleEl = document.querySelector<HTMLDivElement>('#competition-tooltip-title')!;
const pieEl = document.querySelector<HTMLDivElement>('#competition-tooltip-pie')!;
const legendEl = document.querySelector<HTMLUListElement>('#competition-tooltip-legend')!;
const presenceEl = document.querySelector<HTMLDivElement>('#competition-tooltip-presence')!;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

const PIE_RADIUS = 30;

/**
 * A pie chart as a small inline SVG string, one wedge per operator sized
 * by its share of the total frequency shown. A single operator (the
 * common case — most markets in this dataset have no competitor at all)
 * draws as a plain filled circle rather than a degenerate 360°-sweep arc
 * path, which some SVG renderers handle inconsistently.
 */
function buildPieSvg(operators: Operator[]): string {
  const radius = PIE_RADIUS;
  const drawRadius = radius - 1;
  const total = operators.reduce((sum, o) => sum + o.frequency, 0);

  if (operators.length <= 1 || total === 0) {
    const color = operators[0]?.color ?? '#9aa3b8';
    return `<svg viewBox="0 0 ${radius * 2} ${radius * 2}" width="${radius * 2}" height="${radius * 2}"><circle cx="${radius}" cy="${radius}" r="${drawRadius}" fill="${color}" /></svg>`;
  }

  let angle = 0;
  const wedges: string[] = [];
  for (const operator of operators) {
    const nextAngle = angle + (operator.frequency / total) * 2 * Math.PI;
    const x0 = radius + drawRadius * Math.sin(angle);
    const y0 = radius - drawRadius * Math.cos(angle);
    const x1 = radius + drawRadius * Math.sin(nextAngle);
    const y1 = radius - drawRadius * Math.cos(nextAngle);
    const largeArcFlag = nextAngle - angle > Math.PI ? 1 : 0;
    wedges.push(
      `<path d="M ${radius},${radius} L ${x0},${y0} A ${drawRadius},${drawRadius} 0 ${largeArcFlag} 1 ${x1},${y1} Z" fill="${operator.color}" />`,
    );
    angle = nextAngle;
  }

  return `<svg viewBox="0 0 ${radius * 2} ${radius * 2}" width="${radius * 2}" height="${radius * 2}">${wedges.join('')}</svg>`;
}

function renderOperators(title: string, operators: Operator[]): void {
  titleEl.textContent = title;
  pieEl.innerHTML = buildPieSvg(operators);

  const total = operators.reduce((sum, o) => sum + o.frequency, 0);
  legendEl.innerHTML = '';
  for (const operator of [...operators].sort((a, b) => b.frequency - a.frequency)) {
    const item = document.createElement('li');
    const percent = total > 0 ? Math.round((operator.frequency / total) * 100) : 0;
    const swatch = document.createElement('span');
    swatch.className = 'competition-tooltip-swatch';
    swatch.style.background = operator.color;
    const label = document.createElement('span');
    label.textContent = `${operator.code} ${operator.name} — ${percent}% (${operator.frequency}/day)`;
    item.append(swatch, label);
    legendEl.appendChild(item);
  }
}

/**
 * The airline's own presence at this airport: level, departures,
 * connecting passengers, and slot holdings. It belongs on the map, where
 * the places are, and the dots already encode the same numbers visually
 * (render/airports.ts).
 */
function renderPresence(iata: string, state: SimState): void {
  const p = airportPresence(state, iata);
  const parts: string[] = [];

  if (p.departures === 0) {
    parts.push('Not served');
  } else {
    const connecting = Math.round(connectingPassengersThrough(state, iata));
    parts.push(`${p.level} · ${p.departures} dep/day`);
    if (connecting > 0) parts.push(`${connecting} connecting/day`);
  }

  if (p.slotsHeld > 0) parts.push(`slots ${p.slotsHeld} · $${p.slotFeesPerDay.toLocaleString()}/day`);

  presenceEl.textContent = parts.join(' · ');
}

/**
 * Show the tooltip for whatever findCompetitionHover() (render/
 * competition.ts) currently reports under the cursor, positioned just
 * off the pointer. Called from main.ts's mousemove handler whenever the
 * map is showing.
 *
 * `includeCompetitors` mirrors the Competition overlay's own on/off state
 * — revealing competitor operators on hover is exactly what turning that
 * overlay on is supposed to mean, so with it off this filters the
 * legend down to just the player's own entry (if any), same as the
 * overlay itself only drawing your own routes when it's off.
 */
export function showCompetitionTooltip(
  hover: CompetitionHover,
  screenX: number,
  screenY: number,
  state: SimState,
  includeCompetitors: boolean,
): void {
  const ownOnly = (operators: Operator[]): Operator[] =>
    includeCompetitors ? operators : operators.filter((o) => o.code === PLAYER_AIRLINE.code);

  if (hover.type === 'airport') {
    const airport = airportsByIata.get(hover.iata);
    renderOperators(`${hover.iata}${airport ? ` — ${airport.name}` : ''}`, ownOnly(operatorsForAirport(hover.iata, state)));
    renderPresence(hover.iata, state);
  } else {
    presenceEl.textContent = '';
    renderOperators(`${hover.origin} ↔ ${hover.dest}`, ownOnly(operatorsForMarket(hover.origin, hover.dest, state)));
  }

  tooltip.hidden = false;
  tooltip.style.left = `${screenX + 16}px`;
  tooltip.style.top = `${screenY + 16}px`;
}

export function hideCompetitionTooltip(): void {
  tooltip.hidden = true;
}
