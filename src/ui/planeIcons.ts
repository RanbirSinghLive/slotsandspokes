/**
 * One icon per aircraft class, drawn top-down with the nose up, in the same
 * 24 by 24 stroke style as every other icon here. They differ where the
 * real aircraft do, so the four are told apart at a glance in the lease
 * fan and the lists instead of being one plane at four sizes:
 *
 * - **Propeller:** straight wings, a propeller across the nose.
 * - **Regional:** modestly swept wings, two engines at the rear, a T-tail.
 * - **Narrowbody:** long swept wings, one engine under each.
 * - **Widebody:** a wider fuselage, the longest wings, two engines under each.
 *
 * Each string is the inner markup of an `<svg viewBox="0 0 24 24">` (what
 * ui/radial.ts wants), drawn at a thinner stroke than the rest of the icon
 * set so the detail survives at 16 to 22 pixels.
 */

const NARROW_FUSELAGE = 'M12 3 C13.2 5 13.2 8.5 13.2 11.5 V19 L12 21.5 L10.8 19 V11.5 C10.8 8.5 10.8 5 12 3Z';
const WIDE_FUSELAGE = 'M12 3 C14 5 14 8.5 14 11.5 V19 L12 22 L10 19 V11.5 C10 8.5 10 5 12 3Z';

const wrap = (body: string): string => `<g stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${body}</g>`;

export const PLANE_ICONS: Record<string, string> = {
  PROP: wrap(
    `<path d="${NARROW_FUSELAGE}"/>` +
      '<path d="M10.8 10.5 H2.5 V13.5 H10.8"/><path d="M13.2 10.5 H21.5 V13.5 H13.2"/>' +
      '<path d="M10.8 18.5 H8 V20.5 H10.8"/><path d="M13.2 18.5 H16 V20.5 H13.2"/>' +
      '<path d="M8.6 2 H15.4"/>',
  ),
  REGIONAL: wrap(
    `<path d="${NARROW_FUSELAGE}"/>` +
      '<path d="M10.8 9.5 L3.5 14.2 V16.2 L10.8 14"/><path d="M13.2 9.5 L20.5 14.2 V16.2 L13.2 14"/>' +
      '<path d="M9.3 15.5 V19.5"/><path d="M14.7 15.5 V19.5"/>' +
      '<path d="M8.5 21.3 H15.5"/>',
  ),
  NARROWBODY: wrap(
    `<path d="${NARROW_FUSELAGE}"/>` +
      '<path d="M10.8 9 L2 15.6 V17.8 L10.8 14.6"/><path d="M13.2 9 L22 15.6 V17.8 L13.2 14.6"/>' +
      '<circle cx="6.4" cy="13.4" r="1.2"/><circle cx="17.6" cy="13.4" r="1.2"/>' +
      '<path d="M10.8 19 L7.5 21.4 H10.8"/><path d="M13.2 19 L16.5 21.4 H13.2"/>',
  ),
  WIDEBODY: wrap(
    `<path d="${WIDE_FUSELAGE}"/>` +
      '<path d="M10 9 L1.5 16.2 V19 L10 15.4"/><path d="M14 9 L22.5 16.2 V19 L14 15.4"/>' +
      '<circle cx="4.6" cy="16.3" r="1.1"/><circle cx="7.6" cy="13.3" r="1.1"/>' +
      '<circle cx="19.4" cy="16.3" r="1.1"/><circle cx="16.4" cy="13.3" r="1.1"/>' +
      '<path d="M10 19.6 L6.6 22 H10"/><path d="M14 19.6 L17.4 22 H14"/>',
  ),
};

/** The generic paper-plane glyph, for anything that is not one of the four classes. */
const FALLBACK = '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>';

/** Inner markup for a class's icon, ready for ui/radial.ts. */
export function planeIconInner(typeCode: string): string {
  return PLANE_ICONS[typeCode] ?? FALLBACK;
}

/** A standalone inline icon for lists and cards. */
export function planeIconElement(typeCode: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('plane-icon');
  svg.innerHTML = planeIconInner(typeCode);
  return svg;
}

/**
 * One colour per aircraft type, for the Schedule timeline's rotation blocks
 * (ui/panels.ts), so a plane's type reads at a glance down the rows.
 */
export const TYPE_COLOURS: Record<string, string> = {
  PROP: '#5ed6c8',
  REGIONAL: '#f2a541',
  NARROWBODY: '#9d8cf0',
  WIDEBODY: '#ef7a95',
};
