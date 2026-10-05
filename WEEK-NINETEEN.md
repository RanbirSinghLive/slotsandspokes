# airgame — Week nineteen (cargo: goods that match)

Handoff document. Week eighteen (the map you can read and watch) lives in
`WEEK-EIGHTEEN.md`.

**Status:** plan only. Cargo is a new system; this file is what names it.
Chosen by the owner: **goods matching**, not a flat per-seat yield.

---

## The idea

Cargo is a different kind of mechanic from passengers. Every airport makes
a few goods and needs a few goods. A link earns money when what one end
makes is what the other end needs. It is not correlated with passenger
demand: a small fishing airport can be a rich cargo origin, and a big
business airport can have little cargo to give.

It answers the thin-market problem (YHZ and the like): a second revenue
line that does not depend on the city's population.

## Rules

1. **Cargo profile per airport** (`data/airport-cargo.json`, hand-authored
   from public knowledge, like `airport-character.json`). Each entry lists
   1 to 3 goods it makes and 1 to 3 it needs, with a size 1 to 3. An airport
   not listed gets a default from population.
2. **Goods** (about eight): seafood, fresh produce, auto parts, electronics,
   mail and parcels, medical, industrial gear, ore samples. Each has a value
   per tonne and a spoilage rate (fresh goods lose value with trip time).
3. **A route's cargo flow** is the tonnes a day both ends can match, in each
   direction, times the value per tonne, times a distance factor, less
   spoilage. It uses only goods that have a make at one end and a need at
   the other.
4. **Capacity (first slice: belly only).** Each flight has hold space left
   over after passenger bags. Cargo fills it. Freighters are a later slice.
5. **Edges fade.** A rival flying the same pair splits the flow, so a
   cargo edge is temporary. The durable moat is a hub that collects goods
   from many producers and ships them to many buyers.

## First slice

- `data/airport-cargo.json` for eastern Canada and the US airports.
- `src/sim/cargo.ts`: pure rules that, given a route and a flight, return
  tonnes carried and revenue. No DOM.
- A cargo line in the P&L and `HOW-IT-WORKS.md` section.
- Airport inspector shows makes and needs (with an (i)).
- Headless player: no new policy needed, since belly cargo rides existing
  flights.

Not in this slice: freighters, rival cargo, cargo contracts.

## Costs to flag

- Every new field is optional (`?`) so old saves load.
- Adds revenue, so it changes starting economics: `npm run quick` needs a
  read and the owner's OK before `balance-reference.json` is saved again.
- Stays clear of the maintenance and difficulty work other threads own.
