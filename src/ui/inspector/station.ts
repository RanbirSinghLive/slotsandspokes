import { showConfirm } from '../confirmModal';
import { money } from '../format';
import { heading, line } from './dom';
import {
  DELAY_CAUSES,
  HANDLING,
  HUB_MIN_DEPARTURES,
  LEDGER_DAYS,
  STATION_BUILD_DAYS,
  STATION_FEE,
  STATION_PER_DAY,
  downgradeStation,
  handlingParameters,
  pendingStation,
  stationDowngradeBlocked,
  stationReadout,
  stationTier,
  stationUpgradeBlocked,
  upgradeStation,
  type DelayCause,
  type HandlingTier,
} from '../../sim/stations';
import type { SimState } from '../../sim/state';

/**
 * The station section of an airport view (sim/stations.ts): who handles the
 * ground work here, and a turnaround strip showing what a typical departure
 * from this airport loses to each cause. Bar lengths share one scale, so two
 * airports' strips compare at a glance.
 */

/** Minutes of delay per departure that fill the strip. */
const STRIP_FULL_MINUTES = 30;
/** The on-time line: a departure that loses this much has used up the grace (sim/delays.ts). */
const STRIP_MARK_MINUTES = 15;

export const CAUSE_STYLE: Record<DelayCause, { color: string; code: string; name: string }> = {
  knockOn: { color: '#ffb347', code: 'TURN', name: 'Late inbound plane ate the turn' },
  ground: { color: '#b07ad9', code: 'GND', name: 'Ground handling' },
  congestion: { color: '#ff5c5c', code: 'CONG', name: 'Airport congestion' },
  weather: { color: '#4a90d9', code: 'WX', name: 'Weather' },
  age: { color: '#8a93a6', code: 'ACFT', name: 'Aircraft age' },
};

export const TIER_GLYPH: Record<HandlingTier, string> = { contract: '○', own: '◐', hub: '●' };
const TIER_NAME: Record<HandlingTier, string> = { contract: 'Contract handler', own: 'Own ramp staff', hub: 'Hub-grade handling' };

export function minutesText(minutes: number): string {
  return minutes.toFixed(1);
}

export function stationSection(state: SimState, iata: string, changed: () => void): HTMLElement[] {
  const tier = stationTier(state, iata);
  const pending = pendingStation(state, iata);
  const handling = handlingParameters(state, iata);
  const nodes: HTMLElement[] = [
    heading(
      'Station',
      `Who handles the ground work here, and what a typical departure from this airport loses to each cause over the last ${LEDGER_DAYS} days. ` +
        `Handling delays a departure ${Math.round(handling.chance * 100)}% of the time, up to ${Math.round(handling.maxMinutes)} min. ` +
        `Contract handlers are slowest, and slower again at thin fields. Own staff needs a crew or line base here; hub-grade needs own staff and ${HUB_MIN_DEPARTURES} departures a day. ` +
        `Each step is paid up front, takes ${STATION_BUILD_DAYS.own}–${STATION_BUILD_DAYS.hub} days to build and costs a fixed amount a day. ` +
        `A longer turn buffer on a route soaks up TURN delay; handling and congestion need the tier or fewer movements.`,
    ),
  ];

  const tierRow = line(`${TIER_GLYPH[tier]} ${TIER_NAME[tier]}`, 'inspector-line station-tier');
  tierRow.title = `${TIER_NAME[tier]} · delays ${Math.round(handling.chance * 100)}% of departures, up to ${handling.maxMinutes} min`;
  if (tier !== 'contract' && !(tier === 'own' && iata === state.homeAirport)) {
    tierRow.append(` · ${money(STATION_PER_DAY[tier])}/day`);
  }
  if (pending) tierRow.append(` · ${TIER_GLYPH[pending.to]} ready day ${pending.readyDay}`);
  nodes.push(tierRow);

  const readout = stationReadout(state, iata);
  if (readout) {
    const strip = document.createElement('div');
    strip.className = 'station-strip';
    for (const cause of DELAY_CAUSES) {
      const minutes = readout.perDeparture[cause];
      if (minutes <= 0) continue;
      const segment = document.createElement('span');
      segment.className = 'station-strip-seg';
      segment.style.width = `${Math.min(100, (minutes / STRIP_FULL_MINUTES) * 100)}%`;
      segment.style.background = CAUSE_STYLE[cause].color;
      segment.title = `${CAUSE_STYLE[cause].code} · ${CAUSE_STYLE[cause].name} · ${minutesText(minutes)} min a departure`;
      strip.append(segment);
    }
    const mark = document.createElement('span');
    mark.className = 'station-strip-mark';
    mark.style.left = `${(STRIP_MARK_MINUTES / STRIP_FULL_MINUTES) * 100}%`;
    mark.title = `${STRIP_MARK_MINUTES} min · the on-time line`;
    strip.append(mark);
    nodes.push(strip);
    nodes.push(
      line(
        `${minutesText(readout.totalPerDeparture)} min/dep` +
          (readout.topCause ? ` · ${CAUSE_STYLE[readout.topCause].code}` : '') +
          ` · ${readout.departures} dep · ${readout.days}d` +
          (readout.lateDeparturePerDeparture >= 1 ? ` · leaves +${Math.round(readout.lateDeparturePerDeparture)}` : ''),
      ),
    );
  } else {
    nodes.push(line('No departures yet', 'inspector-line goal-ahead'));
  }

  const actions = document.createElement('div');
  actions.className = 'station-actions';
  const next: 'own' | 'hub' | null = tier === 'contract' ? 'own' : tier === 'own' ? 'hub' : null;
  if (next) {
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'base-close';
    up.textContent = `▲ ${TIER_GLYPH[next]} ${money(STATION_FEE[next])}`;
    const blocked = stationUpgradeBlocked(state, iata);
    up.disabled = blocked !== null;
    up.title = blocked ?? `${TIER_NAME[next]} · ${money(STATION_FEE[next])} + ${money(STATION_PER_DAY[next])}/day · ${STATION_BUILD_DAYS[next]} days to build`;
    up.addEventListener('click', () =>
      showConfirm({
        title: `${TIER_NAME[next]} · ${iata}`,
        rows: [
          { label: 'Fee now', value: money(STATION_FEE[next]) },
          { label: 'Running cost', value: `${money(STATION_PER_DAY[next])}/day` },
          { label: 'Ready in', value: `${STATION_BUILD_DAYS[next]} days` },
          { label: 'Ground delays', value: `${Math.round(HANDLING[next].chance * 100)}% · up to ${HANDLING[next].maxMinutes} min` },
          { label: 'Cash after', value: money(state.cash - STATION_FEE[next]) },
        ],
        facts: ['Stepping down later is instant and refunds nothing.'],
        confirmLabel: `Build · ${money(STATION_FEE[next])}`,
        run: () => {
          upgradeStation(state, iata);
          changed();
        },
      }),
    );
    actions.append(up);
  }
  if (tier !== 'contract') {
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'base-close';
    down.textContent = '▼';
    const blocked = stationDowngradeBlocked(state, iata);
    down.disabled = blocked !== null;
    down.title = blocked ?? 'Step down one tier · no refund';
    down.addEventListener('click', () => {
      downgradeStation(state, iata);
      changed();
    });
    actions.append(down);
  }
  if (actions.childElementCount > 0) nodes.push(actions);
  return nodes;
}
