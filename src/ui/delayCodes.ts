import type { DelayBreakdown } from '../sim/delays';

/**
 * Delay causes as icons. Each cause has a glyph, an IATA-style two-digit
 * delay code and a plain meaning; the glyph shows, and the meaning and code
 * come as a tip on hover or tap (ui/mapTools.ts's data-tip wiring covers
 * the inspector and the flight card).
 */

export type DelayCause = keyof DelayBreakdown | 'rotation' | 'executive';

const CAUSES: Record<DelayCause, { svg: string; code: string; meaning: string }> = {
  rotation: { svg: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>', code: '93', meaning: 'Late inbound aircraft' },
  knockOn: { svg: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>', code: '93', meaning: 'Rushed turnaround' },
  age: { svg: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', code: '41', meaning: 'Aircraft defects, worse with age' },
  weather: { svg: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 5 15.5"/><polyline points="13 13 10 18 14 18 11 22"/>', code: '71', meaning: 'Weather at departure' },
  congestion: { svg: '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M16 15h2a4 4 0 0 1 4 4v2"/>', code: '83', meaning: 'Airport congestion' },
  executive: { svg: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', code: 'COO', meaning: 'Flight-ops executive clawed back time' },
};

export function delayCodeFor(cause: DelayCause): { code: string; meaning: string } {
  return CAUSES[cause];
}

/** The cause's glyph as a small element with its tip. `detail` extends the meaning ("Weather at YUL"). */
export function delayIcon(cause: DelayCause, detail?: string): HTMLElement {
  const { svg, code, meaning } = CAUSES[cause];
  const el = document.createElement('span');
  el.className = `delay-icon delay-icon-${cause}`;
  const text = `${detail ?? meaning} · delay code ${code}`;
  el.dataset.tip = text;
  el.setAttribute('aria-label', text);
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg>`;
  return el;
}

/** Icon and minutes for each active cause, biggest first. Empty when nothing delayed it. */
export function delayIconsFor(delay: DelayBreakdown): HTMLElement[] {
  const causes: (keyof DelayBreakdown)[] = ['knockOn', 'age', 'weather', 'congestion'];
  return causes
    .filter((cause) => delay[cause] > 0)
    .sort((a, b) => delay[b] - delay[a])
    .map((cause) => {
      const chip = document.createElement('span');
      chip.className = 'delay-chip';
      chip.append(delayIcon(cause), `${delay[cause]}`);
      return chip;
    });
}
