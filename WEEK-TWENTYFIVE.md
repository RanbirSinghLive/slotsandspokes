# airgame — Week twenty-five (stations)

Handoff document. Origin: the "turnaround strip" idea (project file
`ideas/airline-ops-flavour.md`, item 4) judged to have no repeat value as a
plane-level animation, and rebuilt as a station-level read-out tied to a real
decision.

**Status:** a sim change. Ground handling adds a fifth delay cause, so
on-time numbers move a little; a game that never builds a station plays
with contract handling everywhere but home.

## Decisions (from the owner)

- Do the whole slice: ledger, tiers, strip, headless policy.

## Defaults picked

- Delay is attributed to the **origin** airport: the turn happens there.
- Turn length itself is unchanged (still 30 minutes plus the route buffer);
  handling adds delay rather than changing the schedule's packing.
- Tiers: contract (default), own staff (needs a base), hub-grade (needs own
  staff and 6 departures a day). Slow to build, paid by the day.
- Strip, not a minigame: icons, colours and tooltips; no new words.

## Slices

1. `sim/stations.ts`: tiers, build, cost, ledger, read-out.
2. `sim/delays.ts` and `sim/step.ts`: the ground cause, ledger recording,
   daily rollover and running cost.
3. `ui/inspector/station.ts`, the airport view section and the Airports Delay column.
4. Headless player `keepStations()`; `npm run stationtest`.
5. Hub moat (built): a station tier lifts the airport's effective capacity in the
   congestion roll (`airportLoadAt()` read by `rollCongestionDelay()` in
   `sim/delays.ts`), so a busy hub queues later. Defaults:
   settle before building:
   - The lift is small and scales with tier (own staff a few percent,
     hub-grade more), and applies to the congestion cause only.
   - The lift is earned: it builds over weeks at the tier and lapses when daily
     departures fall under the tier's floor, so it cannot be bought once and
     left (a cheap permanent edge is a bug).
   - The airport view's delay strip already splits the causes; congestion
     shrinking there is how the player sees it work, with no new words.
   - Separate from slot tenure (slots.ts): the two hub moats are tuned one at a
     time, tenure first.
   - Rivals ignore it for now.

How it works lives in HOW-IT-WORKS.md (Stations).
