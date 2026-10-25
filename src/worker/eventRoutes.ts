/**
 * Anonymous play stats: POST /api/event writes one row to Cloudflare
 * Workers Analytics Engine (the `EVENTS` binding in wrangler.jsonc), so the
 * owner can see how many people start a game, how far they get and which
 * link brought them. The client is ui/playStats.ts; HOW-IT-WORKS.md
 * ("Play stats") lists every event and how to query them.
 *
 * Plain functions over a tiny writer type, so the test
 * (src/worker/eventRoutes.test.ts) runs in Node. Nothing personal is kept:
 * no IP address, no user agent string, only the country Cloudflare already
 * resolved and phone-or-desktop. The id is a random one made in the browser.
 *
 * Row layout (Analytics Engine has numbered columns, not names):
 *   index1   anonymous id
 *   blob1    event name        blob2  anonymous id    blob3  country
 *   blob4    device            blob5  source          blob6  medium
 *   blob7    campaign          blob8  referrer host   blob9  home IATA
 *   blob10   difficulty        blob11 detail (event-specific)
 *   double1  game day          double2 days since first visit
 *   double3  visit number
 */
export type EventWriter = {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
};

export const EVENT_NAMES = ['landed', 'game_started', 'day_reached', 'bust', 'cloud_on', 'stats_off'] as const;

const MAX_BODY_BYTES = 2_000;
const MAX_FIELD_CHARS = 64;

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_CHARS) : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export async function handleEvent(
  request: Request,
  writer: EventWriter | undefined,
  country: string,
): Promise<Response> {
  // 204 either way: a stats call never shows an error to the player, and a
  // deployment without the binding just doesn't count.
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const name = text(body.name);
  const id = text(body.id);
  if (!(EVENT_NAMES as readonly string[]).includes(name) || id === '') return new Response('Unknown event', { status: 400 });
  if (writer === undefined) return done;
  const userAgent = request.headers.get('user-agent') ?? '';
  writer.writeDataPoint({
    indexes: [id],
    blobs: [
      name,
      id,
      country.slice(0, 2),
      /Mobi|Android|iPhone|iPad/i.test(userAgent) ? 'phone' : 'desktop',
      text(body.source),
      text(body.medium),
      text(body.campaign),
      text(body.referrer),
      text(body.home),
      text(body.difficulty),
      text(body.detail),
    ],
    doubles: [count(body.day), count(body.daysSinceFirst), count(body.visit)],
  });
  return done;
}
