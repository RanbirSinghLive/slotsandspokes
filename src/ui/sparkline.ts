const SVG = 'http://www.w3.org/2000/svg';

/**
 * A route's last days of margin as a thin line around a zero line, in the
 * colour of the week's result. Drawn without axes or words: its shape says
 * whether the week was steady or lurching, and the tooltip carries the
 * numbers.
 */
export function sparkline(values: number[], tip: string, width = 34, height = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', tip);
  svg.dataset.tip = tip;
  if (values.length < 2) return svg;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const y = (value: number) => 1 + (height - 2) * (1 - (value - low) / span);
  const zero = document.createElementNS(SVG, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(width));
  zero.setAttribute('y1', y(0).toFixed(1));
  zero.setAttribute('y2', y(0).toFixed(1));
  zero.setAttribute('class', 'sparkline-zero');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', values.map((value, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${y(value).toFixed(1)}`).join(' '));
  const lastWeek = values.slice(-7).reduce((total, n) => total + n, 0);
  line.setAttribute('class', lastWeek >= 0 ? 'sparkline-line is-up' : 'sparkline-line is-down');
  svg.append(zero, line);
  return svg;
}
