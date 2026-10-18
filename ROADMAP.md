# Roadmap — the rebuild

Work happens on the local `rebuild` branch. Nothing is pushed, tagged or deployed until the user says so (a local
pre-push hook refuses pushes without OO_PUSH_OK=1). Published: v0.9.1 (2026-10-02)
through v0.9.2.14 (2026-10-15), each with its CHANGELOG.md entry; next v0.9.2.15 (CHANGELOG.md's [Unreleased]).

Owner decisions still open (2026-10-17): redeploying the MCP Worker, so the 2026-10-17 MCP fixes (the /mcp/%zz crash,
parse caching) and EMSC in `earthquakes` reach claude.ai users; narrowing the pages' `connect-src` from `https:` to the feed
hosts (docs/NOTES.md calls the wildcard a deliberate trade-off: custom relays and radio streams); and whether the
non-commercial terms of Open-Meteo (free API) and the light-pollution World Atlas (CC BY-NC 4.0) fit paid Meta ads and
GitHub Sponsors (record the answer in NOTICE or GOVERNANCE.md).

Goal: one coherent, well-engineered project that zooms from a street to the Local Group on real, open data — code a
programmer would enjoy reading, not three big HTML files.

## Stage 1 — credible codebase
- [x] Plan + architecture docs (`docs/ARCHITECTURE.md`), lean `CLAUDE.md`
- [x] `src/core/`: time, units & frames, Kepler, planets + Moon, IAU rotation, small-body format, assets, formatting
- [x] Tests for the core (`node --test`), checked against JPL Horizons fixtures
- [x] Solar System view moved onto `src/core` + `src/solar/` modules (solar.html = markup + styles only)
- [x] Satellite feed (TLE fetch, mirror, cache, parse) as `src/core/tle.js` (globe and 2D map)
- [x] 3D globe moved onto modules (`src/globe/`), aircraft dead reckoning shared via `src/core/geo.js`
- [x] 2D map split into modules (`src/map/`, generated from an AST analysis of the old script), keeping its layer contract; satellites via `src/core/tle.js`
- [x] CI: syntax check, page→module links, tests on every push (`.github/workflows/ci.yml`; runs once we publish)
- [x] `docs/DATA_SOURCES.md` (every feed: what, licence, refresh, accuracy)
- [ ] Refresh ISRO spacecraft tracks before they run out (Chandrayaan-2 2026-11-08, Aditya-L1 2027-01-19): `python brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1"` (JPL Horizons, public domain); test/india.test.mjs warns two weeks ahead.
      Do it before 2026-11-01 and republish; if Horizons still ends Chandrayaan-2 on 2026-11-08, the owner picks where the India page's main button goes instead
      (Aditya-L1 or the Moon)
- [x] Honest README with a demo clip (README.md: brand/clip/zoom-preview.webp and the 30 s MP4)

Housekeeping before publishing: `src`, `earth_fx_2k.jpg` and `brand/textures/moons` are now in `APP_PATHS` / the release zip;
check any new runtime asset is too (archived /v/<tag>/ copies fall back to the site root only for big data and textures).

## Stage 2 — the signature: one zoom from street to galaxy
- [x] Seamless globe ↔ Solar System hand-off (matched camera and field of view, cross-fade, roll to the ecliptic, both directions)
- [x] One time control for everything: globe time bar (satellites follow it, aircraft hide off-live), carried across the hand-off both ways
- [x] Everything CelesTrak publishes in orbit (all active satellites + the three big debris clouds; the full catalogue is
      Space-Track's and can't be redistributed) + "Near misses": SOCRATES close approaches, watched live at the TCA
      (data appears once the site build runs: `active`, `fengyun-1c-debris` and `socrates.json` are new in build_site.py)
- [x] Major moons (Mars to Pluto, 20): Horizons-fitted orbits, tidally locked, orbit lines and labels near their planet
- [x] Cosmic-web finale: 43,480 2MRS galaxies, cluster labels on the real overdensities, a ladder rung and the tour's last stop

## Stage 2b — the overkill wow (2026-10-02)
- [x] Light delay (ghost where Earth sees the focused body) and our radio bubble (since 1920, stars inside tinted)
- [x] Other solar systems: 6,339 NASA exoplanets at their stars; fly into any system (real sizes, habitable zone, transit-timed positions)
- [x] Look-up mode (globe band → Look up): your sky from your location, phone sensors or drag; planets, bright stars,
      overhead satellites and aircraft, compass ring, next ISS pass (core/passes.js, core/orientation.js, tested).
      Needs the real-phone check: iOS compass + Android absolute orientation
- [x] Solar eclipses 2027–2030 (globe band → Eclipses): Horizons Sun/Moon every minute, live umbra + penumbra, path of
      totality, coverage from your location. 2027-08-02 greatest eclipse 25.51°N 33.16°E 10:06:39 UT, 6 min 27 s
      (NASA: 25°31'N 33°08'E, 6 min 23 s); the six central eclipses land within ~0.1° of NASA's points
- [x] Under the hood panels (` key / buttons): fps + frame times, draw calls, GPU, data sources and ages, SGP4 worker
      timing; the Solar System's errors measured live in the browser against JPL Horizons (core/accuracy.js, also tested)

## Stage 3 — launch like engineers
- [x] Performance numbers + fixes (docs/PERFORMANCE.md, brand/tools/perf.mjs): shader pre-warm, graphics levels with auto step-down, software-GPU hint, phone header fix
- [x] First-visit phone journey, emulated (brand/tools/mobile_journey.mjs): load times halved, touch picking, layout fixes on all three views
- [x] Phones without phones: real Chrome in Google's Android emulator and Safari's engine with an iPhone profile (docs/TESTING.md)
- [ ] Real-phone pass on the published beta (iPhone Safari + Android Chrome: a real GPU, memory limits) and README numbers
- [x] 30-second capture of the full zoom (brand/tools/zoom_capture.mjs → brand/clip/, full 1080×1920 in brand/video/)
- [ ] Decide how the public history looks (squash / fresh repo) — the user's call
- [x] Publish as v0.9.1 (2026-10-02)
- [x] Publish as v0.9.2.1 (2026-10-03): other solar systems, look up, eclipses, light delay, under the hood, phone fixes
- [x] Publish as v0.9.2.5 (2026-10-06): Tonight above you (+ tonight.html), look-up upgrades, launches, people in space, search, find a flight,
      share a picture, cloud forecast, meteor showers, constellations, embed mode, two bug-hunt rounds (80 fixes), build keeps last good feeds
- [x] Publish as v0.9.2.4 (2026-10-04): About the creator page, links to Ironbound, search tags, MIT licence, citation file
- [x] Publish as v0.9.2.3 (2026-10-04): country dossiers, big employers, volcanoes, aurora, flybys, sun and time zones, share links, the tour, 3D buildings (OpenStreetMap, no account)
- [x] Publish as v0.9.2.2 (2026-10-03): phone dock, desktop nav pad, lighthouses, weather mode (clouds, radar, rain, wind, temperature), phone performance

## Stage 4 — things people asked for (2026-10-05/06, published as v0.9.2.5 on 2026-10-06 with the notices commit)
- [x] Tonight above you (globe band → Tonight; `globe.html#go=tonight` from the landing page): visible ISS / Tiangong / Hubble
      passes, Starlink trains (launches still below ~470 km), the brightest satellites when high, the five bright planets,
      the Moon's phase, the aurora chance where you stand, all in plain words (core/sky.js, tested). Location saved on the
      device only, rounded; a returning visitor gets a one-line "ISS at 9:42 pm, look WNW" toast
- [x] Pass alerts: "Calendar" downloads an .ics with a 10-minute reminder (works with the site closed, no server);
      "Remind me" = a notification while the page is open (src/globe/alerts.js + notify-sw.js, re-armed on the next visit)
- [x] Aurora alerts: checked every 10 min while the page is open, only in the dark, once a night at most
- [x] Share a picture (navpad ◫ or P, phone menu): the view with a caption strip and the site address, to the share sheet
      with the link on phones, a PNG + copied link on desktops (src/globe/snapshot.js)
- [x] Find a flight (globe band → Find flight): ticket number (BA 123 → BAW123), callsign, registration or hex
      (core/flight.js, tested); the download version asks adsb.lol and refreshes every 15 s; the website searches what it
      has and otherwise opens adsb.lol's own map. Aircraft cards get "Share", and links carry the flight (`&f=BAW123`)
- [x] Meteor showers (core/meteors.js, tested): the ten major showers in Tonight with an honest rate from where you are
      (radiant height, Moon, suburban sky), a peak-night calendar reminder, and the active radiants marked in Look up
- [x] Search everything (band → ⌕ Search, or "/"): satellites by name, NORAD number or everyday name (ISS, Hubble,
      Tiangong), countries, flight numbers, views, and volcanoes / employers / lighthouses once their layers have loaded
- [x] Look up → "Sky on": any date 1800-2049 (planets, Moon, stars; satellites only within 3 days of today)
- [x] Satellite cards say what the thing is in one sentence (core/explain.js)
- [x] Install as an app (manifest.webmanifest: standalone, shortcuts to Tonight and Find a flight); "reduce motion"
      makes camera flights jump instead of swoop
- [x] Constellation figures and names in Look up (d3-celestial, BSD: data/constellations.json via brand/tools/make_constellations.py), "Figures" toggles them
- [x] Rocket launches (band → Launches, pads as orange markers with countdowns): Launch Library 2, copied by the site build every 6 h
      (build_site.py mirror_launches), countdown, how sure the time is, webcasts, calendar / notification reminders, fly to the pad
- [x] "When can I see it?" on every satellite card (its passes over you, 3 days); Tonight adds where the ISS is right now and
      launches within 1,000 km in the next week ("look toward the SSE"), plus the next launch anywhere
- [x] Embed mode (`globe.html#embed=1`, navpad "</>" or phone menu copies an iframe); landing page shows the next launch countdown
- [x] Keyboard focus outlines, labelled globe and card regions
- [x] Tonight: sunset / dark / sunrise, moonrise and set, the next full Moon by name (Harvest, Hunter's...; supermoons),
      "Farthest from home" (Voyagers, New Horizons, Pioneers: distance now and signal time), and a "look up now" nudge a
      minute before each visible ISS / Tiangong pass while the page is open
- [x] Look up "Red": a red-light view that keeps your eyes dark-adapted (remembered)
- [x] Clouds tonight (Open-Meteo, CC BY 4.0; location rounded to ~10 km): clear spells in words, the next clear night, and each
      pass marked clear / cloudy (core/clouds.js, tested)
- [x] "Coming up in the sky": the Moon within 5° of a bright planet, planets within 3° of each other, next 30 days (core/sky.js meetings)
- [x] Look up: tap a planet, the Moon, a bright star or a satellite to find out what it is (distance, light travel time,
      "the light reaching your eyes left Vega in 2001"; core/skyfacts.js)
- [x] Tonight "Share tonight": a one-line summary of your sky with a link, to the share sheet or the clipboard
- [x] Look up "Find": pick a planet, the Moon, the ISS or a bright star; an arrow and "turn right 32°, up 11°" lead you to it
      (core/orientation.js guide, tested)
- [x] Look up hides things on the ground (employer towers, volcanoes, lighthouses, pads, quakes, buildings): from eye height
      they were the "streaks" seen across the sky
- [x] Tonight: the next solar eclipse you can see from home (how much of the Sun, when; "Watch the shadow"); sections fold
      (remembered)
- [x] People in space right now (Launch Library 2 astronauts, build copy in data/astronauts.json, core/crew.js tested): a card
      with names, flags, agencies, days in space; "Aboard now: 11 people" on the ISS and Tiangong cards; in Tonight and search
- [x] tonight.html: the Tonight card without the 3D globe (src/sky/main.js wires light feeds into src/globe/tonight.js, which
      no longer imports the globe; core/observer.js replaces Cesium for passes). Phone profile: card 1.2 s, full answer 1.7 s
      after location. Landing page and the app shortcut link here
- [x] Bug hunt rounds 1-2 (2026-10-05/06): 24 + 56 confirmed defects fixed (three reviewers, then a 213-agent workflow:
      10 finders, 3 verifiers per finding, a seeded second round). Headline fixes: a ticket number like AA1234 was read as
      a hex address; "tonight" opened pre-dawn described the minutes to dawn; meteor peak nights were a day off west of
      UTC+6; cards overwrote each other; look-up leaked models, buildings and clicks; the build's launch/crew copies
      were all-or-nothing; the site build now keeps the last good copy of any feed it can't refresh (see NOTES.md)
- [x] Live site 2026-10-06: data/tle/ is empty since the 06:28 UTC build (CelesTrak timed out on GitHub's runner); the
      next scheduled build (12:23 UTC) or a manual "Website" run restores it; with this branch's build_site.py a repeat
      would keep the previous copy instead (it does, and now warns when a kept group's elements are over 48 h old)
- [ ] Real-phone check: share sheet with a file (iOS Safari, Android Chrome), notifications on Android, .ics on iPhone

## Stage 5 — Ops pack: take on God's Eye View (2026-10-10; published from v0.9.2.7, 2026-10-11)
Benchmark: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (Node + Vite, Google 3D tiles, OpenAI voice).
Our edge stays: a URL that works on a phone, no keys, no install, and the zoom out to the cosmic web.
- [x] Sensor looks, keys 1-7: night vision, thermal (white hot, black hot, ironbow), CRT, noir. One post-process pass
      (src/globe/ops.js); off = disabled, no cost. Stylised: "thermal" maps brightness + Sobel edges, not temperature
- [x] Tactical HUD (H): compass tape, reticle, the ground under it in lat/lon and MGRS (core/mgrs.js, tested against
      GeoTrans), altitude, ground sample distance, UTC, a lock line with range for the followed object
- [x] Detection (D): boxes + IDs on the nearest 46 things in view (22 on phones). Scanning all 18,747 objects costs 2 ms,
      4 times a second; frame time with HUD + boxes + thermal on = 5.5 ms median, same as off (RTX 3060, headless Edge)
- [x] Cockpit (C): ride a followed satellite (or a plane, download version) along its path; drag to look, wheel to zoom,
      Esc out; the model and its orbit line hide while you're inside
- [x] Voice (V or the mic), keyless: the browser's speech recognition + core/voicecmd.js (tested) + spoken answers.
      Go to places, track things, sensors, layers, views, "what's this", "how many satellites are in view". Chrome, Edge, Safari
- [x] Places by name in Search and voice: Photon (komoot, OpenStreetMap), only the typed words are sent (src/globe/places.js)
- [x] Share links keep the look (&o=nvg.h.d); landing page section with three captures (brand/lander/ops/)
Round 2 (2026-10-10, local):
- [x] Public relay on the owner's Cloudflare account (relay/, Workers Cache in front): NOAA NHC, NYC cameras and the
      live cable map now work on the website. The ADS-B networks and OpenSky refuse Cloudflare's servers, so live
      aircraft still need the download (see docs/NOTES.md "Public relay"; adsb.lol says feeder API keys are coming)
- [x] Live aircraft through the relay, tried and dropped: the 2026-10-15 deploy with adsb.lol was rolled back (adsb.lol
      answers Cloudflare with 429), and the relay redeployed on 2026-10-17 carries no aircraft host (relay/worker.js:
      not adsb.lol, not OpenSky, whose terms forbid passing the data on). On the website both views now say once that
      live aircraft come with the free download and stop asking (core/relay.js markNotCarried). core/airgrid.js's tile
      grid stays for a future relay; the open item is "Live aircraft on the website" below
- [x] Photoreal 3D cities: Google tiles via the visitor's own Cesium ion token; Google's geocoder while on (src/globe/photoreal.js)
- [x] Tropical cyclones on the globe: NASA EONET tracks + NOAA NHC advisories (src/globe/storms.js)
- [x] Directions: drive / walk / cycle (FOSSGIS OSRM), turn-by-turn, "fly it", by voice (core/route.js tested)
- [x] Launch replays: a reconstructed ascent per listed launch, labelled an estimate (core/ascent.js tested)
- [x] Director: shots, cinema mode, scenes as links or files (core/scene.js tested)
- [x] Mapped cameras and plate readers from OpenStreetMap (Overpass), with view wedges (src/globe/surveil.js)
- [x] Lightning in weather mode (NOAA nowCOAST, the Americas and the Pacific)
- [x] World radio with an analog tuner: 3,000 stations, the dial snaps to real stations and flies to them (src/globe/radio.js)
- [x] Live transit: Boston (MBTA), Helsinki (HSL, MQTT over WebSocket), Norway (Entur), interpolated between reports
- [x] Live traffic cameras projected into the 3D city (src/globe/cams.js): TfL (stills + video), NYC, Caltrans, Fintraffic;
      the picture is cast onto the ground or Google's buildings from an estimated pose (core/campose.js, tested), with an
      image plane, frustum and coverage; Look through + drag to line up, Save; 'Nearest camera' hand-off from any card
- [x] Traffic: simulated cars on real roads (src/globe/traffic.js): OpenFreeMap vector tiles (core/mvt.js, core/roadtiles.js),
      car following, lights at busy junctions, density by road type and local time, drive side by country; measured
      speeds/counts drive the cars and colour the roads in New York (NYC DOT) and Finland (Fintraffic) (core tested)
- [ ] Traffic: a TomTom flow overlay for visitors who bring their own key; per-lane counts where Fintraffic has them

### Round 3: what God's Eye View does better (ranked in docs/GEV_STUDY.md)
- [x] Keyless 3D terrain (Re:Earth / Mapterhorn; a layer, off on phones); cars, buses, parked planes, mapped cameras, OSM
      buildings, projected cameras, look-up and the route fly-through stand on it; exact heights near the view
- [x] Aircraft icons that point along the course from any camera angle (alignedAxis = the course vector)
- [x] Aircraft motion: fixes stamped with the feed's own time, dead reckoning through a turn (core/geo.js, tested), new
      fixes eased in instead of jumping, geometric altitude where the feed has it
- [x] Hazards: NOAA forecast cones, tracks, coastal watches/warnings and wind fields + GDACS cones for every other basin;
      wildfire hot spots worldwide (NASA VIIRS via GIBS vector tiles, keyless) and US perimeters (NIFC) (core/hazards.js tested)
- [x] Before/after: recent Landsat / Sentinel-2 pictures of the view (NASA CMR + GIBS HLS, VIIRS daily), split by a slider
- [x] More live cameras: live video from DelDOT, Iowa DOT, Statens vegvesen and MoDOT (HLS, hls.js on first use), stills
      from Hong Kong, Singapore, Calgary and DriveBC: 12 networks (Austin, NSW, TxDOT, Tallinn left out: see DATA_SOURCES)
- [x] Bike share worldwide (CityBikes, ~800 systems; core/bikes.js tested), Austin + Minneapolis transit (GTFS-RT,
      core/gtfsrt.js tested), Baltic ships (Digitraffic AIS: arrows far out, true-size hulls with wakes close in; core/ais.js tested)
- [x] One weather timeline: the last 2.5 h observed (satellites, radar) then NOAA GFS every 3 h to +5 days (wind,
      temperature, cloud, rain), read in the browser by byte range (core/grib2.js + core/gfs.js tested; no build step,
      no ECMWF yet); the globe's clock follows the slider and the slider follows the clock
- [x] Battery saver: 5-15 frames a second while nothing moves (96% fewer frames idle in high orbit), full speed on any
      input, motion, tiles loading, fast time, following, close-up traffic (src/globe/saver.js)
- [x] Voice: "what's this?" about what the pointer rests on, numbered answers ("the second one"), weather at a place
      ("is it raining in London?"), counting over a place ("how many planes over Texas?"), hold Space to talk, the
      best voice the browser has, a short sound for listening and answers (core/voicecmd.js tested)
- [x] Draw and measure (band → Measure, M, or voice): pins, lines, areas and distance arrows (up to 512 points), each leg and
      the total over the WGS84 ellipsoid (Vincenty, a bisection near the antipode: within a millimetre of GeographicLib),
      areas on it (within 0.001%), the trip by road (OSRM), length over the hills and the climb on 3D terrain, "outline
      France" with its area, GeoJSON out; draped with ClassificationType.BOTH; a compact card on phones (core/measure.js tested)
- [x] Share links, embeds and shared pictures carry the drawing (`&d=`: ~0.1 m points, names, the road, outlines; checked
      shape by shape on arrival, tested in core/measure.js and core/viewlink.js)
- [x] The MCP package (mcp/, `open-overwatch-mcp`): 14 tools answering from the same open data (earthquakes, where a
      satellite is and its passes, launches, crew, flybys, cyclones, EONET events, Baltic ships, bike share, weather, the
      aurora, tonight's sky), each with a link that opens the globe there; show_on_globe puts the globe in the chat as an
      MCP App (a frame of the site in embed mode, moved by hash); no SDK, one dependency (satellite.js); a Claude Desktop
      bundle (.mcpb) built by the release workflow; npm publish needs the owner's npm account (test/mcp.test.mjs)
- [x] MCP 0.2.0: 13 more tools, 27 in all (traffic cameras with the latest pictures as images, live transit, VIIRS
      wildfires grouped into fires with NIFC's named US fires, country briefings, submarine cables, the planets and their
      next events, solar eclipses from a place, distances drawn on the globe, volcanoes, measured road speeds, near misses
      in orbit, sun and moon times, meteor showers), five prompts, a Worker-ready fetch handler (token-guarded, not
      deployed) and
      a Streamable HTTP transport (`--http <port>`, stateless, loopback only, Host/Origin checks; Worker-ready handler, not
      deployed); camera networks and transit feeds shared with the globe through src/core
- [x] MCP 0.3.0 (2026-10-13, branch grow2-mcp): a remote endpoint for claude.ai and ChatGPT connectors on Cloudflare
      Workers (mcp-worker/ + mcp/worker.mjs: stateless Streamable HTTP at /mcp, a token in the header or the path, CORS
      for claude.ai and ChatGPT, every feed and tool answer shared through the Workers Cache API, a subrequest budget, a
      rate-limit binding, the free plan's 10 ms leaving the 11 heaviest tools out; tested in Node, bundled and smoke-run
      in local workerd, not deployed); 3 more tools, 32 in all: `weather_details` (pressure and its tendency, gusts,
      CAPE, fog, waves and swell, ECMWF/GFS/ICON agreement; core/wxpoint.js), `aircraft_lookup` (adsbdb: type, owner,
      route) and `where_in_space` (any mission, comet, moon or named asteroid now; asteroid elements by byte range;
      core/whereis.js); stdio split into mcp/stdio.mjs so nothing the Worker imports needs Node
- [x] Deploy the MCP Worker (`npx wrangler deploy` in mcp-worker/, a `MCP_TOKEN` secret): deployed 2026-10-13 (version
      aaf0e183, mcp-worker/wrangler.toml)
- [ ] Redeploy the MCP Worker with the 2026-10-17 code (the /mcp/%zz 404, parse caching, EMSC in `earthquakes`): the
      owner's call, not decided yet; then check the globe panel over a remote connector in claude.ai (MCP Apps support
      there is the host's)
- [x] Country lookups across the antimeridian: Russia no longer claims Canada and Alaska (core/borders.js, the globe's card too)
- [x] Emulator pass of v0.9.2.7 (Android Chrome 124 + WebKit iPhone 15): every new layer holds the phone cap of 30
      renders/s while dragging, the battery saver idles at 5-15, no script errors in either engine, layer caches stay
      flat after the first use; launch labels of one site now share one label (+N)
- [x] The measure card on iPhones: while placing points it is a 52 px strip above the dock (the running total, Undo,
      Finish, a chevron for the rest); card and dock went from 46% to 21% of the screen (WebKit iPhone 15 profile)
- [x] Aviation (GEV item 17, branch grow-aviation): the aircraft card says what a plane is and where it is going (adsbdb:
      type, registration, owner, a photo, the route its callsign flies, checked against where the plane really is) and
      the type picks its model class (narrow/wide-body, regional, turboprop, business jet, helicopter, light, fighter,
      military; core/actype.js tested: ~600 type codes, families, emitter categories); cockpit weather in the HUD
      (Open-Meteo pressure levels: wind with head/tail and cross components, OAT against ISA, TAS and Mach, cloud,
      visibility, an icing hint, nearest airport, destination; core/aloft.js tested); an Airports layer with
      arrival/departure/ground boards from the live aircraft (OurAirports, public domain; core/airports.js tested);
      trails of the followed, selected or pinned planes coloured by altitude, 10/30/60 min (core/trail.js tested)
- [x] Aviation, round 2: flight phase (parked … cruise … on final; core/phase.js tested) on the card, in the cockpit HUD and
      in spoken answers; the route arc to the destination (only for a route that fits); airport weather with a
      VFR/MVFR/IFR/LIFR category (estimated cloud base); search "A380", "747", "helicopters", "private jets"; voice
      "arrivals at Heathrow", "what's taking off from JFK?", "what plane is that?", "show trails"; boards list planes
      that just landed or took off (from their last two fixes) and flag emergency squawks; "Tell me when it lands"
      (a notification on final and at touchdown); trails as GeoJSON; type codes in DET labels; tower view (watch a
      plane from the field's tower with a lens that keeps it framed)
- [x] Runways (OurAirports, public domain; data/runways.json, 5,777 runways at 4,016 airports): the runway in use (what
      arrivals are lined up with, else into the wind) and the wind on it on airport cards, "final 34R" on board rows,
      "On final for 34R" on plane cards and in the cockpit HUD (core/runways.js tested)
- [x] Aviation, round 3 (branch grow2-aviation): the airport's own METAR and TAF in plain words on its card (Aviation Weather
      Center, through the download's local helper: AWC sends no CORS; core/metar.js tested against AWC's decode of 191
      METARs and 41 TAFs), airport dots coloured VFR/MVFR/IFR/LIFR; board times as estimates with a range (distance,
      ground speed, descent; narrow on final, wide far out or turning) that keep score when planes land
      (core/eta.js tested); runways used in the last hour and the last change of flow, read from the trails of planes
      polled every 15 s near the open or kept airport (core/runwaylog.js tested on Denver's layout); voice "METAR at Denver",
      "Which runway is Heathrow using?"; MCP tool 30, `airport_weather` (Node asks AWC directly)
- [ ] Aviation next: the MCP server answering "what's landing at X" (Node reads the aircraft feeds directly),
      business-jet and regional-jet models of their own instead of a scaled airliner
- [x] NYC traffic: measured speeds were all dropped (NYC DOT publishes ~a day late; the cut-off was 4 h). Now up to 48 h,
      with the age said on the card; 70 measured road pieces around the FDR. Midtown's side streets have no sensors at all
- [x] OpenStreetMap layers without Overpass (GEV_STUDY 16; core/osmtiles.js tested): military areas from OpenFreeMap
      `landuse` z9-12 (filled, outlined without tile seams, joined across tiles, named by the military airfields inside or
      on a click), every mapped licence-plate reader in the US and Canada from the DeFlock/FlockHopper tiles (a dot cloud
      from orbit, make/operator/facing close up), and 3D buildings with their mapped heights and colours from OpenFreeMap
      z14 (Overpass only as the fallback; phones get 4 tiles and skip sheds)
- [x] Plate readers and military areas on the 2D map too (src/map/osmlayers.js, the same tiles and core code)
- [x] Directions: a drive in the US or Canada counts the mapped plate readers within 40 m and how many face along the road
- [x] MCP tools `plate_readers` and `military_areas` (mcp/osm.mjs, the same core code)
- [ ] Plate readers outside the US and Canada still come from Overpass (surveil.js) until someone tiles the world's
- [x] Solar System growth (2026-10-12, branch claude/grow-solar-ac7965): 22 Horizons missions (Juno, JWST, BepiColombo,
      Solar Orbiter, Hera, OSIRIS-APEX, Hayabusa2, Cassini, Rosetta, Dawn, Galileo, Ulysses added) with flown/planned
      paths, event markers, mission cards (signal time, next event countdown, timeline that sets the clock) and a
      "missions now" list; comets with comae and physical ion + dust tails (exact syndyne), open orbits (3I/ATLAS),
      perihelion timelines and a "comets near the Sun" list; "Where is it now?" ranked search over everything with
      where-in-Earth's-sky; the view as a link (#f=, #t=, #d=, #q=); Sun-Earth L1/L2. Tests against Horizons fixtures
- [x] Solar: comet brightness (SBDB M1/K1): "brightest now" with each comet's peak, "coming up" (due to peak brighter
      than 12 in three years), magnitudes on cards and in the coma glow; comets with stale orbits left out (core/comets.js
      tested against Horizons T-mag)
- [x] Solar: Juno at 1-day steps and on its osculating orbits around the drawn Jupiter, 30-minute sets at each of its 109
      perijoves (within 150 km of Horizons through a pass; was ~200,000 km), its orbit drawn there, perijoves on its card
- [x] Solar: eclipses and lunar occultations 2026-2030 from space (core/syzygy.js on a Horizons Sun/Moon fit): the Moon's
      shadow on the globe with its cones, the red Moon inside Earth's umbra rings, the Sun-Earth-Moon line, the Moon's
      "shadow" toward a star; a list with Jump / play buttons, searchable event cards whose timeline holds the contacts.
      12 solar + 12 lunar eclipses match NASA's canon (time < 2 min, magnitude < 0.01); 139 occultations (bright stars,
      five planets) checked against published events
- [ ] Solar: occultation ground tracks (where on Earth the star disappears, as a band on the globe) and grazes; Uranus,
      Neptune and the dwarf planets; the 2031+ eclipses need a longer Horizons fit
- [x] Weather 2.0: ECMWF IFS open data (0.25°, CC BY 4.0) beside GFS, read in the browser by byte range like GFS (a
      CCSDS decoder for its GRIB2, core/aec.js); a model switch and a side-by-side slider (washes split, streaks and H/L
      follow their side); sea-level pressure as isobars every 4 hPa with H and L (core/contour.js); gusts; ocean waves
      with direction darts (NOAA WAVEWATCH III via a JPEG 2000 decoder, core/jpx.js; ECMWF's wave model); a legend, a
      point readout, and voice answers with gusts, pressure and its trend, the sea state (decoders checked against eccodes)
- [x] Shared feed core (2026-10-12, branch grow-map-core): quakes, EONET, GDACS, cyclones, cameras, aurora, cables, aircraft,
      transit feeds, Overpass, radio mirrors, OSRM and passes parsed once in src/core (tested) for the 2D map, the globe
      and the MCP server; the views' own copies deleted
- [x] The 2D map catches up: Baltic ships moving between reports (core/ais), bike share, live transit (Boston, Helsinki,
      Norway, Austin, Minneapolis), cyclone cones / warnings / wind fields, keyless wildfire hot spots and US perimeters,
      all twelve camera networks with live video, draw and measure (R), share links in the globe's format, and the map
      and the globe open each other on the same place with the matching layers and the drawing
- [x] The 2D map catches up, round 2 (2026-10-13, branch grow2-map): forecast weather from the globe's models (wind
      streaks, temperature, pressure with isobars and H/L, gusts, cloud, rain, waves with darts; GFS or ECMWF) on Mercator
      tiles with a timeline bar (now to +5 days, play, legend, every field at the pointer), carried both ways in links
      (`w=`); aircraft cards with adsbdb's type, owner and route (checked against the plane), the flight phase and the
      runway it is lined up with; an Airports layer with live boards, the field's weather and category, the runway in use
      and the wind on every runway, runways drawn from zoom 11; airport search
- [x] Shared with the globe through src/core (tested): the model loader and its worker (wxload), how fields are drawn
      (wxpaint), adsbdb (acinfo), board/card/route/runway words; the map's own sun model, geodesy and escaper deleted
      for core's (subsolar, nightRing, geo, format)
- [x] 2D map, round 2 continued: the two models side by side with a draggable divider; the weather at a plane's height
      on its card (core/aloft.js aloftWords); trails coloured by altitude with stats and GeoJSON (core/trail.js)
- [ ] 2D map: the tower view, the landing watch and the route arc are still globe-only
- [ ] Live aircraft on the website: only with a feed's agreement (an adsb.lol feeder key, or OpenSky's permission)
- [x] An MCP server (download version): mcp/, 38 tools in 0.4.0
- [ ] A real-phone check of everything above
- [ ] Publish `open-overwatch-mcp` to npm (needs the owner's npm account with 2FA): not for now (owner, 2026-10-17)
  - [x] Ready to publish (eng/npm): a 105-file tarball checked against the import graph (test/npmpack.test.mjs),
        `.github/workflows/npm.yml` (trusted publishing, provenance, off until `NPM_PUBLISH` is true), `mcp/server.json`
        for the MCP Registry; the owner's steps are in brand/launch/mcp-listings.md (not in the repository)

### Installable app, touch hints, accessibility (grow-pwa-a11y, 2026-10-12, local)
- [x] Service worker (sw.js, scope = the site root): the app opens offline (pages + every module, found by reading the
      pages' imports at install), live-feed copies under data/ are network-first and come back marked when offline,
      datasets and brand assets stale-while-revalidate, pinned CDN libraries and base-map tiles cache-first (CORS only),
      live feeds and the relay untouched; offline banner, offline.html for unsaved pages, "new version" prompt with Reload
      (build_site.py stamps the version + commit into sw.js), Install button on the landing page where Chrome offers it
- [x] Archived /v/<tag>/ versions and the download (serve.js) are safe: archived pages never register or touch the
      worker and it passes their requests through; on localhost it is off unless ?sw=1 (?sw=0 removes it).
      brand/tools/pwa_check.mjs proves both on a Pages-like layout: Edge 10/10, WebKit iPhone 10/10; Android Chrome:
      installable (no installability errors), offline landing + Solar System
- [x] First-run touch hints on the globe and the 2D map (phones only, once per view, ?hints=1 again), and the long
      press they teach: "This spot" (decimal, DMS, MGRS, Copy, Share with a pin, Pin it, the country) on the globe, a spot
      popup (Copy, What's here, 3D globe) on the map. gesture_check.mjs: Edge Pixel, WebKit iPhone, Android emulator 8/8 each
- [x] Accessibility layer (src/app/a11y.js) on all six pages: toolbars move with arrow keys, the map's panel is real tabs,
      aria-pressed / -current / -expanded follow the views' classes, selections are said once in a live region (the
      globe card no longer re-reads every tick), skip links, focus rings, the globe turns / zooms / tilts / picks from
      the keyboard, the Solar System's search is a combobox; reduced motion stops CSS animation everywhere
- [x] Contrast: the faint text colour #55667a (3.1-3.5:1) is now #738599 (4.6-5.4:1) on every page; symbol-only time
      buttons and the Solar System search got names. HTML check (core/a11ycheck.js) in the tests and in CI
- [x] Solar System camera flights still swoop with reduced motion on in v0.9.2.14 (the globe's already jump). Fixed on
      rebuild: src/solar/util.js CALM, used by focusOn, flyDist and the hand-over roll (off CONTRIBUTING.md's good
      first issues and test/docs.test.mjs since 2026-10-17)
- [ ] Real-phone check of install + offline (iOS: Add to Home Screen from Safari's Share menu; no install prompt there)

### Earth now dashboard (grow2-dashboard, 2026-10-13, local)
- [x] "Earth now" panel on the 3D globe (band button, `E`, `#go=now`; a folding sheet on phones): quakes (24 h count,
      strongest, busiest regions, per-day charts for 7 days M2.5+ and 30 days M4.5+), tropical cyclones, aurora (Kp now in
      words, 3 days + 1 day forecast chart with the G1 line), launches in the next 24 h with countdowns and per month,
      people in space, flybys this week, EONET wildfires (prescribed burns apart), the model's hottest / coldest /
      windiest point; every line switches its layer on and flies there. Sums and SVG charts in core/earthnow.js (tested)
- [ ] Launches per month from real history: the site copies only upcoming launches; a trimmed `launches/previous` copy
      in build_site.py (a few more LL2 requests per build) would give a true monthly count. Needs the owner's OK
      (not decided on 2026-10-17, so left out of v0.9.2.15)
- [ ] An `earth_now` MCP tool on the same core sums
### Time travel (grow3-timetravel, 2026-10-13, local)
- [x] One clock, real history: with the globe's clock in the past, earthquakes come from the USGS catalogue (24 h before
      the time shown, back to 1900), cyclones from EONET's closed events and GDACS's past cyclones (track cut at the time
      shown, position interpolated, no forecasts), a new `events` layer (EONET eruptions, fires, floods, ice: live 20
      days, or the time shown), and satellites from a daily archive of element sets (core/history.js, tested on real
      USGS and EONET answers; Ian's landfall within 12 km of NHC's point)
- [x] Site build: `data/tle/history/` keeps one snapshot a day for 30 days (17 groups, ~0.55 MB a day), carried between
      builds in an actions/cache folder with the live site as fallback, pruned; tested in Python from `node --test`
- [x] Time travel panel (band, `#go=history`, phone Time sheet): slider, UTC date box, ±1 h / ±1 day, 1 day / week /
      30 days / year back, six moments (Tōhoku, Ian, Haiyan, Türkiye–Syria, JWST, Apollo 11), what came back per layer,
      what is live only; links carry `t=` and `go=history`. Aircraft and upcoming launches hide in the past
- [ ] The archive fills from the first site build after publishing: until then rewinds use today's elements within a
      week and hide satellites further back
- [ ] Archive Starlink too? 1.8 MB a day (54 MB for 30 days on Pages): the owner's call
- [ ] The 2D map has no time travel yet (its quake and EONET layers could share core/history.js)
- [ ] Past fire hot spots (GIBS VIIRS tiles are dated: fires.js could ask for the day shown)

### End-to-end browser tests (grow2-e2e, 2026-10-13, local)
- [x] Playwright suite (`e2e/`, `npm run e2e`, port 8805): every page in headless Chromium with software WebGL, the feeds
      stubbed (CelesTrak refused, fixtures in e2e/support/feeds.mjs), main controls driven, share links both ways, phone
      layouts (Pixel 7), five picture checks against small thumbnails; its own CI job (docs/TESTING.md)
- [x] Fixed on the way: the 2D map's "3D globe" button lost the view on a middle-click
- [ ] At 1366x820 the globe's zoom pad covers the right end of the band (Measure, Eclipses, Solar system ↗)
- [x] The 2D map's phone bar buttons are 37.5 px tall in v0.9.2.14: under the 44-48 px a finger wants. Fixed on
      rebuild: 44 px (open-overwatch.html `#mobilebar button`; e2e/phone.spec.mjs checks 44; off CONTRIBUTING.md's
      good first issues and test/docs.test.mjs since 2026-10-17)
- [x] First CI run on Linux: if fonts push the picture checks past their limits, add `<name>.linux.png` references
      (e2e/snapshots/tonight-phone.linux.png)
- [ ] Refresh e2e/snapshots/globe-europe.png on the next GitHub run (`OO_E2E_ALL=1 OO_E2E_UPDATE=1`): it was taken at
      the old Low quality level, which no level now matches; look at it before committing it
- [ ] Run the browser tests written on 2026-10-17 on GitHub (a push to ci-e2e needs the owner's OK): the globe to
      Solar System hand-off and back, the #go= panels, weather mode, an Ops look, voice, Tonight's #at= links and embed,
      the phone Low tier with Starlink off, and the EMSC mock. The delayed no-aircraft line has no browser test (only
      source checks in test/globesite.test.mjs): look for it on a normal globe run there
### Oceans and air (grow3-ocean, 2026-10-13, local)
- [x] Globe and 2D map: NOAA NDBC buoys and coastal stations (`buoys`, ~870, coloured by wave height), DART tsunami
      buoys (`dart`, ~75; the card reads the buoy's file: water column, event mode), NOAA CO-OPS tide gauges (`tides`,
      ~300 US; the card reads the level now and the next high and low), sea-surface temperature (`sst`, GHRSST MUR via
      GIBS) and smoke and dust (`smoke`, the OMPS UV aerosol index via GIBS) with legends from GIBS's own colour maps;
      clicking the sea reads the value back from the tile's pixel; air quality (`airq`, the CAMS model via Open-Meteo
      on a grid over the view: OpenAQ v3 needs a key). Parsers and card words in core/ocean.js (tested on captured
      answers); MCP tools `sea_conditions` and `air_quality`
- [x] **The website needs the relay redeployed** for buoys and DART: NDBC sends no CORS, `www.ndbc.noaa.gov` is added to
      relay/worker.js (TTL, PATHS) and PUBLIC_RELAY_HOSTS, but the Worker on Cloudflare runs the old list until the owner
      redeploys it (`npx wrangler deploy` in relay/). Tides, sea temperature, smoke and air quality need no relay.
      Redeployed 2026-10-17, with www.tsunami.gov beside it and no adsb.lol
- [ ] Tsunami messages (NTWC and PTWC, tsunami.gov's Atom feeds, already on the relay): a parser in src/core, a line
      on quake cards with a tsunami flag, on DART cards in event mode and in Earth now, and an MCP tool (deferred from
      the 2026-10-17 audit, product-5)
- [ ] After the relay redeploy: probe one NDBC or camera target twice with different `&t=`; the Worker's inner cache
      (caches.default) only takes effect on a custom domain or route, not on *.workers.dev
- [ ] Iowa DOT stills: its camera list was empty on 2026-10-17; when it has rows again, check one ImageURL against the
      relay's `atmsqf.iowadot.gov` PATHS rule (/snapshots/ or an image file, no query string), or Iowa stills get a
      quiet 403 on the website
- [ ] Ocean next: NOAA's HF-radar surface currents (ERDDAP, CORS); Argo floats; a tide curve on the card (the 6-minute
      predictions); tide gauges outside the US (IOC sea level monitoring, no CORS: relay); the 2D map's click-to-read
### CI security and coverage (ci-security-coverage, 2026-10-14, local)
- [x] Dependabot (npm and github-actions, weekly, grouped, against main), CodeQL (JavaScript and actions; push and PR
      to main, weekly; data, renders and fixtures skipped), `npm audit --audit-level=high` and a licence allowlist
      check (`brand/tools/license_check.mjs`, no new dependency) in the test job, and a coverage floor (`npm run
      coverage`: src/core and mcp, lines 96 / branches 81 / functions 91 against 99.3 / 84.2 / 94.3 measured)
- [ ] Raise the branch floor as the MCP tools' error paths get tests: 83 since the 2026-10-17 MCP error-path tests
      (package.json `coverage`; 84.96 % measured). Lowest now: mcp/wxdetail.mjs 46 %, airportwx.mjs 53 %,
      volcanoes.mjs 62 % branches

### Provenance on every live layer (provenance-layers, 2026-10-14, local)
- [x] Every live card on the globe and the 2D map says who reported it, how many sources agree, how old the data is
      (core/liveprov.js stamps; docs/NOTES.md "Provenance on every live card")
- [x] Real agreement where the site merges feeds: aircraft (both views), storms (NHC / GDACS / EONET, one vote per agency),
      quakes (USGS + GDACS alerts, 2D map), ships (Digitraffic + aisstream, 2D map); tolerances tested
- [x] Export what's in view as GeoJSON, CSV, KML with provenance (core/export.js); MCP answers carry `provenance`
- [x] A second earthquake catalogue (EMSC) so quakes can be confirmed, not only reported (new feed: owner's call):
      seismicportal.eu beside USGS on the globe, the 2D map and the MCP `earthquakes` tool (core/quakes.js emscSource)
- [ ] EMSC's busy windows (a week or a month, M1+ in a day) are cut at 1,000 events (core/quakes.js emscUrl; EMSC's own
      ceiling is unchecked), so older USGS quakes there stay "reported"; the significant-month floor stays M4.5
- [ ] Ask a second aircraft network once for the plane whose card is open (one request), so the open card can confirm

### Re-entry predictions: Falling soon (reentry, 2026-10-14, local)
- [x] core/decay.js: perigee/apogee, decay from n-dot (B* as fallback and cross-check) through a solar-scaled exponential
      atmosphere, a window of ±25% of the time left, the corridor ground track; tested on Tiangong-1 and GOCE (real dates
      inside their windows) and by hand against Aerospace CORDS (docs/NOTES.md "Re-entry predictions")
- [x] Globe "Falling soon" list and cards (window in plain words, uncertainty, provenance), `reentry` corridor layer (off),
      `go=reentry[&id=]` links; the 2D map's `reentry` layer; MCP `reentries` (38 tools with `dark_sky`); guide section on the uncertainty
- [ ] Live F10.7 and Kp for the atmosphere (SWPC `json/f107_cm_flux.json` and the Kp feed the aurora layer reads) instead of
      the documented default
- [ ] Rocket bodies: a decaying-objects group copied by the site build (needs a source that may be redistributed)
- [ ] Tell station-kept satellites from falling ones (SATCAT operational status, or two element sets a few days apart)

### Left over from the 2026-10-17 audit (v0.9.2.15, local)
- [ ] At publish: give 0.9.2.15 its date in src/core/whatsnew.js (test/whatsnew.test.mjs fails once CHANGELOG.md has
      the heading and the entry has none)
- [ ] Owner, outside the repo: point the Hindi Meta ads at `india/hi/` (the URL is in docs/INDIA.md), and reword the
      Instagram bio and first post, which still mention planes
- [ ] brand/tools/make_cards.mjs still makes an "11,737 planes" card: new copy or retire it; don't post it as it is
- [ ] Kepler-90's planet cards keep the archive's designations (KOI-351 ...): an alias per planet would fix it
- [ ] Solar System lines: Earth's is the Earth-Moon barycentre's orbit (up to ~4,700 km from Earth's centre); a comet
      within PARABOLIC of e = 1 is placed as a parabola (core/comets.js), a little off its line; Moon-centred mission
      tracks jump up to ~5,000 km at orbit burns (core/craft.js; a later local start for Chandrayaan-2 needs a new
      Horizons fetch)
- [ ] test/localpaths.test.mjs scans chosen folders; scanning every tracked .md/.html/.json would need its own allowlist
- [ ] A public page (and an MCP tool) saying which feeds are stale or failing (deferred from the audit, product-6)
- [x] Credits, licence lists, privacy notices and claims brought into line with the code and the upstream terms
      (attribution and docs package: Esri, OSM links, OpenSky's paper, non-commercial list, NOTICE, home-page a11y)
- [ ] Left from that package (files owned elsewhere that round): a file:// boot message on open-overwatch.html like
      globe.html's; the OSM link in src/globe/osmbuildings.js's credit and the 2D map's Setup "Base maps" row; OpenSky's
      paper in the 2D map's Setup sources panel; an a11ycheck rule for Devanagari text without `lang="hi"`
      (test/attribution.test.mjs checks four pages only)
- [x] README promotion (readme package, round 3): one-line install / run per platform, a comparison table with
      Stellarium Web, NASA Eyes, Flightradar24, Celestia, KeepTrack.space and gods-eye-view, "Why not just use X?", the
      /sky/ city pages and /teach/ in the feature list; CONTRIBUTING.md's good first issues are the four drafted for
      GitHub (zoom pad, `earth_now`, Kepler-90's planet names, the home-folder scan), checked by test/docs.test.mjs
- [ ] README: add the clean-machine install test sentence (brand/launch/readme-promo.md, not in the repository) once
      `.github/workflows/install-test.yml` is on the default branch and has gone green on a release; re-check the
      comparison's "not checked" and "that we know of" cells (KeepTrack offline, a Flightradar24 MCP server) and
      gods-eye-view's hosted version before each release
- [ ] Owner: open the four good first issues on GitHub (drafts and `gh` commands in brand/launch/good-first-issues.md,
      not in the repository),
      then link each CONTRIBUTING.md item to its issue

## Rules of thumb
- One clear goal per session; read this file first, tick boxes as they land.
- Core code is plain ES modules with no DOM/three.js imports, so Node can test it.
- No build step: browsers load `src/` directly; CDN libraries via import maps.
- Never point automated runs at CelesTrak (the site mirrors TLEs); look-dev renders use `brand/tools/globe_shot.mjs`.
