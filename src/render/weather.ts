import { projection } from './projection';
import { airports, isAirportKnown } from './airports';
import type { SimState } from '../sim/state';

// Purely decorative — CLAUDE.md's determinism rule is about step() (the
// simulation), not rendering, so there's no reason a lightning flash or a
// snow particle needs to look identical on every replay of the same
// state. `Math.random()` here is fine in a way it would never be under
// sim/.
const FLASH_PROBABILITY_PER_FRAME = 0.05;
const FLASH_RADIUS_PX = 16;
const SNOW_PARTICLE_COUNT = 5;
const SNOW_RADIUS_PX = 10;

// Advances every frame regardless of sim speed or pause state — it's an
// animation clock for the snow particles' drift, not simulated time, so
// it doesn't need to (and shouldn't) come from state.simMinute.
let animationFrame = 0;

/**
 * A subtle flash/drift at any airport currently under active weather
 * (sim/weather.ts) — thunderstorm airports flicker with an occasional
 * bright flash, snowstorm airports get a handful of small particles
 * drifting past. Ops mode only; called from main.ts's render() after
 * drawAirports() so the effect sits on top of the airport dot.
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
      if (Math.random() < FLASH_PROBABILITY_PER_FRAME) {
        ctx.beginPath();
        ctx.arc(x, y, FLASH_RADIUS_PX, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fill();
      }
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
