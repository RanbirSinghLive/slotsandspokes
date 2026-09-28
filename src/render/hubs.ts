import { projection } from './projection';
import { airports } from './airports';
import { connectingFlowsAt, onwardFlowsFrom, type ConnectingFlow } from '../sim/hubs';
import { HUB_STYLES, hubStyleAt } from '../sim/hubStyle';
import type { SimState } from '../sim/state';

/**
 * What hovering one of your airports shows: the passengers connecting
 * through it. Where to fly to connect more is the player's call, read off
 * the Demand lens, not suggested here.
 *
 * - Each connecting flow is a curve from one spoke to the other, bent
 *   through the hub — the trip those passengers actually make — and
 *   thicker the more of them there are. The busiest few are labelled.
 * - Passengers from this airport who change planes somewhere else
 *   (Toronto–St. Louis via O'Hare, seen from Toronto) are fainter dashed
 *   curves from here, bent through the airport where they connect.
 * - The hub itself gets a line saying how many connect and how it's run.
 *
 * A pure read of state, like every renderer.
 */

const FLOW_STROKE = 'rgba(94, 214, 200, 0.75)';
const ONWARD_STROKE = 'rgba(94, 214, 200, 0.4)';
const ONWARD_LABEL = '#9fe3da';
const LABELLED_ONWARD_FLOWS = 2;
const FLOW_LABEL = '#5ed6c8';
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


/**
 * A curve from `a` to `b` that passes through `via` at its midpoint, the
 * trip connecting passengers make. Returns the point `t` of the way along
 * it, for placing a label.
 */
function strokeFlowCurve(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  via: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  // A quadratic curve whose control point is placed so the curve passes
  // through `via` at its midpoint: for t = 0.5 a quadratic sits at
  // (a + 2c + b) / 4, so c = 2·via − (a + b) / 2.
  const control: [number, number] = [2 * via[0] - (a[0] + b[0]) / 2, 2 * via[1] - (a[1] + b[1]) / 2];
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(control[0], control[1], b[0], b[1]);
  ctx.stroke();
  return [
    (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * control[0] + t * t * b[0],
    (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * control[1] + t * t * b[1],
  ];
}

/** Width for a flow, by its share of the busiest one drawn alongside it. */
function flowWidth(flow: ConnectingFlow, busiest: number): number {
  return 1 + (MAX_FLOW_WIDTH - 1) * Math.sqrt(flow.passengers / busiest);
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
  const onward = onwardFlowsFrom(state, hub);
  const busiestOnward = onward[0]?.passengers ?? 0;
  ctx.save();
  ctx.lineCap = 'round';

  // Onward flows first, so the ones connecting here draw on top.
  ctx.strokeStyle = ONWARD_STROKE;
  ctx.setLineDash([4, 5]);
  onward.forEach((flow, i) => {
    const other = flow.a === hub ? flow.b : flow.a;
    const via = screenPoint(flow.hub);
    const end = screenPoint(other);
    if (!via || !end) return;
    ctx.lineWidth = flowWidth(flow, busiestOnward);
    // Labelled near the far end, away from the labels crowding the hub.
    const [x, y] = strokeFlowCurve(ctx, hubPoint, via, end, 0.8);
    if (i < LABELLED_ONWARD_FLOWS) label(ctx, `${hub}–${other} via ${flow.hub} ${Math.round(flow.passengers)}/day`, x, y, ONWARD_LABEL);
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = FLOW_STROKE;
  flows.forEach((flow, i) => {
    const a = screenPoint(flow.a);
    const b = screenPoint(flow.b);
    if (!a || !b) return;
    ctx.lineWidth = flowWidth(flow, busiest);
    // Label a quarter of the way along, on the first spoke's side, so
    // labels for flows sharing a spoke don't stack on the hub.
    const [x, y] = strokeFlowCurve(ctx, a, hubPoint, b, 0.25);
    if (i < LABELLED_FLOWS) label(ctx, `${flow.a}–${flow.b} ${Math.round(flow.passengers)}/day`, x, y, FLOW_LABEL);
  });
  ctx.restore();

  const connecting = flows.reduce((total, flow) => total + flow.passengers, 0);
  label(
    ctx,
    `${Math.round(connecting)} connecting/day · ${HUB_STYLES[hubStyleAt(state, hub)].name}`,
    hubPoint[0],
    hubPoint[1] + 22,
    FLOW_LABEL,
  );
  const connectingOnward = onward.reduce((total, flow) => total + flow.passengers, 0);
  if (connectingOnward >= 0.5) {
    label(ctx, `${Math.round(connectingOnward)}/day connect onward elsewhere`, hubPoint[0], hubPoint[1] + 40, ONWARD_LABEL);
  }
}
