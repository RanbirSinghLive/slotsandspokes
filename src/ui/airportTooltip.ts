import { airportPresence, airports } from '../render/airports';
import { connectingPassengersThrough } from '../sim/hubs';
import { airportDemandSize } from '../sim/marketSize';
import { describeServiceLevel, hungerAt } from '../sim/serviceLevel';
import type { SimState } from '../sim/state';
import { unmetDemandByAirport } from '../sim/unmetDemand';

/**
 * The airport hover card: an airport's name and the few numbers worth
 * reading before clicking it. The map labels airports by code only, so
 * this is where a name is one hover away; the airport view (a click) has
 * everything else. With the Competition overlay on, its own card
 * (ui/competitionTooltip.ts) covers airports instead.
 */

const tooltipEl = document.querySelector<HTMLDivElement>('#airport-tooltip')!;
const namesByIata = new Map(airports.map((airport) => [airport.iata, airport.name]));

function line(text: string, className?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

// The card is rebuilt only when what it says changes, not every frame.
let shownText = '';

export function showAirportTooltip(state: SimState, iata: string, screenX: number, screenY: number): void {
  const presence = airportPresence(state, iata);
  const connecting = Math.round(connectingPassengersThrough(state, iata));
  const unmet = unmetDemandByAirport(state).get(iata);
  const weather = state.weatherByAirport[iata];

  const lines: [string, string?][] = [[`${iata} · ${namesByIata.get(iata) ?? iata}`, 'flight-tooltip-title']];
  lines.push([
    presence.departures === 0
      ? 'Not served'
      : `${presence.level} · ${presence.departures} dep/day` + (connecting > 0 ? ` · ${connecting} connecting` : ''),
  ]);
  lines.push([
    (unmet ? `Demand ${airportDemandSize(unmet.latent).toLowerCase()} · ` : '') + describeServiceLevel(hungerAt(state, iata)).label.toLowerCase(),
  ]);
  if (unmet && unmet.spilled >= 1) lines.push([`${Math.round(unmet.spilled).toLocaleString()} pax/day turned away`, 'is-late']);
  if (weather) lines.push([`WX ${weather.kind === 'thunderstorm' ? 'thunderstorm' : 'snowstorm'}`, 'is-late']);

  const text = lines.map(([t]) => t).join('|');
  if (text !== shownText) {
    shownText = text;
    tooltipEl.replaceChildren(...lines.map(([t, className]) => line(t, className)));
  }
  tooltipEl.hidden = false;

  // Beside the dot, kept on the map rather than spilling over the sidebar.
  tooltipEl.style.left = `${screenX + 16}px`;
  tooltipEl.style.top = `${screenY + 16}px`;
  const rect = tooltipEl.getBoundingClientRect();
  const mapRight = document.querySelector<HTMLCanvasElement>('#map')!.getBoundingClientRect().right;
  if (rect.right > mapRight) tooltipEl.style.left = `${Math.max(8, screenX - rect.width - 16)}px`;
  if (rect.bottom > window.innerHeight) tooltipEl.style.top = `${screenY - rect.height - 16}px`;
}

export function hideAirportTooltip(): void {
  tooltipEl.hidden = true;
}
