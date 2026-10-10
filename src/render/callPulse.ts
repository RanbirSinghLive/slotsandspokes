import { airports } from './airports';
import { projection } from './projection';

/**
 * The airport where a plane that needs a call is waiting (ui/callPopup.ts):
 * a faint amber ring that breathes slowly, so the map shows which plane the
 * popup is about. Drawn only while the popup is open.
 */
let pulseAirport: string | null = null;

const PULSE_PERIOD_MS = 2800;
const PULSE_RGB = '255, 176, 64';

export function setCallPulse(iata: string | null): void {
  pulseAirport = iata;
}

/** True while the ring is on screen, so the paused map keeps redrawing often enough for a smooth breath. */
export function callPulseActive(): boolean {
  return pulseAirport !== null;
}

export function drawCallPulse(ctx: CanvasRenderingContext2D, nowMs: number): void {
  if (!pulseAirport) return;
  const airport = airports.find((a) => a.iata === pulseAirport);
  const point = airport ? projection([airport.lon, airport.lat]) : null;
  if (!point) return;
  // 0 → 1 → 0, smoothly, once per period.
  const breath = (1 - Math.cos((2 * Math.PI * nowMs) / PULSE_PERIOD_MS)) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(point[0], point[1], 15 + breath * 6, 0, 2 * Math.PI);
  ctx.strokeStyle = `rgba(${PULSE_RGB}, ${0.2 + breath * 0.4})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point[0], point[1], 7, 0, 2 * Math.PI);
  ctx.fillStyle = `rgba(${PULSE_RGB}, ${0.1 + breath * 0.25})`;
  ctx.fill();
  ctx.restore();
}
