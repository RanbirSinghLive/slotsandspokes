/**
 * A chart's key, as a row of swatches under it: each mark the chart uses
 * and what it means, in the chart's own colours. Real DOM, so it wraps
 * on a narrow panel.
 */

export type LegendMark = 'line' | 'dash' | 'band' | 'dot' | 'ball' | 'block' | 'flag';

export type LegendItem = { mark: LegendMark; color: string; label: string };

export function chartLegend(items: LegendItem[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'chart-legend';
  for (const item of items) {
    const entry = document.createElement('span');
    entry.className = 'chart-legend-item';
    const swatch = document.createElement('span');
    swatch.className = `chart-legend-swatch is-${item.mark}`;
    swatch.style.setProperty('--swatch', item.color);
    entry.append(swatch, item.label);
    row.append(entry);
  }
  return row;
}
