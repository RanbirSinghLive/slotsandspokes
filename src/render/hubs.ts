import { geoPath } from 'd3-geo';
import type { LineString } from 'geojson';
import { projection } from './projection';
import { airports } from './airports';
import { connectingFlowsAt, suggestSpokes } from '../sim/hubs';
import { HUB_STYLES, hubStyleAt } from '../sim/hubStyle';
import type { SimState } from '../sim/state';

/**
 * What hovering one of your airports shows: the passengers connecting
 * through it, and where to fly next to connect more.
 *
 * - Each connecting flow is a curve from one spoke to the other, bent
 *   through the hub — the trip those passengers actually make — and
 *   thicker the more of them there are. The busiest few are labelled.
 * - The best new spokes (sim/hubs.ts's suggestSpokes()) are dashed lines
 *   out from the hub, labelled with what they'd earn a day once grown.
 * - The hub itself gets a line saying how many connect and how it's run.
 *
 * A pure read of state, like every renderer.
 */

const FLOW_STROKE = 'rgba(94, 214, 200, 0.75)';
const FLOW_LABEL = '#5ed6c8';
const SUGGESTION_STROKE = '#7ab8ff';
const LABEL_FONT = '11px ui-monospace, Consolas, monospace';
const LABELLED_FLOWS = 3;
const MAX_FLOW_WIDTH = 7;

const airportsByIata = new Map(airports.map((airport) => [airport.iata, airport]));

function screenPoint(iata: string): [number, number] | null {
  const airport = airportsByIata.get(iata);
  return airport ? projection([airport.lon, airport.lat]) : null;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(10, 12, 18, 0.85)';
  ctx.fillRect(x - width / 2 - 3, y - 8, width + 6, 16);
  ctx.fillStyle = colour;
  ctx.fillText(text, x - width / 2, y);
}

function money(amount: number): string {
  return amount >= 1000 ? `$${(amount / 1000).toFixed(1)}k` : `$${Math.round(amount)}`;
}

/** Whether hovering this airport has anything to show. */
export function hasHubView(state: SimState, iata: string): boolean {
  return state.schedule.some((leg) => leg.origin === iata || leg.dest === iata);
}

export function drawHubView(ctx: CanvasRenderingContext2D, state: SimState, hub: string): void {
  const hubPoint = screenPoint(hub);
  if (!hubPoint) return;

  const flows = connectingFlowsAt(state, hub);
  const busiest = flows[0]?.passengers ?? 0;
  ctx.save();
  ctx.lineCap = 'round';
  flows.forEach((flow, i) => {
    const a = screenPoint(flow.a);
    const b = screenPoint(flow.b);
    if (!a || !b) return;
    // A quadratic curve whose control point is placed so the curve passes
    // through the hub at its midpoint: for t = 0.5 a quadratic sits at
    // (a + 2c + b) / 4, so c = 2·hub − (a + b) / 2.
    const control: [number, number] = [2 * hubPoint[0] - (a[0] + b[0]) / 2, 2 * hubPoint[1] - (a[1] + b[1]) / 2];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(control[0], control[1], b[0], b[1]);
    ctx.strokeStyle = FLOW_STROKE;
    ctx.lineWidth = 1 + (MAX_FLOW_WIDTH - 1) * Math.sqrt(flow.passengers / busiest);
    ctx.stroke();

    if (i < LABELLED_FLOWS) {
      // Label a quarter of the way along, on the first spoke's side, so
      // labels for flows sharing a spoke don't stack on the hub.
      const t = 0.25;
      const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * control[0] + t * t * b[0];
      const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * control[1] + t * t * b[1];
      label(ctx, `${flow.a}–${flow.b} ${Math.round(flow.passengers)}/day`, x, y, FLOW_LABEL);
    }
  });
  ctx.restore();

  const path = geoPath(projection, ctx);
  const hubAirport = airportsByIata.get(hub)!;
  for (const suggestion of suggestSpokes(state, hub)) {
    const target = airportsByIata.get(suggestion.spoke);
    const targetPoint = screenPoint(suggestion.spoke);
    if (!target || !targetPoint) continue;
    const line: LineString = { type: 'LineString', coordinates: [[hubAirport.lon, hubAirport.lat], [target.lon, target.lat]] };
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = SUGGESTION_STROKE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    path(line);
    ctx.stroke();
    ctx.restore();
    label(
      ctx,
      `+${money(suggestion.revenuePerDay)}/day, ${Math.round(suggestion.passengers)} connecting once grown`,
      targetPoint[0],
      targetPoint[1] - 16,
      SUGGESTION_STROKE,
    );
  }

  const connecting = flows.reduce((total, flow) => total + flow.passengers, 0);
  label(
    ctx,
    `${Math.round(connecting)} connecting/day · ${HUB_STYLES[hubStyleAt(state, hub)].name}`,
    hubPoint[0],
    hubPoint[1] + 22,
    FLOW_LABEL,
  );
}
