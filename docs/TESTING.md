# Testing

## Unit tests
`node --test` from the repo root (the browser tests are separate: [below](#end-to-end-browser-tests-playwright-in-ci)): the maths in `src/core/` against JPL Horizons fixtures and textbook identities, the country lookup (`core/borders.js`: cities land in their countries, ocean is nobody's, every border has facts) and the share-link format (`core/viewlink.js`: round trip, bad links refused)
(no dependencies). CI runs them on every push, plus a syntax check of every module and a link check of every page.
[DEVELOPING.md](DEVELOPING.md#3-tests) has the table of what each file covers. Two kinds behave differently: the site
build's tests (`sitebuild`, `sitebudget`, `tlearchive`) run `.github/build_site.py` in Python and are skipped without
it, and `test/india.test.mjs` reads the real date: from two weeks before an ISRO track runs out (Chandrayaan-2 on
2026-11-08, Aditya-L1 on 2027-01-19) it prints a `WARNING` diagnostic, without failing, that names the refresh
(`python brand/tools/make_spacecraft.py --only "Chandrayaan-2,Aditya-L1"`).

### Fuzz tests
`test/fuzz.test.mjs` (in `node --test`, a few seconds) feeds tens of thousands of mutated inputs to the decoders that
read untrusted bytes: GRIB2, CCSDS (AEC), JPEG 2000, vector tiles, GTFS-RT, METAR/TAF, MQTT and the text feeds' parsers
(the targets, mutators and checks are in `test/helpers/fuzz.mjs`). Each must return a well-formed result (no NaN or
Infinity where a number is promised) or throw an `Error`, within 250 ms a call and without asking for a typed array,
`Array` or `ArrayBuffer` of over 2^25 elements (2^28 bytes); round trips (AEC, tiles, GTFS-RT, METARs, MQTT frames) are
checked as properties. Each target runs in a worker, so a hang fails with the case it hung on. Cases come from a fixed
seed, so a failure is the same every run.

```bash
OO_FUZZ=1 node --test test/fuzz.test.mjs                     # 50 times the cases, from a new seed each run (a few minutes)
OO_FUZZ=1 OO_FUZZ_SEED=31337 node --test test/fuzz.test.mjs  # replay the seed a failure names (OO_FUZZ=n: n times the cases)
```

A bug it finds gets fixed in the decoder and its input added as a regression at the bottom of `test/fuzz.test.mjs`.

## End-to-end browser tests (Playwright, in CI)
`npm run e2e` (or `npx playwright test`) opens every page in headless Chromium against `serve.js` and drives it like a
visitor. It starts its own helper on **port 8805** (`OO_E2E_PORT` to change; an already running one there is reused
outside CI), so it never touches your :8787. CI runs it as a separate job (`e2e` in `.github/workflows/ci.yml`), so a
flaky browser never holds up the unit tests; its report, traces and failure screenshots are the `e2e-report` artifact.

```bash
npm install                                  # once: Playwright is a dev dependency (not in the npm package or the .mcpb)
npx playwright test                          # everything: desktop + phone, ~4 minutes on 2 workers
npx playwright test e2e/map.spec.mjs         # one page
npx playwright test --project=phone          # only the phone layouts
npx playwright test -g "share link"          # by name
```

**Which browser.** Playwright's Chromium when it is installed (`npx playwright install chromium`; CI installs
`--only-shell chromium`); on Windows without it, the installed Edge, so nothing has to be downloaded. `OO_E2E_CHANNEL=chrome`
or `msedge` picks one. WebGL is **software** (SwiftShader) by default: slower (the globe boots in ~20 s), but the same
picture every run and no GPU needed. `OO_E2E_GPU=1` uses the GPU and skips the picture checks. Two workers by default,
one on CI (`OO_E2E_WORKERS`): three software-WebGL browsers at once starve each other and the Solar System stalls.

**No live data.** `e2e/support/net.mjs` sits in front of every request:
- **CelesTrak is refused** before it leaves the browser (counted; the tests check the pages asked and were refused).
- The relay (`/proxy`) answers from fixtures and never reaches upstream.
- Pinned libraries and fonts (jsDelivr, cdnjs, Google Fonts) are fetched once into `e2e/.cache/` (git-ignored; CI keeps
  it between runs), so reruns are offline and byte-identical.
- Feeds get canned answers from `e2e/support/feeds.mjs`, in each feed's real shape and relative to the moment of the
  request: USGS quakes (the largest an M6.1 off Hachinohe), EMSC's catalogue (its own solution of that quake, so it
  reads "confirmed"), EONET, NOAA Kp and OVATION and SWPC's Sun data, NWS/NHC/GDACS (empty), the readsb
  aircraft feeds (three military, one Cessna squawking 7700), OpenSky, the TLE mirror (`test/fixtures/stations.tle`),
  launches and astronauts (`test/fixtures/ll2_*.json`), near misses (`data/socrates.json` from
  `test/fixtures/socrates-small.csv`), RainViewer's radar frames, the ISS position, GitHub's latest release,
  `versions.json`, and one Open-Meteo point forecast for Tonight. Open-Meteo grids (the weather panel) are never
  answered: its per-IP quota.
- Video (`.mp4`, `.webm`: the landing page's hero and demo clips) is refused. With request interception on, a playing
  `<video>` in headless Chromium stalled every later request of the page (modules, fonts, fixtures) and, through the
  shared browser, the next tests too; the clips are decoration with still fallbacks, so the tests check which clip is
  asked for, not that it plays.
- Map imagery (Esri, GIBS, OSM tiles) gets flat stand-in tiles; anything else is aborted and listed in the test's
  `blocked-requests.txt` attachment, so a new feed shows up as "blocked" rather than as a flaky live call.
`test/e2esupport.test.mjs` (in `node --test`) parses every fixture with the same `src/core/` parsers the pages use, so a
fixture can't drift from its feed's shape unnoticed.

**What fails a test.** Besides its own checks, every test fails on an uncaught exception, a `console.error`, or an
error status for one of the site's own files (`e2e/support/fixtures.mjs`); a test that expects an error says so with
`errors.allow(/.../)`. Site-build copies a local server can't have (`data/flybys.json`, `news`, `socrates`) are exempt.

| Spec | What it drives |
|---|---|
| `landing.spec.mjs` | the live strip (ISS, quakes, launch countdown), the version picker re-pointing the launch buttons, a retired version listed as a download (not in the picker), `?v=`, the fleet viewer, the phone demo tabs, every link into the site |
| `india.spec.mjs` | the India page: English by default and the Hindi toggle (remembered), `?lang=hi`, utm tags removed from the address and from shared links, the live strip, launches and the pass table, the phone demo, every link into the site; `india/hi/` opening in Hindi at its own address, with every link resolving |
| `guide.spec.mjs` | every link in the guide and about page (in-page sections, pages across the site, https outside), the "on this page" links, section labels, the skip link, the buttons into each view |
| `map.spec.mjs` | the 2D map: counters from the feeds, layers that stick across a reload, a click on a quake, view presets, the welcome card, the balloon layer's warning (Esc refuses, accept once per session), intel tabs and log, search (coordinates, a satellite), keyboard shortcuts, the share link round trip with a drawing, the 3D globe button (also on a middle-click), a globe link opening here, a hostile link |
| `globe.spec.mjs` | the globe: counters, the layer dock (persisted), the time bar, search (ISS, a country), launches and eclipses, time travel back to the quake catalogue and Now, Measure (`M`) and a drawing in a link (London-Paris 343.9 km), the share link round trip (camera, layers, paused time), "Classic map" on the same place, a hostile link; panels opened from a link (Earth now, falling soon, near misses, people in space, flybys, find a flight), weather mode on RainViewer's frames, an Ops look from a link and a voice command; and the hand-off: zoomed out to 400,000 km the Solar System takes over with the globe's clock and distance while the globe stops drawing, and its way home hands back |
| `solar.spec.mjs` | the Solar System: boot, search (Mars, Voyager, Halley, arrow keys, Esc, nothing found), a link with a body, moment and distance, `#q=`, Share, the clock buttons, layers and the mission and comet lists, Chandrayaan-2 circling the Moon on screen with its height on the card |
| `tonight.spec.mjs` | Tonight with the clock fixed at 2026-10-13 19:00 UTC in London: planets, meteors, Moon, the 2027 eclipse, clouds, launches, the ISS and crew; remembering and forgetting the place, Greenwich without permission, a launch's Details to the globe, Share; a `#at=lat,lon` link (answers for that place, saves nothing), a typed place (only the words go to Photon), the embed (`#embed=1`: chosen sections, no location buttons or toasts) |
| `phone.spec.mjs` | the `phone` project (Pixel 7, touch): every page fits the width, the 2D map's bottom bar and sheets, a tapped quake, the globe's phone dock and sheets (and its Low level: 30 fps cap, 0.66 render scale, no FXAA, Starlink off), the Solar System's menu and search, tap-target sizes |
| `visual.spec.mjs` | picture checks of five still views (below) |

**Picture checks** (`visual.spec.mjs`, `e2e/support/snap.mjs`): the globe over Europe and Saturn at fixed moments with the
interface hidden, the 2D map's first screen, the guide's first screen and Tonight on a phone. Each screenshot is shrunk
to a 160 px thumbnail (box filter: font hinting and anti-aliasing average out, layout and colour don't) and compared with
`e2e/snapshots/<name>.png` (5-25 kB each): the test fails when the mean channel difference or the share of pixels off
by more than 48 goes over the view's limit; the log prints both numbers every run. On a failure the reference, the
thumbnail and a red difference picture are attached to the report, and the thumbnail is also left in
`e2e/.results/snapshots-actual/` under the reference's name. A changed heading in the guide scores ~17 (limit 5); reruns
on the same machine score 0.
- The globe over Europe is skipped on CI unless `OO_E2E_ALL=1` (GitHub's runner draws it two ways from run to run). Its
  reference, `globe-europe.png`, was taken at the old Low level, which no current level matches: refresh it on the next
  GitHub run with `OO_E2E_ALL=1 OO_E2E_UPDATE=1` and look at it before committing.
- `OO_E2E_UPDATE=1 npx playwright test visual` rewrites the references: look at them before committing.
- Fonts render differently per system. If CI's Linux pictures drift past the limits, give it its own references:
  `OO_E2E_UPDATE=platform` writes `<name>.<platform>.png` (`linux`, `win32`), which wins over `<name>.png` on that
  platform; or copy `snapshots-actual/` from the CI artifact after a look, renamed `<name>.linux.png`.

**Writing a test.** Import `test`, `expect` and the `openMap` / `openGlobe` / `openSolar` helpers from
`./support/fixtures.mjs`; drive the page through its controls (`locator().click()`, the keyboard) and read the state
through the console handles (`OW`, `OO3D`, `OOSS`, `OOSKY`). `test.use({ fixedNow: '2026-...Z' })` freezes the page's
`Date` and makes the fixtures for that moment. A new live feed needs a fixture in `feeds.mjs` and a line in
`fixtureFor()` (and a check in `test/e2esupport.test.mjs`).

Found by the first runs: the 2D map's "3D globe" button lost the view on a middle-click (fixed: `auxclick`); at
1366x820 the globe's zoom pad covers the right end of the band (Measure, Eclipses, Solar system); the 2D map's phone
bar buttons are 37.5 px tall, under the usual 44-48 px for a finger.

## In the browser (needs `node serve.js` on :8787)
| Tool | What it does |
|---|---|
| `brand/tools/perf.mjs` | load size, still and moving frame rates, desktop and an emulated phone |
| `brand/tools/zoomtest.mjs` | real wheel events from Earth through the hand-off to the stars and back, frame by frame |
| `brand/tools/mobile_journey.mjs` | a first visit A to Z on a phone: landing, globe, Solar System, 2D map, with touch, screenshots and a layout audit |
| `brand/tools/webkit_journey.mjs` | the same journey in Safari's engine (Playwright WebKit) with an iPhone 15 profile |
| `brand/tools/pwa_check.mjs` | the installable app on a copy of the website's layout (`/open-overwatch/` + archived `/v/<tag>/` from git, its own server, no serve.js needed): no worker on localhost by default, install, archived versions untouched, offline pages + banner, offline.html, the new-version prompt, `?sw=0`. `chromium` (installed Edge) or `webkit` |
| `brand/tools/gesture_check.mjs` | the first-run touch hints and the long press on the globe and the 2D map: `chromium` (Edge, Pixel profile, CDP touch), `webkit` (iPhone 15) or `android` (the emulator's Chrome over adb; `adb reverse` your port first); screenshots in `brand/perf/gestures/` |
| `brand/tools/a11y_check.mjs` | the HTML accessibility check of every page (also in `node --test` and CI) |
| `brand/tools/wind_fixture.mjs` | a made-up wind grid the journeys serve as `data/wind.json` (and they block Open-Meteo: its per-IP hourly quota) |
| `brand/tools/android_features.mjs` | the newer globe features on the Android emulator, by touch: tap a country, the Explore sheet and Weather panel fit, the tour starts and a touch stops it, a shared link restores the view; screenshots in `brand/perf/android-features/` |
| `brand/tools/android_profile.mjs` | one gesture on the Android emulator with the JavaScript profiler on: `map`, `mapspace`, `mappinch`, `mapspacepinch`, `handoff`, `weather`; `OO_CSS='…'` A/B tests a style, `OO_CALLERS='regex'` prints who calls a slow native function |

The journeys and the Android tools mark the touch hints as seen (`oo-hints` in localStorage) so the hint card does not take
their first tap; gesture_check.mjs tests the card itself. All of them block the live feeds that must never see automated traffic (CelesTrak above all).

## Phones without phones
**Android: Google's emulator, driving real Chrome.** This is installed under your user profile, with no admin rights:
- Android SDK in `%LOCALAPPDATA%\Android\Sdk`;
- portable OpenJDK 17 in `%USERPROFILE%\tools\jdk17`;
- a virtual Pixel 8 called `OO_Pixel8`, running Android 15 with Google Play and 4 GB RAM.

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd OO_Pixel8 -gpu host -no-snapshot-save -no-boot-anim
```
Once it has booted, open Chrome on it (the journey re-makes these links itself if adb drops them):
```bash
adb shell am start -a android.intent.action.VIEW -d http://localhost:8787/index.html com.android.chrome
adb reverse tcp:8787 tcp:8787                                   # the phone's localhost:8787 = this PC's server
adb forward tcp:9333 localabstract:chrome_devtools_remote       # DevTools into the phone's Chrome
```
Then run the journey:
```bash
OO_ANDROID=1 node brand/tools/mobile_journey.mjs                # screenshots in brand/perf/android/
```
Things to know about the emulator:
- **Secure context:** `localhost` on the phone is a secure context, so location and motion sensors work. In the
  emulator window, the "…" menu → Virtual sensors / Location moves them, which is how to try Look up.
- **Screenshots** come from `adb exec-out screencap`. Big DevTools screenshots of a WebGL page reset the adb link.
- **A fresh image** spends its first minutes updating Google Play Services. Each crash of Play Services takes Chrome
  down with it, so let it settle before measuring.
- **adb resets:** the emulator's adbd sometimes resets ("timeout expired while flushing socket"), which drops every
  forward and reverse. The journey re-makes only the missing ones, because replacing a live forward cuts DevTools,
  and retries a page that comes up as Chrome's "site can't be reached".
- **A first visit every time:** the journey and the profiler close leftover localhost tabs (a background globe tab
  costs about a second of load time) and clear the site's storage, so the welcome presets show and the map does not
  reopen wherever the last run left it.
- **Paint costs are noisy:** the emulator decodes and rasterises through the host GPU, so the 2D map's pinch p95
  moves between 80 and 180 ms run to run with an idle main thread. Run an A/B at least twice each way.

**iPhone: there is no iOS simulator outside a Mac.** `webkit_journey.mjs` catches WebKit-only breakage, for example
Cesium needing `OffscreenCanvas`, which iOS only has since 16.4 (the globe page now shims it). For the real iOS
Simulator, install Xcode (free) on a Mac and open the site in the Simulator's Safari.

## Latest results (2026-10-03, local build, Android emulator unless noted)
| | morning | evening |
|---|---|---|
| Globe on screen | 4.6 s | 4.3 s |
| Dragging the globe (all satellites loaded) | 14-16 fps | 47-57 fps |
| Zoom out to the Solar System | 8 long tasks, 2.4 s | 0 long tasks, 54 fps |
| Solar System drag + pinch | 53 fps | 60 fps |
| 2D map drag + pinch | 27-49 fps (noisy) | 60 fps |
| Opening Weather, first time | 12 long tasks, 2.2 s (a layer-count shader build, 0.6 s, plus tile uploads) | the 0.6 s moves to an idle moment ~16 s after load (`Weather.prewarm`); the open itself: 0 long tasks when run after idle. Opened straight after a busy gesture sequence (the journey) it can still land inside the step |
| iPhone profile (WebKit) | all steps pass | all steps pass, no errors |
| Desktop zoom, Earth to the stars | p95 6.2 ms | p95 6.2 ms, no frame over 50 ms |

**The satellite dots were the biggest cost on phones.** Every moved dot costs Cesium a high/low precision split, and once more
than a tenth of a point collection moves it re-uploads the whole vertex buffer: ~11,000 dots, every frame. Dragging the globe
ran at 15 fps with the dots and ~60 without. Far out they now all move together every few frames (8 on phones above 20,000 km,
4 above 1,500 km, 2 in low orbit) and nothing is uploaded in between; a dot moves ~125 m a frame, well under a pixel. Moving them
in rotating slices did not help: each slice was still over a tenth. It also showed a trap: an unpropagated satellite reads
`undefined`, not NaN, from the worker buffer and became a NaN position.

### Weather mode on the Android emulator (2026-10-03)
Measured with `android_profile.mjs weather`, the journey's "Weather with wind" step, and A/B runs (hide the canvas, empty it).

| | before | after |
|---|---|---|
| Wind streaks, still | 29-35 fps | 46 fps |
| Wind, dragging the globe | 32 fps | 43 fps |
| Wind + temperature wash | 28 fps | 42 fps |
| Clouds + radar only (no wind) | 44-55 fps | same |

What the A/B runs showed: the particles' JavaScript was never the main cost. A full-screen canvas laid over the WebGL globe costs
about 15 fps just to composite on the emulator (an empty one costs the same). What helped: updating the streaks at half the frame
rate on phones (about +15 fps), a canvas at 0.6 of the CSS pixels, projecting particles with our own matrix (Cesium's
`worldToWindowCoordinates` was 15% of the main thread; the maths is checked against it to 0 px), and skipping the satellite and
aircraft position updates while weather mode hides them (580 ms of work per profile). Left: opening the mode makes Cesium link a
new globe shader for the extra imagery layers (about 0.5 s, once), which a pre-warm at boot could hide.

**Test hygiene:** Open-Meteo limits each IP per hour (a live open is 612 locations). A burst of test runs exhausts it and wind then
silently does not draw, which looks like a speed-up. The site build now mirrors the grid (`data/wind.json`, every 6 h, see
`build_site.py`) and the browser reads that first; to test before a release, put a file of that shape in `data/` by hand and delete
it afterwards. Always check "wind canvas ... lit" is non-zero when measuring.

### A tap on a phone is a country, not a satellite (2026-10-04)
A finger covers ~28 px and 18,000 satellite dots mean one is nearly always under it, so the first Android run of `android_features.mjs`
opened a Starlink card when Japan was tapped. A tap now selects a satellite only when its dot is within 8 px of the touch; otherwise it
is treated as a tap on the ground (the country). Mouse clicks are unchanged (3 px).
