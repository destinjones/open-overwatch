# Developing Open Overwatch

How to run the project, test it, render it headless, add a layer to the globe or the 2D map, add an MCP tool, and how
a change gets from your editor to the website. Pointers go to the code; the reasons behind most decisions are in
[NOTES.md](NOTES.md) (one section per area), the structure in [ARCHITECTURE.md](ARCHITECTURE.md), every shared core
module in [CORE.md](CORE.md), the data in
[DATA_SOURCES.md](DATA_SOURCES.md), the link format in [LINK_FORMAT.md](LINK_FORMAT.md) and the phone tooling in
[TESTING.md](TESTING.md).

## Contents

1. [The shape of the project](#1-the-shape-of-the-project)
2. [Running it](#2-running-it)
3. [Tests](#3-tests)
4. [Rendering headless (globe_shot)](#4-rendering-headless-globe_shot)
5. [Adding a layer to the 3D globe](#5-adding-a-layer-to-the-3d-globe)
6. [Adding a layer to the 2D map](#6-adding-a-layer-to-the-2d-map)
7. [Feeds that send no CORS headers: the relays](#7-feeds-that-send-no-cors-headers-the-relays)
8. [Adding an MCP tool](#8-adding-an-mcp-tool)
9. [Data built offline](#9-data-built-offline)
10. [Publishing](#10-publishing)
11. [House rules](#11-house-rules)

## 1. The shape of the project

A static site with no build step. Each page loads ES modules straight from `src/`; third-party libraries come from a
CDN, pinned to exact versions (CesiumJS 1.146 and satellite.js 5.0.0 as classic scripts in `globe.html`, three.js via an
import map in `solar.html`, Leaflet in `open-overwatch.html`).

| Path | What |
|---|---|
| `index.html`, `about.html`, `guide.html` | landing page, creator page, user guide (plain HTML + CSS) |
| `globe.html` → `src/globe/` | the 3D globe; `main.js` wires everything, `window.OO3D` is the console handle |
| `solar.html` → `src/solar/` | Solar System to cosmic web; `window.OOSS` |
| `open-overwatch.html` → `src/map/` | the 2D map; `window.OW` |
| `tonight.html` → `src/sky/main.js` | the Tonight card without the globe (reuses `src/globe/tonight.js`) |
| `src/core/` | shared code with **no DOM and no three.js/Cesium imports**, so Node can test it ([CORE.md](CORE.md)) |
| `src/app/` | the shell every page loads (`shell.js`): the installable app (`pwa.js`), the accessibility layer (`a11y.js`), touch hints and the long press (`gestures.js`, `spot.js`); `window.OOApp` |
| `sw.js`, `offline.html`, `manifest.webmanifest` | the service worker (offline copy, updates), the page shown offline with nothing saved, the app manifest |
| `mcp/` | the MCP server (Node; stdio, or Streamable HTTP on your own machine) |
| `relay/` | the public relay, a Cloudflare Worker |
| `serve.js`, `serve.py` | the local helper: static files + a locked-down relay |
| `brand/tools/` | data builders, render and test tools |
| `data/` | data built offline (and, on the website, feed copies made by the site build) |
| `test/` | `node --test`; fixtures in `test/fixtures/` |

Conventions that hold everywhere (from ARCHITECTURE.md): the space frame is heliocentric ecliptic J2000 in AU, time is
a Julian Date, angles are radians inside functions; core functions write vectors into an `out` object instead of
allocating.

## 2. Running it

ES modules don't load from `file://`, so serve the folder:

```bash
node serve.js
```

That serves the repository on `http://127.0.0.1:8787/` (Python: `python3 serve.py`; Windows: `Start Open
Overwatch.bat`, which picks whichever you have and opens the 2D map). Pages: `/index.html`, `/globe.html`,
`/solar.html`, `/open-overwatch.html` ("Enter silent" skips the audio prompt), `/tonight.html`.

`OW_PORT=8788 node serve.js` runs a second helper on another port. Several sessions or worktrees may share this PC: a
server already on 8787 can be serving a different copy of the site, so check which folder it serves before trusting
what you see.

In Claude Code's desktop app the preview configurations in `.claude/launch.json` (`open-overwatch`,
`open-overwatch-8788`, `open-overwatch-8789`) start the same helper.

Console handles for poking at a running page:

```js
OO3D.Sats.list.length          // the globe's satellites
OO3D.viewer.scene.requestRender()
OOSS                           // the Solar System view
OW.Sats.reload()               // the 2D map pauses feeds in hidden tabs: drive them by hand when testing
```

A hidden browser tab runs at 0 fps; drive frames with `OO3D.viewer.render()` when testing in a background pane.

On the local helper the service worker stays **off** (several copies of the site share `localhost:8787`, and a cached
copy would hide your changes): `?sw=1` turns it on for that browser and `?sw=0` turns it off and removes it.
`?hints=1` shows the first-run touch hints again.

### The MCP server

```bash
npm install                                          # once: satellite.js, the one dependency
node mcp/server.mjs --site http://localhost:8787/    # links and the chat panel point at your local copy
```

`node mcp/server.mjs --http 8793` serves Streamable HTTP on `http://127.0.0.1:8793/mcp` instead of stdio (your own
machine only; `--allow-origin` lists web origins that may call it). `node mcp/server.mjs --version` prints the version. See [mcp/README.md](../mcp/README.md) for installing it into an MCP
client.

## 3. Tests

```bash
node --test
```

Runs every `test/*.test.mjs` with Node's own runner. No dependencies except `satellite.js` for the MCP satellite tests
(skipped with a note when it isn't installed). What they cover:

| File | Checks |
|---|---|
| `core.test.mjs` | time, units, Kepler, planets and the Moon against JPL Horizons fixtures |
| `moons.test.mjs`, `orientation.test.mjs`, `eclipse.test.mjs`, `sky.test.mjs`, `passes.test.mjs` | moons, device orientation, eclipse shadows, the night sky, satellite passes |
| `tle.test.mjs`, `socrates.test.mjs` | element-set sources and parsing; close-approach CSV |
| `geo.test.mjs`, `measure.test.mjs`, `borders.test.mjs`, `route.test.mjs` | great circles and dead reckoning; WGS84 distances and areas against GeographicLib; the country lookup; routes |
| `viewlink.test.mjs`, `scene.test.mjs` | share links and Director scenes: round trips, hostile input refused |
| `voice.test.mjs` | voice command parsing |
| `gfs.test.mjs`, `wxmodels.test.mjs`, `grib2.test.mjs`, `aec.test.mjs`, `contour.test.mjs`, `wxload.test.mjs`, `wxpaint.test.mjs` | the weather timeline, the GFS and ECMWF files, GRIB2 decoding (simple, complex, JPEG 2000, CCSDS) checked against eccodes, model fields, isobars; loading a moment (runs, retries, blending, the decoded-hours cache) and how fields are drawn, for both views |
| `solar.test.mjs` | comets on any conic and their magnitudes, spacecraft tracks (Juno around Jupiter through its perijoves), the "where is it now?" search, Solar System links and sky positions, against JPL Horizons |
| `syzygy.test.mjs` | eclipses and lunar occultations 2026-2030: the Sun and Moon fit against Horizons, the eclipses against NASA's canon and the globe's own eclipse code, occultations against published predictions |
| `roadtiles.test.mjs`, `traffic.test.mjs`, `gtfsrt.test.mjs` | vector tiles and roads, the traffic model, GTFS-RT |
| `ais.test.mjs`, `bikes.test.mjs`, `transit.test.mjs`, `transitfeeds.test.mjs`, `hslrt.test.mjs`, `hazards.test.mjs`, `fireclusters.test.mjs`, `radio.test.mjs`, `campose.test.mjs`, `ascent.test.mjs` | the feeds' parsers and the models built on them |
| `feeds.test.mjs`, `cables.test.mjs`, `cameras.test.mjs`, `camerasnear.test.mjs`, `aircraft.test.mjs` | the shared feed parsers (quakes, EONET, cyclones, GDACS, aurora, cables, cameras, aircraft records) the 2D map, the globe and the MCP server all use |
| `aviation.test.mjs`, `acinfo.test.mjs` | aircraft classes, adsbdb answers and route fits, ICAO address blocks, weather aloft, airport boards, runways, trails, the card and board words both views share; the adsbdb client (queue, cache, rate limit) |
| `osmtiles.test.mjs`, `overpass.test.mjs` | buildings, military areas and plate readers from vector tiles; the polite Overpass client |
| `eclipselocal.test.mjs`, `solarsys.test.mjs` | eclipses from a place against NASA's, the planets from Earth |
| `pwa.test.mjs`, `sw.test.mjs`, `spot.test.mjs`, `a11y.test.mjs` | the installable app's decisions, the service worker in a fake worker, the long-press spot card, and the accessibility check on every page |
| `ops.test.mjs`, `inject.test.mjs`, `regress.test.mjs` | MGRS and the voice commands of the Ops pack; hostile input in numbers, ids and HTML stays harmless; regressions from the code reviews |
| `relay.test.mjs` | the Cloudflare Worker against a stand-in upstream |
| `mcp.test.mjs` | the MCP server: protocol, argument checks, every tool against canned answers, a stdio round trip, the HTTP transport |
| `docs.test.mjs` | these docs against the code: layer ids, link parameters, voice examples, band buttons, core modules and their exports |

Run one file with `node --test test/measure.test.mjs`. CI (`.github/workflows/ci.yml`) runs on every push: a syntax
check of every module and tool (`node --check`, `py_compile`), a check that every `src/…` module a page loads exists,
the accessibility check (`node brand/tools/a11y_check.mjs`: names, alt text, labels, ids, colour contrast on every
page), then `npm ci` and `node --test`. A new page goes into `PAGES` in `a11y_check.mjs`, the lists in
`test/a11y.test.mjs` and `PAGES` in `sw.js` (so it works offline), and loads `src/app/shell.js`.

**When to add a test.** Anything in `src/core/` gets one, in the file for its area (or a new `test/<area>.test.mjs`), and a section in
[CORE.md](CORE.md).
Prefer real reference data (Horizons vectors, GeographicLib values, a captured feed answer in `test/fixtures/`) over
numbers the code produced itself. A bug that reached a user gets a line in `regress.test.mjs`.

Browser-level checks (frame rates, the phone journeys, the Android emulator, WebKit) are in [TESTING.md](TESTING.md).

## 4. Rendering headless (globe_shot)

`brand/tools/globe_shot.mjs` renders a page in headless Microsoft Edge on the GPU and saves screenshots. It is the
way to look at the globe without a visible browser (a hidden pane can't render WebGL) and the way to check a change
visually.

```bash
node brand/tools/globe_shot.mjs <out_prefix> <width>x<height> "<js>" [settleSeconds] ["<js2>" settle2 ...]
```

Each `<js>` runs in the page (async is fine), then the page renders for `settleSeconds` (default 6) and
`<out_prefix>_<n>.png` is written. The page is `http://localhost:8787/globe.html` unless `OO_URL` says otherwise, so the
helper must be running.

```bash
# the globe over Europe, then London tilted
node brand/tools/globe_shot.mjs shots/eu 1600x900 "OO3D.viewer.camera.setView({destination: Cesium.Cartesian3.fromDegrees(10, 50, 6e6)})" 8 "document.querySelector('[data-go=ground]').click()" 10

# another page: the Solar System, or this guide
OO_URL=http://localhost:8787/solar.html node brand/tools/globe_shot.mjs shots/solar 1600x900 "" 8
OO_URL=http://localhost:8787/guide.html node brand/tools/globe_shot.mjs shots/guide 1280x2400 "" 2
```

It blocks CelesTrak, OpenSky, the ADS-B networks, USGS and wheretheiss.at: every run is a fresh browser profile with no
cache, and CelesTrak once firewalled this PC's network after a day of renders. Satellites then come from the website's
copy. **Never point automated runs at CelesTrak.** For repeatable lighting, pin the clock first
(`OO3D.viewer.clock.multiplier = 0`). It prints the GPU it got; a software renderer means the picture and the speed are
not representative.

The other tools in `brand/tools/` follow the same pattern: `perf.mjs` (frame rates), `zoomtest.mjs` (the zoom through
the hand-off), `mobile_journey.mjs` / `webkit_journey.mjs` (a first visit on a phone), `zoom_capture.mjs` (the promo
clip). Their shared Chrome DevTools Protocol client is `brand/tools/cdp.mjs`.

## 5. Adding a layer to the 3D globe

A globe layer is a switch in `LAYERS` (`src/globe/layers.js`) plus a module that draws it and an `apply()` that the
switch calls. `src/globe/volcanoes.js` is the smallest complete example (28 lines); read it first.

1. **The switch.** Add an entry to `LAYERS` in `src/globe/layers.js`:

   ```js
   { id: 'tides', group: 'Earth', name: 'Tide gauges (NOAA, live)', color: '#5fd3ff', on: false },
   ```

   `id` is what share links and the MCP server use (`[a-z0-9_-]`, short, stable: renaming one breaks old links). `group`
   is `Space`, `Air` or `Earth` (the dock's headings come from the order of the list). `on` is the default for a fresh
   visit; use `on: !PHONE` for something heavy. The dock is built from this list, and the visitor's choice is
   remembered per browser (`store` key `ly.<id>`).

2. **The module.** Create `src/globe/tides.js`. Draw with one shared primitive collection (points, billboards or a
   `Primitive`), not one entity per object: thousands of entities are slow. Give each drawn thing `id: obj` so picking
   finds the object, and set `obj.kind`. Load data only the first time the layer is on, and catch failures:

   ```js
   import { C } from './env.js';
   import { scene } from './viewer.js';
   import { L, setCount } from './layers.js';

   const pts = scene.primitives.add(new C.PointPrimitiveCollection());
   export const Tides = {
     list: [], loading: null,
     load() {
       if (!this.loading) this.loading = fetch('https://…').then(r => r.json()).then(d => {
         for (const s of d.stations) {
           const o = { kind: 'tide', name: s.name, lat: s.lat, lon: s.lon, level: s.level };
           o.pt = pts.add({ position: C.Cartesian3.fromDegrees(o.lon, o.lat), pixelSize: 6, color: C.Color.fromCssColorString('#5fd3ff'), show: L.tides.on, id: o });
           this.list.push(o);
         }
         setCount('tides', this.list.length);
       }).catch(e => { this.loading = null; console.warn('tides', e); });
       return this.loading;
     },
     apply() { pts.show = L.tides.on; if (L.tides.on && !this.loading) this.load(); scene.requestRender(); },
   };
   ```

   Use `fetchAsset` (`src/core/assets.js`) for files under `data/`, and `getJSON(url, { relay: true })` from `env.js` for
   a feed without CORS headers (see [section 7](#7-feeds-that-send-no-cors-headers-the-relays)). Feeds that refresh use
   a timer that does nothing while the layer is off.

3. **Wire it.** In `src/globe/main.js`, import the module and call `Tides.apply()` inside `applyAll()` (the function
   behind `hooks.applyVisibility`, which runs whenever a switch changes or a link is applied). If the layer stands on
   the ground, add its id to `GROUND` in the same file so look-up mode hides it. Add it to the `window.OO3D` object for
   the console.

4. **The hover tip and the card.** In `src/globe/ui.js`, `tipFor(o)` returns the one-line hover text and the card is
   built by kind further down. A module can instead give its objects a `cardHtml()` method (and `tip`), which `ui.js`
   uses as is; then **escaping is the module's job**: run every upstream string through `esc()` from `env.js`.

5. **Everything that names layers.**
   - `mcp/place.mjs` `LAYERS` (and the `layers_on` description in `mcp/tools.mjs`): `test/mcp.test.mjs` fails until
     the two lists match.
   - The user guide's layer table (`guide.html`, `#layers`, in the dock's order) and the id list in LINK_FORMAT.md's `l`
     section: `test/docs.test.mjs` fails until every id is in both.
   - `MAP_TO_GLOBE` in `src/core/viewlink.js` if a 2D map layer shows the same thing, so links between the views carry it.
   - [DATA_SOURCES.md](DATA_SOURCES.md): the source, licence, refresh and accuracy.
   - The credits: a `new C.Credit('…')` on the imagery or an attribution on the card, as the source asks.
   - Search (`src/globe/search.js`) if people will look for its objects by name; voice (`src/core/voicecmd.js`) already
     switches any layer by its name ("turn on tides").
   - The Ops detection boxes (`src/globe/ops.js`) and look-up only if it makes sense for this layer.

6. **Phones.** Check memory and frame time with the battery saver on and off, and in the phone profile
   (`brand/tools/mobile_journey.mjs`). Phones cap counts (see how `PHONE` is used in `traffic.js`, `radio.js`, `ops.js`).

7. **Check it** in the browser (no console errors, the dock count appears, a click opens the card, a share link with
   `&a=tides` turns it on) and with a `globe_shot.mjs` render.

## 6. Adding a layer to the 2D map

The 2D map has its own layer contract, enforced by `src/map/engine.js` (summarised from NOTES.md "2D map: adding a layer").
Layers are defined across `src/map/` (`feeds.js`, `aircraft.js`, `satellites.js`, `cities.js`, `hazards.js`,
`osmlayers.js`, `weather.js`, `aviation.js`); a feed both views show belongs in `src/core/` (as quakes, cyclones, cameras, transit and aurora now
are) with the 2D file only placing it on the canvas.

1. `Layers.add({ id, group, name, desc, color, default, points })` before `INIT`. `group` must be one of
   `Layers.groups` (`Air`, `Space`, `Sea & sky`, `Ground`, `Cities`, `Weather & space weather`, `Infrastructure`) or it
   never shows.
   Keep `id` to `[a-z0-9_]`; `points` must equal the Points set id.
2. `Points.define(setId, ly.id, { minZoom })`, then `Points.set(setId, items)` in the fetch. Item colours must be `#hex`.
3. `feed(ly, { interval, fetch: async () => { … }, viewDependent?, minZoom? })`. The fetch must **throw** on failure,
   set `ly.feed.count` itself, and must not set `ly.feed.status` or `nextAt` (the scheduler overwrites them). Use
   `Net.json` / `Net.text` for every request.
4. `Detail.renderers[kind] = obj => html`. **Escape every upstream string with `esc()`**: `Detail.kv` values and the
   `Detail.head` sub-argument go into `innerHTML` raw. Check link schemes with `isHttp()`.
5. A CORS-blocked source: add the host to `NEEDS_RELAY` in `src/map/util.js` **and** `ALLOWED_HOSTS` in `serve.js`
   **and** `serve.py`.

Moving objects (like aircraft and ships) have no generic path: they need a hand-written branch in `Glyphs.draw`. A
top-level exception anywhere aborts `INIT`, so open the map after every change. Modules import only from earlier ones;
names needed before they exist go through the `late` registry in `src/map/util.js`. Add the layer to the guide's 2D map
table too (`test/docs.test.mjs` checks).

## 7. Feeds that send no CORS headers: the relays

A browser can read a feed only if the feed sends `Access-Control-Allow-Origin`. For the few that don't, there are two
relays, and both only carry an allowlist:

- **The local helper** (`serve.js` / `serve.py`, the download version): `/proxy?url=…` for hosts in `ALLOWED_HOSTS`,
  only for the helper's own pages (a Host check, no `Access-Control-Allow-Origin` of its own, every redirect re-checked).
  Keep the two files' lists the same, and equal to the 2D map's `NEEDS_RELAY` (plus old hosts that archived pages use).
- **The public relay** (`relay/worker.js`, a Cloudflare Worker on the owner's account) for the website: the hosts in
  `PUBLIC_RELAY_HOSTS` (`src/core/relay.js`) = the Worker's `TTL` table, each limited to its feed paths (`PATHS`), GET
  only, an Origin header required, a fixed `Accept`, HTML never cached, `Access-Control-Allow-Origin` fixed to the
  published site. `test/relay.test.mjs` runs the Worker against a stand-in upstream.

In the globe, `relayed(url)` and `getJSON(url, { relay: true })` in `src/globe/env.js` pick the local helper when the
page is served from localhost, else the public relay for the hosts it carries, else nothing (the layer says it needs
the download version).

Adding a host to the public relay needs the feed owner's agreement (the ADS-B networks and OpenSky refuse cloud servers;
don't disguise the relay to get past that) and a redeploy (`npx wrangler deploy` from `relay/`), which is the owner's
call. See NOTES.md "Public relay".

## 8. Adding an MCP tool

The server is `mcp/`: `server.mjs` (the command line: stdio, or `--http`) → `index.mjs` (assembly) → `protocol.mjs`
(JSON-RPC by hand: initialize, tools, resources, prompts, cancellation, argument checks) + `tools.mjs` (the first
tools, and the list of all of them) + one file per newer tool or family (`cams.mjs`, `transit.mjs`, `fires.mjs`,
`country.mjs`, `cables.mjs`, `solar.mjs`, `eclipses.mjs`, `distance.mjs`, `volcanoes.mjs`, `roads.mjs`, `conj.mjs`,
`sun.mjs`, `meteors.mjs`, `osm.mjs`) + `place.mjs` (Photon places, framing a view, globe links) + `words.mjs` (shared
wording: `iso`, `km`, `plural`, `areaData`, `limitProp`, `take`…) + `hazards.mjs` (quakes, events, storms through the
core parsers) + `sats.mjs` (element sets and SGP4) + `feeds.mjs` (fetch with a cache, stale-if-error) + `prompts.mjs`
(the ready-made prompts) + `panel.mjs` (the globe in the chat, an MCP App). Transports: `http.mjs` (Streamable HTTP on
web Request/Response), `http-node.mjs` (serving it from Node), `worker.mjs` (a token-guarded fetch handler for Workers,
not deployed). No SDK; one dependency, satellite.js.

A tool is an object `{ name, title, description, inputSchema, run }`. New tools go in their own file as a factory that
takes `ctx` (see `mcp/volcanoes.mjs`), imported in `tools.mjs` and added to the array `createTools` returns:

```js
// mcp/tides.mjs
import { areaProps, resolveArea, frameArea, globeUrl } from './place.mjs';
import { areaData, limitProp, take } from './words.mjs';

export function tidesTool(ctx) {
  const { feeds } = ctx, link = v => globeUrl(feeds.siteBase, v);
  return {
    name: 'tides',
    title: 'Tide gauges',
    description: 'Water levels now at NOAA tide gauges near a place, with a globe link.',   // for the model: what it answers, from where
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { ...areaProps('to look'), limit: limitProp(10, 50) },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 100, signal });
      const d = await feeds.json('https://…', { ttl: 6 * 60e3, timeout: 20e3, signal });
      // … pick, sort, take(list, a.limit || 10)
      const url = link({ camera: frameArea(area), on: ['tides'] });
      return { text: [`3 tide gauges near ${area.label}.`, /* one line each */ `On the globe: ${url}`].join('\n'),
               data: { stations: [], area: areaData(area), url, source: 'NOAA CO-OPS (public domain)' } };
    },
  };
}
```

Then `import { tidesTool } from './tides.mjs'` in `tools.mjs` and add `tidesTool(ctx)` to the array `createTools`
returns.

- **Return** `{ text, data }`: `text` for people and models (short lines, units, times in UTC or the place's zone),
  `data` for programs, always with `url`, a globe link built with `link()` (`globeUrl` in `place.mjs`, see
  [LINK_FORMAT.md](LINK_FORMAT.md)). Name the source and its licence in `data.source`.
- **Arguments** are checked against `inputSchema` before `run` (`checkArgs` in `protocol.mjs`, with gentle coercion of
  numbers and booleans). Use `additionalProperties: false`, ranges and enums. Places: `areaProps()` gives `place`,
  `lat`, `lon` and `radius_km`; `resolveArea()` geocodes with Photon.
- **Errors** a person can act on: `throw new ToolError('what went wrong and what to try', 'invalid_arguments' |
  'unavailable' | …)` (from `feeds.mjs`). Network failures from `feeds.json` already are `ToolError`s.
- **Network**: only through `feeds.json(url, opts)` / `feeds.text(url, opts)` (a `User-Agent` naming the project,
  timeouts, an in-memory cache with `ttl`, the last good answer when a source fails). Data the website copies (TLEs,
  launches, crew, flybys) comes from the site (`feeds.json(feeds.site('data/…'))`): never CelesTrak or Launch Library directly.
- **Shared logic** goes in `src/core/` (and gets its own test there), so the website and the server agree: the tools
  already reuse `core/passes.js`, `core/sky.js`, `core/ais.js`, `core/bikes.js`, `core/launches.js` and more.
- **The bundle**: add the tool's name and a one-line description to `tools` in `mcp/manifest.json` (Claude Desktop's
  extension manifest); `test/mcp.test.mjs` checks the manifest lists exactly the server's tools. Add a row to the tools
  table in `mcp/README.md` and the source to DATA_SOURCES.md ("The MCP server").
- **Pictures**: a tool may return images too (MCP image content), as `traffic_cameras` does with camera stills.
- **Prompts** that should walk a model through several tools go in `mcp/prompts.mjs`.
- **Test** it in `test/mcp.test.mjs`: add the source's answer to `ROUTES` (the pretend Internet; a captured answer in
  `test/fixtures/` for anything big) and a `test('mcp: …')` that calls the tool through the protocol and checks
  `text`, `data` and the link (`decodeView` on its hash). Nothing in the tests touches the network.
- **Version**: a change to the server bumps `VERSION` in `mcp/feeds.mjs`, `version` in `package.json` and in
  `mcp/manifest.json` together (the test checks they agree).

Only `show_on_globe` opens the globe panel in the chat (`ui: { resourceUri: PANEL_URI }`); other tools return links.

## 9. Data built offline

The browser never queries big catalogues. Scripts in `brand/tools/` download once (cached in the gitignored
`brand/source/`) and write `data/`: `make_small_bodies.py` (1.57M asteroids), `make_stars.py`, `make_galaxies.py`,
`make_exoplanets.py`, `make_moons.py`, `make_spacecraft.py`, `make_eclipses.py`, `make_ephem.py` (the Sun and Moon 2026-2030 for eclipses and occultations), `make_comet_mags.py` (a test fixture), `make_countries.py` (facts and
borders), `make_companies.py`, `make_volcanoes.py`, `make_lighthouses.py`, `make_constellations.py`, `make_airports.py`
(OurAirports' airports, and with `--runways` their runways). See each script's opening
comment for what it fetches and writes. Downloading a new dataset is a decision for the project owner: ask first.

Live feed copies on the website (`data/tle/`, `data/launches.json`, `data/astronauts.json`, `data/flybys.json`,
`data/socrates.json`, `data/news.json`, `data/wind.json`) are made by the site build (below), not committed.

## 10. Publishing

As it is today:

1. **Branches.** Work happens on the local `rebuild` branch (or a branch merged into it). Nothing is pushed, tagged or
   deployed except when the project owner says so. A local `pre-push` hook refuses every push unless `OO_PUSH_OK=1` is
   set, which is done only on the owner's word.
2. **Versions** are small four-part steps (v0.9.2.8, then v0.9.2.9, …), recorded in the status line of `CLAUDE.md` and
   in `ROADMAP.md`.
3. **`Publish Update.bat`** (Windows) asks for the version number and a one-line summary, writes the version into
   `OW_VERSION` in `open-overwatch.html`, commits everything, creates an annotated tag `v<version>` and pushes `main`
   with its tags.
4. **The Website workflow** (`.github/workflows/pages.yml` → `.github/build_site.py`) runs on every push to `main`, every
   6 hours, and by hand. It builds the site with the current version at the root and every annotated `v*` tag frozen
   under `/v/<tag>/` (only `APP_PATHS` in `build_site.py` are copied there, so add every new runtime asset to that list),
   writes `versions.json` for the landing page's version picker, and refreshes the feed copies (TLE groups, launches,
   crew, flybys, close approaches, headlines, wind). A copy it can't refresh keeps the live site's last good one. It
   also stamps `sw.js`'s `BUILD` with the version and commit, so every published version is a new service worker
   (visitors get a "new version" prompt).
5. **The Release workflow** (`.github/workflows/release.yml`) runs on a `v*` tag: it builds `open-overwatch.zip` (the
   download, with `sw.js` and `offline.html`; keep its file list in step when the app needs new files) and `open-overwatch.mcpb` (the MCP server as a
   Claude Desktop extension: `mcp/`, `src/core/`, satellite.js) and attaches both to a GitHub release. The landing
   page's download button points at `releases/latest/download/open-overwatch.zip`.
6. **The relay** (`relay/`) is deployed separately with `npx wrangler deploy` on the owner's Cloudflare account, only
   when the owner agrees; the website keeps working without the change until then.
7. **npm**: `npm publish` for `open-overwatch-mcp` needs the owner's npm login and has not been done.

After a release: bump `lastmod` in `sitemap.xml` for pages that changed, tick `ROADMAP.md`, and note anything learned
in NOTES.md.

## 11. House rules

- `src/core/` stays DOM-free and three.js/Cesium-free; run `node --test` after changing it.
- Escape every upstream string before it goes into HTML (`esc()`); check link schemes (`isHttp()`).
- Never point automated runs at CelesTrak. Renders go through `globe_shot.mjs`.
- Respect the sources: polite rates, credit, no disguised clients, and only feeds whose terms allow it.
- Keep edits targeted in big shared files (`main.js`, `ui.js`, the HTML pages): other people may be working there too.
- Phones are first-class: check frame time and memory in the phone profile, not just on a desktop GPU.
- Plain English in the interface and the docs: say what it is, where it comes from and how sure it is.
