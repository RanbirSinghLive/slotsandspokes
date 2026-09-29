import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import type { SimState } from '../sim/state';

// Purely decorative — CLAUDE.md's determinism rule is about step() (the
// simulation), not rendering, so an animation here can run on the page's
// own clock rather than on state.
const STORM_RADIUS_PX = 18;
/** A storm cell's glow breathes this slowly, so a whole front reads as weather, not a strobe. */
const STORM_PULSE_MS = 3200;
const SNOW_PARTICLE_COUNT = 5;
const SNOW_RADIUS_PX = 10;

// Advances every frame regardless of sim speed or pause state — it's an
// animation clock for the snow particles' drift, not simulated time, so
// it doesn't need to (and shouldn't) come from state.simMinute.
let animationFrame = 0;

/** A small lightning bolt, centred on (x, y). */
function drawBolt(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number): void {
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y - 6);
  ctx.lineTo(x - 3, y + 1);
  ctx.lineTo(x, y + 1);
  ctx.lineTo(x - 1.5, y + 6);
  ctx.lineTo(x + 3.5, y - 1.5);
  ctx.lineTo(x + 0.5, y - 1.5);
  ctx.closePath();
  ctx.fillStyle = `rgba(255, 214, 102, ${alpha})`;
  ctx.fill();
}

/**
 * The weather at every airport under it (sim/weather.ts): a thunderstorm
 * is a soft violet cell with a small bolt beside the dot, its glow rising
 * and falling slowly, each airport on its own beat so a front ripples
 * rather than flashing in step; a snowstorm is a handful of small
 * particles drifting past. Called from main.ts's render() after
 * drawAirports() so it sits on top of the airport dot.
 */
export function drawWeatherEffects(ctx: CanvasRenderingContext2D, state: SimState): void {
  animationFrame += 1;

  for (const airport of airports) {
    const event = state.weatherByAirport[airport.iata];
    if (!event || !isAirportKnown(airport.iata)) continue;

    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    const [x, y] = point;

    if (event.kind === 'thunderstorm') {
      // Each airport's own beat, from where it is, so neighbours in a front drift out of step.
      const beat = (performance.now() / STORM_PULSE_MS + (airport.lon + airport.lat) * 0.37) * 2 * Math.PI;
      const pulse = 0.5 + 0.5 * Math.sin(beat);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, STORM_RADIUS_PX);
      glow.addColorStop(0, `rgba(150, 130, 230, ${0.22 + 0.12 * pulse})`);
      glow.addColorStop(1, 'rgba(150, 130, 230, 0)');
      ctx.beginPath();
      ctx.arc(x, y, STORM_RADIUS_PX, 0, 2 * Math.PI);
      ctx.fillStyle = glow;
      ctx.fill();
      drawBolt(ctx, x + 9, y - 8, 0.6 + 0.35 * pulse);
    } else {
      ctx.fillStyle = 'rgba(230, 240, 255, 0.75)';
      for (let i = 0; i < SNOW_PARTICLE_COUNT; i++) {
        // Each particle drifts on its own phase offset so they don't all
        // move in lockstep — still fully deterministic-*looking* enough
        // to read as gentle snow, just not tied to any state that needs
        // to be saved or replayed.
        const phase = animationFrame * 0.4 + i * 17;
        const px = x + Math.sin(phase * 0.05) * SNOW_RADIUS_PX;
        const py = y + (phase % (SNOW_RADIUS_PX * 2)) - SNOW_RADIUS_PX;
        ctx.beginPath();
        ctx.arc(px, py, 1.3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
}
