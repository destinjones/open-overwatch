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
  Objects within 5 km of the ISS/CSS are "docked" (no model, no dot). Aircraft: OpenSky snapshot (15 min) + adsb.lol mil,
  dead-reckoned up to 15 min; the nearest 200 within 300 km (camera < 600 km) get models (brand/models/aircraft) with
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
workflow (.github/workflows/pages.yml -> .github/build_site.py): main at the root, every annotated v* tag frozen under
/v/<tag>/, and versions.json for the landing page's version picker and history (#launch). The /v/<tag>/ copies only
contain build_site.py's APP_PATHS: add every new runtime asset there (the Launch button opens /v/<latest>/), or
the archived app 404s on it (v0.7-v0.8 globe crashed that way until v0.8.1). Each archived version costs
~25 MB of the 1 GB Pages limit.
Mirrors are best effort, and a failed refresh must never take the previous copy down: on 2026-10-06 06:28 UTC the
scheduled build timed out on every CelesTrak group (90 s each, a 36-minute build that still "succeeded"), deployed with
an empty data/tle/, and the live globe fell back to CelesTrak directly for every visitor until the next build.
build_site.py now keeps the live site's copy of any feed it cannot refresh (last_good / keep_last), stops waiting on
CelesTrak after the first timeout, and index.json lists the groups it `kept`.
`Publish Update.bat` bumps OW_VERSION, commits, tags vX and pushes; .github/workflows/release.yml then builds
`open-overwatch.zip` (the download the lander links to via releases/latest/download). Keep the zip file list in that
workflow in sync when the app starts needing new files. gh CLI (portable): ~/bin/gh-cli/bin/gh.exe.

### Search and sharing (SEO)
`index.html`, `about.html` and the three app pages each carry a title, description, canonical URL, Open Graph and Twitter tags; the landing and About
pages also carry JSON-LD (`WebSite`, `SoftwareApplication`, `Person` with `sameAs` links to GitHub and Ironbound). `robots.txt` keeps the archived `/v/<tag>/`
copies and `/data/` out of search results and points at `sitemap.xml`: bump its `lastmod` when a release changes a page. `CITATION.cff` gives GitHub's
"Cite this repository" button; `LICENSE` (MIT) covers the code only, the data keeps its own licences (docs/DATA_SOURCES.md). The portrait is
`brand/about/destin-*.webp` (cropped from the owner's own photo).

## 2D map: modules (src/map/)
util (helpers, Store, Log/toast/Sound, Net + Relay, clock; `late` registry) · mapview (Leaflet map, base maps, Sun) ·
engine (Glyphs canvas renderer, Points, Layers registry + panel, feed scheduler) · detail (Detail panel, tracks, hover,
tabs/sheets) · aircraft · satellites (TLEs via src/core/tle.js) · feeds (all point/vector layers) · presets (views,
legend, Locate, Fun/ISS follow) · brief (Brief, Welcome) · audio · setup (Setup tab, Probe, search) · cities (bike share, live
transit) · hazards (fire hot spots, US perimeters) · measure (draw and measure) · share (links, hand-off to the globe) · main (INIT, OW).
Modules import only from earlier ones; the five names used before they are defined (Sats, cableHit, Probe, Brief, Keys)
are read through `late.X`. OW_VERSION stays a classic <script> const in the HTML (Publish Update.bat edits that line).
A hidden tab pauses feeds by design: drive them with OW.Sats.reload() etc. when testing in a background pane.

## 2D map: adding a layer (the contract the code enforces)
1. `Layers.add({id, group, name, desc, color, default, points})` before INIT. `group` must be one of `UI.groups`
   or it never shows; keep `id` to `[a-z0-9_]`; `points` must equal the Points set id.
2. `Points.define(setId, ly.id, {minZoom})`, then `Points.set(setId, items)` in the fetch. Item colors must be `#hex`.
3. `feed(ly, {interval, fetch: async () => {...}, viewDependent?, minZoom?})`. The fetch must THROW on failure,
   set `ly.feed.count` itself, and must not set `ly.feed.status` / `nextAt` (runFeed overwrites them).
   Use `Net.json` / `Net.text` for every request.
4. `Detail.renderers[kind] = obj => html`. **Escape every upstream string with `esc()`** — `Detail.kv` values and
   the `Detail.head` sub-argument go into innerHTML raw. Check link schemes with `isHttp()`.
5. CORS-blocked source: add the host to `NEEDS_RELAY` in the html AND `ALLOWED_HOSTS` in serve.js AND serve.py.
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
redirect hop re-checked against the allowlist. Keep their allowlists = NEEDS_RELAY (+ old hosts for archived pages).

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
  through the relay (the local helper; the public Worker once redeployed with those hosts).
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
  the descent rate. A route that contradicts the board (starts here on a plane landing here) is not shown on the row.
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
  public relay, not to the 2D map's NEEDS_RELAY: the 2D map doesn't ask it). The website keeps the Open-Meteo line and
  says why. api.weather.gov does send CORS, but its `rawMessage` was empty for KDEN's latest observation, it has US
  stations only, and its TAFs are IWXXM XML: not worth a second decoder. A bbox METAR query over the US timed out (504);
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
- Renders: `brand/tools/airport_wx_shot.mjs` (desktop and 390x844) injects TEST1xx planes and runway events (the render
  blocks the aircraft feeds); real callsigns there pulled real adsbdb routes naming other airports, which drops them
  from the board (routeOther), hence the TEST callsigns. METAR/TAF/dots in the shots are live AWC.

## Public relay (relay/, Cloudflare Worker) — 2026-10-10
`relay/worker.js` on the owner's Cloudflare account (`npx wrangler deploy` from relay/, after `npx wrangler login`):
https://open-overwatch-relay.destinjones123.workers.dev/?url=… . Allowlist = `PUBLIC_RELAY_HOSTS` in src/core/relay.js
(nine hosts: NOAA NHC, NYC DOT cameras, submarinecablemap, the BC and Missouri camera lists, four agencies' stills), each
host limited to its feed paths (PATHS in worker.js), an Origin header required, GET only, redirects re-checked, a fixed
Accept (a forwarded one let anyone poison the shared cache with DriveBC's HTML rendering: 2026-10-11 review), HTML never
cached, a 30 MB cap counted on the stream, `Access-Control-Allow-Origin` fixed to the published site, test/relay.test.mjs
exercises it with a stand-in upstream. Add the free-plan WAF rate-limiting rule on the route (e.g. 60 req/min per address), Workers Cache in front (works on the free plan: `CF-Cache-Status: HIT`; per-host max-age in TTL).
The ADS-B networks and OpenSky refuse Cloudflare's servers (adsb.lol 429, airplanes.live / adsb.fi / adsb.one 403,
OpenSky timeout), so they are not relayed; don't disguise the relay to get past that. adsb.lol's API terms say a key
(given to feeders) is coming: with the owners' agreement, add the host back to TTL and PUBLIC_RELAY_HOSTS.

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
- Spacecraft: 22 tracks from `make_spacecraft.py` (Horizons, 2-5-day samples to 2035, cached in brand/source/horizons/;
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
  `new URL('…', import.meta.url)` they reach (about 170 files, after load + idle so it never competes with the
  globe's start). A module only reached by a computed path would be missed: keep imports literal. Save-Data: pages only.
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
