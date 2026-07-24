# airgame — Week one — eastern Canada slice

Six milestones. Each one ends with something that runs and looks like progress.
Commit at the end of every milestone, and ideally several times inside each.

Realistically this is more than seven evenings of work for a first project.
That is fine — the order matters more than the calendar.

**Definition of done for week one:** ten airports on a dark map, twelve daily
flights flown by three aircraft, a day/night terminator sweeping across, a
clock, a speed control, and a panel showing cash and where each aircraft is.
No player input beyond the speed control. Nothing is editable yet.

---

## M1 — Scaffold and basemap

Get a map on the screen. Nothing else.

- `npm create vite@latest` with the vanilla TypeScript template
- Add `d3-geo`, `d3-geo-projection` if needed, `topojson-client`
- Download Natural Earth 110m countries as TopoJSON into `data/`
- `render/projection.ts` exports a single `d3.geoMercator()` instance, fitted to
  a bounding box that covers eastern Canada from roughly 42°N to 50°N and 80°W
  to 51°W
- `render/basemap.ts` draws land and coastlines onto the canvas through
  `d3.geoPath` with the canvas context as its context
- Dark background, low-contrast landmasses. The aircraft need to be the
  brightest thing on screen later, so keep the basemap dim.
- Canvas sized to the window, redrawn on resize, `devicePixelRatio` handled so
  it isn't blurry on the M1's display

**Done when:** eastern Canada fills the window, sharp, and resizing the window
doesn't distort it.

---

## M2 — Airports

- Author `data/airports.json`. Starter set below — **verify every coordinate
  against the OurAirports CSV before trusting it**, the values here are
  approximate.

```json
[
  { "iata": "YUL", "name": "Montréal–Trudeau",   "lat": 45.4706, "lon": -73.7408, "utcOffsetMinutes": -300 },
  { "iata": "YYZ", "name": "Toronto Pearson",    "lat": 43.6777, "lon": -79.6248, "utcOffsetMinutes": -300 },
  { "iata": "YOW", "name": "Ottawa Macdonald",   "lat": 45.3225, "lon": -75.6692, "utcOffsetMinutes": -300 },
  { "iata": "YQB", "name": "Québec City Lesage", "lat": 46.7911, "lon": -71.3933, "utcOffsetMinutes": -300 },
  { "iata": "YHZ", "name": "Halifax Stanfield",  "lat": 44.8808, "lon": -63.5086, "utcOffsetMinutes": -240 },
  { "iata": "YSJ", "name": "Saint John",         "lat": 45.3161, "lon": -65.8892, "utcOffsetMinutes": -240 },
  { "iata": "YFC", "name": "Fredericton",        "lat": 45.8689, "lon": -66.5372, "utcOffsetMinutes": -240 },
  { "iata": "YQM", "name": "Greater Moncton",    "lat": 46.1122, "lon": -64.6786, "utcOffsetMinutes": -240 },
  { "iata": "YYG", "name": "Charlottetown",      "lat": 46.2900, "lon": -63.1211, "utcOffsetMinutes": -240 },
  { "iata": "YYT", "name": "St. John's",         "lat": 47.6186, "lon": -52.7519, "utcOffsetMinutes": -150 }
]
```

- Plot each as a small circle, with the IATA code beside it
- Add pan by dragging and zoom by scroll wheel, by mutating the projection's
  translate and scale and redrawing
- Label collision is not a problem worth solving at ten airports. Ignore it.

**Done when:** all ten are visible and correctly placed, and pan and zoom feel
smooth.

---

## M3 — Routes

- `sim/geo.ts`: great circle distance in nautical miles, and a bearing function
- `data/aircraft-types.json`: one type is enough to start.

```json
[
  {
    "code": "DH4",
    "name": "Dash 8-400",
    "seats": 78,
    "cruiseKts": 360,
    "costPerBlockHour": 3400,
    "costPerDeparture": 900
  }
]
```

- `data/schedule.json`: twelve legs across three aircraft, hand-written. Build
  each aircraft's day as a plausible chain — the destination of one leg is the
  origin of the next, with at least 30 minutes on the ground between them. Give
  each aircraft a tail number and start it somewhere overnight.
- Compute `blockMinutes` for each leg at load time and store it
- `render/routes.ts` draws each distinct city pair as a geodesic arc, thin and
  dim

**Done when:** the map shows a route network, the arcs are visibly curved, and a
console log confirms no aircraft is scheduled to depart from an airport it isn't
at.

That last check matters. A schedule with a broken rotation will produce
inexplicable behaviour in M4 and you will lose an evening to it.

---

## M4 — Clock and one aircraft

The first milestone where the thing is alive.

- `sim/state.ts`: the state shape and an initial state factory

```ts
type Aircraft = {
  tail: string;
  typeCode: string;
  status: 'ground' | 'airborne';
  atAirport: string | null;
  activeLegId: string | null;
};

type ActiveFlight = {
  legId: string;
  tail: string;
  origin: string;
  dest: string;
  departMinute: number;
  arriveMinute: number;
};

type SimState = {
  simMinute: number;
  cash: number;
  aircraft: Aircraft[];
  activeFlights: ActiveFlight[];
  completedToday: string[];
};
```

- `sim/step.ts`: advance one minute. For each scheduled leg whose departure time
  matches the current minute of day, if the aircraft is on the ground at the
  right airport, move it airborne and push an `ActiveFlight`. For each active
  flight whose arrival minute has passed, land it, put the aircraft on the
  ground at the destination, and remove it.
- `main.ts`: the accumulator loop from `CLAUDE.md`, plus a clock readout in the
  corner showing day number and UTC time
- Speed control: buttons for pause, 1×, 4×, 20×
- `render/aircraft.ts`: for each active flight, compute `t` from fractional sim
  time, get the position from `d3.geoInterpolate`, project it, draw a small
  triangle rotated to the heading

**Done when:** one aircraft departs, crosses the map, and lands at the right
airport at the right time, and pausing genuinely freezes it mid-air.

---

## M5 — Full fleet and the terminator

- Turn on all three aircraft and all twelve legs
- `render/terminator.ts`:

```ts
const dayOfYear = Math.floor(simMinute / 1440) % 365;
const minuteOfDay = simMinute % 1440;
const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
const subsolarLon = -(minuteOfDay - 720) / 4;
const antisolar: [number, number] = [subsolarLon + 180, -declination];
const nightHemisphere = d3.geoCircle().center(antisolar).radius(90)();
```

Render `nightHemisphere` through the same `geoPath` and fill it with a
semi-transparent dark navy. Draw it above the basemap and below the routes and
aircraft.

- Let a full simulated day run at 20× and watch it

**Done when:** three aircraft fly their rotations without desyncing, and the
night shading moves east to west across the map over the course of a sim day.

This is the screenshot-worthy moment. Take one.

---

## M6 — Economy and the first panel

- `sim/economy.ts`: deliberately crude for now.

```ts
const LOAD_FACTOR = 0.75;
const AVG_FARE = 185;

function flightResult(leg, type) {
  const pax = Math.round(type.seats * LOAD_FACTOR);
  const revenue = pax * AVG_FARE;
  const cost = (leg.blockMinutes / 60) * type.costPerBlockHour
             + type.costPerDeparture;
  return { pax, revenue, cost, margin: revenue - cost };
}
```

Apply it on arrival, not departure, and add the margin to `state.cash`.

- `ui/panels.ts`: a right-hand sidebar in plain HTML, updated on each render
  - cash, and today's revenue, cost and margin so far
  - a fleet table: tail, type, status, and either current airport or
    origin → destination with minutes remaining

**Done when:** a full sim day runs and cash moves in a direction you can explain
from the numbers in the panel.

---

## Then, in order

1. **Headless runner.** `src/headless/run.ts` — import `step`, run 365 days with
   no browser, write a per-day CSV. This is where you find out the fare and cost
   assumptions are wrong. Do this before adding any new mechanic.
2. **Schedule editor.** Make the schedule table editable. This is the first real
   player decision, and the point at which it becomes a game.
3. **Turn times and delay propagation.** Give each leg a scheduled ground time,
   add a stochastic delay distribution on arrival, and let a late inbound push
   the next departure. Watch a tight morning turn poison an afternoon. This is
   the mechanic that makes the map worth looking at.

Everything else — aircraft acquisition, demand modelling, competitors, CPA
negotiation, maintenance — waits until those three are solid.

---

## Deliberately deferred

Do not build these in week one, no matter how easy they look: daylight saving,
individual passenger itineraries, connecting traffic, weather, fuel price
variation, airport capacity limits, crew, maintenance, more than one aircraft
type, save and load, sound, aircraft type selection UI.
