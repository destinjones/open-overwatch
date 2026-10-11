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
legend, Locate, Fun/ISS follow) · brief (Brief, Welcome) · audio · setup (Setup tab, Probe, search) · main (INIT, OW).
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
Moving-object types (like aircraft/ships) have no generic path: they need a hand-written branch in Glyphs.draw.
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

## Public relay (relay/, Cloudflare Worker) — 2026-10-10
`relay/worker.js` on the owner's Cloudflare account (`npx wrangler deploy` from relay/, after `npx wrangler login`):
https://open-overwatch-relay.destinjones123.workers.dev/?url=… . Allowlist = `PUBLIC_RELAY_HOSTS` in src/core/relay.js
(NOAA NHC, NYC DOT cameras, submarinecablemap), GET only, redirects re-checked, `Access-Control-Allow-Origin` fixed to
the published site, Workers Cache in front (works on the free plan: `CF-Cache-Status: HIT`; per-host max-age in TTL).
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
