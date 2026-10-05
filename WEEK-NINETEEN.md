# airgame — Week nineteen (cargo: goods that match)

Handoff document. Week eighteen (the map you can read and watch) lives in
`WEEK-EIGHTEEN.md`.

**Status:** plan only. Cargo is a new system; this file is what names it.
Chosen by the owner: **goods matching**, not a flat per-seat yield. Merges
two design drafts (this thread's and `roadmap/cargo-design.md`) into one.

---

## The idea

Cargo is a supply-and-need match, not a pull that grows with city size.
Every airport produces some goods and needs others. A **lane** is one good
moving from an airport that produces it to one that needs it, and it earns
whatever the passenger demand is. A fishing town can be a rich lane; a big
business city can be a poor one.

It answers the thin-market problem (YHZ and the like): a second revenue
line that does not depend on the city's population.

## Rules

1. **Cargo profile per airport** (`data/airport-cargo.json`, hand-authored
   from public sources like `airport-character.json`, with a script default
   from population and region for unlisted airports). Each lists what it
   *produces* and *needs*, 0 to 2 each.
2. **Goods** (about ten): seafood, fresh produce and flowers, auto and
   aerospace parts, electronics, parcels and mail, medical, mining and
   industrial supplies, fuel and food for remote strips. Each has a value
   per tonne, a shelf life in days, and a handling type (general, cold
   chain, bulky).
3. **A lane earns** tonnes a day matched between the two ends, times value
   per tonne, times a distance factor, less handling cost. Perishables lose
   value when late, which ties to on-time and the cascade already in the sim.
4. **Backhaul.** A lane is balanced when the far end also produces what the
   near end needs. One-way lanes fly empty on the return. Pairing stations
   whose goods cross is the "connect them to each other" part.
5. **Edges fade.** An unserved need sets a shortage price on its lane.
   Serving it fills the need and the price decays (seeded, deterministic).
   Rivals read profit and pile on.
6. **Moats take time.** Cargo terminals (a base kind next to crew, line and
   hangar, with levels for tonnes a day and cold chain) and shipper
   contracts (like `contracts.ts`) lock volume. A hub that strings many
   producers to many buyers is hard for a one-route rival to copy.
7. **Capacity.** Belly cargo rides existing flights in the hold left after
   passenger bags. Freighters later, by refit like the cabin refit.

## Slices (in order)

1. **Data and readout, no money.** `data/airport-cargo.json`, a Cargo map
   lens (▲ makes, ▼ needs on airports, lanes coloured by good), an airport
   goods table and a ranked lane list with a $/day estimate. Tunable by eye;
   rendering only, so `quick` is unchanged.
2. **Belly revenue** on existing flights from matched lanes, as its own
   line in `flightResult()` and the P&L. First `quick` read.
3. **Shortage prices and rival cargo.**
4. **Cargo terminals and shipper contracts.**
5. **Freighters** by refit.
6. **Multi-hop chains** through a hub.

New rules live in `src/sim/cargo.ts`; the UI only calls them.

## Open choice for the owner

Props and small planes have tiny holds, so belly revenue in slice 2 mostly
pays on regional and bigger planes. To rescue prop-only starts like YHZ,
add a small **prop cargo hold** to slice 2. Default if unanswered: belly
only, revisit after the first `quick` read.

## Costs to flag

- Every new state field is optional (`?`) so old saves load; no `Map` or
  `Set` in state.
- Slice 2 changes starting economics: `npm run quick` needs a read and the
  owner's OK before `balance-reference.json` is saved again.
- The headless player needs lane choice in its route scoring from slice 2.
- Stays clear of the maintenance and difficulty work other threads own.
