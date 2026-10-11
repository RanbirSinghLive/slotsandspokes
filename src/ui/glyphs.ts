/**
 * Small department glyphs for the inspector's plainer sections: the
 * ops board, the airport list, the crew room, the hangar and the fee desk
 * each get their own look. Same 24 by 24 stroke style as the rest of the
 * icon set; the words ride in `data-tip` (ui/mapTools.ts shows them on
 * hover, or for a moment after a tap).
 */

const PATHS = {
  people: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  hangar: '<path d="M2 21V10l10-6 10 6v11"/><path d="M7 21v-7h10v7"/><path d="M7 17h10"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  engine: '<rect x="3" y="8" width="14" height="8" rx="3"/><path d="M17 10l4-2v8l-4-2M7 8V5M12 8V5M7 16v3M12 16v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  mapPin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  alert: '<path d="M12 3L2 20h20z"/><path d="M12 10v5M12 17.5v.5"/>',
  bag: '<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 7V4h6v3M9 11v6M15 11v6"/>',
  bagOff: '<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 7V4h6v3"/>',
  bags: '<rect x="3" y="8" width="11" height="13" rx="2"/><path d="M6 8V5h5v3"/><rect x="15" y="12" width="6" height="9" rx="1.5"/>',
  seat: '<path d="M6 3v9a2 2 0 0 0 2 2h8"/><path d="M16 14v7M8 21h10M6 3h3"/>',
  boarding: '<path d="M4 12h12M11 6l6 6-6 6"/><path d="M20 4v16"/>',
} as const;

export type GlyphName = keyof typeof PATHS;

/** The glyph's SVG markup, for innerHTML. */
export function glyphSvg(name: GlyphName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** A glyph as an inline element; `tip` is what hover or tap says about it. */
export function glyph(name: GlyphName, tip?: string, className = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `glyph glyph-${name}${className ? ` ${className}` : ''}`;
  el.innerHTML = glyphSvg(name);
  if (tip) {
    el.dataset.tip = tip;
    el.setAttribute('aria-label', tip);
  }
  return el;
}

/**
 * A row of pips: `filled` of `total`, the way a hangar shows its bays.
 * `tone` colours the filled ones.
 */
export function pips(filled: number, total: number, tip: string, tone = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `pips${tone ? ` pips-${tone}` : ''}`;
  el.dataset.tip = tip;
  el.setAttribute('aria-label', tip);
  const shown = Math.min(total, 12);
  for (let i = 0; i < shown; i++) {
    const pip = document.createElement('i');
    if (i < filled) pip.className = 'is-on';
    el.append(pip);
  }
  return el;
}
