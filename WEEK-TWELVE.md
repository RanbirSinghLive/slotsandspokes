# airgame — Week twelve (ready for alpha players)

Handoff document. Week eleven (ops-centre polish, the map's four
corners, the panel as screens with a rail, contracts, the crew planning
board) lives in `WEEK-ELEVEN.md`; read this one first. **Draft**: the
owner picks the name and trims the list.

**State at handoff:** save key `airgame-save-v46`. The game plays end to
end in a desktop browser, but only on the owner's machine: no hosting,
no domain, no git remote, version 0.0.0, no credits for the data it
uses, and a save-shape change silently orphans old saves.

---

## The idea, in one paragraph

An alpha is a handful of outside players (5–20) playing a real build on
their own machines and telling us what confused, bored or broke them.
So the bar is not "finished": it's **they can reach it, it doesn't lose
their game, they can find their feet in the first ten minutes, and we
hear back**. Everything below serves one of those four. No server,
database or account (CLAUDE.md): it stays a static page, and feedback
comes by a link and a save file.

---

## Decisions for the owner

1. **The name.** Candidates, `.com` checked free on 2026-09-28 (check a
   trademark search before paying):
   - **Slots & Spokes** (`slotsandspokes.com`): names the game's moats,
     slots and hub-and-spoke; alliterative; plainly an airline game.
   - **Load Factor** (`loadfactorgame.com`, `playloadfactor.com`): the
     game's headline number; insider, ops-flavoured.
   - **Blocktime** (`blocktimegame.com`): the airline word for gate to
     gate; short.
   - Avoid **Great Circle** (free as `greatcirclegame.com`, but the name
     of a 2024 Indiana Jones game).
2. **Where it's hosted.** A static host (Cloudflare Pages, Netlify or
   GitHub Pages), deployed from a git remote on push. Recommended:
   Cloudflare Pages, free, with the domain registered alongside.
3. **A public link, low uptake** (settled with the owner): anyone with
   the link can play, no invites or gating; expect 5–10 players. So a
   free static-host tier is plenty, a custom domain can come after a
   free one (`<name>.pages.dev` works on day one), and since strangers
   may arrive, the page needs to explain itself: an "alpha" badge, what
   feedback is wanted and where, and the desktop-only notice. Still no
   analytics: feedback is what players choose to send.

---

## Status

- **Hosted:** GitHub remote `RanbirSinghLive/slotsandspokes`, deploying
  on Cloudflare Pages on push; Node pinned to 22 (`.nvmrc`).
- **Done:** version 0.1.0 (shown in the Game screen, stamped in saves);
  save formats and migrations under one fixed key, the old save carried
  over; export and import as a file; an unreadable save kept and
  offered for download; the crash catcher; Credits (with GeoNames' CC BY
  attribution); the desktop-only notice; an Alpha badge on the rail;
  the page titled Slots & Spokes.
- **Feedback:** a Google Form (no account needed), pre-filled with the
  build, home and day (`ui/feedback.ts`), from a Feedback item on the
  rail, the Game screen and the crash card. Its responses are published
  as a CSV that a daily scheduled scan reads, triages against the code
  and turns into suggested fixes for the owner to approve; the scan
  never changes code itself.
- **The tutorial** (asked for by the owner in place of the desktop
  pop-up): a first-visit welcome card (play or skip; the desktop note
  folded into it on a narrow screen), then nine spotlight steps over the
  real screen, two of them hands-on (choose a home, fly a first route).
  Replayable from the Game screen.
- **Asked for by the owner:** crews hired by type from an airport's
  ring; planes rebased between crew bases from the Fleet screen (a
  paid ferry and 2 days away, crews staying put). The headless player
  doesn't rebase yet.
- **Still to do from threads 1–5:** the browser pass, rival codes that
  are real airlines', and the year one report.

## Thread 1: reachable (must)

- A git remote and a static deploy on push; the domain pointed at it.
- A version stamp: `package.json` bumped to 0.1.0, shown small in the
  Game screen and in every save, so a report says which build.
- **Desktop only, said kindly**: under ~900px wide, a notice instead of
  a broken layout.
- A browser pass: Chrome, Firefox, Safari, Edge on macOS and Windows,
  at 1280×720 and up.

## Thread 2: doesn't lose their game (must)

- **Save migrations, not a new key.** A save carries its version; loading
  an older one runs small upgrade steps (the `ensureCrewBases()` pattern,
  made general) instead of starting over. A save we can't upgrade says
  so and offers its file.
- **Export and import a save** as a file in the Game screen: the backup,
  and the bug report attachment.
- **A crash catcher**: an uncaught error pauses the game and shows a
  card with the error, the version and a button that downloads the save,
  instead of a frozen map.

## Thread 3: their first ten minutes (must)

- **A first-run guide** of five or six steps over the real screen, each
  pointing at the thing to do: pick a home (with its difficulty),
  lease-and-fly your first route from the ring, watch the ops board and
  P&L strip, read the Demand lens, open Goals. Skippable, replayable from
  the Game screen.
- **Home difficulty explained** at the picker, with contracts named as
  the help a weak home gets.
- **Speed and pacing**: check a new player isn't waiting through quiet
  days early on (a 200× or "skip to morning" may be worth it).

## Thread 4: we hear back (must)

- A **Feedback** button on the rail: a link to a form (name, what
  happened, what they expected), with the version filled in, and a
  prompt to attach the exported save.
- A **Year one report** at day 365 (and on game over): cash, fleet,
  best and worst routes, tier reached, a line to share. It's the natural
  moment to ask for feedback, and gives players a goal to reach.

## Thread 5: honest and credited (must)

- A **Credits** screen: OurAirports and Natural Earth (public domain,
  credited anyway) and **GeoNames (CC BY 4.0, attribution required)**,
  plus d3 and topojson licences.
- **Rival codes** that are real airlines' IATA codes (SK is SAS, IB is
  Iberia) changed to unused pairs, so no real airline appears to be in
  the game.

## Thread 6: balance good enough to judge (should)

- Carried from week eleven: a careful player's year runs $14M–$69M and
  never busts past the start (too easy), and the steady player
  over-expands at a thin home (Halifax 4/6 busts). Enough of a pass that
  alpha feedback is about the game, not an obvious exploit.
- A performance check on a modest laptop at 100×, late in a year with a
  big network (the Demand lens and rival layers are the heaviest).

## Thread 7: nice before beta (could)

- Colour-blind safety for red/green (P&L bars, on-time): a pattern or
  shape as well as colour.
- A changelog line in the Game screen per build.
- Keyboard shortcuts listed in a `?` card.
- **Mobile as good as desktop** (owner, 2026-09-28; tested on a Samsung
  S26 Ultra): touch pan and pinch zoom, taps for what hover shows, and a
  phone layout.

---

## Order

1. The name and domain (owner), git remote and deploy (thread 1).
2. Save safety and the crash catcher (thread 2), before anyone else
   plays: a lost game is the fastest way to lose an alpha player.
3. Credits and rival codes (thread 5), small and required.
4. The first-run guide and feedback (threads 3 and 4).
5. A balance pass (thread 6), then invite the first players.

## Carried forward from week eleven

- The product (cabins, fare families, cruise speed): paused.
- The steady headless player over-expanding at thin homes.
- A lessor listing when a class unlocks.
- Week-twelve game ideas from the owner's lists: seasons, rival
  personalities that can fail, missed connections.

## Playtest notes

*(The owner, and then the alpha players, add findings here.)*
