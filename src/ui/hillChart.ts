/**
 * The revenue hill as an SVG (sim/revenueHill.ts), for a route's fare
 * (ui/inspector/route.ts) and the network's fare level (ui/farePolicy.ts):
 * the airline's estimate of the day's margin across the range as a dashed
 * line in a band of how unsure it is, the days actually flown as dots,
 * the zero line, the stretch where rivals answer shaded amber, rivals'
 * fares as flags, the likely top as a gold bar with its best guess, and
 * the value as a ball on the line. Drag the ball (or the arrow keys) to
 * set it; letting go calls `done`.
 */

export type ChartPoint = { x: number; margin: number; uncertainty: number; invites: boolean };

export type HillChartOptions = {
  points: ChartPoint[];
  low: number;
  high: number;
  observations: { x: number; margin: number }[];
  flags: { x: number; label: string }[];
  peak: { x: number; margin: number };
  peakRange: { low: number; high: number };
  /** Axis labels besides the range's ends, which `format` labels. */
  ticks: { x: number; label: string }[];
  format: (x: number) => string;
  value: () => number;
  setValue: (x: number) => void;
  done: () => void;
  step: number;
  ariaLabel: string;
};

const WIDTH = 340;
const HEIGHT = 92;
const PAD_TOP = 16;
const PAD_BOTTOM = 14;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** The estimate at `x`, read off between the sampled points. */
export function estimateAt(points: ChartPoint[], x: number): number {
  if (x <= points[0].x) return points[0].margin;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const t = (x - points[i - 1].x) / Math.max(1e-9, points[i].x - points[i - 1].x);
      return points[i - 1].margin + t * (points[i].margin - points[i - 1].margin);
    }
  }
  return points[points.length - 1].margin;
}

export function drawHillChart(o: HillChartOptions): { element: HTMLElement; moveBall: () => void } {
  // Scaled to the hill's own range (band and days flown included), so its
  // shape shows even when it loses money everywhere; the zero line is
  // drawn when it's inside.
  const margins = [
    ...o.points.flatMap((p) => [p.margin + p.uncertainty, p.margin - p.uncertainty]),
    ...o.observations.filter((d) => d.x >= o.low && d.x <= o.high).map((d) => d.margin),
  ];
  const highest = Math.max(...margins);
  const lowest = Math.min(...margins);
  const pad = Math.max(1, (highest - lowest) * 0.08);
  const top = highest + pad;
  const bottom = lowest - pad;
  const span = Math.max(1, top - bottom);
  const x = (value: number) => ((value - o.low) / Math.max(1e-9, o.high - o.low)) * WIDTH;
  const y = (margin: number) => PAD_TOP + ((top - margin) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const root = svg('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'revenue-hill', role: 'slider', tabindex: 0 });
  root.setAttribute('aria-label', o.ariaLabel);

  // Where rivals would answer with flights.
  let zoneStart: number | null = null;
  o.points.forEach((point, i) => {
    const last = i === o.points.length - 1;
    if (point.invites && zoneStart === null) zoneStart = point.x;
    if ((!point.invites || last) && zoneStart !== null) {
      const end = point.invites ? point.x : o.points[i - 1].x;
      root.append(svg('rect', { x: x(zoneStart), y: 0, width: Math.max(2, x(end) - x(zoneStart)), height: HEIGHT - PAD_BOTTOM, class: 'hill-rival-zone' }));
      const label = svg('text', { x: x(zoneStart) + 3, y: HEIGHT - PAD_BOTTOM - 3, class: 'hill-zone-label' });
      label.textContent = 'rivals answer';
      root.append(label);
      zoneStart = null;
    }
  });

  if (bottom < 0 && top > 0) root.append(svg('line', { x1: 0, x2: WIDTH, y1: y(0), y2: y(0), class: 'hill-zero' }));

  // The band: how unsure the airline is at each point.
  const upper = o.points.map((p) => `${x(p.x).toFixed(1)},${y(p.margin + p.uncertainty).toFixed(1)}`);
  const lower = [...o.points].reverse().map((p) => `${x(p.x).toFixed(1)},${y(p.margin - p.uncertainty).toFixed(1)}`);
  root.append(svg('path', { d: `M${upper.join(' L')} L${lower.join(' L')} Z`, class: 'hill-band' }));
  root.append(svg('polyline', { points: o.points.map((p) => `${x(p.x).toFixed(1)},${y(p.margin).toFixed(1)}`).join(' '), class: 'hill-line' }));

  // The days actually flown: what they really made.
  for (const day of o.observations) {
    if (day.x < o.low || day.x > o.high) continue;
    root.append(svg('circle', { cx: x(day.x), cy: y(day.margin), r: 1.8, class: 'hill-day' }));
  }

  // The top: a best guess, with where it likely is.
  if (o.peakRange.high > o.peakRange.low) {
    root.append(svg('rect', { x: x(o.peakRange.low), y: 1, width: Math.max(2, x(o.peakRange.high) - x(o.peakRange.low)), height: 3, rx: 1.5, class: 'hill-peak-range' }));
  }
  root.append(svg('circle', { cx: x(o.peak.x), cy: y(o.peak.margin), r: 3, class: 'hill-peak' }));
  // Anchored on the side with room, so it never runs off the edge.
  const peakX = x(o.peak.x);
  const peakLabel = svg('text', { x: peakX > WIDTH / 2 ? Math.min(WIDTH - 2, peakX + 18) : Math.max(2, peakX - 18), y: Math.max(12, y(o.peak.margin) - 6), class: 'hill-peak-label' });
  peakLabel.setAttribute('text-anchor', peakX > WIDTH / 2 ? 'end' : 'start');
  peakLabel.textContent =
    o.peakRange.high > o.peakRange.low ? `top ${o.format(o.peakRange.low)}–${o.format(o.peakRange.high)}?` : `top ${o.format(o.peak.x)}`;
  root.append(peakLabel);

  for (const flag of o.flags) {
    if (flag.x < o.low || flag.x > o.high) continue;
    root.append(svg('line', { x1: x(flag.x), x2: x(flag.x), y1: 2, y2: HEIGHT - PAD_BOTTOM, class: 'hill-rival' }));
    const text = svg('text', { x: x(flag.x) + 2, y: 9, class: 'hill-rival-label' });
    text.textContent = flag.label;
    root.append(text);
  }

  for (const tick of [{ x: o.low, label: o.format(o.low) }, ...o.ticks, { x: o.high, label: o.format(o.high) }]) {
    if (tick.x < o.low || tick.x > o.high) continue;
    const text = svg('text', { x: x(tick.x), y: HEIGHT - 2, class: 'hill-axis' });
    text.setAttribute('text-anchor', tick.x === o.low ? 'start' : tick.x === o.high ? 'end' : 'middle');
    text.textContent = tick.label;
    root.append(text);
  }

  const ball = svg('circle', { r: 6, class: 'hill-ball' });
  root.append(ball);
  const moveBall = () => {
    const value = o.value();
    ball.setAttribute('cx', String(x(value)));
    ball.setAttribute('cy', String(y(estimateAt(o.points, value))));
    ball.classList.toggle('is-risky', o.points.some((p) => p.invites && Math.abs(p.x - value) <= (o.high - o.low) / 48));
    root.setAttribute('aria-valuenow', String(value));
  };
  moveBall();

  const fromPointer = (event: PointerEvent) => {
    const rect = root.getBoundingClientRect();
    return o.low + ((event.clientX - rect.left) / Math.max(1, rect.width)) * (o.high - o.low);
  };
  let dragging = false;
  root.addEventListener('pointerdown', (event) => {
    dragging = true;
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Moves still arrive while the pointer stays over the hill.
    }
    o.setValue(fromPointer(event));
  });
  root.addEventListener('pointermove', (event) => {
    if (dragging) o.setValue(fromPointer(event));
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    o.done();
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    o.setValue(o.value() + (event.key === 'ArrowRight' ? o.step : -o.step));
  });
  root.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') o.done();
  });

  const wrap = document.createElement('div');
  wrap.className = 'hill-wrap';
  wrap.append(root);
  return { element: wrap, moveBall };
}
