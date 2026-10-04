import { airports, isAirportKnown } from './airports';
import { isOpsView } from './opsView';
import { projection } from './projection';
import { crewPlan } from '../sim/crewPlan';
import { dailyDeparturesAt } from '../sim/airports';
import { nextSlotFees } from '../sim/slots';
import type { SimState } from '../sim/state';

/**
 * Ops view's small chips under an airport you serve, only where something is
 * wrong: "crews −2" when the crew base there is short of the legal minimum
 * for the planes flying today (or of a plane about to arrive), "slots full"
 * when the airport has no room for another daily pair (the inspector's
 * "next pair: full"). A healthy map draws none.
 */

const CHIP_FONT = '10px ui-monospace, Consolas, monospace';
const CHIP_HEIGHT = 13;
const CHIP_OFFSET_Y = 30; // below the "on its way" badges
const CREWS_COLOUR = '#ffb347';
const SLOTS_COLOUR = '#ff8080';

/** Crews missing at each base today, else for the next plane arriving short. */
function crewShortages(state: SimState): Map<string, number> {
  const shortages = new Map<string, number>();
  for (const base of crewPlan(state)) {
    const today = base.classes.reduce((sum, c) => sum + Math.max(0, c.minimum - c.crews), 0);
    const arriving = base.classes.reduce((sum, c) => sum + Math.max(0, ...c.entries.map((e) => e.short)), 0);
    const missing = today > 0 ? today : arriving;
    if (missing > 0) shortages.set(base.iata, missing);
  }
  return shortages;
}

export function drawAirportChips(ctx: CanvasRenderingContext2D, state: SimState): void {
  if (!isOpsView()) return;
  const shortages = crewShortages(state);
  ctx.save();
  ctx.font = CHIP_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const airport of airports) {
    if (!isAirportKnown(airport.iata) || dailyDeparturesAt(state, airport.iata) === 0) continue;
    const chips: { text: string; colour: string }[] = [];
    const missing = shortages.get(airport.iata);
    if (missing) chips.push({ text: `crews −${missing}`, colour: CREWS_COLOUR });
    if (nextSlotFees(state, airport.iata, 1)[0] === null) chips.push({ text: 'slots full', colour: SLOTS_COLOUR });
    if (chips.length === 0) continue;
    const point = projection([airport.lon, airport.lat]);
    if (!point) continue;
    chips.forEach((chip, i) => {
      const y = point[1] + CHIP_OFFSET_Y + i * (CHIP_HEIGHT + 2);
      const width = ctx.measureText(chip.text).width + 8;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.88)';
      ctx.fillRect(point[0] - width / 2, y - CHIP_HEIGHT / 2, width, CHIP_HEIGHT);
      ctx.strokeStyle = chip.colour;
      ctx.lineWidth = 1;
      ctx.strokeRect(point[0] - width / 2 + 0.5, y - CHIP_HEIGHT / 2 + 0.5, width - 1, CHIP_HEIGHT - 1);
      ctx.fillStyle = chip.colour;
      ctx.fillText(chip.text, point[0], y);
    });
  }
  ctx.restore();
}
