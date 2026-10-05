/**
 * One icon per innovation (sim/innovations.ts), for the tech tree in Head
 * office: 24×24 line drawings in the same stroke style as the rail's and
 * the map ring's icons, coloured by the node they sit in.
 */
const ICONS: Record<string, string> = {
  // A graduation cap: training your own crews.
  'crew-academy': '<path d="M2 9 12 4l10 5-10 5Z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/>',
  // A browser window with a ticket: selling direct.
  'online-booking': '<rect x="2.5" y="4" width="19" height="15" rx="2"/><path d="M2.5 8h19"/><path d="M8 12h8l-1 1.5 1 1.5H8l1-1.5Z"/>',
  // A wrench with a spark: airframes refurbished younger.
  'younger-airframes': '<path d="M14.5 6.5a4 4 0 0 1-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 1 5.3-5.3l-2.4 2.4-2.4-.6-.6-2.4Z"/><path d="M19 2v3M17.5 3.5h3"/>',
  // A card with a star: members who come back.
  'loyalty-scheme': '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m12 8.5 1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4Z"/>',
  // A wing whose tip turns up: less fuel.
  winglets: '<path d="M3 16 16 11c2-.7 3-2 3.5-5l.5-2 1 1-.5 3c-.5 3-2 5-5 6L4 19Z"/><path d="M8 17.5 7 21"/>',
  // Two linked rings: a partner selling your connections.
  'codeshare-feed': '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/><path d="M12 8.2v7.6"/>',
  // A row of seats with one filled: selling the last seat.
  'spoilage': '<path d="M5 18v-6a3 3 0 0 1 3-3h1v9"/><path d="M15 18V9h1a3 3 0 0 1 3 3v6"/><path d="M9 18h6"/><path d="M12 3v4M10 5h4"/>',
};

export function innovationIconElement(id: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[id.startsWith('spoilage-') ? 'spoilage' : id] ?? '<circle cx="12" cy="12" r="8"/>';
  return svg;
}
