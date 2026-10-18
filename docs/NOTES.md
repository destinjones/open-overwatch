# Notes and hard-won lessons

Detail that used to live in CLAUDE.md. Read the section you need before touching that part.

## Files and per-view lessons
- `index.html` — the landing page (GitHub Pages root). Hero clip/stills from brand/tools/lander_hero.py, feature icons
  from brand/tools/feature_icons.py, phone clips from the capture footage; live ISS (wheretheiss.at) + USGS in the hero.
- `open-overwatch.html` — the 2D map's markup and styles; its code is ES modules in src/map/ (see below).
  Lines 417-418 are giant data tables (COUNTRY, COUNTRY_ALIAS); don't read them in full.
- `globe.html` — 3D view on CesiumJS 1.146 (CDN), needs the helper. Satellites: CelesTrak TLEs (Cache Storage, 2 h),
  SGP4 in a worker for the dots; the nearest 40 within 4,000 km get glTF models (brand/models/*.glb, Blender-built,
  +X ram / +Z zenith / solar_* nodes rotate about Y toward the sun), exact SGP4 per frame keyed to the Cesium clock.
  Objects within 5 km of the ISS/CSS are "docked" (no model, no dot). Aircraft (the download version only: the website
  has none, see "Public relay"): OpenSky snapshot (15 min) + adsb.lol mil, dead-reckoned up to 15 min; the nearest
  200 within 300 km (camera < 600 km) get models (brand/models/aircraft) with
  heading, pitch from vertical rate and bank from turn rate. Follow camera = own preUpdate re-centring (Cesium's
  trackedEntity lags a tick ≈ 115 m at orbital speed). Lessons: 4x MSAA and one 8k single-tile imagery texture broke
  globe rendering; city lights are a tile pyramid shown only above 300 km (where sun shading is on); ground atmosphere
  hides night lights so it is off; below 300 km the scene light is an overhead fill (globe unlit there anyway);
  satellites in Earth's shadow get a CustomShader ambient term. A hidden Browser pane runs 0 fps: drive frames with
  viewer.render() when testing. MODEL_FIX = -90° about Z undoes Cesium's glTF forward-axis turn.
  Earth look (the `Earth` block): NASA GIBS Blue Marble NG (day, far, kept down to ~150 km) over Esri imagery (near), GIBS VIIRS Black Marble
  (night, gamma 0.4 then brightness, compensated for the lighting fade), ground atmosphere ON with nightFadeOut=1 /
  nightFadeIn=0 (else the night side turns black), lightingFade at R+20 km / R+200 km, no HDR (washes night purple).
  Two EllipsoidGeometry shells read brand/textures/earth_fx_*.jpg (make_earth_fx.py; rolled 180° because the shell's st
  starts at lon 0): glint + cloud shadows (premultiplied blend; needs orderIndependentTranslucency:false AND an
  appearance.getRenderState override, Cesium otherwise forces ALPHA_BLEND) plus open-ocean blue over Esri's seafloor
  shading; the GIBS layers use the EPSG:4326 set (pole to pole; 512 px tiles, 288° level 0) — don't paint polar caps,
  GlobeFS's day/night + ground atmosphere can't be matched by hand; clouds 9 km up (procedural detail + relief, dissolve below 250 km); a limb shell at
  115 km (additive; tangent-height layers: day blue, sunset bands, airglow). Shells need compressVertices:false. Cloud
  noise needs a float-safe hash (the classic fract(p*p*p) one makes zigzags at Earth-scale coordinates). Look-dev:
  render with brand/tools/globe_shot.mjs (headless Edge on the RTX GPU) — the Browser pane can't screenshot when the
  app is hidden. Pin the clock (clockStep TICK_DEPENDENT, multiplier 0) for repeatable lighting.
  Stars: NASA SVS Deep Star Maps 2020 cube faces (brand/textures/sky, sky_1k for phones) from make_skybox.py (EXR
  decoded by headless Blender via exr_dump.py; source EXR is gitignored). Cesium.SkyBox reads each face vertically
  flipped vs the OpenGL convention (verified with direction-coded faces; star positions checked against Orion/Sgr).
  camera.setView({orientation:{direction, up}}) far out in space can come back upside down; check camera.upWC.
  TLEs: the website build mirrors every CelesTrak group the apps use to /data/tle/<group>.txt (build_site.py; the Website
  workflow also runs every 6 h). Both apps read that copy first on destinjones.github.io and fall back to it elsewhere.
  CelesTrak firewalled this PC's network on 2026-10-01 after many headless renders (fresh profile = no cache each run);
  globe_shot.mjs now blocks the live feed hosts. Never point automated runs at CelesTrak.
- `solar.html` — Solar System → Local Group view on Three.js 0.186 (importmap, CDN), one scene in AU with a log depth
  buffer; camera rides along with the focused body. Planets: JPL approximate elements (1800-2050) + IAU rotation models;
  textures brand/textures/planets (make_planet_textures.py, Solar System Scope CC BY 4.0). Small bodies: data/solar/
  asteroids_a.bin (brightest 300k; phones load only this) + asteroids_b.bin (rest, 1.57M total) + small_bodies.json
  (named, comets) from make_small_bodies.py (JPL SBDB); Kepler is solved per point in the vertex shader (15-byte
  records, see the script). Stars: data/solar/stars.bin (HYG v4.1, CC BY-SA) via make_stars.py; spacecraft:
  data/solar/spacecraft.json (JPL Horizons) via make_spacecraft.py. Sky: brand/textures/sky_equirect*.jpg sampled by
  direction in a shader (no cube-map conventions). Milky Way: NASA/JPL-Caltech R. Hurt top-down image on the galactic
  plane (115,000 ly square, Sun 26,000 ly from the centre). Big assets load relative first, then from the site root, so
  /v/<tag>/ copies only carry solar.html itself. window.OOSS is the console handle; globe_shot.mjs renders it with
  OO_URL=http://localhost:8787/solar.html.
- `serve.js` / `serve.py` — twin local helpers: serve the folder on http://127.0.0.1:8787 and relay an https host
  allowlist at `/proxy?url=…` for sources that send no CORS header. Keep the two in sync. `OW_PORT=8788` runs a second
  serve.js: the one on 8787 may be another session's, serving another copy of the site (check before trusting a render;
  `OO_URL=http://localhost:8788/globe.html` points globe_shot.mjs at yours).
- `Start Open Overwatch.bat` / `.vbs` — Windows launchers.
- `brand/` — brand + promo pack (3D emblem, globe hero, share images, TikTok promo video) and the scripts that
  rebuild it; see brand/README.md. The start screen's `.splash-globe` and the favicon/apple-touch-icon/og tags use it.
- `notes/review-2026-10-01.json` — full multi-agent review: per-subsystem summaries, key functions, extension
  notes, verified issues (with line numbers) and a feed-liveness check of every external endpoint.

## Publishing
Repo github.com/destinjones/open-overwatch (public); site https://destinjones.github.io/open-overwatch/, built by the "Website"
workflow (.github/workflows/pages.yml -> .github/build_site.py): main at the root, the newest ARCHIVE_KEEP (6)
annotated v* tags frozen under /v/<tag>/ (older tags get a small page pointing at their release zip), and versions.json
for the landing page's version picker and history (#launch). The /v/<tag>/ copies only contain build_site.py's APP_PATHS: add every new runtime asset there (the Launch button opens /v/<latest>/), or
the archived app 404s on it (v0.7-v0.8 globe crashed that way until v0.8.1). Each archived version costs
~30 MB of the 1 GB Pages limit (pages.yml warns over 900 MB and fails over 950 MB).
Mirrors are best effort, and a failed refresh must never take the previous copy down: on 2026-10-06 06:28 UTC the
scheduled build timed out on every CelesTrak group (90 s each, a 36-minute build that still "succeeded"), deployed with
an empty data/tle/, and the live globe fell back to CelesTrak directly for every visitor until the next build.
build_site.py now keeps the live site's copy of any feed it cannot refresh (last_good / keep_last), stops waiting on
CelesTrak after the first timeout, and index.json lists the groups it `kept`.
`Publish Update.bat` bumps OW_VERSION (src/map/version.js), commits, tags vX and pushes; .github/workflows/release.yml then builds
`open-overwatch.zip` (the download the lander links to via releases/latest/download). Keep the zip file list in that
workflow in sync when the app starts needing new files. gh CLI (portable): ~/bin/gh-cli/bin/gh.exe.
- 2026-10-17, the Pages budget: the site root is HEAD minus SKIP_ROOT, which now also leaves out the dev-only folders
  test/, e2e/, notes/, relay/, mcp-worker/ and brand/clip/ (KEEP_ROOT puts back the one file a page loads from them,
  test/fixtures/horizons_2026-10-02.json for the Solar view's accuracy table). Only the newest ARCHIVE_KEEP (6) tags by
  version number get a full /v/<tag>/ copy (`online_tags`); an older tag's pages are a small script-free page linking
  its release zip, and its versions.json entry has `online: false` and no map/globe/solar paths. versions.json's top
  level carries `online` (the count really online) and `keep` (ARCHIVE_KEEP). build_site.py prints the site size and
  warns over SITE_BUDGET (900 MB); pages.yml fails the build over 950 MB.
- 2026-10-17, news and the sitemap: a partial GDELT run fills the countries that failed from the live copy (up to 3 days
  old) and lists them in news.json's `kept` map ({ISO2: ms of their own fetch}); the globe's country panel labels those
  headlines with that time and says "last few days" once they are over 24 h old. sitemap.xml's <loc> list is
  hand-written, but the build rewrites every <lastmod> from git (`date_sitemap`); the app pages (APP_PAGES: globe,
  solar, open-overwatch, tonight) also count commits to src/ and data/.
- 2026-10-17, the release: `Publish Update.bat` now runs `git fetch origin main` and `git merge --ff-only origin/main`
  before it bumps anything (it stops if this branch and main have both moved), shows which branch goes to main, pushes
  the branch and the tag together (`git push --atomic`), and on a failed push deletes the tag and takes back the version
  commit (it then says version.js already holds the new number, so the same one can be entered again). The zip also
  carries index/about/guide, india/, the airport, runway, deep-sky and light-pollution data (lightpollution.md, its
  CC BY-NC note, goes with the .bin), the install-sheet screenshots, LICENSE, NOTICE and docs/DATA_SOURCES.md. Copies of
  live feeds (data/tle/, launches, news, …: SITE_ONLY in test/release.test.mjs) are not in it: the download reads those
  from the website. test/release.test.mjs reads the zip list from release.yml and fails on a file README.txt lists, a
  data/ file a view fetches, a page or srcset image a shipped page links, a manifest icon or screenshot, or a folder
  whose asset paths pages build in JS (brand/lander/clips/, brand/india/clips/, brand/models/) that the zip lacks.

### Search and sharing (SEO)
`index.html`, `about.html` and the three app pages each carry a title, description, canonical URL, Open Graph and Twitter tags; the landing and About
pages also carry JSON-LD (`WebSite`, `SoftwareApplication`, `Person` with `sameAs` links to GitHub and Ironbound). `robots.txt` keeps the archived `/v/<tag>/`
copies and `/data/` out of search results and points at `sitemap.xml`, a sitemap index of `sitemap-pages.xml` (the site build
dates its `lastmod`s from git; add a `<url>` by hand for a new page) and `sitemap-sky.xml` (the city sky pages, written at
each deploy; a project site's robots.txt is never read, so the index is how crawlers find them). `CITATION.cff` gives GitHub's
"Cite this repository" button; `LICENSE` (MIT) covers the code only, the data keeps its own licences (docs/DATA_SOURCES.md). The portrait is
`brand/about/destin-*.webp` (cropped from the owner's own photo).

## 2D map: modules (src/map/)
util (helpers, Store, Log/toast/Sound, Net + Relay, clock; `late` registry) · mapview (Leaflet map, base maps, Sun) ·
engine (Glyphs canvas renderer, Points, Layers registry + panel, feed scheduler) · detail (Detail panel, tracks, hover,
tabs/sheets) · aircraft · satellites (TLEs via src/core/tle.js) · feeds (all point/vector layers) · presets (views,
legend, Locate, Fun/ISS follow) · brief (Brief, Welcome) · audio · setup (Setup tab, Probe, search) · cities (bike share, live
transit) · hazards (fire hot spots, US perimeters) · measure (draw and measure) · share (links, hand-off to the globe) · weather (forecast
model layers, the timeline bar) · aviation (aircraft card extras, airports, boards, runways) · main (INIT, OW).
Modules import only from earlier ones; the five names used before they are defined (Sats, cableHit, Probe, Brief, Keys)
are read through `late.X`. OW_VERSION is a classic-script const in src/map/version.js (Publish Update.bat edits that line).
A hidden tab slows feeds by design (engine.js: each waits two extra intervals, so it runs at a third of its cadence; alerts
still arrive): drive them with OW.Sats.reload() or `runFeed` when testing in a background pane.

## 2D map: adding a layer (the contract the code enforces)
1. `Layers.add({id, group, name, desc, color, default, points})` before INIT. `group` must be one of `UI.groups`
   or it never shows; keep `id` to `[a-z0-9_]`; `points` must equal the Points set id.
2. `Points.define(setId, ly.id, {minZoom})`, then `Points.set(setId, items)` in the fetch. Item colors must be `#hex`.
3. `feed(ly, {interval, fetch: async () => {...}, viewDependent?, minZoom?})`. The fetch must THROW on failure,
   set `ly.feed.count` itself, and must not set `ly.feed.status` / `nextAt` (runFeed overwrites them).
   Use `Net.json` / `Net.text` for every request.
4. `Detail.renderers[kind] = obj => html`. **Escape every upstream string with `esc()`** — `Detail.kv` values and
   the `Detail.head` sub-argument go into innerHTML raw. Check link schemes with `isHttp()`.
5. CORS-blocked source: add the host to `NEEDS_RELAY` (src/map/util.js) AND `ALLOWED_HOSTS` in serve.js AND serve.py
   (the download's helpers). For the website too, if the feed's terms allow relaying: `TTL` and `PATHS` in
   relay/worker.js AND `PUBLIC_RELAY_HOSTS` in src/core/relay.js, then a Worker redeploy (the owner's OK). Six lists in
   five files; test/relayhosts.test.mjs checks PUBLIC_RELAY_HOSTS = the Worker's TTL and PATHS hosts,
   PUBLIC_RELAY_HOSTS ⊆ NEEDS_RELAY ⊆ both helpers, serve.js = serve.py, and that every NEEDS_RELAY host is one
   something in src/ fetches, except the four camera-still hosts (the feeds name them) and its `planned` list of hosts
   relayed ahead of their loader (now www.tsunami.gov).
   PATHS must cover every URL the client sends for a carried host: a path outside it gets a 403 'path not on the relay
   allowlist', which the client treats as an ordinary error (only 'host not on…' stops the host).
6. A feed the website can't get (Net.fetch throws an error with `notCarried`: no relay carries the host, or the deployed
   Worker answered 'host not on the relay allowlist', core/relay.js `relayRefused` + `markNotCarried`) stops for the
   visit: runFeed logs one warning, schedules no retry and skips it on pan nudges. A later success (a custom relay in the
   Setup tab) or switching the layer off and on clears `f.notCarried`. The first `air_*` layer that stops this way logs
   "No live aircraft on the website: they need the free download" once (`Feeds.airNotCarried`; main.js's boot line sets
   the same flag). The refused set is per host and in memory only, so the next visit asks again.
Moving objects: `Movers.define(id, { layerId, kind, minZoom, at(o, now, out), glyph, tip, label })` (engine.js) draws a Map
the feed fills, placed by its own motion model each frame (transit uses it); aircraft and ships keep their own branches.
A top-level exception anywhere aborts INIT, so test every new layer in the browser.

## Feed status as of 2026-10-02
The 2026-10-01 review's confirmed issues (notes/review-2026-10-01.json) were worked through on 2026-10-02: all fixed
except the antimeridian handling for point layers (design change) and a separate static-layer canvas (refactor).
Feeds now: IR clouds = NASA GIBS band-13 clean IR from GOES-East/West + Himawari (no Meteosat: no Europe/Africa);
RainViewer radar maxNativeZoom 7; submarine cables live from submarinecablemap.com via the helper (GitHub copy as
fallback); GDACS paged (up to 1000 events); radio-browser hosts all/de1/de2; GDELT not relayed (rate-limit replies
arrive without CORS and are reported as such); airplanes.live only when picked (403 without permission); CelesTrak
`noaa` group gone (in `weather`), `last-30-days` often has no TLE-format data (new catalog numbers outgrow TLE).
Helpers (serve.js/serve.py) are locked down: Host check, /proxy only for the helper's own pages, no ACAO, each
redirect hop re-checked against the allowlist. Keep their allowlists = NEEDS_RELAY (+ old hosts for archived pages;
test/relayhosts.test.mjs checks since 2026-10-17).

## Blender (for 3D assets)
- Production renders run HEADLESS via the launcher (blocks, returns the exit code, but stdout is lost: log to files).
  Shared helpers: brand/tools/bl_common.py (5.2 compositor/VSE API notes inside). AgX whitens strong emission; the
  video encode uses the Standard view transform so footage colours pass through.
- The Store build is sandboxed: its writes under %LOCALAPPDATA% land in
  %LOCALAPPDATA%\Packages\BlenderFoundation.Blender_ppwjx1n5r4v9t\LocalCache\Local\…; use a work dir outside AppData
  (lander_hero.py uses ~/open-overwatch-work).
- Blender 5.2.2 is the Microsoft Store build. `blender.exe` can't be launched directly (Access denied);
  use the alias `%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe` (e.g. `-b --python-expr "…"`).
- The Blender Lab "MCP" add-on (v1.0.3) is installed and enabled, with online access on. With Blender open it
  listens on 127.0.0.1:9876; the Claude "Blender" desktop extension connects to it.
- The map is 2D, so 3D work goes in as pre-rendered icons/sprites, branding/promo renders, or a separate
  3D globe view (Three.js/CesiumJS + .glb models).

## Traffic (src/globe/traffic.js) — 2026-10-10
- The cars are simulated and every label says so: no open feed gives individual vehicles. Real numbers only where a
  city publishes them: NYC DOT link speeds (~2.5-3 h late, shown with their age) and Fintraffic sensors (speeds and
  counts per direction; direction 1 = the station's `bearing`). They set the cars' speed and, with a count, how many.
- Roads come from OpenFreeMap's vector tiles, not Overpass: on 2026-10-10 overpass-api.de answered 504 to about half the
  road queries, kumi.systems answered 500 to everything, and error answers carry no CORS headers (they show up as
  "Failed to fetch"). A public CDN with versioned tiles is the polite choice for a website (GEV was asked by OSM Germany
  to slow down). curl gets 406 from overpass-api.de; browsers are fine (don't disguise curl).
- Vector tiles have no node ids, lanes, speed limits or signals: junctions are shared vertices (a street ending between
  another road's vertices gets one inserted, same level only), tile seams are joined within one unit along the edge,
  lanes and speeds come from the road class, and lights go where two tertiary+ roads meet or a secondary+ road crosses
  anything (Manhattan comes out right). The street grid's main bearing (27.5° measured for Midtown; ~29° real) sets
  which approaches are green first; a green wave runs along it at ~40 km/h.
- Cost: a z14 tile is ~0.7 MB (every layer; we decode two in ~2 ms), preparing it ~30 ms once; join + graph ~3 ms a
  tile. 2,450 cars cost ~1.2 ms a frame on the RTX 3060 (138 vs 165 fps); phones cap at 600 cars and 4 tiles.
- Drawing: car sprites (top-down, nose along the segment via `alignedAxis`, brake lights) within 1.4 km, glowing dots
  beyond 1.1 km coloured by the last ~8 s of speed; measured roads as coloured lines beside the traffic.
- Other OpenStreetMap layers (mapped cameras, buildings, a projected camera's street) share one polite Overpass client
  (src/globe/overpass.js): one request at a time, a pause as long as the last request took, the fastest healthy server.

## 3D terrain and aircraft motion (terrain.js, aircraft.js) — 2026-10-10
- Terrain: Re:Earth's keyless quantized mesh (Mapterhorn + EGM2008, ellipsoid heights, vertex normals; the globe's own
  lighting stays off below ~20 km, so close up the photo's shading carries the relief). A layer: desktop on, phones off.
- `globe.getHeight` costs ~0.8 ms a point (it intersects the drawn tile's mesh): never per car or per plane. Exact
  heights come from `sampleTerrainMostDetailed` in batches of 500 and are kept per rounded point (Terrain.ground);
  coarse ones (level 9) keep far or low things out of hills without pulling detailed tiles for a whole country
  (Terrain.near); the ground under the camera is the stand-in until an answer arrives.
- Roads get a point every 25 m on terrain (core densify): cars on Russian Hill went from -22..+19 m off the ground to 99%
  within 3 m. Parked planes at Denver: exactly +2 m (they were 125 m under the airport when read from coarse tiles).
- Jumping the camera to a new place with terrain on can cost one 200-370 ms frame (Cesium compiling terrain shader
  variants the first time); later jumps are smooth. Steady state ~90 fps vs ~150 flat on the RTX 3060 (low, oblique).
- Plane icons: `alignedAxis` = the course as an Earth-fixed unit vector (Cesium 1.146 turns it into eye space every
  frame: `czm_modelView3D`), rotation 0. Checked with labelled rings top-down and at 45° pitch; small crops of tilted
  views are easy to misread (check with labels).
- Motion: OpenSky fixes are dead-reckoned from `time_position`, not the snapshot time; adsb.lol from `now - seen_pos`.
  A turn rate from two fixes 2-120 s apart (0.4-4 deg/s) curves the next 2 min. A new fix that disagrees with the drawn
  position is eased in (tau = distance / 300 m/s, 0.8-6 s; not over 50 km), heading too. Geometric altitude (OpenSky
  `geo_altitude`, readsb `alt_geom`) is used as an ellipsoid height when present.

## Weather timeline, battery saver, voice (weather.js, wind.js, model.js, saver.js, voice.js) — 2026-10-11
- GFS straight from the browser: `noaa-gfs-bdp-pds` on S3 sends CORS * and allows the `Range` header (preflight answers
  `range`), and its 404s carry CORS too. Each forecast hour's `.idx` (~40 KB) gives byte offsets; U and V 10 m are
  neighbours, so one range fetches both (158 KB). No build step was needed (the study had planned a GitHub Action).
- NCEP packs every field we use with GRIB2 template 5.3 (complex packing, second-order spatial differencing, 13-ish
  bits, no bitmap). core/grib2.js matched eccodes (pip `eccodes`, a dev check only) to 9e-7 on all five fields;
  test/grib2.test.mjs carries its own small encoder instead of a data file.
- The run to read: newest first from 3.5 h after the run starts, accepted once the last hour we show (f120, f072 on
  phones) exists. A newer run replaces it every 6 h (checked every 20 min while weather is open).
- Weather mode opens on the pictures without waiting for the run (`Weather.adoptRun` adds the forecast later): a failed
  fetch to a bucket is retried like S3's CORS-less "503 Slow Down" (wxload.js runComplete, 8 tries, 4 runs, then the
  other model), so an unreachable S3 kept the panel on "loading…" for minutes (the e2e weather test caught it).
- Weather mode sets the globe's clock (paused at the moment; live again on the newest observed frame or on close), and
  follows `Time.onChange` and a running clock: watch `selfClock` / `following` so the two don't chase each other.
- The battery saver uses Cesium's `targetFrameRate` (cheap idle RAF ticks), not `requestRenderMode`: every per-frame
  updater keeps working, just less often. The quality auto step-down must ignore those slow frames (it did not at first).
- Push-to-talk ignores Space on buttons (a focused chip would also be clicked) and in text fields.

## Weather 2.0: ECMWF, pressure, gusts, waves (model.js, wind.js, core/aec.js, jpx.js, contour.js, wxmodels.js) — 2026-10-12
- ECMWF open data on AWS (`ecmwf-forecasts`, eu-central-1) sends CORS * and allows `Range`, like the GFS bucket; each
  step's `.index` is one JSON object a line (`_offset`, `_length`), turned into `.idx`-shaped rows so `idxRanges` serves
  both. Only the 00/12 UTC runs: 06/18 are the `scda` stream and stop at +90 h. A run is complete ~7.5 h after it starts.
- That bucket sheds load with **503 Slow Down, sent without CORS headers**: in a browser it is a plain "Failed to fetch".
  When a run was new, 3-4 requests in 8 got it. The worker retries (backoff, 8 tries) and runs at most 4 requests at a
  time; the run probe retries too, else it wrongly falls back to an older run.
- ECMWF packs with CCSDS (GRIB2 template 5.42, libaec): `core/aec.js`. Details the standard leaves to libaec: the
  zero-block "rest of segment" code (fs+1 = 5) means min(blocks left in the interval, 64 − b mod 64); larger codes are
  one less; the second extension's first pair in a reference block has an implied 0. Flags 14 = MSB | 3-byte | preprocess.
- NOAA's WAVEWATCH III (GFS-Wave, same bucket as GFS) is JPEG 2000 (template 5.40, JasPer): `core/jpx.js`. With a
  bitmap the image is ONE ROW of the packed points (568,137 × 1), so its width exceeds the default precinct (2^15):
  dozens of precincts per resolution, and LH/HH bands are empty. eccodes' "lossy" JPEG is reversible 5/3 cut short:
  reconstruct each coefficient at the middle of its own last decoded plane (as OpenJPEG does), not one plane for all.
- Field codes: ECMWF cloud is a local fraction (0.6.192, ×100), rain rate is 0.1.52, `10fg` is the strongest gust in
  the hour before the step (template 4.8: forecast time = step − 1), `msl` is 0.3.0 against GFS's `PRMSL` 0.3.1; its
  grid starts at 180° E. ECMWF has no gusts or rain rate at step 0: a kind missing from one hour takes the other's.
- Both decoders equal eccodes (pip `eccodes`, a dev check) on real fields: CCSDS exactly (~80 ms a 0.25° field in
  Node), JPEG 2000 to float32 rounding (~200-360 ms). test/fixtures/wx holds small messages eccodes wrote, with sums
  and samples of eccodes' own decoding.
- Volume: ECMWF at 0.25° is ~0.5-1.3 MB a field (~6 MB an hour with every layer); the worker thins it to 0.5° (1° on
  phones) before handing it over. Waves are ~1.3 MB an hour either way.
- Isobars: blended in time, averaged to 1° first (a 0.25° field wiggles over every mountain), every 4 hPa from 1000,
  heavier every 20, labelled along the lines; H/L are points highest/lowest within 9° that stand 2.5 hPa off the rim's
  mean. Drawn into a clear image so the split works; the H/L labels aren't imagery, so a postRender hook shows each
  model's only on its side.
- Side by side: every wash is two imagery layers with `splitDirection` LEFT/RIGHT at `scene.splitPosition`; a wind
  streak takes the model of the side it was on last frame. The before/after slider (imagery.js) uses the same
  `splitPosition`; don't run both at once.
- Editing on Windows: Python's text mode writes CRLF; use `open(..., newline='')`, or the MCP test that reads
  weather.js's `sets:` line (and others) fails.

## More live feeds (ships.js, bikes.js, transit GTFS-RT, cams live video) — 2026-10-11
- A Primitive's geometry is baked into world coordinates (and projected for 2D) unless the viewer is `scene3DOnly`, which
  ours isn't: a unit quad in model space crashes `projectTo2D` (points near the Earth's centre). Ship hulls and wakes are
  built where the ship is and moved by `modelMatrix = (transform now) × (transform at build)⁻¹`.
- core/mvt.js `skip()` had `this.p += this.varint()`, which adds to p as it was before the length: off by the length's own
  bytes. Map tiles never skip a length-delimited field; a GTFS-RT header does at once.
- CapMetro: `data.texas.gov/download/…` answers 302 without CORS. The dataset's metadata (`api/views/eiei-9rpf.json`,
  CORS) names the current `blobId`; `api/views/eiei-9rpf/files/{blobId}` is CORS * and never changes (a new id each update).
- Live video: DelDOT (Wowza), Iowa (MediaMTX fMP4 on :8888), Vegvesen and MoDOT send CORS on playlists and segments. An MSE
  video (hls.js) is a fine WebGL texture. One `Live` stream is shared by the card and the projection; moving a `<video>`
  between parents pauses it (the HTML rule for a removed media element), so it resumes itself on 'pause'.
- Stills without CORS (Vegvesen, Iowa, Calgary, Singapore) show in the card without `crossorigin` and project only
  through a relay: the local helper, or on the website the public relay (its PATHS take each agency's still URLs; Iowa's
  rule takes /snapshots/ or an image name, because its list was empty on 2026-10-17 and no live ImageURL could be seen).
- CityBikes: 300 requests an hour per address (`ratelimit-*` headers); `?fields=` trims the answer; times look like
  `…+00:00Z`; some systems' feeds stopped months ago (their last numbers stay): greyed after 2 days.
- AIS: positions are the antenna's (A to the bow, C to port: the hull is offset); ROT_AIS = 4.733 √(°/min); heading 511
  and course 360 mean none; the ETA has no year. Digitraffic `?from=<ms>` returns only what changed (~270 a minute).

## Hazards and imagery (storms.js, fires.js, imagery.js) — 2026-10-11
- NOAA's tropical map service is CORS-open (it echoes the origin) and carries everything NHC's KMZ files do, as
  GeoJSON: join layers by the storm id in `idp_source` (ep202026) and refuse to draw a cone whose advisory differs from
  the points' (mid-update mixes). GDACS fills every other basin (JTWC etc.); its geometry is ~0.4 MB per storm (wind
  buffers we don't draw), cached per episode. Match storms by name first: EONET's last fix can lag 300+ km.
- Keyless FIRMS: GIBS serves VIIRS thermal anomalies as Mapbox vector tiles, but only in the EPSG:4326 `500m` set
  (288° level 0); the 3857 paths 404. Tiles come gzipped with no Content-Encoding (DecompressionStream in a worker);
  a date with no data yet is a 404 without CORS, which fetch reports as a network error. A 36° tile in Africa's burning
  season: 0.5 MB gzipped, 14,400 detections.
- NIFC perimeters are MultiPolygons with hundreds of spot-fire rings: as entities that was 8,438 objects (too slow to
  appear); now two batched ground primitives (fills, outlines) with instance ids for picking.
- CMR: the CSV form at a point is the light one (150 KB for 3 months vs ~0.7 MB per 50 granules as JSON). The first
  pair is the newest fairly clear picture against the oldest clear one at least two weeks earlier.
- Picking an entity drawn for an object: `entity.obj = object` (ui.js pickObj).
- 2026-10-17 (core/cyclones.js loadCyclones, the globe and the 2D map): only NHC's tau-0 point (or one with no tau)
  moves a storm, sets its wind and counts as NHC's report. Without it, a new storm starts at the cone's corner, or the
  forecast only joins a storm of the same name. The points layer asks for `idp_filedate`; ArcGIS answers a field it
  doesn't know with a 200 and `{ error }`, so loadCyclones asks once more without it (`fldatelbl` still gives the
  advisory time), and a layer that still errors warns 'NHC forecast layer <id>' instead of quietly drawing no storms.
  GDACS's forecast is skipped only for storms that actually got a NOAA forecast (`fc.src === 'NOAA NHC'`). Worth a live
  look after a publish: a layer-5 query with idp_filedate should still return features.

## Draw and measure (measure.js, core/measure.js) — 2026-10-11
- Distances: Vincenty's inverse and direct formulae on WGS84, within 0.08 mm of GeographicLib 2.1 (Karney; pip
  `geographiclib`, a dev check only, its values pasted into test/measure.test.mjs) on 4,000 random pairs. Vincenty's
  longitude iteration runs away within about a degree of the antipode (196 of 2,000 such pairs): those are solved by
  halving the starting bearing in Karney's set-up (point 1 nearer a pole, moved south, longitude difference positive,
  first northward crossing of point 2's latitude: the longitude reached grows with the bearing). Exactly opposite points
  are half a meridian apart (20,003,931.459 m). Lines along the equator are a special case for the bisection.
- Areas: every geodesic edge split each 20 km along itself, then the exact great-circle excess on the authalic sphere
  (R 6,371,007.18 m, latitudes mapped so areas keep), Karney's tan(E/2) per edge; a ring round a pole is put right by
  how many times it winds round (the sum of its longitude steps). Worst of 400 random polygons: 3.4e-6; the 195 country
  outlines: 2.5e-6. Two float traps: adding 4π to a small area kept only its first digits (5e-5 off on a 1,650 m²
  sliver), and wrapping a longitude difference by adding 180 first cost a 0.0035° step its last digits (0.06 m² steps).
- Cesium 1.146: draped (clampToGround) polylines and ground polygons are not pickable here (pick and drillPick find
  nothing on them, terrain on or off); corners and labels are, so they carry `entity.obj` (tip, cardHtml, afterCard)
  and ui.js opens a shape's card from them. `PolylineArrowMaterialProperty` on a draped line draws only the shaft (30% of
  the width): the head is a billboard with alignedAxis = the arrival course (core/geo `courseAxis`), its tip at the end.
- Entities are made once per part and moved in place: re-creating a draped line on every click made it flicker. The
  rubber band to the pointer is an undraped geodesic polyline (CallbackProperty, depthFailMaterial), mice only.
- Labels and corners skip the depth test (hills would hide them), so a 4 Hz `EllipsoidalOccluder` check hides the ones
  behind the Earth.
- Clicks: Google's 3D city → `scene.pickPosition` (one depth read per click; viewer.js's pickPositionSupported = false
  only stops the camera controller's reads), 3D terrain → `globe.pick` (CPU, the drawn tiles), else the ellipsoid.
- A quick (under 0.5 s) second click or tap on the last point is the double-click that finishes; a slow one is a point
  placed close by (at first a phone corner 16 px from the last one ended the area).
- Phones: while a tool is armed the card is one slim strip just above the dock: the shape in hand (or what to tap) in
  two lines, Undo, Finish, and a chevron for the rest; picking a tool or tapping the globe folds it back. In WebKit's
  iPhone 15 profile (Playwright, a 393x659 Safari viewport) the strip is 52 px: card and dock cover 21% of the screen,
  where the full card, then a compact one (tools, hint, readout, buttons: 202 px), left 46%. The two small icons are
  SVG (WebKit drew the ↶ and ▴ characters tiny and faint). Flights to a shape leave room for the card. Checked with real
  WebKit touch taps (`page.touchscreen.tap`, brand/tools/_steps/ms_webkit.mjs) and Chromium at 390x844.
- Over the ground: finished lines up to 30 km on 3D terrain, at most 300 heights (Terrain.heights, the most detailed
  tiles): length with the hills (Google Earth's "ground length"), climb and descent.
- Voice "from A to B" takes the two best Photon matches unless one of them is much nearer (3x) another candidate of the
  other (core `choosePair`): the routes' closest-pair rule suits "Big Ben to the Tower of London" but could turn "Paris
  to Berlin" into Paris, Maine and Berlin, New Hampshire. "How far is the Moon / the ISS" answers without drawing.
- Test input: Cesium's pointer handling calls setPointerCapture, so a synthetic touch needs pointer id 1 (the mouse's;
  brand/tools/_steps/ms_common.js).
- Share links and embeds carry the drawing (`&d=`, core/measure.js encodeDrawing / decodeDrawing via core/viewlink.js):
  each shape's points as steps of a millionth of a degree (~0.1 m, so the numbers come back the same) in zigzag varints over
  the base64url alphabet (polyline-style, but with no character URLSearchParams escapes), custom names as base64url UTF-8,
  a distance's road as a flag (OSRM is asked again on arrival), outlines as ISO codes. A named pin, a 4-point line, a named
  distance by road and France: 109 characters; 512 far-apart points still fit (≤ 9,000). Each part is checked on its
  own and dropped if it fails (counts, ranges, 7-character numbers, names without control or direction-flipping
  characters); names are text everywhere (the card escapes them). On arrival the card opens on desktops (not in embeds,
  not over a country or flight card the link opens); phones get a toast, as the card would cover the drawing.
- Not done: states and provinces ("outline Texas" needs a boundary dataset: the user's OK to download), dragging a
  corner to edit.

## Aviation (acinfo, aircard, trails, cockpitwx, airports; core actype, aloft, airports, trail) — 2026-10-12
- One import in main.js (`aviation.js`); ui.js calls `hooks.airCard(o, card)` for aircraft cards; aircraft.js calls
  `hooks.airFix(r)` on every upsert (trails record it) and classifies with core/actype.js (`airClass`: the designator,
  then adsbdb's words, then the readsb emitter category, then slow-and-low = light). The class picks the sprite and the
  glTF shape plus a scale (business jet = airliner x0.5, regional x0.78, turboprop = the tprop model x0.8): no new models.
- adsbdb: CORS `*`, keyless, rate-limited per IP (429 body "rate limited for N seconds"). Its route data may not be
  copied into other databases: browser cache only, never in the repo or a mirror. A route is a callsign's usual
  route: `routeFit` (inside the 1.2x ellipse + 150 km; heading within 70° of the destination when far from both ends)
  labels a mismatch instead of trusting it. Live: a 777 under a DEN-LGA callsign was flagged; ASA400 "SEA-BNA" flying
  north near Eugene passed at 100° (98° off), hence 70°. The route arc (routeline.js) is drawn only for a route that fits.
- Boards (core/airports.js `boardStatus`): within 90 km and 7,500 m above the field. Arriving = descending (< -1 m/s),
  within 55° of pointing at the field and under a lax glide (120 m + 330 m/km), or in the circuit (< 12 km, < 900 m).
  Departing = climbing and pointing away (or in the circuit), < 6,000 m, < 70 km. Ground = on the ground within 5 km
  (taxiing over 3 m/s). A route on file naming the airport makes a level plane in the hold count; one naming other
  airports drops it. A plane goes to the airport it fits best (score = km x (1 + degrees off / 45)), so Heathrow and
  City, or Denver and its neighbours, don't count the same plane. ETA: along-track distance / ground speed, nudged by
  the descent rate. A route is named on a row only when it names this airport at the right end (since 2026-10-13: before, any route not
  contradicting the board was, and a JFK arrival flying an LGA-ATL callsign showed "from LGA").
- Cockpit weather: the barometric altitude as an ISA pressure altitude picks the two Open-Meteo levels around it
  (1000..30 hPa), interpolated in log-pressure, wind mixed as vectors (350° and 10° make 0°). TAS = |ground velocity -
  wind velocity| (the feeds have no heading), Mach from the OAT. Open-Meteo takes pressure-level variables in
  `current=`. The block sits under the HUD's top-left text (the card covers the right); on phones at 244 px from the top.
- Trails: OpenSky's 15-min snapshots are not recorded (straight lines through turns) except for a watched plane. One
  Cesium Primitive per drawn trail (PolylineGeometry, a colour per vertex, rebuilt at most once a second when it
  changed, plus the stretch to where the plane is drawn now). adsb.lol answered 429 to this PC while the pane polled
  every 5 s, so followed planes are polled every 10 s, others 20 s, with a 2-min back-off.
- Renders: globe_shot blocks the aircraft feeds, so the shots inject test planes (`src: 'adsb.lol (test fixture)'`);
  adsbdb and Open-Meteo answers in them are real. With other sessions rendering too, set `OW_WORK` to a folder of your
  own: cdp.mjs's orphan reaper in one run kills another run's Edge (headless Edge re-parents, so it looks orphaned);
  the symptom is "CDP connection closed" at a random step.
- Round 2 (same day): `routeline.js` draws a dashed great circle (core/phase.js `greatCircle`, continuous across the
  antimeridian) to the destination, holding the plane's height and easing down over the last 200 km, and a fainter one
  back to the origin, only while the route fits. `landwatch.js` watches planes from their cards (pinned trails keep them
  polled) and notifies through alerts.js: on final (core flightPhase), on the ground (and where), or lost low near a
  field. Boards' "just landed / took off" comes from `r.was` (aircraft.js keeps the fix before) via core `recentMove`;
  a plane that just landed is listed there and not again under "on the ground". `towerview.js`: eye 45 m over the field
  (over Terrain.near when terrain is on: OurAirports elevations are above sea level, Cesium heights above the
  ellipsoid), camera set every preUpdate, fov = 3 x the angle of 90 m at the plane's distance (0.6-60°), wheel/pinch
  zoom; `hooks.towerAir` keeps the plane's model alive in AirModels.refresh. Airport weather: Open-Meteo surface values
  in knots, cloud base estimated from the temperature/dew point spread (400 ft per °C) only under ≥50% low cloud, FAA
  categories from that and the visibility: labelled estimated.
- Runways (`runways.js`, core/runways.js): headings from the two thresholds (OurAirports' le/he coordinates), lined up =
  within 20 km of a threshold, before it, within 1 km of the centre line (4° further out), tracking within 20°. The
  runway in use: most arrivals lined up, else most headwind when the wind is 5 kt or more. data/runways.json matches
  runways by OurAirports ident (= ICAO for 4,016 of the 4,579 fields). Checked with a test arrival on Denver 34R.
- The pane only renders while it is shown: a hidden pane runs no preUpdate (tower view, cockpit, trails look frozen).
  Check such things with globe_shot instead. Reloading the pane often earned 429s from adsb.lol's /mil.
- The scene renders on request: in the pane, call `scene.requestRender()` before trusting a screenshot of a change, and
  `viewer.clock.currentTime` lags the wall clock while idle (it ticks only on rendered frames). The violet vertical
  lines over cities are the Big-employers towers (Michelin at Clermont-Ferrand), not a stray polyline.

## Airport weather, estimates and runway history (fieldwx.js, fieldwatch.js; core metar, eta, runwaylog) — 2026-10-13
- aviationweather.gov's data API sends no `Access-Control-Allow-Origin` (GET and OPTIONS checked 2026-10-13), so METAR
  and TAF are download-version only, relayed by serve.js/serve.py (`aviationweather.gov` added to both; not to the
  public relay; the 2D map's NEEDS_RELAY got it later, with the map's airport cards: see "The 2D map catches up,
  round 2"). The website keeps the Open-Meteo line and says why. api.weather.gov does send CORS, but its `rawMessage`
  was empty for KDEN's latest observation, it has US stations only, and its TAFs are IWXXM XML: not worth a second decoder. A bbox METAR query over the US timed out (504);
  `ids=` lists of 60 answer in ~0.2 s, so the dots ask by id for the fields in view (`AirportIndex.inBox`, large first).
- The decoder (core/metar.js) works on the raw text, never AWC's decoded fields, so the same code would read any METAR
  source; the tests check it against AWC's decode of the same reports. Differences that are representation, not error:
  AWC gives no category without a sky group (we follow, except when the visibility alone says IFR or worse), AWC writes
  VV as `OVX`, and AWC's TAF periods carry earlier values forward (BECMG) where ours keep what the group says;
  `tafAt` does the carrying. The RMK T-group (tenths) wins over the whole-degree temperatures, as AWC does. `INTER`
  (Australia) is read as a TEMPO; `VV///` as a hidden sky of unknown height (ceiling 0, LIFR).
- Estimates (core/eta.js): the path is the distance to the threshold when lined up (core/runways.js finalFor), else the
  distance x1.08 + 8 km to join the final + a turn penalty past 30° off; speed falls linearly with distance to an
  approach speed by class (D ln(v0/v1)/(v0-v1)); a steady descent rate pulls by at most -30%/+40%. High on final keeps
  the short path but widens the top (it may go round). The range is the honest part: -15/+20% on final, -25% / +35%..
  +120% elsewhere, plus 30 s either way. First live hour at KDEN (north flow, IFR): 23 estimates for 11 landings, 18
  inside their range, median miss 38 s; the 50 km band's 4 came in ~2.7 min early (straight-in from the south, shorter
  than the joining allowance). EtaLog widens a field's ranges when under 60-80% land inside, narrows over 95%.
- Fresh fixes: the globe's civil traffic is OpenSky's 15-minute snapshot, too sparse for touchdowns, so an open airport
  card (and up to 3 "Keep watching" fields) polls adsb.lol `/v2/point/lat/lon/40` every 15 s, adsb.fi on failure. The
  first poll from this PC got a 429 from adsb.lol (other sessions were polling it too); the next went through. Those
  fixes go through Air.upsert, so trails record them like any adsb.lol fix (Trails.record skips only OpenSky).
- Runway history (core/runwaylog.js): every 10 s, trails whose points changed are read for ground/air changes; the trail's
  last point waits for the next to confirm it, and a single-fix flicker of the on-ground flag is ignored (seen live:
  MAI293 "landed" and "took off" on 07 in the same second). Landing runway = votes from the last 5 minutes of airborne
  points lined up (linedUp with the track between points) + 2 for the touchdown on a runway's centre line moving its
  way; take-off = points on the centre line beyond the runway moving its way. Moves are put at the nearest airport within
  6 km, so the 40 nm poll around DEN also logs Buckley, Centennial and Rocky Mountain Metro. Flow change = 2+ on the new
  direction (runways within 45° count as one flow: 34R/35L) after 2+ on the old, with the new direction at most a quarter
  of the moves before (Denver departs on 25 and 08 at once: the first live run called that "moved from 08 to 25"). Live at KDEN, 15:18-15:27Z: arrivals
  34R/35L/35R, departures 25/08 (matches Denver's north-flow plan), ~25 events in 10 minutes.
- MCP `airport_weather` (mcp/airportwx.mjs): Node has no CORS, so it asks AWC directly and decodes with the same
  core/metar.js; the favoured runway is the most headwind from the METAR's wind (said to be the wind's choice, not the
  tower's). Checked live for LHR, JFK and Tokyo (Haneda, the largest). Voice: `airwx` in core/voicecmd.js only fires
  on METAR/TAF/flight-category words or "... airport", so "weather in Paris" stays the weather view.
- Renders: `brand/tools/airport_wx_shot.mjs` (desktop and 390x844) injects TEST1xx planes and runway events (the render
  blocks the aircraft feeds); real callsigns there pulled real adsbdb routes naming other airports, which drops them
  from the board (routeOther), hence the TEST callsigns. METAR/TAF/dots in the shots are live AWC.

## Public relay (relay/, Cloudflare Worker) — 2026-10-10, updated 2026-10-17
`relay/worker.js` on the owner's Cloudflare account (`npx wrangler deploy` from relay/, after `npx wrangler login`; a
redeploy needs the owner's OK): https://open-overwatch-relay.destinjones123.workers.dev/?url=… . Allowlist =
`PUBLIC_RELAY_HOSTS` in src/core/relay.js = the Worker's TTL table (eleven hosts: NOAA NHC, NYC DOT cameras,
submarinecablemap, the BC and Missouri camera lists, four agencies' stills (Norway, Iowa, Calgary, Singapore), NOAA NDBC
for buoys and DART, and tsunami.gov), each host limited to its feed paths (PATHS in worker.js), an Origin header required
(the website, or localhost:8787 / 127.0.0.1:8787 for testing), GET only, redirects re-checked, a fixed Accept (a
forwarded one let anyone poison the shared cache with DriveBC's HTML rendering: 2026-10-11 review), HTML and error
answers never cached, a 30 MB cap counted on the stream, `Access-Control-Allow-Origin` fixed to the published site,
test/relay.test.mjs exercises it with a stand-in upstream. Rate limiting per address: not a WAF rule (the relay lives
only on workers.dev, which has no zone for one) but a Workers Rate Limiting binding in relay/wrangler.toml
(`[[ratelimits]]`, as mcp-worker/ has), checked per `cf-connecting-ip` after the allowlist; its deploy waits for the
owner. Workers Cache in front (works on the free plan: `CF-Cache-Status: HIT`; per-host max-age in TTL).
The ADS-B networks and OpenSky refused Cloudflare's servers on 2026-10-10 (adsb.lol 429, airplanes.live / adsb.fi /
adsb.one 403, OpenSky timeout); don't disguise the relay to get past that. adsb.lol's API terms say a key (given to feeders)
is coming.
- 2026-10-15, live aircraft on the website: tried and rolled back. Terms checked: OpenSky's (opensky-network.org/about/
  terms-of-use): non-profit research and education only, 3(iii) no making the data available to others, and "Operational
  use of the REST API in any live product, service, or automated system also requires a written license": not relayed,
  not even cached (ask OpenSky for a licence to change that). adsb.fi: "personal, non-commercial use only", 1 req/s;
  airplanes.live: written permission; adsb.one: 403. adsb.lol: ODbL 1.0, "The API is available to everyone", dynamic
  rate limits, a feeder key later. A Worker relaying adsb.lol's shared queries (`/v2/mil`, squawks, `/v2/point` on the
  fixed grid of src/core/airgrid.js) was deployed that day and rolled back: adsb.lol answers Cloudflare's servers with
  429. None of api.adsb.lol, opendata.adsb.fi, api.airplanes.live, api.adsb.one sends CORS headers (checked 2026-10-15),
  so the website has no live aircraft; the download asks them through its local helper from the visitor's own address.
- 2026-10-17, what the Worker carries now (redeployed that day): the eleven hosts above and no aircraft feed. The adsb.lol
  rules are gone from worker.js (it no longer imports airgrid.js; test/relayhosts.test.mjs fails if an aircraft host or
  airgrid comes back). airgrid.js stays as the shared tiling of the 2D map sweep and the globe; its `adsbLolTtl` and
  `adsbLolRelayable` are kept for a future relay that can reach adsb.lol and only the tests use them. On the website the
  pages send no aircraft request at all: `publicRelayable` is false for those hosts, so the globe's `getJSON` and the map's
  `Net.fetch` (without a custom relay) throw `notCarried` before fetching; the globe's layers say "download version" and
  the map logs one line (rule 6 of the layer contract; the globe notes of 2026-10-17).
- 2026-10-17, one request form: the Worker accepts only `PUBLIC_RELAY + encodeURIComponent(new URL(feed).href)` (core
  relay.js `relayUrl`, which every client uses), optionally followed by `&t=<digits>` (a camera still's minute,
  core/cameras.js `bustUrl`), and no query string or fragment on the target itself. Any other spelling (extra or
  reordered parameters, a re-encoded or upper-case target) gets a 400, since each would be a separate entry in the shared
  caches. A carried host asked for a path outside PATHS gets 403 'path not on the relay allowlist: <host>'; only 'host not
  on the relay allowlist' reads as `relayRefused`, so a stray path never stops the whole host for the visit.
- 2026-10-17, two caches: Workers Cache in front (keyed by the raw request, t included; its hits never reach the code) and
  `caches.default` inside, keyed by the canonical target without t, so every minute's still URL would share one copy.
  The inner Cache API only takes effect on a custom domain or route; on *.workers.dev it does nothing and the front cache
  alone shares (a still asked with each minute's t then costs one upstream fetch per camera per minute, as before). To see
  whether the inner cache works: ask the same NDBC or camera target twice with different t; a fast second answer (or a
  cf-cache-status header) means it does.
- Budget: the free plan's 100,000 Worker requests a day (cache hits may count) is ~70 a minute across every relayed feed
  (NHC, cameras, NDBC buoys/DART, cables; www.tsunami.gov is allowed but nothing asks for it yet); when it runs out
  they all fail until midnight UTC. Workers Cache is per data centre, so "one upstream request per interval" is per
  Cloudflare location. Watch the Worker's request graph after advertising; Workers Paid ($5/month, 10 M requests) if needed.

## MCP server (mcp/) — 2026-10-11
- Layout: `server.mjs` (CLI, stdio) → `index.mjs` (assembly) → `protocol.mjs` (JSON-RPC by hand: initialize with version
  negotiation 2025-11-25 … 2024-11-05, tools, resources, cancellation, schema checks with gentle coercion) + `tools.mjs`
  (14 tools, each `{ text, data }` with `data.url`) + `place.mjs` (Photon areas, framing, links via core/viewlink.js) +
  `sats.mjs` (TLE groups from the site copy, SGP4 via satellite.js 5.0.0) + `feeds.mjs` (cache, stale-if-error, the
  CelesTrak block) + `panel.mjs` (the MCP App). The root package.json makes it an npm package (`files`: mcp/ + src/core/).
- Links from outside can't know a visitor's layers, so the link format grew `&a=` / `&x=` (layers on / off, the rest as
  they are) and `&s=` (a satellite to follow: selected once Sats.ready, followed if it has a 3D model, else flown to).
- A hash that changes in an open globe is applied again (main.js `hashchange` → Share.restore({ fly: true })): what the
  new link doesn't name goes back to a fresh page's state (live clock, weather closed, no country card, normal sensor),
  and the camera flies. The MCP panel moves its framed globe this way: no reload, ~2.5 s. Embeds post `{ type: 'oo:ready' }`
  to the page framing them once the link is applied (the panel lifts its veil on it).
- MCP Apps (spec 2026-01-26): the resource is `text/html;profile=mcp-app` with `_meta.ui.csp.frameDomains` naming the
  site's origin (without it hosts default to `frame-src 'none'`); tools name it in `_meta.ui.resourceUri` (plus the old
  flat `ui/resourceUri` key). Handshake: `ui/initialize` with `appInfo`, `appCapabilities`, `protocolVersion`, then
  `ui/notifications/initialized` and a size; results arrive as `ui/notifications/tool-result` (read `structuredContent.url`,
  only links on the site are framed); `ui/open-link` for the way out. Only show_on_globe opens the panel: a globe per
  answer would be heavy. Embed mode now hides the Ops rail too; the panel's buttons sit top left (the globe's own way out
  is top right). Tested with a stand-in host in headless Edge (brand/tools/_steps/mcp_host.html, gitignored) and the
  official TypeScript SDK client (validates every response).
- Weather links stay at ≥ 3,000 km: Weather.open() flies to the whole Earth from lower down.
- Sources' quirks: GDACS's severity is the strongest wind of the storm's life, not now (said as "strongest so far"); NHC
  `intensity` is knots and `movementDir` is where it is heading; SWPC Kp JSON is now objects (`Kp`, forecast `kp` +
  `observed`), the old array rows are read too; AIS ETAs more than a day old or two months ahead are placeholders
  (dropped); Photon extents are [w, n, e, s], and one spanning most longitudes (territories) becomes a circle.
- Publishing: `npm publish` from the repo root needs the owner's npm login (not done); the release workflow builds
  `open-overwatch.mcpb` (Claude Desktop's one-click install: manifest.json at the root, mcp/, src/core/, node_modules/
  satellite.js; ~320 KB) and attaches it to the release next to the zip.
- 0.2.0 (2026-10-12): 20 tools. The tools live in one file each beside tools.mjs (`cams`, `transit`, `fires`, `country`,
  `cables`, `solar`.mjs); shared formatting in `words.mjs`, the hazard feeds three tools read in `hazards.mjs`. The tools
  read the same shared core as the globe and the 2D map: cameras from core/cameras.js (plus camNetsNear, camsNear,
  imageType), transit from core/transitfeeds.js (plus HSL_PB, METRO_TRANSIT_PB, capmetroFile; core/transit.js hslRoute
  reads HSL's route ids), cables from core/cables.js, hazards from core/quakes.js, eonet.js and cyclones.js.
- Tools may return `images: [{ data, mimeType }]`: sent as MCP image content after the text. Camera stills are sniffed
  by their first bytes (an agency's "offline" page is HTML with a 200), at most 1.5 MB, base64 without Node's Buffer.
- feeds.mjs grew `bytes()` (pictures, GTFS-RT, gzipped vector tiles), POST bodies (Entur's GraphQL; the body is part of the
  cache key) and a byte cap. GIBS sends its tiles gzipped without saying so: unzipped with DecompressionStream.
- Streamable HTTP (`--http <port>`, mcp/http.mjs + http-node.mjs): stateless, so GET and DELETE answer 405 (no event
  stream, no sessions) and notifications 202; one message per POST (batches 400). Host must be loopback (DNS rebinding),
  Origin loopback or listed; 406/415/413/400 as the spec says. http.mjs uses only Request/Response, so the same handler
  could serve from a Cloudflare Worker with `hosts: null` and its own auth (not deployed: the relay Worker is separate
  and redeploys need the owner's OK). A client that hangs up aborts its tool call.
- 0.2.0 also: `eclipses` (core/eclipselocal.js turns the Horizons tables Earth-fixed without Cesium: IAU 1976 precession +
  the four main nutation terms + GAST; within ~0.05° and a few seconds of NASA's circumstances), `distance` (choosePair, then
  each name asked again near the other when the pair is over 50 km apart, but a city is never replaced by a village or a
  shop of the same name, and a typed lat, lon is never second-guessed; the globe link carries the line as `&d=`),
  `volcanoes` (a town is a 60 km circle round it, a country its box), `road_speeds` (core/traffic.js parsers).
- Also `close_approaches` (data/socrates.json + SGP4 for where), `sun_and_moon` (riseSet at -0.833/-4/-6/+6/-12/-18°;
  the local day from Intl offsets; V8 rolls 2026-02-30 over to March, so dates are checked by round trip), and
  `meteor_showers`. Prompts (`prompts.mjs`, `prompts/list` + `prompts/get`): five requests that name only real tools (a
  test checks), arguments quoted as one cleaned line. `worker.mjs`: the server as a fetch handler, bearer token
  (MCP_TOKEN, 16+ characters, compared without early exit) or 503/401; Host check off, Origin check on. Not deployed.
- core/borders.js: Russia's mainland ring (and Wrangel Island) crosses the antimeridian, so the flat even-odd test made a
  band round the world that claimed 40 of 196 grid points in Canada (the globe's country card too). prepare() now keeps
  an east-shifted copy of such parts (b.east) for inCountry; b.box is unchanged (mainBox and fly-to use it).
- HSL in the server is the GTFS-RT file, not the MQTT stream (no WebSocket in a one-shot answer); its route ids carry the
  line ("1055" = 55, "31M1" = M1, "3001R" = R train, 1001-1015 trams except bus 14).
- 0.3.0 (2026-10-13): the Worker (mcp/worker.mjs, config in mcp-worker/). Cloudflare's free plan: 10 ms CPU, 50
  subrequests a request, and **Cache API calls count against the 50** (a feed miss costs match + fetch + put). So the
  Worker makes a server per request (its own fetch counter, budget 45) over one in-isolate `memo` Map (parsed answers
  outlive the request), `createFeeds({ shared })` puts the Cache API in front of every GET for the feed's own ttl, and
  tools/call answers are cached by SHA-256 of [version, site, tool, sorted arguments] for CALL_TTL. Workers freeze
  Date.now during CPU work, so CPU can't be measured in the Worker: HEAVY comes from Node timings with the canned feeds
  (process.cpuUsage ticks at 15.6 ms on Windows; use performance.now with everything canned). claude.ai connectors take
  a URL and OAuth only, no custom header: the token rides in the path (/mcp/<token>, a wrong one is a 404); /.well-known/*
  answers 404 so OAuth discovery gives up. Rate limit = the `[[ratelimits]]` binding (period 10 or 60 s only).
  `npx wrangler deploy --dry-run` bundles it (479 KiB, 153 KiB gzip) and `wrangler dev` ran it in local workerd against the
  live sources; `wrangler dev` leaves workerd children holding mcp-worker/.wrangler on Windows (stop them by port).
- protocol.mjs imported node:readline for stdio, which would break the Worker bundle: stdio is mcp/stdio.mjs now, and a
  test walks the Worker's import graph (only satellite.js from npm, no node: built-ins).
- `where_in_space`: core/search.js's fuzzy index over the 28,000 named bodies costs ~0.7 s to build and ~0.9 s a query
  (edit distance on every miss): fine in the view once, too slow per call. core/whereis.js has a quick index (fold once,
  an exact-name Map, prefix/substring scan only without an exact hit): 50 ms to build, ~0 ms for an exact name. Asteroid
  elements come from the packed .bin by seven Range requests (column-major: a at 4i, e at 4N+2i, … cls at 14N+i); the
  small-body list loads only when no planet, moon or mission matches at 800+. constellations.json names are English
  ("Ram"): IAU_NAMES maps the abbreviations. Halley's next perihelion from osculating elements lands in 2062-01 (real:
  2061-07), so periodic returns are said "around YYYY-MM" with a note.
- `weather_details`: Open-Meteo `past_hours=3` gives the 3-hour tendency in one request; `current` takes any hourly
  variable; the Marine API with `cell_selection=sea` answers for coastal points and errors or returns nulls inland (both
  read as "no sea"); multi-model daily keys come suffixed (`temperature_2m_max_ecmwf_ifs025`). Open-Meteo answered 503
  and once a truncated body during testing: transient, the feeds layer reports it as a retryable error.
- The "not deployed" notes above are history: the Worker was deployed on 2026-10-13 (mcp-worker/README.md and
  wrangler.toml). It was not redeployed for the 2026-10-17 changes below, so the remote connector still runs the older
  code until the owner approves a redeploy; the stdio server has them (the .mcpb from the next release too).
- 2026-10-17: `plate_readers` reports a failed FlockHopper index as 'unavailable' only when the point lies in that
  index's rough box (ALPR_REACH in mcp/osm.mjs: US [-180,15,-64,72], Canada [-141.5,41.5,-52,84]); anywhere else it is
  the usual not_found "United States and Canada only". `createOverwatchServer({ importSgp4 })` (default
  `() => import('satellite.js')`) lets a test make satellite.js missing: the satellite tools then fail with ToolError
  'unavailable' and "satellite.js is missing: run npm install …".
- 2026-10-17, EMSC in `earthquakes` (mcp/hazards.mjs): one EMSC request per USGS summary, kept 10 minutes, read as text
  (FDSN's empty 204 = no events). If EMSC fails or takes over 10 s, the summary's last EMSC list is used, kept in a
  WeakMap on `feeds.scope` (the memo every server in a Worker isolate shares), so the Worker's per-request servers keep it
  too.

## NYC measured traffic speeds — 2026-10-12
- NYC DOT's Traffic Speeds dataset (i4gi-tjb9) lags far more than "a few hours": on 2026-10-12 the newest row was 27 h
  old, so the 4-hour freshness cut-off dropped every link and New York showed no measured roads. NYC_MAX_AGE is 48 h now;
  cards say when a reading is old ("the latest the city has published").
- Its ~150 sensor links in Manhattan are all on the edges (FDR, West Side Hwy / 12th Ave, tunnels, bridges); Midtown's
  streets have none, so a Midtown view correctly shows no measured roads. A query ordered by data_as_of over the whole
  table is slow (minutes for count(distinct)); keep the ordered $limit query (1200 rows ≈ every link).

## OpenStreetMap layers from vector tiles (military.js, alpr.js, tilebuildings.js, core/osmtiles.js) — 2026-10-12
- Why: the public Overpass servers refuse a website's worth of requests. These three read tiles over plain GET (CORS,
  browser-cached): OpenFreeMap (`tiles.openfreemap.org/planet` TileJSON names this week's set) and FlockHopper's camera
  tiles. `src/globe/vtiles.js` holds the TileJSONs (6 h), runs at most 4 tile requests at once across these layers and
  fetches a tile once when two layers want it. A 404/204 is an empty tile (the Canadian set has no US tiles).
- MVT polygons: exterior rings are positive by the surveyor's formula in tile units (y down), holes negative and follow
  their exterior (`polygons`); old tiles wound the other way are handled by the first ring's sign. Tiles overlap by a
  buffer, so every polygon is clipped exactly to its tile (Sutherland-Hodgman, `clipRing`); otherwise buildings on a
  tile edge are drawn twice and z-fight. Points on a cut lie exactly on the tile edge, which is how `outlineRuns` leaves
  the seams out of outlines and how `joinPieces` puts an area cut by tile edges back together (a cut on one side
  overlapping a cut on the same world line from the other side). An area with an unmatched cut runs on past the loaded
  tiles: its size is "at least".
- Military: OpenMapTiles has `landuse` class=military from z4 but **no name** for it, and `poi` has no military class.
  Names come from `aerodrome_label` class=military inside the area (in z12 tiles for most fields: Fort Liberty is
  "Pope Field (+1)" at z12 and unnamed at z10), else the card asks Overpass once (`is_in` + landuse/military; the
  smallest named enclosing area, which can be the base around a part). Zoom: the most detailed of z12..z9 whose tiles
  for a circle of 1.3 x the height fit in 16 (9 on phones) (`pickZoom`). Fills are GroundPrimitives and outlines
  GroundPolylinePrimitives per tile (ClassificationType.BOTH, built in workers); draped primitives don't pick here, so
  each area has a clamped billboard pin and label carrying the card. Labels show from sqrt(area) x 9 (named) or x 5.
- Plate readers: the tiles are tippecanoe output with `--drop-rate=1 --no-feature-limit`: z0-8 are a heat set (points
  with no properties), z9-14 carry every camera with its tags, so z9 already has all of them (Chicago's z9 tile: 2,164
  readers, 127 KB brotli). From orbit the globe draws the heat points (one point batch per tile, made once); below
  ~250 km the readers (z12..z9 by the same pickZoom rule). 145,000 mapped in the US + Canada on 2026-10-12. Facing
  wedges are made only for readers near the middle of the view below 8 km. surveil.js (Overpass) skips the ALPRs this
  layer already draws, by OSM node id; elsewhere in the world plate readers still come from surveil.js.
- Buildings: OpenFreeMap's `building` layer is z13-14 but z13 is nearly empty: z14 only (the same tiles traffic loads).
  `render_height` is always there (height, or levels x ~3 m, or a default); `hide_3d` marks an outline whose
  building:parts are drawn instead; `colour` is the mapped colour or material, toned toward grey. Midtown Manhattan: 9
  tiles, ~18,000 buildings, built in Cesium's workers in a second or two on the RTX 3060. On terrain each building
  stands on `sampleTerrainMostDetailed` at its corner mean (one call per tile). Over the cap, the biggest footprint x
  height are kept. Overpass (osmbuildings.js) only takes over after 4 failed tiles in a row.
- 2D map (src/map/osmlayers.js): the same tiles and core functions as two feeds (viewDependent, refetched on moveend).
  Plate readers: a dot cloud (z = map zoom - 3, 20,000 dots) below map zoom 10, every reader from 10 (z = map zoom - 2,
  9..12). Military areas from map zoom 8 (z = map zoom - 2, 9..12) as Leaflet polygons (fill only) plus seam-free
  polylines, with a triangle pin carrying the card. `Net.bytes` (util.js) fetches binary with the browser cache on;
  `Net.fetch` keeps `cache: 'no-store'` for everything else. A 404 tile is an empty tile.
- Plate readers along a route (directions.js, `Alpr.along`): the tiles the route passes (`routeTiles`, the finest zoom
  needing at most 40; a long drive falls back to z9), then `readersAlong` (40 m, a grid of the route's segments). "Facing
  along the road" means a tagged facing within 45° of the road's line either way: ALPRs commonly read rear plates, so
  "toward the traffic" would undercount. Loop to O'Hare (2026-10-12): 29 within 40 m, 23 along the road.
- MCP (mcp/osm.mjs): `plate_readers` and `military_areas` use the same core code in Node; `feeds.bytes` caches binary
  like json. A big area (a state) gets a plate-reader count from the positions-only tiles, not a list. Tests build their
  tiles with test/helpers/mvt.mjs (it shows as an empty passing file in `node --test`).
- Headless renders killed each other: `reapOrphans()` in brand/tools/cdp.mjs killed any profile browser whose parent
  was gone, and Edge's main process always outlives the launcher `spawn()` starts, so every globe_shot run killed every
  other session's running render (`CDP connection closed` mid-run). Each profile now holds owner.pid and only a dead
  owner (or, without owner.pid, 30 minutes of age) makes a browser an orphan. Parallel sessions can also set `OW_WORK`.
## Solar System: missions, comets, search and links (solar/spacecraft.js, comets.js, find.js, lists.js) — 2026-10-12
- Spacecraft: 22 tracks (28 since ISRO's six were added on 2026-10-17) from `make_spacecraft.py` (Horizons, 2-5-day
  samples to 2035, cached in brand/source/horizons/;
  each entry now has agency, status, alias). `core/craft.js` interpolates with a Catmull-Rom cubic: ~300-1,600 km off
  Horizons half-way between samples (samples are rounded to 1e-5 AU = 1,500 km); linear was off up to 200,000 km, so
  `sky.js craftAt` (Tonight's "farthest things we built") uses it too. Subtracting the planet for craft in orbit
  (Juno, Cassini) does not help: interpolation is linear in the samples, so it cancels; only denser data would.
  Past the last sample a craft coasts on only if it is above solar escape speed (Voyagers, Pioneers, New Horizons);
  others have no position there (Cassini after 2017 is hidden, its card says why). Statuses ("Ended 2017") are today's;
  lines of missions over for a year are hidden unless focused. Unfocused tracks draw the last year flown and the next
  half year; the focused one draws everything plus event markers (22 full tracks were orange spaghetti).
- Comets (`core/comets.js`): conics of any e from SBDB q, e, i, node, peri, tp (Barker for parabolas, Newton on
  e sinh H - H = M for hyperbolas; elements may carry their own mu). Checked on 2026-10-12 against Horizons: 12
  comets within 0.3% of r except Halley (0.5%, elements from 1968) and 67P (7%, a 2015 orbit before a Jupiter
  approach). Ion tail = solar wind (400 km/s radial) minus the comet's velocity; dust tail = exact syndyne (each grain
  released at t - tau with the comet's state, then two-body with GM (1 - beta)). The first version pushed grains by
  1/2 beta g tau^2 at the release distance: a sungrazer just past perihelion threw a tail 100 AU long. Tail lengths
  are illustrative; we have no absolute magnitudes, so famous comets are drawn bright and others faint, and the list
  says "best placed", not "brightest". Fragments (-B, -AA) and D/ comets are left out of "near now".
  `make_small_bodies.py --comets-only` rewrites only the comets (keeps open orbits within 3 years of perihelion).
- Search (`core/search.js`): exact > prefix > word prefix > substring > 1-2 typos; then kind, fame, length. Compact
  forms make "voyager1" work; digit-only substrings need 5+ characters ("67p" used to hit every asteroid numbered
  ...67 starting with p). Indexes are built lazily: bodies, all comets, 26,000 named asteroids, exoplanet hosts.
- Links (`core/solarlink.js`): `#f=<body key>&t=YYYY-MM-DDTHH:MM&r=<days/s>&d=<AU>`, or `#q=<search>`. The hash follows
  the view (replaceState every 2 s and on focus), but only after a link we opened was applied (find.ready).
- Card: "In Earth's sky" from `core/skyplace.js`: elongation and side (evening/morning) and the nearest constellation
  *figure* (data/constellations.json stick figures, not IAU boundaries: the galactic centre comes out "near
  Ophiuchus"). Checked: Halley in Jan 1986 "low in the west after sunset, near Aquarius", as it was.
- Renders: parallel sessions' globe_shot runs reap each other's headless Edge (cdp.mjs reapOrphans); set
  `OW_WORK="$LOCALAPPDATA\oo-brand-<name>"` per session. The Browser pane, when hidden, draws no frames at all.
## Solar System round 2: eclipses, occultations, comet brightness, Juno (eclipses.js, core/syzygy.js) — 2026-10-13
- The Moon for eclipses: `planets.js`'s formula is ~0.3° off (half the Moon's width), so `make_ephem.py` fits Horizons'
  apparent Sun (daily) and Moon (hourly) 2026-2030 as Chebyshev series (Moon 4-day segments degree 13: 3 m; Sun 32-day
  degree 13: 1 km) into `data/solar/ephem.json` (148 KB). While it is loaded the view's Moon is drawn there
  (`byKey.moon.geoSource`), else the shadows would miss it. Time argument is UT (the view's clock).
- `core/syzygy.js`: new/full Moons by bisection on the longitude difference; solar eclipses reuse `eclipse.js` cones
  and `eclipselocal.js` Earth-fixed turn (agrees with the globe's `greatestEclipse` on the minute tables within 15 s,
  0.2°); lunar eclipses by Danjon (1/85 enlargement, Earth radius at 45°: R x 0.998340) as NASA's canon: all 12
  lunar eclipses 2026-2030 within 2 min, umbral magnitudes within 0.01, durations within 2 min. NASA's tables give TD;
  subtract ~70 s. A central eclipse's "magnitude" in NASA's tables is the Moon/Sun diameter ratio, not the covered
  fraction of the diameter. Occultations: the Moon within R_earth + R_moon (+ the planet's radius projected) of the
  line Earth-target; 139 in 2026-2030 (Regulus monthly until 2027, Antares, the Pleiades; Spica's, Saturn's and
  Aldebaran's series are not on); checked against published Venus 2026-06-17 and Jupiter 2026-09-08 / 10-06 events.
  All 163 events take ~200 ms in the browser.
- Shadows in the shaders: `globeMaterial` got an occluder (the other globe in view space); coverage from the angular
  radii and separation of Sun and occluder seen from the fragment. Use atan(|a x b|, a.b), not acos: float32 acos near
  1 has ~7% of the Sun's radius as its resolution and bands. Earth's clouds share the uniforms. The Moon adds a red
  term in the umbra. Diagrams (cones, rings, lines) only show within hours of an event and within 0.08 AU of Earth.
- Comet brightness: SBDB M1/K1 per comet (1,634 of 1,867), m = M1 + 5 log delta + K1 log r (Horizons' T-mag, agrees to
  0.006 on Horizons' distances). SBDB keeps each comet's last orbit solution: 16P/Brooks 2's 2016 elements put it 1.5
  AU from its 2026 place, so it showed as "magnitude 13 now" when Horizons says 24. `orbitFresh` (within 8 years and
  1.2 periods of the epoch) keeps such comets out of the lists; the card says "orbit data from 2016" instead.
- Juno: on the heliocentric samples it was drawn up to 900,000 km from the Jupiter on screen (JPL's approximate
  Jupiter is that far off Horizons') and cut corners at perijove. Now `track.local`: daily osculating elements around
  Jupiter + sets every 30 min for +-3 h around each of 109 perijoves, flown two-body around the drawn Jupiter; never
  carry a set across a perijove (Jupiter's J2 turns the orbit there: a set an hour away is ~1,000 km off at the pass).
  Within 150 km of Horizons over two days around three perijoves (sets every 15 min for +-6 h: 66 km at 1.7x the size).
  The 1-day heliocentric track still draws the cruise and the long view. spacecraft.json is 1.6 MB (gzip 0.6 MB); 1.9 MB
  (gzip 0.7 MB) with the ISRO tracks.

## Shared feed core and the 2D map catching up — 2026-10-12 (branch grow-map-core)
- One parser per feed, in src/core, for the 2D map, the globe and the MCP server: quakes, eonet, gdacs, cyclones,
  cameras, aurora, cables, aircraft, transitfeeds, overpass, radio mirrors, OSRM (route.js), passes (ecfAt/nextPass).
  Fetching stays in the views (the map's Net with its relay and throttles, the globe's getJSON) and goes in as a
  function (`loadCyclones({ json })`, `startPoll(s, { fetch })`, `overpass(q, { fetch })`), so Node tests run the whole
  recipe with fakes (test/feeds, cameras, transitfeeds, aircraft, overpass).
- Cyclones on the 2D map now have what the globe had: NOAA forecast cones, tracks, coastal watches and warnings, the wind
  field and GDACS cones for other basins. NHC's `movementSpeed` is mph (the old 2D card said kt).
- Cameras: the 2D map shows all twelve networks (it had five); a stream-only camera (DelDOT, MoDOT, Iowa, Norway) plays
  in the panel through hls.js (the globe's version, loaded on first use). Live video starts from a data attribute: the
  injection test forbids interpolating anything but num()/idArg() into inline handlers.
- Live transit on the canvas: a vehicle is stepped (core fleet) when the canvas draws it, so motion runs at the draw
  rate (~2 Hz idle, every frame while panning). The map's "height" for Entur's box is `zoomToHeight` (core/viewlink).
- Fire hot spots: the same tiles as the globe (fireTilesWanted), the worker moved to src/core/fires.worker.js; a 1,000 km
  view over Zambia in October: 12,000 detections, drawn on the shared canvas without trouble.
- Share links: the globe's format. The map's zoom ↔ the globe's height (`zoomToHeight`, `heightToZoom`: London at zoom
  12 ≈ 20 km up). A 2D link names its layers exactly (`l=`); between views the layers go as `a=` through MAP_TO_GLOBE, so
  the other view keeps its own. "3D globe" (rail) and the globe's "Classic map" open each other on the same place with
  the drawing. The 2D hash is cleared once applied (the map then remembers its own view).
- Found on the way: the 2D radio's saved genre was inside a comment (never loaded: the station list asked for tag
  "undefined" until one was picked); the HSL stream's stop() left its ping and sweep timers running when a socket closed
  without an onclose; storm cards named NOAA NHC twice.
- brand/tools/cdp.mjs kills "orphaned" Edge from other runs in the same work folder: with several sessions rendering, set
  OW_WORK to a folder of your own. brand/tools/page_check.mjs renders any page (the 2D map too) and lists script errors.
## The 2D map catches up, round 2: forecast weather and aviation (map/weather.js, map/aviation.js) — 2026-10-13
- One model loader for both views (core/wxload.js + core/model.worker.js, moved from the globe): the map's
  `makeModels` uses the same cache names (`oo3d-gfs`, `oo3d-ecmwf`), so a forecast hour either view fetched is in Cache
  Storage for the other. Moving it found a bug: a new forecast hour was stamped after the eviction ran, so it always
  sorted as the oldest, was skipped, and the decoded-hours cache kept one hour more than its limit.
- Washes and isobars are `L.GridLayer`s painted per 256 px tile in Web Mercator (latitude by row, longitude by column),
  in their own panes under the vectors and glyphs, so they pan, zoom and wrap like the base map with no reprojection of
  a world image (an equirectangular image overlay would be stretched north-south). A temperature tile costs ~8 ms
  (every 2nd pixel; every 4th from zoom 7, where a 1° cell is already 700 px), an isobar tile ~2 ms. A new moment
  redraws the tiles in view.
- Isobars: core `pressureChart` (the globe's own chart now comes from it too), longitudes folded into -180..180 and cut
  where they cross the date line (`splitJumps`), each piece with its box so a tile draws only what touches it; value
  labels respaced per zoom (40° apart at zoom 3, halving each level, cached per moment); H and L drawn on the tiles.
- Wind streaks: particles in lat/lon carried by the blended field, projected with the Mercator formulas (no Leaflet
  call per particle). Mercator is conformal, so the same screen speed per m/s at any zoom is dlon = u·k, dlat =
  v·k·cos(lat) with k = c / (pixels per degree). Spawned evenly over the view's area (sin(lat) uniform), held while the
  map moves, reset on moveend. ~1,800 particles on a 1,500 px map, ~900 on phones at half the frame rate.
- Each forecast layer is a feed (status dot, errors, the model answering) whose fetch is one shared `Wx.load()` per
  moment and set of fields; dragging the slider reloads them through `runFeed(…, true)`, debounced. In a hidden pane
  the map's scheduler waits 2× the interval (30 min here): drive them with `runFeed` when testing in a background pane.
- Links: core/viewlink.js `MAP_TO_WEATHER` pairs the map's `wx_*` layers with the globe's weather sets (`ir` and
  `radar` show the model's cloud and rain on forecast steps), so the 3D globe button opens weather mode on the same
  fields and model (`w=`), and the globe's Classic map button brings its weather sets back as forecast layers.
- ECMWF works on the map as on the globe (the model menu on the bar); with a run just out its bucket throttles (503
  without CORS headers), so a cold ECMWF hour can take a minute; the layers' dots stay amber meanwhile.
- Aviation: the globe's adsbdb client is core/acinfo.js (store, fetch and clock handed in; the map keeps its own cache
  in `ow.adsbdb`). Map records are feet, knots and ft/min with no previous fix; `airPoint` turns one into the SI point
  core reads, placed where the canvas draws it (`airAt`, core deadReckon: the canvas, following and the boards agree),
  and ingest now keeps the fix before (`rec.was`) so boards see landings and take-offs. The card, phase and route
  words, the board rows and the runway wind words are core functions both views call (`kindWords`, `phaseWords`,
  `routeWords`, `boardRowWords`, `windWords`).
- Boards were changed for both views after a render: a plane landing at JFK under a callsign whose route on file is
  LGA-ATL was listed "from LGA". A row now names the other airport only when the route names this one at the right end.
- Runways are drawn from zoom 11 (polylines; ends as a Points set with `noSel`, else every end ringed as selected
  along with its airport); the runway in use on an open card is green. Airport cards re-render with the live kinds
  every 2 s (board from the planes now on the map, at most 8 adsbdb look-ups per airport per page).
- Dedup on the way: the map's private sun model (mapview.js), its haversine/destination/bearingTo and its own `esc`
  are gone for core's (core/sky.js `subsolar`, `nightRing` against `sunAlt`; core/geo.js; core/format.js, now
  null-safe). An `export { esc } from …` creates no local binding: util.js used esc itself and INIT died with
  "esc is not defined" (caught in the pane; import it, then export it).
- Side by side (⇆ on the bar): the second model's washes and isobars are their own grid layers in panes `wxWashR` /
  `wxTopR`; each side's panes get a `clip-path: inset()` at the divider. Panes ride on the map pane, which Leaflet
  translates while dragging, so the inset is the divider's container x minus `map._getMapPanePos().x`, set again on
  every move and zoom (a 0×0 pane clips its children fine with negative insets). Streaks are one canvas in a pane of
  their own (`wxStreak`, never clipped); each particle follows the model on its side, as on the globe.
- The aircraft card also says what the air is doing at the plane's height (Open-Meteo's two pressure levels around
  it, core/aloft.js `aloftWords`: head/tail and cross wind, temperature against ISA, true airspeed and Mach, cloud and
  an icing hint), asked once per 10 minutes per 0.25° cell and level pair, only for the open card. Trails are core
  `Trail`s per aircraft (the map's old raw `rec.trail` arrays are gone): drawn for the open, followed and pinned planes
  as runs of same-coloured polylines (a few dozen for 30 minutes), with stats and GeoJSON on the card; "Trail" pins.
- After merging grow2-aviation: the board rows' estimate words (core/eta.js ranges "≈ 9 min (7–12)", "took off ≈ 4 min
  ago") are inside core `boardRowWords`, so both views' boards say the same; the 2D map's boards make the same
  estimates (without the globe's per-field track record) and its airport cards show the field's METAR and TAF in
  plain words (core/metar.js) where the local helper relays aviationweather.gov (added to NEEDS_RELAY; serve.js and
  serve.py already allowed it), the model line otherwise. The METAR's wind decides the runway in use when there is one.
- Not on the 2D map: the observed frames of the globe's weather mode (the map has its own radar and IR layers), the
  tower view, the landing watch and the route arc.
- Renders: brand/tools/page_check.mjs (screenshots + script errors) works for the map. From Git Bash, give OW_WORK as
  a Windows path (`C:\Users\…`): with `$LOCALAPPDATA/…` Edge started but cdp.mjs never found DevToolsActivePort.

## Installable app, touch hints, accessibility (sw.js, src/app/, core/pwa.js, core/spot.js, core/a11ycheck.js) — 2026-10-12
- **Where the worker runs.** `src/app/pwa.js` registers `sw.js` (scope = the site root, `updateViaCache: 'none'`) only on
  the website. Archived `/v/<tag>/` pages are inside that scope, so two guards: their pages never register or talk to the
  worker (`isArchivedPath`), and the worker passes through any request under `v/` or whose referrer is an archived page
  (the Solar System's root-copy fallback). On localhost (serve.js, the download, every dev session sharing :8787) it is off
  unless `?sw=1` (remembered as `oo-sw`); `?sw=0` unregisters it and clears its caches. Never add sw.js to APP_PATHS.
- **Versions.** build_site.py `stamp_worker` writes `<OW_VERSION>+<commit>` into `const BUILD = 'dev'` of the site's
  copy (it stops the build if that line is missing). A new commit on main = new worker bytes = the "new version · Reload"
  bar; the 6-hourly data rebuilds of the same commit are byte-identical (no prompt). Caches: `oo-shell-<BUILD>` (pages
  and code, dropped with the old worker), `oo-data-v1`, `oo-asset-v1`, `oo-lib-v1`, `oo-tile-v1` (kept across versions,
  bounded). The globe's own `oo3d*` caches are not the worker's and are never touched.
- **Strategies** are listed at the top of sw.js. The rule that matters: copies of live feeds (data/tle, wind, launches,
  news, …, versions.json) are network-first; offline they come back with an `x-oo-offline: <Date>` header. Our own files
  are kept even though serve.js says `no-store` to everything (that is a dev convenience, not a "never store").
- **Precache = a crawl**, not a list: the pages, then every `src=`, stylesheet, `import … from`, `import('…')` and
  `new URL('…', import.meta.url)` they reach (about 170 files then, 278 on 2026-10-17 against MAX_PRECACHE 450; after
  load + idle so it never competes with the globe's start). A module only reached by a computed path would be missed:
  keep imports literal. Save-Data: pages only.
- **Libraries via `<script>` are no-cors**; the worker refetches pinned CDN files with CORS so the cache holds readable
  copies (an opaque one counts as ~7 MB of quota in Chrome). Leaflet's base tiles are `crossOrigin: false`: OSM and Esri
  answer CORS, so they are kept; anything that does not is passed through uncached.
- **Testing offline in WebKit:** Playwright's `setOffline` with a service worker makes WebKit fail with "internal error";
  pwa_check.mjs drops the connections in its own server instead (and also sets offline in Chromium for the banner).
- **Touch hints** (`gestures.js`): phones only (`pointer: coarse` without a fine pointer), not in embeds, after the
  globe's boot screen or the map's splash and welcome are gone; `oo-hints` remembers per view. The journeys pre-set it.
- **Long press** (`spot.js`): 550 ms, 10 px slop, one finger. On the globe, lifting the finger is also a Cesium click
  that would open the country over the card: the press sets `state.picking` until 350 ms after the finger is up (ui.js
  ignores clicks while picking). The card is a self-describing object for ui.js `select()` (`cardHtml`/`afterCard`), so
  Fly to and Nearest camera come for free. On the map the following click is swallowed for 800 ms (else the probe opens).
- **a11y.js works on the live DOM** from a per-page description (toolbars, toggles, tabs, the card to announce): new
  band or dock buttons other modules add are covered without changes. Announcements go to one polite region; a card is
  said once per selection (kind + heading), map popups by their heading. `fixNames` gives symbol-only buttons their title.
- **The HTML check** (core/a11ycheck.js, test/a11y.test.mjs, CI) fails on a button named only by a symbol, an input
  with only a placeholder, an img without alt, duplicate ids, tabindex > 0, an unlabelled role, and text-colour tokens
  (`--ink*`, `--dim`, `--faint`, …) under 4.5:1 against `--bg` / `--panel-solid` / `--panel-2`. Viewports that block zoom
  are only warnings on the three views that handle pinch themselves.
- **2026-10-17, one version per tab.** The pages import their modules under plain URLs, so on a published build
  (`ONE_VERSION`: BUILD is not 'dev') pages and code come from this version's install copy first, and a tab keeps the
  version it started with until it reloads into the new worker. The guarantee covers only what the install crawl found: a
  file built from a run-time URL comes from the network and may be newer. test/sw.test.mjs crawls the real site and fails
  once it passes 80% of MAX_PRECACHE (450 files; 278 on 2026-10-17). On 'dev' (git, the local helper) pages and code
  stay network first.
- **2026-10-17, the update flow** (src/app/pwa.js): the very first worker takes over at once; a later one waits. A tab that
  sees it installed (or finds one already waiting when it opens) shows "A new version of Open Overwatch is ready (vX)"
  with Reload / Later; Reload posts `skip-waiting` and reloads on the takeover (or after 4 s). Any other tab the old
  worker controlled then gets "Open Overwatch was updated in another tab. Reload to finish." pwa.js tracks whether the
  tab is controlled as that changes, so a tab opened on a first visit gets that bar too.
- **2026-10-17, What's new** (core/whatsnew.js RELEASES, shown by pwa.js): a corner card once per version after an update,
  at most 3 lines, "Try it" and "Full notes" (the CHANGELOG heading on GitHub once the entry has a date). Never on a first
  visit (that only remembers the version, `oo-seen`) unless the visitor came through Reload, never in an archived copy
  or an embed (`embed=0` is not one), not while a newer worker is waiting, and it ignores an Escape another panel used.
  `?whatsnew=1` forces it, `?whatsnew=0` never. test/whatsnew.test.mjs fails when src/map/version.js names a version
  without an entry, or when CHANGELOG.md has a `## [x.y.z]` heading whose entry has no `date`: the publisher sets it.
- **2026-10-17, the install sheet:** a maskable icon (brand/emblem/emblem-maskable-512.png) and two screenshots,
  brand/social/screen-narrow.jpg (720x1280) and screen-wide.jpg (1280x800), JPEG quality 85 with a copyright comment,
  made by brand/tools/pwa_images.py from the hero stills. They are in APP_PATHS and the release zip.

## Time travel (timetravel.js, events.js; quakes/storms/satellites follow the clock; core/history.js) — 2026-10-13 (branch grow3-timetravel)

- **One clock, the layers follow it.** Nothing new owns time: `src/globe/time.js` stays the only clock and share links
  keep `t=`. main.js runs `Quakes.sync()`, `Storms.sync()`, `Events.sync()` and `Sats.travel()` on every clock change and
  once a second; each one decides for itself (core/history.js `isPast`: more than 30 minutes back) whether to show its
  live feed or its archive, and flips back when the clock returns. The panel (`timetravel.js`) only moves the clock
  (always paused at the picked moment) and reports what came back.
- **Quakes**: the USGS FDSN event API (`fdsnws/event/1/query`, CORS, keyless) one UTC day per request
  (`orderby=magnitude&limit=1500`, M2.5+), so a running clock asks once per new day; days are kept for the session (14 at
  most). Every quake of the window's two days is drawn once and shown/hidden as the 24 h window slides. The answer is
  the same GeoJSON as the live summaries, so `parseUsgs` reads both. A busy day (Tōhoku: 587 at M2.5+, 0.4 MB) is the
  worst case.
- **Storms**: EONET `status=all&start&end&category=severeStorms` (12 days before to a day after) + GDACS's event search
  for cyclones that are over (`gdacsPastCyclones`; `parseGdacsCyclones` drops them) with at most four geometries, only
  for storms EONET lacks. One fetch per UTC day; `stormsAt` cuts each track at the time shown and interpolates the
  position and wind between fixes (Ian at 19:05 UTC on 2022-09-28 lands 12 km from NHC's landfall point, tested). No
  forecast cones, wind fields or warnings: the archives don't have the forecasts of the time, so none are drawn. NHC's
  advisories have no CORS archive (HURDAT2 is a text file on nhc.noaa.gov without CORS); EONET's storm tracks are
  NHC/JTWC positions anyway.
- **Natural events**: a new `events` layer (off by default; the moments switch it on): EONET's non-storm events, open
  in the last 20 days live, and in the past every event (open or closed) going on that day (`eventActiveAt`: an event
  without a close date counts for a week after its last fix).
- **Satellites**: the site build keeps `data/tle/history/<day>.txt` (bare two-line sets of 17 groups, ~3,900 objects,
  ~0.55 MB a day, 30 days ≈ 16 MB on Pages) plus `index.json`. The first build of each UTC day writes the day's file, only
  when at least half the groups downloaded fresh; earlier days come from an actions/cache folder (`OO_TLE_HISTORY`) or,
  without it, from the live site. Starlink, OneWeb and "active" are not archived (2.5 MB a day). In the browser
  `chooseElements` gives each satellite whichever set (today's or the nearest snapshot's) has its epoch nearer the time
  shown; nothing within 7 days hides it (SGP4 drifts kilometres a day and satellites manoeuvre); a satellite missing from
  a snapshot taken within a day of the time shown, while its group is archived, wasn't catalogued yet and hides. The
  swap rewrites `s.l1/s.l2` (models, cards, orbit lines read those) and reloads the SGP4 worker with nulls for hidden
  ones; `s.today` keeps today's set. Re-chosen when the nearest snapshot changes or every 6 h of clock time.
- **Honest UI**: the panel lists what came back per layer, with a "switch on" for layers that are off; aircraft and
  upcoming launches hide in the past; cameras, ships, transit, bikes, traffic, weather, aurora and VIIRS fires stay live
  and the panel says so. A card follows the clock (the same storm or event re-selected, else closed).
- **Layout**: a strip above the band (the Ops rail sits where a top panel would go); moments fly the camera a little
  south of the place so it lands in the upper half, above the strip. Phones: above the dock, and the Time sheet has a
  Time travel button.
- **Headless shots**: globe_shot blocks USGS; `OO_UNBLOCK=earthquake.usgs.gov` lets the catalogue through for a run
  (CelesTrak can never be unblocked). The browser tests answer the catalogue with the real Tōhoku M6+ fixture.
- **Local archive for testing**: `data/tle/` is gitignored; run `archive_tles('data/tle')` from build_site.py over the
  website's own group copies to make one (never CelesTrak).

## Earth now: the dashboard (now.js, now.css, core/earthnow.js) — 2026-10-13 (branch grow2-dashboard)

- **One panel, the globe's own feeds.** `Earth now` (band, `E`, `#go=now`) sums up quakes, cyclones, the aurora, launches,
  people in space, flybys, wildfires and the model's weather extremes. Everything already on the globe is reused
  (`Quakes.list`, `Storms.list`, `Launches.load()`, `Crew.load()`, `Flybys.load()`, `Model.at()`); the panel adds only
  small history files, fetched when it opens and kept 10-30 minutes: USGS `2.5_week` (~0.3 MB), `4.5_month` (~0.4 MB,
  only when its tab is picked), EONET wildfires, and SWPC's `noaa-planetary-k-index-forecast.json` (observed,
  estimated and predicted rows in one file). Nothing is fetched or timed while the panel is closed.
- **Sums are pure** (`src/core/earthnow.js`, 11 tests on captured answers). Kp → G scale: SWPC marks Kp 5- (4.67) as
  G1, so G = round(Kp) − 4; the test checks every row of the captured product against SWPC's own `noaa_scale` label.
  SWPC tags a 3-hour block by its start and sometimes "estimates" a block that hasn't begun: "now" is the last
  non-predicted row at or before now.
- **Honest labels.** EONET's wildfires are incident reports (mostly IRWIN, US/Canada), and half of them are
  prescribed burns: counted apart. Launches per month come from the upcoming list (the next 40): the current month
  (flown launches are gone) and months past the list's end are drawn faint and say "partial". Weather extremes are
  model grid cells, sea and Antarctica included (2 m temperature and 10 m wind of the GFS hour nearest now), named by the
  globe's own borders.
- **Charts** are inline SVG built as strings in core (`barsSvg`): `role="img"`, a `<title>` and a `<desc>` that lists
  every value with its full date, a tooltip per bar, bars in `currentColor` (each section sets `--c`), text in the page's
  CSS variables, forced-colors fallback. Today / predicted / partial bars are faint (opacity .45).
- **Actions** switch the matching layer on (stored like a dock click) and fly; objects with cards are selected
  (quakes, storms, launches, stations); a named fire or a weather extreme gets a pin object with `cardHtml` so `select()`
  shows it. A weather extreme opens weather mode with Temperature or Wind on first (weather flies out to the whole Earth
  when opened low), then flies to 4,500 km and sets weather's point readout there.
- **Phones**: a sheet above the bottom dock (Explore → Earth now), folding to its title bar while the camera flies;
  weather extremes wait for a tap (~1 MB of model data); opening weather from it closes the sheet (weather's panel takes
  the same place) and says the value in a toast. Countdowns tick once a second only while the sheet is open, unfolded and
  the tab visible; DOM-only, so the battery saver's frame rate is untouched.
- **Desktop band**: it had grown past 1,600 px and was cut off at both ends; now.css caps it at the window minus the
  navigation pad and lets it scroll sideways.
- **Headless shots**: globe_shot blocks USGS, so the renders patch `fetch` for `earthquake.usgs.gov` to the captured
  fixture (`test/fixtures/earthnow/usgs_4.5_week_2026-10-13.json`); the other sections are live.

## Oceans and air (ocean.js, seaair.js, map/ocean.js, core/ocean.js, mcp/ocean.mjs) — 2026-10-13 (branch grow3-ocean)
- **CORS, checked 2026-10-13**: NDBC (`www.ndbc.noaa.gov`) sends none, so buoys and DART go through the local helper
  (serve.js / serve.py / NEEDS_RELAY) and the public relay (worker TTL + PATHS + PUBLIC_RELAY_HOSTS; the website reads
  them since the relay's 2026-10-17 redeploy; a host the deployed Worker still refuses shows the "download version" note,
  not a failed fetch). NOAA's old ERDDAP copy of the buoys (`cwwcNDBCMet` on coastwatch/upwell) is gone (404).
  CO-OPS, GIBS (tiles, colour maps, DescribeDomains) and Open-Meteo send `*`. OpenAQ v3 answers 401 without a key.
- **Reading a picture back**: GIBS colour maps (v1.3 XML) give each colour a value range; `colormapValue` looks the
  pixel up exactly (an exact RGB index: the PNGs are paletted, no blending at 1:1). Draw the tile at native size, read one
  pixel, `imageSmoothingEnabled = false`. Open ends are `-INF` and `+INF` (the `+` tripped the first parser). The SST layer
  read against 40 NDBC buoys' thermometers: median −0.5 °C (MUR is yesterday's pre-dawn temperature), −2.1 to +1.8.
- **Dates**: DescribeDomains (`1.0.0/<layer>/default/<set>/all/<from>--<to>.xml`) names the newest day, so tile URLs
  use it (cacheable) and the legend says which day. OMPS's newest day is the current UTC day, partly covered.
- **DART**: in standard mode a buoy sends its 15-minute values every 6 hours (all the files ended at 18:00 UTC when read
  at 20:00), so "late" starts at 7 hours. Event mode = any 1-minute or 15-second row in the last 6 hours. The water
  column (~2,700-5,700 m) moves ~1 m with the tide: the card says the 6-hour change is mostly tide.
- **CO-OPS** answers errors with HTTP 200 and `{ error: { message } }`; "The supported Datum values are: MSL, NAVD"
  is parsed and retried with the first. Non-tidal river gauges (e.g. Carrollton, LA) may have no recent data at all.
- **Air quality grid**: on round numbers (0.25° to 30°) so the 30-minute cache hits as the view moves; at most 48 points
  per request (Open-Meteo counts each location as a call). The 2D map runs feeds at a third of their cadence in a hidden
  tab, so a hidden preview fetches rarely: drive `runFeed` by hand when testing.
- **Globe clicks**: `hooks.seaAt(lon, lat)` in ui.js runs when a click lands on the Earth but in no country and a picture
  layer is on; it opens a "value here" card. Land clicks still open the country.


## Supply chain: SRI, Content-Security-Policy, self-hosted fonts (core/sricheck.js, brand/tools/sri.mjs, brand/fonts/) — 2026-10-14
- **SRI.** Every CDN `<script src>` and `<link rel=stylesheet>` carries `integrity="sha384-…" crossorigin="anonymous"`
  (without CORS the browser does not check the hash). Module URLs go in an import map's `"integrity"` object instead:
  solar.html lists three.module.js, three.core.js (three.module.js imports it) and OrbitControls.js; globe.html and
  open-overwatch.html carry an integrity-only import map for hls.js, which cams.js / map feeds.js `import()` on first
  use. Import-map integrity needs Chrome 127, Safari 18, Firefox 138; older browsers load those modules unchecked.
  Not covered, by design of the browser: Cesium's own follow-up files (Workers/*.js, Assets, ThirdParty wasm, loaded
  from CESIUM_BASE_URL at run time; the files are immutable on jsDelivr at an exact version) and satellite.js inside
  the blob workers (`importScripts`, no integrity option; it is the same URL the page itself checked).
- **Bumping a library:** change the URL on every page, then `node brand/tools/sri.mjs --fetch --write` downloads each
  pinned file and writes the new hashes (`--fetch` alone only compares). A new tag needs `integrity=""
  crossorigin="anonymous"` first; a new import-map module needs its `"integrity"` entry (the tool prints it). jsDelivr
  only serves fixed bytes for files the npm package ships: never pin a jsDelivr auto-minified `.min.js` the package
  lacks (both pinned .min files are in their packages; checked with data.jsdelivr.com).
- **CSP** is a `<meta http-equiv>` right after `<meta charset>` (it only governs what follows it). Per page script-src
  is 'self' plus the exact CDN origins the page loads, plus the sha256 of each inline script; `test/sri.test.mjs`
  fails when an inline script changes without `node brand/tools/sri.mjs --csp` (hashes are of the LF text, as the HTML
  parser sees it, so a CRLF checkout agrees). Exceptions, on purpose:
  - open-overwatch.html is on hashes like the rest (2026-10-14): its detail-panel HTML never carries `onclick=`; buttons
    say `data-do="fly" data-lat=… data-lon=… data-z=…` (arguments through num()/idArg()) and one document click listener
    in src/map/main.js runs a fixed `ACTIONS` table (fly, air-trail, air-follow, sat-track, clear-track, tab, rerender).
    A new button adds its action there; test/inject.test.mjs fails on any inline handler in src/map, an unknown action,
    or an unwrapped `${…}` in a data-* argument. OW_VERSION moved out of the page to `src/map/version.js` (a classic
    script, still a global const) so the publish bump leaves the page's hashes alone. (Before this, the onclicks for
    Trail/Follow/Ground track/Clear track/← Brief/refresh named module-scoped objects and threw; only flyTo worked.)
  - globe.html adds `'unsafe-eval'`: CesiumJS's Viewer widgets run on Knockout, which reads `(0,eval)("this")` as
    Cesium.js loads (without it the globe never starts: "EvalError … 'unsafe-eval' is not an allowed source") and
    compiles each `data-bind` with `new Function`. It also covers Cesium's WebAssembly (draco, KTX2/basis decoders;
    'wasm-unsafe-eval' alone would do for those). Dropping it means replacing Viewer's widgets with CesiumWidget plus
    our own controls. Every other page is refused 'unsafe-eval' by the check (`EVAL_OK` in core/sricheck.js).
  - style-src keeps 'unsafe-inline' (style attributes and the pages' own <style> everywhere; styles do not run code).
  - img-src / media-src / connect-src allow `https:` (plus data:, blob:): the feeds come from dozens of hosts and
    users can add their own (relay URL, radio streams), so an allowlist would break on every new feed. img-src also
    allows http: (a few camera stills; images cannot run code), and the 2D map's connect-src allows http: for a
    custom relay on the local network (the Setup tab warns about it). Scripts are the part that is locked down.
  - worker-src / child-src 'self' blob: (satellite workers are blob: URLs, which inherit the page's policy, so their
    `importScripts` from jsDelivr passes script-src); frame-src 'self' (the globe frames solar.html for the zoom-out).
    The globe also lists https://cdn.jsdelivr.net there: Cesium first tries `new Worker(<jsDelivr URL>)` and falls back
    to a blob: wrapper only when that throws. Chrome throws for a cross-origin worker, but a CSP block is reported
    later as an error event, so with 'self' blob: alone Cesium's workers never started (createGeometry,
    createVerticesFromQuantizedTerrainMesh: the globe stayed without terrain tiles).
  - frame-ancestors, report-uri and sandbox are ignored in a `<meta>` CSP. GitHub Pages cannot send headers, so
    framing is not restricted (the MCP Apps view frames the globe on purpose).
- **Fonts** are self-hosted (brand/fonts/: Google Fonts' woff2 builds of Big Shoulders Display (variable, 600-900),
  Barlow 400/500/600, IBM Plex Mono 400/500, latin + latin-ext, `fonts.css`, the three SIL OFL files). brand/fonts is
  in APP_PATHS and the release zip. The look-dev tools brand/tools/capture.mjs and make_cards.mjs still ask Google
  Fonts for their own card pages (local tooling, not the site).
- **Check before publishing a page change:** `node brand/tools/sri.mjs` (or `node --test`). In a browser, a CSP
  violation shows as a console error "Refused to …"; listen for `securitypolicyviolation` to catch them in a script.

## Provenance on every live card, and export (core/liveprov.js, core/export.js, app/save.js) — 2026-10-14 (branch provenance-layers)
- The record is core/provenance.js (one shape for every view and the MCP server); core/liveprov.js is the per-layer side:
  `SOURCES` (who each feed is), `LAYERS` (each layer's max age and what its data time means) and the stamp a layer puts on an
  item as it builds it (`stamp(item, layer, [rep(id, { dataAt, cached })], { agreeing })`, or `get prov()` on a prototype via
  `provStamp`). The card asks `provBlock(item)` when drawn, so the age is true at that moment. Unstamped things (static data:
  volcanoes, lighthouses, airports, countries; the simulated cars) show no block.
- Hooked in two places only: the globe's `select()` (ui.js) appends `provBlock(o)` to every card, launches add it to their own
  card; the 2D map's `Detail.render` appends it after the renderer. Everything else is one stamping line per feed.
- Data times used (never our download time): USGS summary `metadata.generated` (else the solution's `updated`); readsb `now − seen_pos`
  (the 2D map), `now − seen_pos` on the globe, OpenSky `time_position`; TLE epoch; EONET newest geometry; GDACS `datemodified`;
  NHC `lastUpdate`, GDACS `polygondate`; VIIRS acquisition; NIFC `poly_DateCurrent`; AIS `timestampExternal`, aisstream
  `time_utc`; GTFS-rt / MBTA / Entur / HSL report times; CityBikes station time; NDBC observation; DART and CO-OPS readings (set
  when the card reads them, "unknown" until then); Open-Meteo model hour; SondeHub frame time; NWS `sent`; GDELT `seendate`;
  Overpass `osm3s.timestamp_osm_base`; radio-browser `lastcheckoktime`; LL2 `last_updated` (the site copy's build time when the copy
  dropped it). Camera lists and the FlockHopper / OpenFreeMap tiles carry no time: those cards say "unknown", honestly.
- Copies: `(copy)` when it came through the site mirror (TLEs unless straight from CelesTrak, launches), a stored snapshot (the
  globe's 15-min OpenSky cache, the TLE localStorage cache) or the public relay (`Relay.viaCopy` on the map, `viaCopy` in
  globe/env.js); the local helper only passes requests on and is not a copy.
- Real agreement, with tolerances in the layer's own core module (tested in test/liveprov.test.mjs):
  - Aircraft (both views): `noteAircraftReport` keeps each feed's newest report 150 s; `sameAircraft` = same hex, ≤ 120 s
    apart, position reachable at its speed (1.5 km + 1.15 × v·Δt), altitude within 500 ft + 4,000 ft/min. Reports further apart
    are dropped from the count, not counted as disagreeing (the /mil feed and the sweep are ~60 s apart: at 30 s nothing
    matched). 2D map, 2026-10-14 evening: 235 of 670 aircraft confirmed by two networks (adsb.lol /mil + adsb.fi sweep, or
    OpenSky + ADS-B). Caveat: adsb.lol, adsb.fi and airplanes.live share many feeders, so "two networks" is not two receivers.
    The globe (OpenSky snapshot + /mil, which is off by default) is nearly all single-source.
  - Storms: the merge in core/cyclones.js keeps a fix per source (`reports`); `stormAgreement` takes the freshest as reference,
    `sameStorm` = 150 km + 30 km/h × Δt (≤ 500 km), and counts each agency once (`agencyOf`): EONET or GDACS repeating NOAA's data is
    named "(NOAA's data again)" and not a second witness; GDACS from JTWC/JMA next to NHC is.
  - Quakes: USGS plus GDACS's earthquake alerts on the 2D map (`stampQuake`, `sameQuake` = 60 s, 100 km, 0.6 magnitude). GDACS
    takes most solutions from NEIC (USGS), so those are listed "GDACS (USGS solution)" and don't confirm. Since 2026-10-17 EMSC
    is the second catalogue on the globe, the 2D map and the MCP server (see "EMSC" below); GDACS stays on the 2D map only.
  - Ships (2D map): Digitraffic and aisstream records of one MMSI (`sameShip`: ≤ 10 min, 300 m + run). Needs an aisstream key.
  - Everything else is single-source: "reported" at best.
- Export: core/export.js turns items into rows (plain fields, plus provenance, confidence, sources, agree, of, data_time,
  data_age_s; CSV cells that would run as formulas get a leading '), app/save.js the buttons and a Blob download. 2D map:
  "Export view" under each live layer (engine.js `Exports` for the layers outside Points: aircraft, ships, balloons,
  satellites, transit). Globe: "Export what's in view" at the end of the Layers dock (globe/exportview.js, items from each
  module, filtered to the camera's view rectangle).
- MCP: hazards.mjs, tools.mjs and the tool modules add `provenance` (the plain line) per quake, storm, event, ship, station,
  launch, vehicle, fire group, buoy, tide gauge, camera and road reading, and per answer for satellites, weather, aurora and air
  quality (`lineFor`). aircraft_lookup (a registry) and the static-data tools have none.
- Gotcha found on the way: the agent's Bash tool turns a doubled backslash in a heredoc into a single one, so a Python
  string meant to write the CSS escape for ✔ (backslash 2714) wrote the octal escape 271 (¹) instead. Write CSS escapes and
  regex backslashes with the Edit tool or a script file.

## The Sun now: solar wind, Bz, flares, SWPC alerts (sunnow.js, core/spaceweather.js, mcp/spaceweather.mjs) — 2026-10-14

- **Feeds (checked 2026-10-14 from Node with an Origin header):** every file below answers `Access-Control-Allow-Origin: *`,
  so the browser fetches SWPC directly; no relay entry, no CSP change (connect-src already allows https:).
  `products/solar-wind/mag-1-day.json` and `plasma-1-day.json` answer **404**: the replacement is `json/rtsw/rtsw_mag_1m.json`
  and `rtsw_wind_1m.json` (the last day, 1-minute, newest first, three spacecraft side by side: SOLAR1 = SWFO-L1, ACE,
  IMAP; the operational one is flagged `active: true`, the others must be dropped or the line zig-zags between them).
  `products/summary/solar-wind-*.json` are the latest minute only (no density).
- **Weight:** the two rtsw files are ~160 + ~100 kB gzipped; the browser skips `xrays-1-day.json` (~105 kB) and takes the
  24 h peak from `xray-flares-7-day.json` (~4 kB) plus the class now from `xray-flares-latest.json`. Fetched only when
  Tonight or Earth now opens, shared and kept 5 minutes (src/globe/sunnow.js).
- **Alerts:** each message supersedes by code + serial (`Extension to`, `Cancel`, `Continuation of Serial Number`); a
  watch supersedes all earlier watches; a watch is in force until its last G1+ day ends (UTC); a K-index alert until its
  synoptic 3-hour period ends; electron/proton alerts for a day. CME news: a watch comment naming a CME, or a type II/IV
  radio burst. Provenance: Bz, wind and X-rays stale after 15 min, each alert dated by its issue time.

## Re-entry predictions: Falling soon (core/decay.js, globe/reentry.js, map/reentry.js, mcp/reentry.mjs) — 2026-10-14

- **No new feed.** Everything comes from the element sets the views already load (the site's copy of CelesTrak's groups);
  CORDS (aerospace.org/reentries) is a reference read by hand, never fetched by code. The model, its constants and why:
  docs/CORE.md `decay.js`. Guide: guide.html#reentry (why the windows are wide).
- **Validation (test/decay.test.mjs, real element sets from public GitHub copies):** Tiangong-1, epoch 2018-03-31 15:17,
  predicted 2018-04-02 01:21 (F10.7 140) / 2018-04-01 23:52 (F10.7 70, the real solar minimum), window ±8.5 h; real 00:16
  UTC. GOCE, epoch 2013-10-23 (two days after its engine stopped), predicted 2013-11-08/09, window ±4 days; real
  2013-11-11 00:16. By hand against CORDS on 2026-10-14: COSMOS 2572 ours 10-18 14:13 ±24 h vs CORDS 10-18 04:46 ±28 h;
  Starlink-1810 from an element set 1.75 h before CORDS's time, ours 10-13 17:37 ±1.9 h vs CORDS 15:37 ±6 h.
  The ISS (2018 and 2026 sets) comes out at 13-15 years without reboosts.
- **Lessons:**
  - n-dot lags at the end. It is fitted over about the last day, so it is the decay of half a day ago; calibrating the
    drag at the current height put Tiangong-1 10 h late and Starlink-1810 7 h late. Calibrating it half a day back up the
    orbit (`FIT_LAG_DAYS`) fixed both, and barely moves anything weeks out.
  - Thrusters look like drag. Starlinks lowering themselves at 420-550 km have n-dot like an object at 200 km (ballistic
    factor 0.3-3 m²/kg against 0.003-0.1 for anything really falling): above `MAX_BALLISTIC` (0.25) they are left out.
    New satellites raising their orbit have negative n-dot, and their B* alone would say "falling in weeks": negative
    n-dot under 600 km counts as manoeuvring too. The site's `last-30-days` copy is a 404 (Pages has none), so it can't be
    used to leave launches out; `fallingSoon({ exclude })` takes ids if it ever comes back.
  - Station-kept satellites in very low orbits (Starlink's direct-to-cell shells at ~355 km) are predicted to fall in
    weeks if nothing boosts them, which is true physics but not what will happen: every card for a working satellite says
    its operator may keep it up. A SATCAT status (`[+]`) would let the list tell them apart; the TLE copies don't carry it.
  - Speed: ~30,000 objects in ~80-150 ms in Node with the `quickDays` screen (a scale height over today's decay rate, an
    upper bound on the lifetime); 3 s without it. The globe computes once per 30 min, after `Sats.ready`.
  - Clutter: 83 objects × 3 orbits was a red blanket on the globe; the layer draws each object's likeliest orbit (±45 min)
    and the picked one its whole corridor (up to 3 orbits, or the window when shorter).
- **Provenance:** layer `reentry` in core/liveprov.js; the item's own `prov.maxAgeMs` (a fifth of the time it had left,
  2 h to 3 days) beats the layer's, so a 47 h prediction from a 21 h old element set says "stale" while a 4-day one from
  7.8 h old says "reported".
- **Not covered:** rocket bodies (not in the public groups the site copies; the full catalogue is Space-Track's),
  controlled de-orbits, F10.7 and Kp from live data (core/spaceweather.js reads neither; DEFAULT_SOLAR is F10.7 140, Kp 2).

## Dark skies: Your sky, Deep sky tonight, the light pollution layer, dark_sky (core/darksky.js, globe/darksky.js, globe/lightmap.js, map/darksky.js, mcp/darksky.mjs) — 2026-10-14

- **Nearest dark sky needs a land test.** The atlas is dark offshore, so without one London's "nearest Bortle 3" is in the
  North Sea. `nearestDark` collects every qualifying cell (and its four neighbours, so not a gap between towns) within
  1,000 km, sorts by distance and asks `land(lat, lon)` (borders.js) until one is on land: London → mid-Wales 225 km WNW,
  Amsterdam → Terschelling 120 km NNE, Denver → the Front Range 65 km WSW. 15-70 ms. Simplified borders can drop a tiny
  island; the Bortle 4 fallback covers places with no class-3 sky in range.
- **Bortle 3 is strict on this scale** (SQM ≥ 21.69, artificial ≤ ~33% of natural): much of lowland Europe has none
  within a few hundred km, which is why the fallback exists.
- **Gear model:** limiting magnitude = NELM + (−1 eyes, +3.5 binoculars, +5.5 small scope); galaxies and big nebulae
  must also have a mean surface brightness (galaxies over their inner quarter) within 1.5 / 2.3 / 3.0 mag/arcsec² of the
  sky. Objects brighter than mag 5 skip that test (bright cores). The sky used is the night's real one: the Moon counts
  unless it leaves two moonless dark hours (`tonightQuality().sqm`).
- **Moon brightness** is a rough phase law (full Moon well up ≈ SQM 18.5 on a dark site, ∝ lit³): it ranks nights, it is
  not a photometric model.
- Tonight loads the 1.7 MB grid (~80 ms to decode in Node, more on a phone) and deepsky.json when it opens with a place,
  borders.json only when the spot is brighter than Bortle 3. On the globe, "Find it" opens look-up with the object as a
  Find target (`LookUp.enter({ name, ra, dec, text })`); tonight.html has no look-up, so the rows have no button there.
- Layers: globe `lightpollution` (one equirectangular picture, 3600 px wide, 1800 on phones, brightest cell per pixel);
  2D map `lightpollution` (a GridLayer painting each Web Mercator tile from the grid, native to z9). Both off by default and
  credited "Falchi et al. 2016, CC BY-NC". MCP `dark_sky` is in the Worker's HEAVY list (decoding the grid is ~80 ms of CPU).

## Globe: hover tips, hidden tabs, what the website carries, quality tiers (ui.js, main.js, core/poll.js, satellites.js, core/quality.js) — 2026-10-17
- **Hover picking.** A hover pick draws the whole scene again into the pick buffer and stalls on readPixels, so the mouse
  picks only at rest: 80 ms after the last move, never while a button is held or the free camera moves (moving hides the
  tip; touch never shows one). Following an object, or a scripted camera that turns `ctrl.enableInputs` off (tower view,
  the launch chase cam, the directions fly-through, webcam projection, look-up, the ops view), still shows tips: those
  cameras move every frame. Releasing the last button schedules a fresh pick (a click with no move brings the tip back),
  and moveEnd clears a waiting timer before setting its own. Aircraft dots and icons are re-uploaded only for the band
  that can draw at the camera's height (`Air.PTS_H`, `ICON_H`; ui.js runs a pass when the camera crosses into a band).
- **Hidden tabs** (core/poll.js `createPoller`, wired in main.js `every()`): the globe's timed feeds run nothing while
  the tab is hidden; back in view, each feed that came due runs once, 1.5 s apart. `keep()` keeps one running hidden: the
  aircraft feeds and trails.js while a plane is watched for its landing or followed (`hooks.airKeep`, a hook so
  trails.js need not import landwatch.js). A failure is retried on the next run and mentioned only on the third in a row;
  an error with `notCarried` stops the feed for the visit (`onStop`, no "retrying").
- **What the website carries.** On a page where the aircraft feeds can't answer, `noAir()` sets `Air.offSite`: the dock
  lines read "download version" on the website and "needs the local helper" on any other host (layers.js `AIR_WHERE`,
  the same test as main.js), voice and "Under the hood" say aircraft come with the download instead of "Tracked 0", and
  phones' header shows SAT and QK instead of AIR and MIL (`body.no-air`). Lines about stopped feeds wait until the boot
  screen has lifted (`later()`: 1.5 s after, two such lines take turns), and the aircraft line shows only if a layer
  is still on. A stopped feed without an `onStop` of its own gets one line too.
- **Satellite worker:** satellite.js is the site's own copy (src/vendor/satellite.min.js, the same bytes the pages pin by
  hash; `importScripts` has no integrity check), one SGP4 run per object a tick. The velocity in the tick buffer is the
  velocity half a second on (v(t) plus 0.5 s of central gravity), so the straight line the page draws over the 1 s
  between ticks stays about a metre off the orbit instead of about 4 m; layout and units are unchanged.
- **Quality tiers** (core/quality.js, applied by globe/quality.js): High / Balanced / Low now also cut what each pixel
  costs. Low: render scale 0.75 (0.66 on phones), no FXAA, no limb halo, no cloud relief taps, one cloud octave, a 30
  fps cap. Balanced: scale 0.9 and the limb halo fading out between 1,200 and 800 km (`limbFade`, LIMB_RIM_M 1,000 km
  ± 200), so low views on Balanced have no horizon rim. `autoLevel` starts phones and software renderers on Low.
  Starlink (~8,000 dots) is off by default on phones; LAYERS entries may carry a `hint` shown only on the dock line, so
  the name stays "Starlink" on cards, search and exports. e2e/snapshots/globe-europe.png was taken at the old Low, which
  no level matches now: refresh it on the next GitHub run (OO_E2E_ALL=1, OO_E2E_UPDATE=1) and look at it first.
- **Phones and boot:** only a shown card (`#card.show`) moves above the Time travel strip, so a closed card's slide-out
  still clears the screen. The boot watchdog (globe.html) says a script "didn't load … may be blocking it" only after
  one failed to load; if Cesium is still missing when the 20 s timer fires it says the library is still downloading.
  It counts thrown errors only from src/globe, src/core or cdn.jsdelivr.net (not extensions or injected scripts), and
  main.js's boot text clears the failure styling when a slow boot recovers.

## Solar System: the hand-over, orbit lines, the deferred asteroid file, ISRO (embed.js, util.js, smallbodies.js, craft.js) — 2026-10-17
- **Hand-over:** the globe hands over beyond 3.0e8 m and the Solar view hands back below EXIT_M = 2.2e8 m. After the
  hand-over the 1.6 s roll (aim at Earth, roll to ecliptic north) is Earth-centred (at the globe's 1 h/s Earth moves
  ~170,000 km in those 1.6 s) and ends at least 1.05 x EXIT_M out; hand-back waits until the camera has been past EXIT_M
  once, so a fast clock can't bounce the view straight back. With prefers-reduced-motion (util.js `CALM`) focusOn,
  flyDist and the roll jump instead of swooping. e2e/globe.spec.mjs drives the zoom out and back on GitHub (ci-e2e).
- **Orbit lines** (util.js `rebasedLine` / `rebase`): float32 vertices at 39 AU are ~570 km coarse, so each line sits at
  its body and holds path minus body, with a vertex on the body (kepler.js orbitPath `through`, comets.js conicArc `at`):
  a 720-point line otherwise passes 56,000 km from Pluto. A line is refilled once its body has moved `reach` camera
  distances (0.1; 0.02 for open comet arcs). Planet orbits are refilled from the elements at the current jd.
- **asteroids_b.bin** (19 MB): a standalone desktop holds it back until the camera first passes 1.5 AU from the Sun
  (LEAVE_EARTH) or the search box gets focus; inside the globe it waits until the view is entered. It never loads on
  Low (no `allAsteroids`), which phones and software renderers start on; picking Balanced or High there loads it.
  A search or link hit on an asteroid in that file starts the load and flies there when it lands, if the focus hasn't
  changed (`onNamed`); a `#q=` link waits for the file only when it names such an asteroid exactly.
- **Loading and picking:** the galaxy catalogue (cosmic.js) loads once, but a failed fetch clears the latch (unless the
  points are already in the scene) and flying out past 1e6 ly retries a minute later, the same back-off as the exoplanet
  catalogue; exoplanets' `X.data` / `systems` / `hostPos` are set only once the markers are built. A body with a hidden
  label is clickable only when its globe covers more than a pixel, so from far out a click near the Sun picks the Sun.
  The in-system caption uses the famous body's name (Kepler-90 for the archive's host KOI-351).
- **ISRO missions** (make_spacecraft.py, JPL Horizons): Chandrayaan-1, -2, the Chandrayaan-3 propulsion module, Vikram,
  the Mars Orbiter Mission and Aditya-L1. A working craft past its last sample reads "past the published track (JPL
  Horizons)", not "mission over", and inLocal stops at the track's end. Moon-centred orbits can be off by up to ~5,000 km
  around orbit raising or lowering burns (craft.js). Chandrayaan-2's track ends 2026-11-08 and Aditya-L1's 2027-01-19:
  test/india.test.mjs prints a WARNING two weeks before an India link loses its position; rerun `python
  brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1"` and republish (ROADMAP).

## EMSC: a second earthquake catalogue (core/quakes.js; globe/quakes.js, map/feeds.js, mcp/hazards.mjs) — 2026-10-17
- EMSC's FDSN service (www.seismicportal.eu, keyless, CORS *, credit "EMSC") is asked beside USGS on the globe, the 2D
  map and the MCP `earthquakes` tool; never waited for (the USGS list draws first and is stamped again when EMSC answers).
- One request per question every 9.5 min at most (`emscSource`: a little under the globe's 10-min reload, so a tick a
  moment early still asks), the start floored to 10 minutes so one question keeps one address. The floor is the USGS
  summary's minus 0.6 (`emscAsk`, `emscUrl`), limit 500, or 1000 for windows over a day or floors under M2.5. A busy
  window (a week or a month, M1+ in a day) comes back as only its newest part, so older USGS quakes read "reported" for
  want of an EMSC solution, not because EMSC disagrees. Each question keeps its own last list; a failure falls back to it.
- Read as text everywhere: FDSN answers an empty 204 when nothing matches (no events), and a body that is not JSON is a
  failure.
- Matching (`matchEmsc`, `sameQuake`): within 60 s, 100 km and 0.6 magnitude (a missing magnitude doesn't disagree),
  the closest in time when several match. EMSC repeating USGS (agency NEIC/USGS, or the network in the USGS id's first two
  letters) is listed "EMSC (USGS solution)" and doesn't confirm; any other agreeing solution makes the quake "confirmed".
  The globe's late restamp uses the magnitude USGS gave, not draw()'s default of 0. globe_shot, perf, zoomtest,
  zoom_capture, mobile_journey and android_* in brand/tools block seismicportal.eu with the other live hosts;
  gesture_check and webkit_journey block earthquake.usgs.gov but not seismicportal.eu.

## Landing pages, India and Tonight links (index.html, india/, tonight.html, 404.html) — 2026-10-17
- Copy rule (test/landing.test.mjs): a description, blurb or README lead that names aircraft carries the exact sentence
  "Live aircraft come with the free download.", and hero or chip copy marks planes and squawks as the free download.
  The pages lead with the zoom, satellites, storms, quakes and Tonight. The release heading on index.html is computed
  from versions.json and counts every release, zip-only ones too; its version picker lists only those still online.
- india/hi/ is generated from india/index.html by `node brand/tools/india_hi.mjs` (it stops if an alt-text swap matches
  nothing); run it after every edit of the English page, then `node brand/tools/sri.mjs --csp`. test/india.test.mjs
  fails when the Hindi page is out of date. Each language is self-canonical and sitemap.xml names the pair with
  xhtml:link alternates. The Hindi ad URL is india/hi/ (docs/INDIA.md).
- Phones: opening the menu moves focus to its first link (the button comes after the links in the DOM); under 380 px the
  home bar's brand is 15 px with a 24 px emblem so it fits 360 px; under 760 px the live dot does not blink (home and
  India). 404.html's pasted-link fix also strips ’ ” … and zero-width spaces. brand/tools/a11y_check.mjs checks 404.html
  and both India pages too.
- Tonight for any place (`tonight.html#at=lat,lon&name=`, `#embed=1[&sections=…]`): an embed remembers fold taps for the
  visit only and opens its footer links in a new tab; a place opened from a link has no aurora alert button (it would
  save the link's place), and `Tonight.peek({ nudge: false })` re-arms reminders and aurora watching but says nothing
  about the visitor's home.
