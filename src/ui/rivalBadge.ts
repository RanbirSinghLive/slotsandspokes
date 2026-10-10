import { classByCode } from '../sim/aircraftClasses';
import { rivalHomeCountry } from '../sim/rights';
import type { SimState } from '../sim/state';

/**
 * The look of a rival airline in the panel: a generated logo tile, its
 * country's flag and a pip per plane. All drawn here from the airline's
 * code and country, so there are no image files and a new rival needs no
 * artwork. The colours depend only on the code, so a carrier looks the
 * same in every save.
 */

/** Pip colour per aircraft class; unknown types fall back to grey. */
const CLASS_COLOURS: Record<string, string> = {
  Propeller: '#8aa0b8',
  Regional: '#5ed6c4',
  Narrowbody: '#ffb347',
  Widebody: '#c792ea',
};

function hueOf(code: string): number {
  let hue = 0;
  for (const char of code) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return hue;
}

/** "CA" → the flag emoji, built from regional-indicator letters. */
export function flagOf(country: string | undefined): string {
  if (!country || country.length !== 2) return '🏳';
  return String.fromCodePoint(...[...country.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** A rival's square logo: its colour, one of three motifs, and its code. A fogged rival is a grey "?". */
export function rivalLogo(code: string, size: number, unseen = false): HTMLElement {
  const hue = hueOf(code);
  const background = unseen ? '#262b36' : `hsl(${hue} 55% 38%)`;
  const text = unseen ? '#6b7384' : `hsl(${hue} 80% 88%)`;
  const accent = unseen ? '#333a48' : `hsl(${(hue + 40) % 360} 70% 55%)`;
  const motif = [
    '<rect x="0" y="26" width="40" height="5" fill="ACCENT"/>',
    '<path d="M0 40 L40 14 L40 22 L0 40Z" fill="ACCENT"/>',
    '<circle cx="33" cy="9" r="5" fill="ACCENT"/>',
  ][hue % 3].replace('ACCENT', accent);
  const el = document.createElement('span');
  el.className = 'rival-logo';
  el.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="${background}"/>${motif}` +
    `<text x="20" y="25" text-anchor="middle" font-size="15" font-weight="700" fill="${text}" font-family="ui-monospace,monospace">${unseen ? '?' : code}</text></svg>`;
  return el;
}

/** One pip per plane, coloured by class, with the fleet in words as its tip. */
export function fleetPips(fleet: string[], unseen = false): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rival-pips';
  const counts = new Map<string, number>();
  for (const typeCode of fleet) counts.set(typeCode, (counts.get(typeCode) ?? 0) + 1);
  el.dataset.tip = unseen ? 'Fleet' : [...counts].map(([typeCode, count]) => `${classByCode(typeCode)?.name ?? typeCode} ×${count}`).join(' · ') || 'No fleet';
  el.setAttribute('aria-label', el.dataset.tip);
  for (const typeCode of [...fleet].sort()) {
    const pip = document.createElement('i');
    const name = classByCode(typeCode)?.name ?? typeCode;
    pip.style.background = unseen ? '#2c3342' : CLASS_COLOURS[name] ?? '#888';
    el.append(pip);
  }
  return el;
}

/** The airline's flag as a small element whose tip is its country. */
export function flagBadge(state: SimState, code: string, unseen = false): HTMLElement {
  const country = rivalHomeCountry(state.competitorRoutes, code);
  const el = document.createElement('span');
  el.className = 'rival-flag' + (unseen ? ' is-unseen' : '');
  el.textContent = flagOf(country);
  el.dataset.tip = country ? `Home country ${country}` : 'Home country unknown';
  return el;
}
