import { crewBases } from '../../sim/crews';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import * as ops from '../routeActions';
import { select } from '../selection';
import { crewExplanation, crewRows } from './airport';
import { heading, line } from './dom';
import { linkToMap } from '../mapLink';

/**
 * The Crews screen: every crew base's crews by class in one place, with
 * the same hire, retrain and release buttons as each airport's view.
 * Bases short of crews come first, since those are grounding planes.
 */
export function buildCrewsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Crews';
  root.append(title);

  const bases = Object.keys(crewBases(state))
    .map((iata) => ({ iata, readout: ops.crewReadout(state, iata) }))
    .filter((base): base is { iata: string; readout: NonNullable<typeof base.readout> } => base.readout !== null && base.readout.classes.length > 0);
  if (bases.length === 0) {
    root.append(line('No crew bases yet · a base opens where you base a plane'));
    return root;
  }

  const all = bases.flatMap((base) => base.readout.classes);
  const crews = all.reduce((sum, crew) => sum + crew.crews, 0);
  const joining = all.reduce((sum, crew) => sum + crew.arriving, 0);
  const standby = all.reduce((sum, crew) => sum + Math.max(0, crew.crews - crew.ideal) * crew.standbyPerDay, 0);
  const short = all.filter((crew) => crew.crews < crew.minimum).length;
  root.append(
    line(
      `${crews} crews · ${bases.length} base${bases.length === 1 ? '' : 's'}` +
        (joining > 0 ? ` · +${joining} joining` : '') +
        (standby > 0 ? ` · standby ${money(standby)}/day` : '') +
        (short > 0 ? ` · ${short} class${short === 1 ? '' : 'es'} short` : ''),
      short > 0 ? 'inspector-line is-over' : 'inspector-line',
    ),
  );

  const shortness = (base: (typeof bases)[number]) => base.readout.classes.filter((crew) => crew.crews < crew.minimum).length;
  bases.sort((x, y) => shortness(y) - shortness(x) || x.iata.localeCompare(y.iata));
  root.append(heading('By base', crewExplanation(bases[0].readout)));
  for (const base of bases) {
    // Each base's name opens its airport view, where its planes are.
    const link = linkToMap(document.createElement('button'), { kind: 'airport', iata: base.iata });
    link.type = 'button';
    link.className = 'inspector-link crews-base';
    link.textContent = base.iata;
    link.addEventListener('click', () => select({ kind: 'airport', iata: base.iata }));
    root.append(link, ...crewRows(state, base.iata, changed));
  }
  return root;
}
