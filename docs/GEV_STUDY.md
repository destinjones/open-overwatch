# God's Eye View: what it's made of, and what to take (2026-10-10)

Source: github.com/bilawalsidhu/gods-eye-view at commit 591f299 (2026-10-09), cloned read-only to
`C:\Users\desti\open-overwatch-work\reference\gods-eye-view` (nothing installed or run). Four read-throughs of the code
plus the docs, and a header-only CORS probe of every source below from our site's origin.

## What it is

- **Size:** ~219,000 lines of JavaScript (7-8x Open Overwatch), 1,803 files, v0.2.1 (2026-10-02), ~50k GitHub stars.
  Maintained by Bilawal Sidhu and Sameh Khamis (Halfpixel) with outside contributors.
- **Stack:** Vite + CesiumJS (1.124, some paths pinned to 1.138), vanilla JS, Google Photorealistic 3D Tiles. The
  `/api/*` routes are Node middleware in the Vite dev server: OpenSky (OAuth + a credit governor), adsb.lol, adsbdb,
  an AISStream socket, CelesTrak, Launch Library 2, FIRMS, GRIB wind decoding, nowCOAST, NHC, OSRM, GBFS, GTFS-RT
  decoding, CCTV frames and HLS, Mapillary, Google Places, OpenAI Realtime tokens, terrain heights, and an MCP server.
- **Local-first:** install with Pinokio or `npm ci && npm run dev`, then paste keys into a POWER UP panel that writes
  `.env`. A hosted version is "coming": their README says the loudest request was "just give me a link". We are one.
- **Licence:** code MIT (we may adapt code if we keep the notice). Not MIT: the bundled data (submarine cables CC
  BY-NC-SA, the Nepal flood pack CC BY-NC) and the 9 aircraft/ship models (Sketchfab, CC BY 4.0 with credit).

## Where we're already ahead

- **A link.** No install, works on phones, keyless. Their voice needs OpenAI, their 3D needs a token or a Google key, and
  most feeds need their local server.
- **Traffic.** Theirs is dots sliding along unconnected road lines: no road graph, no car following, a 0.8% chance of a
  2-6 s random stop near road ends, nothing by time of day, no headings (`src/layers/traffic/animation.js:321`). Ours
  has a joined graph, IDM following, lights, time-of-day busyness, measured speeds in New York and Finland, and sprites
  with headings and brake lights. Their live speeds need a TomTom key.
- **Cameras.** Their "projection" is the picture on a flat plane at the far end of the view cone
  (`src/layers/cctv/projection.js:163`). Ours is true projective texturing onto the ground or Google's buildings,
  with a Look-through calibration.
- **Space.** 18k satellites with SGP4 in a worker, vs their 838 (plus Starlink round-robin on the main thread); the
  seamless zoom out to the Solar System and the cosmic web; moons, near misses, eclipses, look-up, Tonight.
- **Weather reach.** Our radar is worldwide (RainViewer); theirs is the contiguous US only.
- **Voice without keys** (Web Speech). They have none.

Their own known gaps (docs/KNOWN-ISSUES.md and code): wind frozen at one forecast step; radar US-only; lightning
Americas/Pacific only; cyclone cones for NHC/CPHC basins only; weather history not shareable; fires need a FIRMS key;
ships jump once a minute (no dead reckoning or wakes); dense-city traffic lag; planes float 30-60 s at cold airports;
2 live video streams at most; phones get CSS breakpoints only.

## What to take, ranked (all keyless; CORS checked from destinjones.github.io on 2026-10-10)

1. **Keyless 3D terrain.** Re:Earth / Mapterhorn quantized mesh `https://terrain.reearth.land/cesium-mesh/ellipsoid`
   (CORS *, CC BY 4.0), their default. Retry 429/5xx x3 (750 ms doubling to 15 s, shared cooldown), and fall back to
   the plain ellipsoid if it fails. Point heights: `https://terrain.reearth.land/heights.json?points=lon,lat;...`
   (returns ellipsoid, geoid and elevation; 64 points a call). Watch phone cost, and ground-clamp what we draw.
2. **World-stable icons** (`src/data/iconOrientation.js:52-91`). `alignedAxis = ZERO`, then rotate in screen space:
   `v = ENU(pos)*(sin c, cos c, 0)`, `dx = v·camera.rightWC`, `dy = -(v·camera.upWC)`, `rotation = atan2(-dx, -dy)`;
   keep the last value when |(dx,dy)| is tiny. Ours (`alignedAxis = UNIT_Z`) drifts with latitude and pitch. Use it for
   aircraft, transit and ships (our cars already align to the road).
3. **Aircraft motion.** Stamp fixes with the feed's own time (OpenSky `time_position`; adsb.lol receipt minus `seen_pos`).
   Draw one interval behind, interpolating between fixes (fits our 60 s military feed). Coast past the newest fix on
   a constant-rate turn (0.4-4°/s from track deltas), blend course with the chord, slew-limit heading (60°/s), and
   fold late fixes in with a decaying correction offset. Heights: geometric altitude when given, else baro + EGM96
   geoid (`egm96-universal`). Trails for the selected aircraft only: `ArcType.GEODESIC` plus a `depthFailMaterial`.
4. **Hazards, worldwide** (beats their NHC-only and key-gated fires):
   - Cones, tracks, points: NOAA `mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/{5,6,7}/query?...&f=geojson`
     (CORS OK). Draw only when all three match the advisory number. Add **GDACS**
     (`www.gdacs.org/gdacsapi/...`, CORS *) for every other basin.
   - Fire perimeters: NIFC WFIGS `services3.arcgis.com/T4QMspbfLg3qTGWY/.../WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query` (CORS *).
   - Hot spots without a key: GIBS VIIRS thermal-anomaly tiles (the layer/tile matrix still to pin down).
5. **Recent imagery, before/after.** NASA CMR `cmr.earthdata.nasa.gov/search/granules.umm_json` for HLS S30
   (Sentinel-2, `C2021957295-LPCLOUD`) and L30 (Landsat, `C2021957657-LPCLOUD`), sorted newest, with cloud cover and
   footprints; GIBS WMTS tiles `HLS_*_Nadir_BRDF_Adjusted_Reflectance` (30 m) and `VIIRS_NOAA21_CorrectedReflectance_TrueColor`;
   thumbnails from `wvs.earthdata.nasa.gov/api/v1/snapshot` (read its `Data-Present` header); a swipe compare with
   `splitDirection` + `scene.splitPosition`. All CORS *.
6. **More live cameras**, with our true projection:
   - Browser-direct: DelDOT live video (`tmc.deldot.gov/json/videocamera.json`, HLS
     `video.deldot.gov/live/{id}/playlist.m3u8`) and Statens vegvesen (catalogue
     `ogckart-sn1.atlas.vegvesen.no/ogc/features/v1/collections/datex_3_1:CctvSimple/items`, ~135 HLS
     `kamera.vegvesen.no/public/{id}/manifest.m3u8`) are all CORS; DriveBC images are CORS; Austin and Calgary
     catalogues are CORS.
   - Through our relay's allowlist: cctv.austinmobility.io, its.txdot.gov, www.drivebc.ca (the list),
     data.livetraffic.com + webcams.transport.nsw.gov.au, trafficcam.calgary.ca, ristmikud.tallinn.ee,
     tarktee.transpordiamet.ee, kamera.atlas.vegvesen.no.
   - Their heading rule: compass words only from direction fields or NB/SB/EB/WB tokens (never a bare "West" in a name).
   - Their pose priors: known heading: pitch -24°, hFOV 56°, 210 m, 10 m mount; unknown: -18°, 44°, 145 m, 8 m.
   - Swap a still only when a 64x36 signature changes (no flashes). Use hls.js lazily.
7. **Bike share worldwide.** They hard-code 32 US systems; MobilityData's `systems.csv` (raw.githubusercontent, CORS *)
   lists ~900. Lyft and BCycle GBFS are CORS *. Colour stations by bikes/capacity.
8. **More transit.**
   - Austin (`data.texas.gov/download/eiei-9rpf/...`, a redirect, then CORS *) and Minneapolis
     (`svc.metrotransit.org/mtgtfs/vehiclepositions.pb`, CORS *) are GTFS-RT protobuf: generalise the reader in
     `core/mvt.js`.
   - Netherlands (OVapi, needs a User-Agent) and SE Queensland (TransLink) have no CORS: relay.
   - Their playback rules: delay = clamp(max(p95 vehicle lag, p90 feed lag) + 5 s, 25..120 s); 2-3 confirmations for
     implausible jumps (m/s ceilings: bus 36, tram 28, subway 42, rail 111, ferry 25); course only after 12 m of travel.
9. **Ships without a key in the Baltic.** Digitraffic marine AIS `meri.digitraffic.fi/api/ais/v1/locations` (CORS *),
   with dead reckoning and wakes (theirs need an AISStream key and jump each minute).
10. **Wind that moves in time.**
    - Sources: GFS on AWS (`noaa-gfs-bdp-pds.s3.amazonaws.com/.../gfs.tHHz.pgrb2.0p25.fFFF` + `.idx`, Range requests)
      and ECMWF open data (`data.ecmwf.int/forecasts/.../*.grib2` + `.index`). Both are CORS * with Range.
    - Decode GRIB2 in our scheduled GitHub Action (Python eccodes) into Float32 grids on Pages: 360x181, ~0.5-0.8 MB a step.
    - Let the time bar scrub forecast steps (theirs can't).
    - Their renderer: 7,200 baked streamlines (golden-angle seeds, RK2, 16x30 min each way) as polylines 12 km up, with
      a material sliding a highlight along them; colour fields for speed / temperature / pressure; a reading at map centre.
11. **Weather on one timeline.** nowCOAST WMS (CORS *): global longwave IR, GOES regional IR, lightning density; the last
    13 frames in 24 h, play every 2 s, prefetch the next frame; "clouds only" = alpha x smoothstep(luma^2.2, .40, .70);
    the global IR fetched as one whole-extent image (per-tile contrast differs).
12. **A render governor.** `requestRenderMode` with ref-counted "hold" owners (flights, an animating style...);
    everything else calls requestRender. They measured ~60% GPU and ~54% of a core burned at idle before it. Our
    satellites always move, so the win is throttling to a few fps while nothing near the camera moves: good for
    phones and battery.
13. **Smarter keyless voice.**
    - Spoken replies with SpeechSynthesis, from a code-built `{ say (≤25 words), display, referents }` result.
    - "What's this?" about whatever the pointer rests on (250 ms / 12 px dwell, fresh for 30 s); numbered results
      ("the second one").
    - Push-to-talk on Space (held 500 ms), a short earcon while a command works.
    - Answers counted from our own layers ("how many planes over Texas?"). Theirs needs OpenAI for all of it.
14. **Draw and measure.** Area/line/pin (≤512 points), great-circle distance arrows (by road via OSRM when asked),
    "outline Texas" from bundled public-domain Natural Earth + US Census boundaries (lazy-loaded); drape with
    `ClassificationType.BOTH` (CESIUM_3D_TILE alone drew nothing without Google tiles).
15. **Ask Claude or ChatGPT to show it.** Theirs: 40 query tools with one `area` argument (a place, a box, or point +
    radius; lists capped at 25), answers carrying a view link, and an MCP App that loads the whole app through a
    tool. Ours could be a small npm stdio package whose tools answer from public feeds with links to our URL, plus
    an MCP App that just frames `?embed=1`: no checkout, no local server.
16. **Overpass-free OSM layers.** (Done 2026-10-12: military.js, alpr.js, tilebuildings.js.) Public Overpass refuses them too (their `OVERPASS_UPSTREAMS` defaults to empty).
    Military areas: OpenFreeMap `landuse` class=military, z9-12. ALPR: `tiles.dontgetflocked.com/cameras-{us,ca}-hourly.json`
    (MVT, CORS *). Buildings: OpenFreeMap's `building` layer (render_height) from the tiles our traffic already loads.
17. **Smaller ones.**
    - Aircraft types from adsbdb (`api.adsbdb.com/v0/aircraft/{hex}`, CORS *) to pick models.
    - Cockpit weather from Open-Meteo (CORS *).
    - Sensor styles prebuilt and cross-faded on an intensity uniform (500 ms), with sliders generated from uniform
      metadata; bloom/sharpen.
    - A first-run "missions" chooser.
    - Their framing constants: overhead = bounding sphere x1.25, pitch -62°, range 2.4R; a route dolly at 260 m,
      -32°, bank ≤10°.

## Leave alone

OpenAI Realtime voice and the AI HUD caption (key + server), AISStream global ships (key + socket), the FIRMS API,
TomTom flow and Google Street View (keys), Mapillary (a token; maybe bring-your-own later), and the WebUSB RTL-SDR
FM/ADS-B receiver (static-capable and fun, but needs a dongle: later). Live planes stay blocked on the website
even browser-direct: adsb.lol and adsb.fi send no CORS, OpenSky's CORS names only its own site, airplanes.live
answers 403.
Don't copy their Google-derived camera height file (their own data notes say Google content may not be committed);
sample Re:Earth heights instead.

## Engineering habits worth copying

Budgets everywhere (OpenSky credits read from `X-Rate-Limit-Remaining`; tile, image and height caps), abort plus a
generation counter on every camera move, serve-stale on errors, "honest" labels (RECONSTRUCTED ESTIMATE, "approximate",
feed age), fail-closed validation of scene files and share links, and permanent share-link tokens checked in CI.
