import { countryOf, domesticRightsCountries, grantedCountries, homeCountry } from '../../sim/rights';
import type { SimState } from '../../sim/state';

/**
 * The air-rights mark beside an airport's or route's title: an icon in the
 * Rights map view's green when the home carrier may fly domestic routes
 * there, grey when only international legs are allowed. The words live in
 * its tip (ui/infoTooltip.ts shows it on hover, focus or tap).
 */

const SHIELD = '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>';
const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>';

function mark(domestic: boolean, tip: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `info-mark rights-mark ${domestic ? 'is-domestic' : 'is-international'}`;
  el.dataset.info = tip;
  el.setAttribute('aria-label', tip);
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${domestic ? SHIELD : GLOBE}</svg>`;
  return el;
}

/** Null when the airport's or the home country isn't known: nothing to say. */
export function airportRightsMark(state: SimState, iata: string): HTMLElement | null {
  const home = homeCountry(state);
  const country = countryOf(iata);
  if (!home || !country) return null;
  const domestic = domesticRightsCountries(home, grantedCountries(state)).includes(country);
  return mark(
    domestic,
    domestic
      ? `${country} · domestic and international routes open to ${home} carriers`
      : `${country} · international routes only: ${home} carriers can't fly or sell trips between two ${country} airports (cabotage)`,
  );
}

export function routeRightsMark(state: SimState, a: string, b: string): HTMLElement | null {
  const home = homeCountry(state);
  const countryA = countryOf(a);
  const countryB = countryOf(b);
  if (!home || !countryA || !countryB) return null;
  return countryA === countryB ? mark(true, `${countryA} · domestic route, open to ${home} carriers`) : mark(false, `${countryA} → ${countryB} · international route`);
}
