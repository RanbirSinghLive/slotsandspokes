# airgame — Week three (playtest readiness)

This is a working document, same spirit as WEEK-TWO.md was. Different
goal, though: everything here is about making the game the last two
weeks built actually **sit-down-and-play-able**, not about adding new
economic depth. Week two's layers (demand, choice model, yield mix,
competition, pricing, weather) are all in — the question now is whether
there's anything in the way of actually playing a session with them.

Update this freely as we keep talking. Nothing here is committed until
it's built.

---

## What "playtest ready" means here

Specifically: **you**, sitting down to play a session of the current
game, not a stranger discovering it cold. That distinction matters —
it rules out onboarding/tutorial work (you already know the mechanics,
you built them with me) and rules *in* anything that would actually
stop or annoy you mid-session: an edit you can't make, progress you
can't keep, a pace you can't control.

## Confirmed gaps (checked against the code, not guessed)

### 1. No way to remove a route or frequency

M10's route builder can only *add* a leg to `state.schedule`; M8's
schedule editor can only edit an existing leg's departure time. There is
no delete path anywhere — confirmed by grepping `ui/panels.ts` and
`ui/routeBuilder.ts` for anything resembling removal. If you add a
frequency you didn't mean to, or want to retire a route entirely, your
only option right now is editing `data/schedule.json` by hand and
reloading. This is the single most concrete blocker to normal play:
route/frequency mistakes are inevitable in a schedule-editing game, and
there's currently no way to correct one.

**Proposed fix:** a delete affordance on each schedule-table row (M8) —
a small "×" button that removes that leg from `state.schedule` and,
if it was the last leg on that market, removes the corresponding
`state.routeSettings` entry too (otherwise a stale fare/marketing
lever would linger for a market with no flights left).

### 2. No persistence — a reload loses everything

Confirmed: no `localStorage` usage anywhere in `src/`. CLAUDE.md already
flags this as "the right place for saves... this is a normal Vite app,
not a sandboxed artifact," so it's expected infrastructure, just not
built yet. Right now, closing the tab mid-session throws away every
schedule edit, fare change, and marketing dollar you've spent.

**Proposed fix:** serialize `SimState` to `localStorage` on some cadence
(every simulated day is probably enough — no need for every tick) and
offer to restore it on load. `SimState` is already required to survive
`JSON.parse(JSON.stringify(state))` unchanged (CLAUDE.md's rule, built
in from M1), so this is close to free — the hard part was already done
by the constraint, not this feature.

### 3. Every playthrough is currently identical

`createInitialState()` defaults `rngSeed` to a fixed `1`. That's
deliberate and correct for headless testing (same seed, same 60-day
outcome, verified repeatedly this whole project), but it also means
every time you open the game, you get the *identical* weather history,
the identical delay sequence, down to the same thunderstorm on the same
day. Fine for a single session; probably not what you want across
multiple playtest sessions if you're trying to see how the game
responds to different luck.

**Proposed fix:** seed from something session-specific (e.g.
`Date.now()`) by default in `main.ts` specifically — headless/tests
keep passing an explicit seed, so determinism where it actually matters
(reproducible test runs) is untouched.

## Judgment calls, not yet decided

### Time navigation and pacing

Speed controls top out at 20×. A full simulated year (the weather
system's whole season cycle) at 20× is still real minutes of sitting
and watching, most of it with nothing happening. Worth a faster top
speed, a "skip to next event" (next departure/arrival/weather change),
or both — genuinely unsure which is more useful without playing a
session first. Leaning toward: try the game as-is for a session before
building either, since a real playtest is the right way to find out if
this is actually annoying or if 20× already reads fine in practice.

### Weather visibility outside Ops mode

Right now weather only shows up visually in Ops mode (the flash/
particle effects), and only if you happen to be looking at the right
airport at the right frame. There's no ambient signal — no HUD note,
no log — that a storm started or ended. Worth a small always-visible
indicator (e.g., a line in the sidebar: "Snowstorm: YHZ") so you don't
have to be staring at the map to notice a disruption exists, but this
is a legibility nice-to-have, not a blocker the way items 1-3 above are.

### Bankruptcy / a failure state

Cash can go arbitrarily negative with no consequence — nothing stops
the game, nothing warns you. That's fine for exploring the mechanics
(which is the point of a first playtest), but if a real "goal" or "loss
condition" matters to how you want to play, it's worth deciding now
rather than after a session already feels aimless. Not proposing an
answer here — genuinely your call whether this playtest is sandbox
exploration or needs a scoreboard.

## Explicitly out of scope for this document

Everything WEEK-ONE.md and WEEK-TWO.md already deferred stays deferred:
aircraft market, financing, maintenance, crew, multiple aircraft types,
fleet growth beyond 3 tails, connecting itineraries, reactive competitor
AI, diversions/ground stops (weather stayed at "worse delay odds," per
WEEK-TWO.md's "Weather" section). None of that is needed to playtest
what's already built, and pulling any of it in now would be solving a
problem a real session hasn't surfaced yet.

## Draft priority order (not committed)

1. **Remove a route/frequency** — the one item that can actively block
   a session (an unwanted edit with no way back).
2. **Persistence (localStorage save/load)** — the one item that can
   lose a whole session's progress outright.
3. **Non-fixed default seed** — small, cheap, unblocks varied sessions.
4. Time navigation / weather visibility / failure-state — all worth
   revisiting once a real session has actually been played against
   items 1-3, not before.
