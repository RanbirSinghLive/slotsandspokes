# airgame — Week eighteen (the map you can read and watch)

Handoff document. Week seventeen (the first minute) lives in
`WEEK-SEVENTEEN.md`.

**Status:** render and UI work only, from a review of the whole game (a
Boston save at day 75, Toronto at day 120). No new sim rule changes state.
The balance read doesn't apply except to confirm it is unchanged.

---

## The idea

After the route-label overlap fix the map is readable at the network level
but still crowded at the hub, and its planes, disruptions and operating
pressure are small or only in the side panel. This week adds operating
detail to the map behind one switch, **Ops view** (bottom left, key O,
remembered between visits, `render/opsView.ts`), so the plain map never
changes unless asked.

## Slices

All but the basemap draw only when `isOpsView()` is true.

1. **Hub core clean-up.** Airport labels and the "on its way" badges claim
   space first and route labels avoid them; the hub dot grows with departures
   a day; spoke labels thin out at a busy hub.
2. **Route width by volume.** Width scaled by seats a day, under Network and
   Profit.
3. **Planes worth watching.** Larger at close zoom, a short trail, a delayed
   halo, tail label when zoomed in.
4. **Disruption layer.** A grounded plane's pin with days back at its
   airport; cancelled legs dashed.
5. **Fare-gap tick and airport chips.** ▲/▼/≈ against the going rate on a
   route label; a chip for crews short or slots full on an airport.
6. **Basemap at city zoom.** Finer coastline as you zoom, lakes and rivers,
   softer ocean edge. Always on: it is graphics, not operating detail.
7. **"What's holding you back" line.** A read-only function in `src/sim/`
   naming the next bottleneck, shown in the alert strip in Ops view.

## Not in this week

- Late-game spending, sound, a day summary card, and early-game balance:
  each needs a decision first.
