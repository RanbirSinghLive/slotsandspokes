# airgame — Week twenty-one (ops disruptions)

Handoff document. Spec: `roadmap/ops-disruptions-spec.md` in the project files.

**Status:** a sim change. It adds two systems, airspace closures and priority
flights, both optional-effect for a player who never meets them: each draws
from its own random stream, so a game they never touch plays as before.

## Decisions (from the owner)

- Priority flights are on routes already flown, optional, with 14 to 28 days'
  notice, and pay most where the home is small.
- Closures are random events only (no standing zones on day 0), shown on every
  lens; detail only in the Ops lens.
- Rivals ignore closures and priority flights for now.

## Slices

1. `sim/airspace.ts` and `data/airspace-zones.json`: the roll, the detour, the
   `airspace` cancellation cause.
2. Detour at departure; `render/flightPath.ts`.
3. Map zone, ticker, alerts.
4. `sim/mandates.ts`: offers, accept, settle, crew order.
5. Offer window, Schedule list, ticker, Ops stars.
6. Headless player policy.

How it works lives in HOW-IT-WORKS.md (Airspace closures, Priority flights).
