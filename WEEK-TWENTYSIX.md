# airgame — Week twenty-six (reading the game)

Handoff document. Origin: the "Paradox developer and superfan" take (project
file `ideas/paradox-take-build-list.md`), picks 1 and 2.

**Status:** one read-only slice and one sim slice that changes no balance.

## Decisions (from the owner)

- Build pick 1 (why a number changed) and pick 2 (nemesis rival and endgame goal).

## Defaults picked

- Movers compare 7 days with the 7 before; costs that scale with flying are
  scaled to this week's capacity so "flying more" is its own line.
- Nemesis is scored from routes the player flies (rival share of the market's
  flights), not from rival strategy; it changes nothing a rival does.
- Goal is routes (3+ beyond and 1.5x) held 60 days, because routes are the
  one measure both sides keep in the same units.

## Slices

1. `sim/marginMovers.ts`; margin chip, Overview card, Money line, route tip.
2. `sim/nemesis.ts`; `step.ts` rollover, ticker, Rivals list and page, Goals.

Not built: a nemesis reward, rival memory of grudges, an endgame beyond the
ladder's last tier.
