/**
 * Small department glyphs for the inspector's plainer sections: the
 * ops board, the airport list, the crew room, the hangar and the fee desk
 * each get their own look. Same 24 by 24 stroke style as the rest of the
 * icon set; the words ride in `data-tip` (ui/mapTools.ts shows them on
 * hover, or for a moment after a tap).
 */

const PATHS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
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
  sortFifo: '<path d="M4 6h16M4 12h11M4 18h6"/><path d="M19 14v6M16.5 17.5 19 20l2.5-2.5"/>',
  sortLifo: '<path d="M4 6h6M4 12h11M4 18h16"/><path d="M19 10V4M16.5 6.5 19 4l2.5 2.5"/>',
  sortBest: '<path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z"/><path d="M19 15v6M16 18h6"/>',
  contract: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  event: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6z"/><path d="M12 15c0-3 2-5 6-5 0 3-2 5-6 5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.5M4 12h.5M4 18h.5"/>',
  pie: '<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5a9 9 0 0 1 5.5 5.5H15z"/>',
  hub: '<circle cx="12" cy="12" r="3"/><path d="M12 9V3M12 15v6M9 12H3M15 12h6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.7 5 1.4 5 4.2 0 1.1-1.1 1.8-2.5 1.8-1.1 0-2-.5-2.6-1.3M12 6.5V8M12 16v1.5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  boarding: '<path d="M4 12h12M11 6l6 6-6 6"/><path d="M20 4v16"/>',
  gantt: '<path d="M3 4v16h18"/><path d="M7 8h6M10 12h8M7 16h5"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.4 9.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>',
  shelf: '<path d="M3 20h18M3 12h18M5 12V4h6v8M13 12V7h5v5M6 20v-5h5v5"/>',
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
