# Jank and lag: the top 20 (performance run 2026-10-31)

From GitHub run 41245643205 (`ci-e2e` = rebuild 8e42427, the five polish branches merged), the harness in
`e2e/perf.spec.mjs`; the numbers table is in docs/PERFORMANCE.md ("Baseline 2026-10-31"), which also explains how
software WebGL (SwiftShader, no GPU) inflates GPU-bound frames. Each finding gives the page and profile, the
interaction window, its numbers, and the culprit: the long-animation-frame script (file:line, from the browser) and the
hottest functions of the same window in the CPU-profiled pass. "Desktop" is 1366×820; "phone" is a Pixel 7 screen
with the CPU slowed 4×. TBT = long-task time over 50 ms. The 2D map was not measured in this run (a harness bug, fixed
since). Rerun after a fix: push to `ci-e2e`, or Actions → Performance → Run workflow with just that page.

Ordered by how much a visitor would notice, not by raw score.

1. **Globe · desktop · hovering the globe with the full satellite catalogue: a 27 s freeze, then the globe stops
   drawing for good.** Window "Zoom in (10 steps)", mouse resting over the globe: one long task of 27,009 ms, a
   24.6 s frame. The task is `hoverPick` (src/globe/ui.js:123, from the 80 ms hover timer at :105/:110/:134) →
   `pickObj` (:111) → `scene.pick` with a 3×3 box; the profiled pass spent 86 s in `readPixels`. Cesium then threw
   `RangeError: Invalid array length` in `createPotentiallyVisibleSet` and showed "An error occurred while rendering.
   Rendering has stopped." Every later window shows 16.7 ms frames because nothing was drawn, and the zoom out past
   the Moon never handed over to the Solar System (timed out at 280 s). SwiftShader makes `readPixels` far slower than
   a GPU, but the render error is real and permanent. Fix ideas: no hover picks while ~15,000 dots are drawn (pick
   satellites on the CPU from their screen positions, or only on click), skip a pick when the last one was slow, and
   listen to `scene.renderError` to recover instead of leaving a dead globe.
2. **Globe · desktop · the Solar System's background preload uploads textures in the middle of interactions.**
   `step` in src/solar/main.js:235 (an `IdleRequestCallback`, `renderer.initTexture` at :237) ran 2,477 ms during
   "Starlink toggled", 1,122 ms during "Layers dock: open" and 849 ms during "lighthouses and volcanoes"; the windows
   had p95 frames of 2.7 s, 1.4 s and 1.8 s. `touched()` (:233) only counts pointer and wheel input in the last 1.5 s,
   and one whole texture is uploaded per idle callback whatever the deadline says. Fix ideas: honour
   `deadline.timeRemaining()`, treat clicks in the globe's panels and layer changes as activity, upload big maps in
   tiles, or wait for the hand-off.
3. **Globe · desktop · boot: ready at 10.2 s, 7.8 s of blocking time, a 2.5 s first frame.** 17 long tasks (longest
   2,482 ms), 305 requests and 25 MB before ready. The worst frames are Cesium's render loop compiling shaders (`bze`
   in Cesium.js: 5.1 s self time, 58 % of boot). Own code: the aurora (finding 6) and src/globe/main.js (module
   evaluation, 99 ms with 18 ms of forced layout). The phone is ready in 4.8 s because it skips the low-altitude
   warm-up dip. The settle window after boot is still bad: p50 400 ms, 19 frames over 100 ms in 12 s, with
   `getProgramParameter` (synchronous shader-compile checks) 37.6 % and the Solar System's own module evaluation
   (src/solar/main.js, 436 ms) and first frame (src/solar/main.js:150 `frame`, 492 ms) landing 10 s after start.
4. **Globe · desktop · first use of a layer or model compiles shaders on the spot.** Starlink toggled: 68 % of the
   window in `getProgramParameter`; Search → the ISS card: a 1,606 ms Cesium frame, 41 % `getProgramParameter`;
   Layers dock open: 35 %. Fix idea: warm the point-collection and billboard shaders and the ISS model with the
   other models in src/globe/warm.js, behind the boot screen.
5. **Landing · desktop · scrolling to the fleet viewer: 2.7 s and 1.7 s freezes.** Window "Scroll the landing page":
   p99 983 ms, worst frame 3,000 ms, 27 frames over 100 ms, TBT 5,849 ms. The scripts: model-viewer's module
   (`@google/model-viewer@4.0.0`, evaluated when it comes into view: 1,706 ms), an unattributed `setTimeout` task of
   2,686 ms right after it (its GLB and shader set-up), then its render callback (1,377 ms). Self time: model-viewer
   `Ia` 4.8 s (56 %). Fix ideas: load model-viewer on idle after first paint rather than on reveal, show the poster
   until the visitor touches the viewer, and stop its auto-rotate when it is off screen.
6. **Globe · both · the aurora grid is parsed on the main thread at boot.** src/globe/aurora.js:14 (`grid`,
   `Response.json`) and :17 (`load`, `parseOvation`): a 462 ms task on the desktop and 348 ms of self time in the
   profiled boot. Fix idea: parse in a worker or after the globe is showing, in slices.
7. **Landing · phone · switching models in the fleet viewer: 43 frames over 100 ms, a 8.6 s worst frame.** Window
   "Fleet viewer: every model in turn": p50 50 ms, p95 383 ms, 12 long tasks (longest 565 ms), model-viewer's render
   callback 553 ms per switch. Each model is a new GLB parse and shader compile. Fix ideas: smaller GLBs or Draco/
   meshopt, preload the next model on idle, keep one model-viewer and swap `src`.
8. **Globe · phone · opening the Layers dock: a 955 ms task.** `Response.json.then` in src/core/assets.js:14
   (`fetchAsset`) parses a large data file on the main thread when the dock opens (930 ms blocking). Same pattern
   elsewhere: finding 12. Fix idea: fetch and parse that file (the one a default-on layer needs) in a worker, or parse
   it before the dock is opened.
9. **Globe · phone · every camera move runs at 4–6 fps.** Zoom in: p50 217 ms, p95 433 ms, 39 of 46 frames over
   100 ms, 13 long tasks; zoom out p50 233 ms; pan p50 183 ms; the flight to a London street p50 183 ms with a 688 ms
   Cesium frame. Mostly drawing (`(program)` 60–89 % under SwiftShader), but the top own code in every one of these
   windows is the satellite model refresh, src/globe/satellites.js:270 (`refresh`: which satellites get a 3D model)
   and :131 (`update`: extrapolating every dot each frame). Fix idea: run `refresh` on a timer (it picks the nearest
   models, which changes slowly) rather than with every camera change.
10. **Solar System · both · zooming and orbiting at 4–8 fps, with texture uploads mid-zoom.** "Zoom out to the Oort
    cloud" and "Zoom back in": desktop p50 250 ms (91–94 of 99 frames over 100 ms), phone p50 133 ms (111 of ~135).
    On the desktop 59.7 % of "Zoom back in" is `texSubImage2D`: the planet maps sharpened on approach (`Sharpen` in
    src/solar/util.js) upload during the zoom. The desktop is slower than the phone because it draws at pixel ratio
    1.5 at a higher level, which software WebGL pays for in full. Fix ideas: upload the sharper maps only once the
    camera has stopped, and check that Auto picks Low for a software renderer in the Solar System as it does on the
    globe (src/core/gpu.js, src/solar/quality.js).
11. **Solar System · phone · comet tails are rebuilt every frame.** The top own code in both zoom windows:
    `solveKepler` (src/core/kepler.js:17), `conicInPlane` (src/core/comets.js:95), `toEcliptic` (:69) and
    `stateToConic` (:160), about 225 ms of a 19 s window, plus a `new Float32Array` per comet per frame
    (src/solar/comets.js:146) and `dustTail` propagating every dust point each frame (:151). Fix idea: rebuild a tail
    only when the clock has moved enough to change it, and reuse the arrays.
12. **Tonight · phone · "Try Greenwich": a 432 ms task.** `fetchAsset('data/solar/spacecraft.json')` in
    src/globe/tonight.js:111 parses 1.9 MB of JSON on the main thread for the card's spacecraft line (the click
    handler at :218 runs 238 ms on top). Fix idea: a small "where are the probes now" summary file at build time, or
    parse after the card has drawn.
13. **Solar System · both · search results typed and picked.** "Search: Mars, Enter": a 898 ms (desktop) and 540 ms
    (phone) long frame in src/solar/main.js:150 `frame` as the flight starts; "Search: back to Earth" on the desktop:
    a 1,222 ms task. Typing runs `runSearch` (src/solar/find.js:70, `find` at :38) on every keystroke: 367 ms in one
    input event on the phone. Fix ideas: debounce typing by a frame or two and keep a prepared search index; spread the
    flight's set-up over frames.
14. **Tonight · desktop · the page jumps as it loads (CLS 0.122).** One shift of 0.097 moves `main#main`, the footer
    and the header together, then 0.017 on the nav text: the card's content arrives and pushes the layout. Fix idea:
    reserve the card's height (min-height or a skeleton) before the sky answers arrive.
15. **Solar System · phone · the settle after boot: p50 183 ms, 37 frames over 100 ms, one 1.2 s frame, with no
    input.** Comet tails (finding 11) and `setProgram` in three.js (shader switches) top the profile. The desktop's
    settle is p50 283 ms with 28 frames over 100 ms.
16. **Solar System · phone · a year per second: orbits recomputed as time runs.** Window "Time: a year per second":
    p50 133 ms, 38 frames over 100 ms; own code `orbitPath` (src/core/kepler.js:52) 165 ms and `solveHyperbolic`
    (src/core/comets.js:78) 71 ms; the card shifts as it updates (CLS 0.0115 on `#card`).
17. **India · desktop · scrolling to the pass table: a 505 ms task.** `passes()` in india/india.js:124 loads
    satellite.js and the stations' TLEs, then works out the passes in one go (`Response.text.then`). Fix idea: compute
    in slices or a worker, or start on idle before the table is near.
18. **Globe · desktop · the band and counters move during boot (CLS 0.041).** 0.031 moves `#timebar`, `#stats` and
    `.links` together, then `nav#band` and its `#tLive` button. Fix idea: fixed sizes for the counters and the band
    before the feeds' numbers arrive.
19. **Solar System · desktop · label ranking and placement every frame.** `rankStars` (src/solar/deepspace.js:141, run
    every 400 ms from src/solar/ui.js:190, sorting every star with new arrays), `updateLabels` (src/solar/ui.js:189) and
    `labelShown` (:173) are the top own code while zooming and orbiting (20–33 ms each per window). Small, but
    allocation every frame on a phone means more garbage-collection pauses.
20. **Guide · phone · 406 ms of blocking time before the page is usable** (FCP 0.6 s, two long frames of 379 and
    203 ms with no script attribution: style and layout of the 106 kB page and its web fonts). Fix idea:
    `content-visibility: auto` on the long sections below the fold.

Also seen, for the harness rather than the app: on the phone the India page's `#langBtn` could not be clicked within
10 s (something covers it, or it moves while the page settles; worth a look at its tap target). Leaks: none (docs/PERFORMANCE.md).
