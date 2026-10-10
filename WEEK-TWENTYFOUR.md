# airgame — Week twenty-four (ancillary fees)

Handoff document. Ancillary revenue was designed in weeks five to seven and
in `WEEK-ELEVEN.md` (slice 3) and never built. This week builds it in two
steps, chosen by the owner from three options.

**Status:** steps A and B built; extras (priority boarding, paid seats) built airline-wide, unlocked by online booking.

## The idea

A ticket can leave things out and charge for them. Fees are the cheapest new
revenue, and they pay per passenger, not per city, so a thin home like YHZ
gains as much per flight as a big one.

They must not be a free permanent edge (CLAUDE.md): every fee costs NPS, a
leisure or VFR traveller minds it more than a business one, and rivals copy
a fee, so half of the goodwill cost fades while the revenue stays. The
point is to find where a fee pays (leisure routes with no rival) and where
it does not (a business trunk).

## Steps

A. **The fee dial.** An airline-wide level: bags included, checked bag fee,
   all bags and seat fee. Head office has the dial; the Money screen shows
   what fees earn. `sim/ancillaries.ts`.
B. **Per-route levers.** The same fees set per route. The NPS cost on a
   route a rival flies is higher; on an uncontested route it is lower.
   Extras (priority boarding, paid seats) are their own products,
   built airline-wide after A and B.

## Costs to flag

- New state fields are optional so old saves load; `SAVE_FORMAT` stays.
- Level 0 is today's game, so `npm run quick` reads the same at the
  default. The headless player needs a fee policy (it has one in
  `src/headless/player.ts`); the balance read is in HOW-IT-WORKS.md.
- Not in this week: ancillaries for rivals as simulated carriers, bundles,
  loyalty-scheme links.
