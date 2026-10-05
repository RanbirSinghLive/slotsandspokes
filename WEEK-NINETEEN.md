# airgame — Week nineteen (cargo: goods that match)

Handoff document. Week eighteen (the map you can read and watch) lives in
`WEEK-EIGHTEEN.md`.

**Status:** slices 1 to 4 built. Cargo is a new system; this file is what names it.
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

How each works now is in `HOW-IT-WORKS.md` (Cargo). In short:

1. **Cargo profile per airport** (`data/airport-cargo.json`, hand-authored
   from public knowledge like `airport-character.json`; a default from
   population for unlisted airports, and a million-plus city needs a good or
   two more than listed). Each lists what it *produces* and *needs*.
2. **Ten goods** (`data/cargo-goods.json`): seafood, fresh produce, auto
   parts, aerospace parts, electronics, parcels and mail, medical,
   minerals, industrial and camp supplies, textiles. Each has a rate per
   tonne per nautical mile, a daily volume, a shelf life in hours and a
   handling type (general, cold chain, bulky).
3. **A lane earns** tonnes matched between the two ends, times rate, times
   distance, less handling. Perishables lose value the longer and later the
   flight, which ties to on-time and the cascade already in the sim.
4. **Belly only**: a flight carries freight in the hold its passengers'
   bags leave free (0.02 t a seat less 0.01 t a passenger).
5. **Edges fade.** An unmet need pays a shortage premium (up to +60%) that
   fades as you fill it and returns if you stop. Rivals on a pair take a
   share of the lane by frequency.
6. **Moats take time (later).** Cargo terminals as a base kind and shipper
   contracts lock volume; a hub that strings many producers to many buyers
   is hard to copy.

## Slices (in order)

The owner asked for the Cargo map lens at the end, so the readout starts
in the airport view and the lens closes the first build.

1. **Data and readout, no money.** `data/airport-cargo.json`,
   `data/cargo-goods.json`, `sim/cargo.ts`, and what each airport makes and
   needs, with its best matched partners, in the airport view.
2. **Belly revenue** on existing flights from matched lanes, as a line
   in the P&L and the Money screen, paid net of handling. First `quick` read.
3. **Shortage prices and rival cargo.** A need pays a premium until you
   fill it; rivals on a pair take a share of the lane.
4. **Cargo map lens** (key 6): a circle per airport, your freight routes
   by good, the hovered airport's best partners.

Later slices, each its own change:

5. **Cargo terminals and shipper contracts.**
6. **Freighters** by refit.
7. **Multi-hop chains** through a hub.

New rules live in `src/sim/cargo.ts`; the UI only calls them.

## Decided

No prop cargo hold (the owner said no): props carry what their bags leave,
a few hundred kilos, so belly revenue mostly pays on regional and bigger
planes.

## Costs to flag

- Every new state field is optional (`?`) so old saves load; no `Map` or
  `Set` in state.
- Slice 2 changes starting economics: `npm run quick` needs a read and the
  owner's OK before `balance-reference.json` is saved again.
- Belly cargo rides flights the headless player already flies, so it needs no new policy to run; a player who hunts for matched lanes would earn more, so balance reads understate cargo until the headless player is given that habit.
- Stays clear of the maintenance and difficulty work other threads own.

## Balance read

`npm run quick` against main, steady player, medians (ten seeds a home, so
a home can move by a third on the same rules): YUL $7.8M (main $7.2M), YYZ
$62.4M ($53.2M), PHL $70.1M ($87.2M), YHZ −$1k (−$2k, 7 of 10 bust both).
All inside that noise. The steady player earns 0.1% to 0.6% of its revenue
from freight, because it picks routes by passenger demand and carries
whatever happens to match. A version that ranked matched lanes up to 50%
higher read worse at PHL and YYZ, so it was not kept; `balance-reference.json`
is not changed.

Props carry a few hundred kilos, so cargo does not rescue a prop-only start
like YHZ; it starts to pay once a regional or larger plane flies a matched
lane.
