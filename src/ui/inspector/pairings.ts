import { pairingsBySchedule, type Pairing, type PairingBase, type PairingKind } from '../../sim/pairings';
import { minuteOfDayToTimeString } from '../../sim/clock';
import type { SimState } from '../../sim/state';
import { planeIconElement } from '../planeIcons';
import { select } from '../selection';
import { AIRCRAFT_CLASSES, pluralClassName } from '../../sim/aircraftClasses';
import { heading, line } from './dom';
import { foldHeader, isFolded } from './crewsFold';

/**
 * Pairings on the Crews screen (sim/pairings.ts): the duty the current
 * schedule asks of crews, a row per plane across the home-local day, a bar
 * per pairing. Green is a day pairing out of and back to base, amber ends
 * in the evening, red runs into the night, grey starts or ends away from
 * base. Grouped by aircraft type, each folding on its header, then by
 * crew base inside it. Read only: the schedule is changed on the Fleet Gantt.
 */

const DAY_MINUTES = 1440;

const KIND_TIP: Record<PairingKind, string> = {
  day: 'Day pairing: out of base and back inside the day',
  late: 'Late pairing: back at base in the evening',
  night: 'Night pairing: duty runs into the night',
  away: 'Away pairing: starts or ends away from base',
};

const pct = (minute: number) => `${(Math.min(DAY_MINUTES, Math.max(0, minute)) / DAY_MINUTES) * 100}%`;
const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

function barTip(p: Pairing): string {
  return `${p.tail} · ${KIND_TIP[p.kind]} · ${p.route.join('·')} · ${minuteOfDayToTimeString(((p.start % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES)}–${minuteOfDayToTimeString(p.end)} · duty ${hours(p.dutyMinutes)} · flying ${hours(p.blockMinutes)} · ${Math.round(p.creditRatio * 100)}% flying`;
}

/** One crew base's pairings for a type; `withStats` false when the type's header already says the same (one base). */
function groupBlock(group: PairingBase, withStats: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pairing-group';
  const head = document.createElement('div');
  head.className = 'pairing-head';
  const name = document.createElement('span');
  name.className = 'pairing-name';
  name.textContent = group.iata;
  const stats = document.createElement('span');
  stats.className = 'pairing-stats';
  const flags = [group.night > 0 ? `${group.night} night` : '', group.late > 0 ? `${group.late} late` : '', group.away > 0 ? `${group.away} away` : ''].filter(Boolean);
  stats.textContent = `${group.crews} crews · ${Math.round(group.creditRatio * 100)}% flying` + (flags.length > 0 ? ` · ${flags.join(' · ')}` : '');
  stats.title = `${hours(group.blockHours * 60)} flying in ${hours(group.dutyHours * 60)} of duty across ${group.pairings.length} pairings`;
  head.append(name);
  if (withStats) head.append(stats);
  card.append(head);

  const byTail = new Map<string, Pairing[]>();
  for (const pairing of group.pairings) byTail.set(pairing.tail, [...(byTail.get(pairing.tail) ?? []), pairing]);
  for (const [tail, pairings] of byTail) {
    const row = document.createElement('div');
    row.className = 'pairing-row';
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'inspector-link pairing-tail';
    label.textContent = tail.replace(/^C-/, '');
    label.title = `Open ${tail}`;
    label.addEventListener('click', () => select({ kind: 'aircraft', tail }));
    const track = document.createElement('div');
    track.className = 'pairing-track';
    for (const pairing of pairings) {
      const bar = document.createElement('span');
      bar.className = `pairing-bar is-${pairing.kind}`;
      bar.style.left = pct(pairing.start);
      bar.style.width = `${((Math.min(DAY_MINUTES, pairing.end) - Math.max(0, pairing.start)) / DAY_MINUTES) * 100}%`;
      bar.title = barTip(pairing);
      bar.setAttribute('aria-label', barTip(pairing));
      track.append(bar);
    }
    row.append(label, track);
    card.append(row);
  }
  return card;
}

/** The Pairings side of the Crews screen: one folding section per aircraft type, a block per crew base inside it. */
export function pairingsSection(state: SimState, changed: () => void): HTMLElement[] {
  const groups = pairingsBySchedule(state);
  const title = heading(
    'Pairings',
    'The duty the current schedule asks of crews, by aircraft type (tap a type to fold it), then by crew base: one row per plane across the home-local day (gridlines every 4 hours), one bar per pairing, from an hour before the first departure to the last landing. A wait at base of 2 hours or more lets the crew change, which splits a pairing. Green is out of base and back inside the day, amber is back in the evening (after 19:00), red runs into the night (before 06:00 or after 22:00), grey starts or ends away from base. The percentage is time flying over time on duty: a low one means crews paid to wait. Duty between 22:00 and 06:00 counts 1.5x toward a shift, so red pairings need more crews and tire them sooner. Crews are counted as the planes in the group fly with today.',
  );
  if (groups.length === 0) return [title, line('No schedules yet · draw a route to see its pairings')];
  const nodes: HTMLElement[] = [title];
  for (const cls of AIRCRAFT_CLASSES) {
    const ofType = groups.filter((group) => group.classCode === cls.code);
    if (ofType.length === 0) continue;
    const key = `type:${cls.code}`;
    const crews = ofType.reduce((sum, group) => sum + group.crews, 0);
    const duty = ofType.reduce((sum, group) => sum + group.dutyHours, 0);
    const block = ofType.reduce((sum, group) => sum + group.blockHours, 0);
    const planes = new Set(ofType.flatMap((group) => group.pairings.map((p) => p.tail))).size;
    const night = ofType.reduce((sum, group) => sum + group.night, 0);
    const detail = document.createElement('span');
    detail.className = 'crew-fold-detail';
    detail.textContent = `✈ ${planes} · ${crews} crews · ${duty > 0 ? Math.round((block / duty) * 100) : 0}% flying` + (night > 0 ? ` · ${night} night` : '');
    detail.title = `${hours(block * 60)} flying in ${hours(duty * 60)} of duty · ${ofType.length} crew base${ofType.length === 1 ? '' : 's'}`;
    const section = document.createElement('div');
    section.className = 'crew-base';
    section.append(foldHeader(key, changed, planeIconElement(cls.code), ` ${pluralClassName(cls.name)}`, detail));
    if (!isFolded(key)) section.append(...ofType.map((group) => groupBlock(group, ofType.length > 1)));
    nodes.push(section);
  }
  return nodes;
}
