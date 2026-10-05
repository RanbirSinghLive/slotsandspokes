/**
 * Portraits for the executives (data/executives.json): flat cartoon faces
 * in the game's palette, drawn as SVG so they stay sharp at any size and
 * need no image files. Each candidate is a set of traits (skin, hair,
 * glasses, beard); the jacket is their chair's colour, so a row of chairs
 * reads COO teal, CFO amber, CCO violet. An empty chair is a silhouette.
 */

type Hair = 'short' | 'side' | 'long' | 'bun' | 'curly' | 'bald';

type Traits = { skin: string; hair: Hair; hairColour: string; glasses?: boolean; beard?: boolean };

const SKIN = { fair: '#f3d2b6', light: '#e8b996', olive: '#c99a6b', brown: '#a86f47', deep: '#6e4429' };
const HAIR = { black: '#1d1a1f', brown: '#5a3a24', blond: '#d7b064', grey: '#b9bcc4', auburn: '#8a3f22' };

const TRAITS: Record<string, Traits> = {
  'coo-maintenance': { skin: SKIN.light, hair: 'short', hairColour: HAIR.grey, glasses: true, beard: true },
  'coo-fleet': { skin: SKIN.fair, hair: 'bun', hairColour: HAIR.blond },
  'coo-flightops': { skin: SKIN.deep, hair: 'short', hairColour: HAIR.black, beard: true },
  'coo-inflight': { skin: SKIN.brown, hair: 'long', hairColour: HAIR.black },
  'cfo-mercer': { skin: SKIN.light, hair: 'side', hairColour: HAIR.brown, glasses: true },
  'cfo-okafor': { skin: SKIN.deep, hair: 'curly', hairColour: HAIR.black },
  'cfo-adeyemi': { skin: SKIN.brown, hair: 'bun', hairColour: HAIR.black, glasses: true },
  'cco-lindqvist': { skin: SKIN.fair, hair: 'side', hairColour: HAIR.blond },
  'cco-carvalho': { skin: SKIN.olive, hair: 'long', hairColour: HAIR.auburn },
  'cco-sato': { skin: SKIN.light, hair: 'short', hairColour: HAIR.black, glasses: true },
  'cco-mensah': { skin: SKIN.deep, hair: 'bald', hairColour: HAIR.black, glasses: true },
};

/** Each chair's colour, the jacket in its portraits. */
export const ROLE_COLOURS: Record<string, string> = { coo: '#5ed6c8', cfo: '#f2a541', cco: '#9d8cf0' };

function hairShape(traits: Traits, behind: boolean): string {
  const c = traits.hairColour;
  switch (traits.hair) {
    case 'long':
      return behind ? `<path d="M18 30 C17 16 24 11 32 11 C40 11 47 16 46 30 L47 46 L17 46 Z" fill="${c}"/>` : `<path d="M20 26 C21 16 27 13 32 13 C38 13 44 17 44 26 C39 21 30 19 20 26 Z" fill="${c}"/>`;
    case 'bun':
      return behind ? `<circle cx="32" cy="10" r="6" fill="${c}"/>` : `<path d="M20 26 C20 16 26 12 32 12 C38 12 44 16 44 26 C40 20 33 18 20 26 Z" fill="${c}"/>`;
    case 'curly':
      return behind
        ? `<path d="M16 28 C12 16 22 7 32 8 C43 7 52 16 48 28 C49 33 46 35 44 34 L20 34 C18 35 15 33 16 28 Z" fill="${c}"/>`
        : `<path d="M20 24 C22 17 27 14 32 14 C37 14 42 17 44 24 C38 20 26 20 20 24 Z" fill="${c}"/>`;
    case 'side':
      return behind ? '' : `<path d="M20 25 C20 15 27 12 33 12 C40 12 45 16 44 25 C41 19 35 17 28 19 C25 20 22 22 20 25 Z" fill="${c}"/>`;
    case 'short':
      return behind ? '' : `<path d="M20 25 C20 16 26 12 32 12 C38 12 44 16 44 25 C42 20 37 18 32 18 C27 18 22 20 20 25 Z" fill="${c}"/>`;
    case 'bald':
      return behind ? '' : `<path d="M20 27 C19 22 20 20 21 19 L21 27 Z M43 19 C44 20 45 22 44 27 L43 27 Z" fill="${c}" opacity="0.6"/>`;
  }
}

/** The inner markup of a 64×64 portrait. */
function portraitMarkup(traits: Traits | null, role: string): string {
  const jacket = ROLE_COLOURS[role] ?? '#8a93a6';
  const back = '<rect width="64" height="64" rx="12" fill="#1a2030"/>';
  if (!traits) {
    // An empty chair: a silhouette in the chair's colour, faint.
    return `${back}<g fill="${jacket}" opacity="0.28"><circle cx="32" cy="27" r="11"/><path d="M11 64 C12 48 22 43 32 43 C42 43 52 48 53 64 Z"/></g>`;
  }
  const skin = traits.skin;
  const glasses = traits.glasses
    ? '<g fill="none" stroke="#10131b" stroke-width="1.3"><rect x="23" y="26" width="7" height="5" rx="2"/><rect x="34" y="26" width="7" height="5" rx="2"/><path d="M30 28.5 H34"/></g>'
    : '';
  const beard = traits.beard ? `<path d="M22 32 C23 42 28 45 32 45 C36 45 41 42 42 32 C39 37 35 38 32 38 C29 38 25 37 22 32 Z" fill="${traits.hairColour}"/>` : '';
  return (
    back +
    hairShape(traits, true) +
    // Jacket and shirt collar.
    `<path d="M9 64 C10 50 20 45 32 45 C44 45 54 50 55 64 Z" fill="${jacket}"/>` +
    `<path d="M26 45 L32 53 L38 45 Z" fill="#eef1f6"/>` +
    `<path d="M31 50 L33 50 L34 58 L32 60 L30 58 Z" fill="#10131b" opacity="0.55"/>` +
    // Neck and head.
    `<rect x="28" y="38" width="8" height="8" rx="3" fill="${skin}"/>` +
    `<ellipse cx="32" cy="28" rx="12" ry="14" fill="${skin}"/>` +
    `<ellipse cx="20" cy="29" rx="2" ry="3" fill="${skin}"/><ellipse cx="44" cy="29" rx="2" ry="3" fill="${skin}"/>` +
    beard +
    // Face.
    `<circle cx="26.5" cy="28.5" r="1.3" fill="#10131b"/><circle cx="37.5" cy="28.5" r="1.3" fill="#10131b"/>` +
    `<path d="M28 35 Q32 38 36 35" fill="none" stroke="#10131b" stroke-width="1.2" stroke-linecap="round" opacity="0.7"/>` +
    glasses +
    hairShape(traits, false)
  );
}

/** A portrait as SVG text, 64×64: a candidate by id, or an empty chair (null). */
export function portraitSvg(candidateId: string | null, role: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${portraitMarkup(candidateId ? (TRAITS[candidateId] ?? null) : null, role)}</svg>`;
}

/** A portrait as an <svg> element, `size` px square: a candidate by id, or an empty chair (null). */
export function portraitElement(candidateId: string | null, role: string, size = 48): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'portrait');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = portraitMarkup(candidateId ? (TRAITS[candidateId] ?? null) : null, role);
  return svg;
}
