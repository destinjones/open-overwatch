# Architecture

Open Overwatch is a static site: every view is an HTML page that loads ES modules straight from `src/` — no bundler, no
framework, no server you have to run (the optional local helper only relays a few feeds that send no CORS headers).
Third-party libraries come from a CDN, pinned to exact versions with integrity hashes (three.js and hls.js through
import maps, CesiumJS, satellite.js and Leaflet as script tags). The one library the site serves itself is satellite.js
for the satellite Web Workers (`src/vendor/satellite.min.js`, byte for byte the copy the pages pin): `importScripts` has
no integrity check, so a worker never loads code from another site.

```
index.html            landing page
about.html, guide.html  the creator page and the user guide (plain HTML + CSS)
open-overwatch.html   2D map (Leaflet)            -> src/map/
globe.html            3D Earth (CesiumJS)         -> src/globe/
solar.html            Solar System -> Local Group -> cosmic web (three.js) -> src/solar/
tonight.html          the Tonight card without the globe -> src/sky/ (reuses src/globe/tonight.js)
india/, india/hi/     the India page in English and Hindi -> india/india.js, src/core/india.js (india/hi/ is generated)
src/core/             shared, DOM-free, tested: time, frames, orbits, data formats (docs/CORE.md)
src/app/              the shell every page loads: the installable app, accessibility, touch hints, What's new
src/vendor/           satellite.js for the Web Workers (see above)
sw.js, offline.html   the service worker (offline copy, updates) and the page it shows with nothing saved
mcp/                  the MCP server (Node, stdio): tools over the same open data, links into the globe, the chat panel
mcp-worker/           the same MCP server as a Cloudflare Worker (wrangler config; the code is mcp/worker.mjs)
relay/                the website's public relay, a Cloudflare Worker (the hosts are in src/core/relay.js)
test/, e2e/           node --test with fixtures from JPL Horizons; Playwright browser tests (run on GitHub)
data/                 pre-built binary/JSON data (scripts in brand/tools/), and on the website the build's feed copies
brand/                textures, models, promo assets and the scripts that make them
serve.js / serve.py   optional local helper: static files + a locked-down relay
```

[DEVELOPING.md](DEVELOPING.md) has the same map as a table, with the files to start from in each.

## Conventions

**Units.** Distances in the Solar System are astronomical units (AU); interstellar ones are light-years converted to
AU (`LY_AU`). Angles are radians inside functions, degrees only in tables and UI. Time is a Julian Date (`jd`, days,
TT ≈ UTC — the 69 s difference is below anything we draw).

**Frames.** One frame for everything in space: heliocentric **ecliptic J2000** (x toward the March equinox, z toward
the ecliptic north pole). Equatorial inputs (RA/Dec, star catalogues, galaxies) are rotated once with
`eqToEcl`. Earth-fixed data (the globe) stays in Cesium's ECEF; the hand-off between the two goes through the Sun
direction and Earth's IAU rotation, both in `src/core`.

**Vectors.** Core functions write into an `out` object with `x, y, z` (a `THREE.Vector3` or a plain object), so the
same code runs in Node tests and in the render loop without allocating.

## The core (`src/core/`)

| module | what it does |
|---|---|
| `units.js` | constants (AU, light-year, parsec, c), obliquity, `eqToEcl`, `radecToEcl`, galactic axes |
| `time.js` | Julian Date conversions, a simulation clock (rate, live/paused), UTC formatting |
| `kepler.js` | Kepler's equation (Newton, robust start for high e), elements → position |
| `planets.js` | JPL "approximate positions" elements (1800–2050), the Moon (Schlyter + main perturbations), physical data |
| `moons.js` | 20 major moons (Mars → Pluto): orbits fitted to Horizons over 2026, with node, periapsis and mean-longitude rates |
| `rotation.js` | IAU rotation models → body-fixed axes in the ecliptic frame (texture longitude 0 = +x) |
| `smallbodies.js` | the 15-byte-per-object asteroid format, decoding, comet elements |
| `assets.js` | fetch with a fallback to the published site (archived versions don't carry big data) |
| `format.js` | distances, light time, durations, HTML escaping |
| `tle.js` | satellite element sets: CelesTrak / site-copy order, 2 h cache, parsing, epochs |
| `geo.js` | great-circle destination, haversine, dead reckoning for aircraft and ships |
| `socrates.js` | CelesTrak SOCRATES close-approach CSV parsing, upcoming conjunctions |
| `decay.js` | re-entry predictions from TLEs (n-dot and B* drag, solar-scaled atmosphere, ±25% window, corridor ground track) |
| `passes.js` | satellite passes over an observer (rise / peak / set, look angles, sunlit + dark-sky visibility) |
| `orientation.js` | W3C device orientation → camera direction and screen-up (look-up mode) |
| `eclipse.js` | Moon shadow cones, where they meet the WGS84 ellipsoid, shadow outlines, what an observer sees |
| `syzygy.js` | eclipses (solar, lunar) and lunar occultations 2026-2030 from a Chebyshev fit of Horizons' Sun and Moon (`data/solar/ephem.json`) |
| `accuracy.js` | errors against JPL Horizons (shared by the tests and the in-app "Under the hood" panel) |
| `gpu.js` | software-WebGL detection |
| `quality.js` | the globe's graphics levels (tile detail, model caps, render scale, FXAA, limb halo, cloud taps, shell mesh) and the automatic step-down |
| `poll.js` | feed timers that rest while the tab is hidden, catch up staggered when it shows, and stop for the visit on a feed the page can't reach |
| `ecfvel.js` | a satellite's Earth-fixed velocity from SGP4's inertial one (the globe's satellite worker inlines it) |
| `relay.js`, `airgrid.js` | the website's public relay (its hosts, the one URL form it accepts, hosts it refused this visit); the fixed 250 nm aircraft grid |
| `viewlink.js` | share links: a view as a URL hash and back, panels to open, Tonight for a place (`#at=`) and its embed |
| `whatsnew.js` | the "What's new" card a returning visitor sees once after an update |
| `mvt.js` | Mapbox Vector Tile decoding (protobuf by hand, wanted layers only), tile maths |
| `roadtiles.js` | road lines from vector tiles: clipped per tile, joined across tile edges, junctions, names, lights where busy roads meet |
| `traffic.js` | the traffic simulation: road graph, car following (IDM), lights, time-of-day busyness, NYC DOT / Fintraffic readings |
| `pwa.js` | the installable app's decisions: may this page run the site worker (archived /v/ copies never, the local helper only with ?sw=1), offline words, when the touch hints are due, what a long press is |
| `spot.js` | "this spot" (a long press): decimal / DMS / MGRS coordinates, a globe link with a pin on the spot |
| `a11ycheck.js` | the HTML accessibility check (names, labels, alt, ids, tabindex, roles, text-colour contrast) that the tests run on every page |
| `measure.js` | draw and measure: WGS84 distances and bearings (Vincenty; a bisection near the antipode), geodesic polygon areas (authalic sphere), ground length, the words for them, GeoJSON, the drawing in share links |
| `quakes.js`, `eonet.js`, `gdacs.js` | USGS quakes (with EMSC as the second catalogue that makes one "confirmed"), NASA EONET events (points and polygons, storm tracks), GDACS alerts: one parser for the 2D map, the globe and the MCP server |
| `cyclones.js` | every active cyclone, merged per storm from EONET, NOAA NHC, NOAA's forecast layers and GDACS (`loadCyclones`, fetching injected); categories, sources |
| `cameras.js` | the twelve agency camera networks (where the list is, the box, the credit, a parser each; Hong Kong's XML read here) |
| `transitfeeds.js` | live transit sources and areas, the poll loop and HSL's MQTT stream, the fleet drawn behind live (`createFleet`) |
| `aircraft.js`, `aurora.js`, `cables.js`, `overpass.js` | readsb / OpenSky records; OVATION grid and pictures, Kp; cable click test; the polite Overpass client |
| `fires.worker.js` | GIBS VIIRS fire tiles off the main thread (fetch, gunzip, decode), used by both views |
| `actype.js` | aircraft classes from ICAO type codes (then adsbdb words, emitter category) and the model each gets; adsbdb answers as plain records; whether a route on file fits where the plane is; ICAO address blocks to countries |
| `aloft.js` | weather at an aircraft: ISA pressure altitude, the two Open-Meteo pressure levels around it, interpolation, head/cross wind, TAS, Mach, ISA deviation, icing hint, HUD lines |
| `airports.js` | the airport list (OurAirports rows), a 1° grid index (nearest, near, in a box, by code), and boards: arriving, departing or on the ground from live aircraft |
| `phase.js` | flight phase (parked, taxiing, take-off, climb, cruise, descent, approach, final) from a fix and the nearest field; great-circle points |
| `runways.js` | runway ends and headings, wind along and across each, the runway a plane is lined up with, the runway in use |
| `metar.js` | METAR and TAF decoded into numbers and plain words, flight categories, the forecast in force at a time |
| `eta.js` | arrival/departure estimates with ranges (distance, ground speed, descent) and their track record per airport |
| `runwaylog.js` | landings and take-offs found in trails, the runway each used, runway use over the last hour |
| `trail.js` | flight trails: a time window of fixes, 3D Douglas-Peucker thinning, the altitude colour ramp, trail stats |
| `acinfo.js` | the adsbdb client both views' aircraft cards and boards use: one request at a time, a day's cache in the view's store, silent while rate limited |
| `wxload.js`, `model.worker.js` | the weather models at a moment for the globe and the 2D map: newest complete run, one field and forecast hour at a time by byte range, decoded off the main thread, blended between hours; sampling a moment |
| `wxpaint.js` | how model fields look in both views: wash colours, legends, painting through any projection, wave darts, the isobar chart |

Accuracy, checked by the tests against JPL Horizons on 2026-10-02: planets within arcminutes (JPL's own stated
error for these formulas), main-belt asteroids within ~3×10⁻⁴ AU, the Moon within ~0.3°, the other moons within 0.4° of their orbit.
The moon fits drift slowly away from 2026 (no short-period terms); rerun `make_moons.py` with a new window then.

## Every page (`src/app/`, `sw.js`)

Each page loads `src/app/shell.js` (one script tag): `pwa.js` registers `sw.js` after the page has settled and shows the
offline banner, the new-version prompt and the Install button; `a11y.js` adds keyboard moves, names, state attributes and
announcements to the live DOM from a short description per page (so the views' own code stays untouched); `gestures.js`
and `spot.js` (globe and 2D map only, loaded after the page) show the first-run touch hints and handle the long press.
`shell.css` carries the shared focus rings, bar, hint card and reduced-motion rule. `sw.js` is a classic worker at the
site root; `offline.html` is what it shows for a page that was never saved. Details in docs/NOTES.md.

Updates: the site build stamps `sw.js` with `<version>+<commit>`, so every publish is a new worker. At install it crawls
the pages and every module they import and saves them together (with Save-Data on, the pages only), and a published
build then serves a page and those modules from that one version's copy (a file built from a run-time URL, which the
crawl can't find, comes from the network). The new worker waits until the visitor presses Reload on the new-version bar
(the very first one takes over at once); a tab still running the old version when another tab takes the update is asked
to reload too, since the new worker no longer serves the old version's modules. After an update the visitor sees "What's
new" once (`src/core/whatsnew.js`): never on a first visit, in an archived `/v/<tag>/` copy or in an embed.

## The 3D globe (`src/globe/`)

Cesium and satellite.js load as classic scripts (globals); the app is ES modules on top: `env` (DOM, storage, network,
relay), `viewer` (viewer, camera limits, shared primitive collections, star box), `earth` (imagery, the three shader
shells, Sun/Moon directions), `layers` (switches + dock), `follow` (follow camera, glTF axis conventions),
`satellites` (TLEs via core, SGP4 worker, models), `aircraft` (feeds, dead reckoning, models), `quakes`, `ui` (stats,
band, presets, picking, card, lighting), `mobile` (phones only: bottom dock and sheets that click the existing controls), `weather` (weather mode: GIBS infrared clouds, RainViewer radar, IMERG rain, animated), `lighthouses`, `country` (click a country: border, facts, headlines, employers), `companies`, `volcanoes`, `aurora`, `flybys`, `sunline`, `buildings` (needs an ion token, `config.js`), `share` (view links in the URL hash), `tour`, `measure` (draw and measure: pins, lines, areas, distance arrows, country outlines), `navpad` (everything else: zoom, north-up, top-down and reset buttons, keys + − N T R) and `main` (wiring, timers, boot). `state.js` holds the selection and late-bound
hooks so feature modules never import the UI. `window.OO3D` is the console handle.

- **Satellites:** a Web Worker (a blob built in `satellites.js`) loads `src/vendor/satellite.min.js` and propagates
  every satellite once a second: one SGP4 run each gives the Earth-fixed position and, through `core/ecfvel.js`, the
  velocity, sent half a second on (plus 0.5 s of gravity) so the page's straight line between ticks stays about 1 m off
  the orbit. The page moves the dots between ticks.
- **Feed timers:** `main.js` runs every live feed through one `core/poll.js` poller. In a hidden tab the feeds rest,
  except the aircraft feeds while a plane is followed or watched for its landing; when the tab shows again each feed
  that came due runs once, 1.5 s apart. A feed this page can't reach (the website's relay doesn't carry it: `env.js`
  `notCarried`, or the deployed relay refused its host) stops for the visit, and one line says why once the boot screen
  has lifted.
- **Graphics levels:** `quality.js` applies `core/quality.js` (render scale, FXAA, tile detail, model caps, cloud
  octaves and relief, the limb halo) and steps down in Auto; the table is in docs/PERFORMANCE.md.

## One zoom from street to galaxy

`src/globe/space.js` loads `solar.html?embed=1` in an iframe once the globe camera climbs past 80,000 km, and hands
the camera over beyond 300,000 km (looking back at Earth): position, view direction and up vector go across as
Earth-centred vectors in ecliptic J2000 (Cesium Earth-fixed → ICRF with Cesium's IERS-based matrix → ecliptic), plus the
vertical field of view. The Solar System view places them around Earth's *centre* (not the Earth–Moon barycentre,
4,700 km away), so Earth sits in the same pixels at the switch; the two cross-fade in 0.7 s and the star backgrounds line
up. It then rolls the view to ecliptic north over 1.6 s. Zooming into Earth there (below 220,000 km, not mid-flight)
hands the camera back the same way. Only one renderer draws at a time: Cesium's render loop stops while the Solar
System is showing, and the Solar System's loop sleeps while the globe is.

## Data that is built offline

The browser never queries catalogues with millions of rows. Scripts in `brand/tools/` download once (cached in the
gitignored `brand/source/`), compress and write `data/solar/`:

- `asteroids_a.bin` / `asteroids_b.bin` — all 1.57M SBDB asteroids, 15 bytes each, propagated on the GPU
- `small_bodies.json` — named objects and comets · `stars.bin` / `stars.json` — HYG v4.1 in ecliptic light-years
- `spacecraft.json` — JPL Horizons trajectories at fixed steps (Juno also as osculating orbits around Jupiter) · `moons.json` — 20 moon orbits fitted to Horizons
- `ephem.json` — the Sun and Moon from Earth 2026-2030 as Chebyshev series (Horizons), for eclipses and occultations
- `galaxies.bin` / `galaxies.json` — 43,480 2MASS Redshift Survey galaxies (Mpc, equatorial, Hubble-law distances)

Live feeds (satellites, aircraft, quakes, …) are fetched by the page; satellite TLEs come from a copy the site build
refreshes every 6 hours, so visitors never hit CelesTrak directly.

## Rendering notes (solar)

- One three.js scene in AU with a **logarithmic depth buffer** (near 1e-9 AU, far 1e15 AU): 26 orders of magnitude.
- The camera rides along with its focus body; model-view matrices are composed in double precision on the CPU, so
  objects stay steady even 1e11 AU from the origin.
- 1.57M asteroids: one `Points` draw per file; each vertex solves Kepler's equation in the shader from packed
  elements (Float32 a, five Uint16 angles/eccentricity, Uint8 class). 165 fps on an RTX 3060.
- Point clouds that have faded out are set invisible, not just transparent: from light-years away the asteroids all
  land on a few pixels and additive blending serialises them (42 ms a frame on an RTX 3060 before this).
- Graphics levels (`quality.js` in both 3D views) and the measurements are in `docs/PERFORMANCE.md`.
- The star map is sampled by direction in a shader (ecliptic → equatorial → RA/Dec), so there are no cube-map
  orientation conventions to get wrong.

## Testing

`node --test` (from the repo root) — no dependencies. Fixtures in `test/fixtures/` are real JPL Horizons vectors, so a regression in
the orbital maths shows up as a distance error in AU, not as a vague visual change.
