import { FUEL_PRICE_BASELINE } from '../sim/fuel';
import type { SimState } from '../sim/state';

/**
 * Week six's fuel price mechanic, the Executive panel's third section
 * (after Loans and the cash Financial runway) — same "one file per
 * concern sharing one screen" shape ui/executive.ts and ui/loans.ts
 * already use. Deliberately shows history only, no projection: the fuel
 * index is a mean-reverting random walk (sim/fuel.ts), not a trend a
 * straight-line forecast could honestly extrapolate, and the whole point
 * (per the brainstormed request this answers) is to hand the player the
 * real, noisy signal and let *them* do the guessing.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#fuel-price-chart')!;
const ctx = canvas.getContext('2d')!;
const summaryEl = document.querySelector<HTMLDivElement>('#fuel-price-summary')!;
const deltaEl = document.querySelector<HTMLDivElement>('#fuel-price-delta')!;

// Same fixed-2x-sharpening reasoning as executive.ts's own chart constants
// — this canvas never resizes, so a plain fixed buffer is simplest.
const CHART_WIDTH = canvas.width;
const CHART_HEIGHT = canvas.height;
const CHART_PADDING = 24;

function formatIndexAsPercent(index: number): string {
  return `${Math.round(index * 100)}%`;
}

/** Nothing to build once at startup — same shape ui/executive.ts's setupExecutivePanel() already uses. */
export function setupFuelPricePanel(): void {}

function drawChart(history: number[], currentIndex: number): void {
  ctx.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

  // History sits at negative x (days ago), "today" is x=0 — same layout
  // convention as executive.ts's cash chart, minus the projection half.
  const xs = history.map((_, i) => i - (history.length - 1));
  const allXs = [...xs, 0];
  const allYs = [...history, currentIndex, FUEL_PRICE_BASELINE]; // baseline included so the reference line is always in frame

  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const toPx = (x: number) => CHART_PADDING + ((x - minX) / spanX) * (CHART_WIDTH - CHART_PADDING * 2);
  const toPy = (y: number) => CHART_HEIGHT - CHART_PADDING - ((y - minY) / spanY) * (CHART_HEIGHT - CHART_PADDING * 2);

  // Baseline reference line — same dashed-line treatment as the cash
  // chart's zero-cash line, just neutral-colored: sitting above or below
  // it isn't itself good or bad news the way $0 cash is.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(toPx(minX), toPy(FUEL_PRICE_BASELINE));
  ctx.lineTo(toPx(maxX), toPy(FUEL_PRICE_BASELINE));
  ctx.stroke();
  ctx.setLineDash([]);

  // Recent history, ending at today's live index.
  ctx.strokeStyle = '#cdd3e0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((index, i) => {
    const x = toPx(xs[i]);
    const y = toPy(index);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(toPx(0), toPy(currentIndex));
  ctx.stroke();

  // "Today" marker.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(toPx(0), toPy(currentIndex), 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderSummary(history: number[], currentIndex: number): void {
  const pctVsBaseline = Math.round((currentIndex / FUEL_PRICE_BASELINE - 1) * 100);
  if (pctVsBaseline === 0) {
    summaryEl.textContent = `Fuel is right at baseline (${formatIndexAsPercent(currentIndex)}).`;
  } else {
    const direction = pctVsBaseline > 0 ? 'above' : 'below';
    summaryEl.textContent = `Fuel is ${Math.abs(pctVsBaseline)}% ${direction} baseline (${formatIndexAsPercent(currentIndex)}).`;
  }

  if (history.length < 2) {
    deltaEl.textContent = 'Not enough history yet — check back after a few simulated days.';
    return;
  }

  const windowDays = history.length;
  const dailyDelta = (currentIndex - history[0]) / windowDays;
  const direction = dailyDelta >= 0 ? 'up' : 'down';
  const perDayPct = Math.abs(dailyDelta / FUEL_PRICE_BASELINE) * 100;
  deltaEl.textContent = `Trending ${direction} an average of ${perDayPct.toFixed(2)}%/day over the last ${windowDays} day${windowDays === 1 ? '' : 's'}.`;
}

/**
 * Rebuild the chart and summary from `state` — called whenever the
 * Executive panel becomes visible, same "refresh on select, not every
 * tick" pattern the rest of that panel already uses.
 */
export function updateFuelPricePanel(state: SimState): void {
  drawChart(state.fuelPriceHistory, state.fuelPriceIndex);
  renderSummary(state.fuelPriceHistory, state.fuelPriceIndex);
}
