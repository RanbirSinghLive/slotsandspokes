/**
 * Icons for the jump chips at the top of a long inspector view
 * (inspector.ts's addJumpChips): a section heading maps to a glyph by a
 * word in it. A heading nothing matches keeps a text chip, so a new
 * section never loses its chip. The heading's words become the chip's tip.
 */

const ICONS: { words: RegExp; svg: string }[] = [
  { words: /fare|price|cost|money|rasm|average|fuel|margin|cash/i, svg: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { words: /seat/i, svg: '<path d="M6 3v9a2 2 0 0 0 2 2h8"/><path d="M16 14v7M8 21h10M6 3h3"/>' },
  { words: /delay|next \d+ days|today|hours/i, svg: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>' },
  { words: /cancel|closed/i, svg: '<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>' },
  { words: /aog|heavy|check|mtc|maintenance/i, svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
  { words: /base/i, svg: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>' },
  { words: /roster|crew|executive/i, svg: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>' },
  { words: /schedule|rotation|last \d+ days|opened/i, svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  { words: /route|market/i, svg: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>' },
  { words: /lessor|plane|fleet/i, svg: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>' },
  { words: /innovation/i, svg: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>' },
  { words: /ladder|goal|milestone/i, svg: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/>' },
  { words: /to do/i, svg: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
];

/** The chip's SVG markup for a heading, or null to keep a text chip. */
export function chipIconFor(heading: string): string | null {
  const found = ICONS.find((icon) => icon.words.test(heading));
  return found ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${found.svg}</svg>` : null;
}
