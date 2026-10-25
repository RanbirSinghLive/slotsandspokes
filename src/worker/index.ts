import { handleEvent, type EventWriter } from './eventRoutes';
import { handleApi, type KeyValueStore } from './saveRoutes';

/**
 * The Worker in front of the static game: it answers /api/* (cloud saves,
 * and /api/event for anonymous play stats) and nothing else (wrangler.jsonc's run_worker_first sends only /api/* here;
 * the game itself is served straight from the assets).
 *
 * `SAVES` is the Workers KV binding; until it is set up (see the Cloud
 * saves section of HOW-IT-WORKS.md) the API says it isn't configured and the
 * game hides cloud saves. `EVENTS` is the Analytics Engine dataset the
 * play stats go to; without it /api/event accepts and drops them.
 */
type Env = {
  SAVES?: KeyValueStore;
  EVENTS?: EventWriter;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/event') {
      const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? '';
      return handleEvent(request, env.EVENTS, country);
    }
    if (pathname.startsWith('/api/')) return handleApi(request, env.SAVES);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
