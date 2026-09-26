import { computeCashForecast, FORECAST_DAYS_AHEAD, type CashForecast } from '../sim/forecast';
import type { SimState } from '../sim/state';

/**
 * The Executive panel's financial-runway half — the other half (Loans:
 * outstanding balances, repayment) is ui/loans.ts's own concern, rendered
 * into the same `#executive-panel` markup but kept as separate modules,
 * same "one file per concern" shape every other panel in this codebase
 * already follows even when two features share one screen.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#executive-chart')!;
const ctx = canvas.getContext('2d')!;
const summaryEl = document.querySelector<HTMLDivElement>('#executive-summary')!;
const deltaEl = document.querySelector<HTMLDivElement>('#executive-delta')!;

// The canvas element's own width/height attributes (set in index.html,
// 1040x400) are its real pixel buffer — twice the CSS display size
// (style.css sizes it at 520x200), a plain fixed 2x sharpening baked in
// directly rather than reading devicePixelRatio the way the main map
// canvas does (render/projection.ts). That dynamic approach earns its
// complexity for a canvas that resizes with the browser window; this one
// never resizes, so a fixed 2x is simpler and just as sharp on an
// ordinary HiDPI screen.
const CHART_WIDTH = canvas.width;
const CHART_HEIGHT = canvas.height;
const CHART_PADDING = 24;

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString()}`;
}

/**
 * Nothing to build once at startup — same "fully rebuilt whenever the
 * panel opens" shape ui/onTime.ts's setupOnTimePanel() already uses.
 * Exported for symmetry with every other panel's setup function.
 */
export function setupExecutivePanel(): void {}

function drawChart(forecast: CashForecast, currentCash: number): void {
  ctx.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

  // History sits at negative x (days ago), "today" is x=0, the projection
  // runs from x=1 through FORECAST_DAYS_AHEAD.
  const historyXs = forecast.history.map((_, i) => i - (forecast.history.length - 1));
  const projectedXs = forecast.projected.map((_, i) => i + 1);

  const allXs = [...historyXs, 0, ...projectedXs];
  const allYs = [...forecast.history, currentCash, ...forecast.projected, 0]; // 0 included so the zero-cash reference line is always in frame

  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const toPx = (x: number) => CHART_PADDING + ((x - minX) / spanX) * (CHART_WIDTH - CHART_PADDING * 2);
  const toPy = (y: number) => CHART_HEIGHT - CHART_PADDING - ((y - minY) / spanY) * (CHART_HEIGHT - CHART_PADDING * 2);

  // Zero-cash reference line — the same red the rest of the app already
  // uses for "actually broken" (schedule warnings, out-of-range routes).
  ctx.strokeStyle = 'rgba(255, 128, 128, 0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(toPx(minX), toPy(0));
  ctx.lineTo(toPx(maxX), toPy(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Recent history — solid.
  ctx.strokeStyle = '#cdd3e0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  forecast.history.forEach((cash, i) => {
    const x = toPx(historyXs[i]);
    const y = toPy(cash);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(toPx(0), toPy(currentCash)); // connect straight through to today's live cash
  ctx.stroke();

  // Projected trend — dashed, so it reads as "if nothing changes" rather
  // than as real recorded history.
  ctx.strokeStyle = '#8f9bb3';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(toPx(0), toPy(currentCash));
  forecast.projected.forEach((cash, i) => ctx.lineTo(toPx(projectedXs[i]), toPy(cash)));
  ctx.stroke();
  ctx.setLineDash([]);

  // "Today" marker.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(toPx(0), toPy(currentCash), 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderSummary(forecast: CashForecast): void {
  summaryEl.classList.remove('executive-summary--warning');

  if (forecast.history.length < 2) {
    summaryEl.textContent = 'Not enough history yet — check back after a few simulated days.';
    deltaEl.textContent = '';
    return;
  }

  if (forecast.daysUntilZero !== null) {
    const days = forecast.daysUntilZero;
    summaryEl.textContent = `At the current trend, Cash reaches $0 in about ${days} day${days === 1 ? '' : 's'}.`;
    summaryEl.classList.add('executive-summary--warning');
  } else {
    summaryEl.textContent = 'Cash is flat or trending upward — no zero-cash date in sight at the current trend.';
  }

  const perDay = formatMoney(Math.abs(forecast.dailyDelta));
  const direction = forecast.dailyDelta >= 0 ? '+' : '-';
  const windowDays = forecast.history.length;
  deltaEl.textContent = `Averaging ${direction}${perDay}/day over the last ${windowDays} day${windowDays === 1 ? '' : 's'} — projected ${FORECAST_DAYS_AHEAD} days ahead.`;
}

/**
 * Rebuild the chart and summary from `state` — called whenever the
 * Executive panel becomes visible, same "refresh on select, not every
 * tick" pattern ui/onTime.ts already uses, since
 * nothing here needs to react faster than a panel switch. The Loans
 * half of this same panel (ui/loans.ts) refreshes on its own, every
 * frame regardless of which panel is showing — it already has to, since
 * the loan-offer/game-over pop-ups are global overlays, not gated to
 * this panel being open.
 */
export function updateExecutivePanel(state: SimState): void {
  const forecast = computeCashForecast(state);
  drawChart(forecast, state.cash);
  renderSummary(forecast);
}
