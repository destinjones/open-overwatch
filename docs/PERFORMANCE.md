# Performance

Measured with `brand/tools/perf.mjs` (headless Edge on an RTX 3060, serve.js on :8787):

```
node brand/tools/perf.mjs [desktop|phone|both] [page ...]     # OO_PROFILE=1 adds a CPU profile of the moving sample
```

*Desktop* is 1600×900. *Phone* is 390×844 at 3× with touch, a mobile user agent and the CPU throttled 4×. The GPU
can't be throttled, so phone numbers say nothing about a phone's graphics chip: that is what the automatic quality
step-down is for. *Still* samples 8 s with the camera at rest; *moving* samples 8 s of a scripted camera move:
- globe: the Street preset, a 3 s flight from 20,000 km to a London street;
- Solar System: Earth out past the asteroid belt;
- 2D map: continuous panning.

## Before and after (2026-10-02)

| Page · profile | Moving fps before | Worst frame before | Moving fps after | Worst frame after |
|---|---|---|---|---|
| Globe · desktop | 41 | 1,254 ms | 73–77 | 640–870 ms (one-off shader compiles) |
| Globe · phone | 8.6 | 1,533 ms | 69 | 490 ms |
| Solar System · desktop | 85 | 146 ms | 165 | 139 ms |
| Solar System · zoomed out (light-years+) | 16 | | 165 | |
| 2D map · both | 157–164 | 24 ms | unchanged | |

Every page runs at the display's refresh rate with the camera at rest.

## The scroll-wheel zoom (`brand/tools/zoomtest.mjs`)

Real wheel events from a 20,000 km view of Earth, out through the hand-off into the Solar System and beyond, then
back in to the ground (`OO_BACK=10 node brand/tools/zoomtest.mjs desktop 8`). Reported on 2026-10-02 from a Mac laptop in
Firefox on the live v0.9 site, which has none of these fixes.

| Stretch (desktop) | Before | After |
|---|---|---|
| Hand-off to the Solar System | 1.0 s freeze, then a second at ~4 fps | worst frame ~100 ms |
| 1,600–4,400 AU (asteroids piling onto a few pixels) | 24 ms frames | 6 ms |
| Back down to Earth (2,300 km → street) | 0.5–0.9 s freezes, 5–18 fps | worst ~240 ms, median 6 ms |
| Whole round trip, 18 s | dozens of frames over 50 ms | 5 |

Fixes for this path:
- **Solar System textures:**
  - Every planet starts on its 2k map; the 4k map loads only for the body you fly close to (`Sharpen` in `src/solar/util.js`).
  - Loading all the 4k maps up front used ~600 MB of GPU memory and caused a 1.1 s upload at the hand-off.
- **Solar System shaders:**
  - three.js's shader error checks are off (`?debug` turns them back on). They forced each compile to finish on the spot.
  - Shaders are compiled with `compileAsync` while idle, and textures are uploaded one per idle slice.
  - The globe waits for that warm-up before handing over.
- **Background preload (desktop):** 10 s after start, the globe loads the Solar System view in the background. The
  1.27M-asteroid file waits until the view is actually entered.
- **Globe warm-up:** behind the boot screen, the globe dips to 600 km for a moment. Below ~800 km Cesium adds fog and
  atmosphere to its shaders, so both versions of every model and tile shader compile before the globe is shown.
- **3D models:** per-model dynamic environment maps are off (`NO_ENV_MAP`). They rendered an atmosphere cube map for
  every model and added a shader version per height band.

## A first visit on a phone (`brand/tools/mobile_journey.mjs`)

A first-time visitor, A to Z: the landing page; the 3D globe (drag, pinch, Layers, Near misses, tap a satellite, pinch
out to the Solar System); the Solar System view (drag, pinch, menu, ladder); the 2D map (Enter silent, a preset, drag
and pinch, the tabs).
- **Device:** an emulated mid-range Android: 390×844 at 3×, touch, CPU 4× slower, "Fast 4G" (9 Mbps, 60 ms), empty cache.
- **Output:** a screenshot per step, plus a layout audit (sideways scroll, panels off screen or overlapping, tap targets,
  tiny text) in `brand/perf/mobile/`.

| | Before | After |
|---|---|---|
| Globe, until it shows | 11.3 s, 10.7 MB | 6.4 s, 4.9 MB |
| Solar System, until it shows | 10.3 s, 8.9 MB | 4.1 s, 3.2 MB |
| Tap a satellite | missed (3 px pick, a 2 px dot) | opens its card (28 px touch pick; the cloud shells no longer catch taps) |
| Hover tips | stuck on screen after a touch | none from touch |
| Pinch on a 2D-map panel | zoomed the whole page (stuck) | blocked (viewport, `touch-action`, iOS `gesturestart`) |
| 2D map after a preset | ~100 px strip of map | sheets at 48 % height, one-row header |
| Solar caption | a narrow column mid-screen | a compact strip at the bottom, tap to dismiss |
| Globe Near-misses card | half hidden behind the band | a bottom sheet above it, scrolls |
| Satellite error toast on arrival | yes (one missing group) | only if no satellites at all |

What made the difference on load:
- The globe no longer downloads Cesium's default sky box (0.9 MB, replaced anyway).
- Phones get a 2k cloud/glint texture (0.9 MB instead of 2.6).
- Satellite groups load four at a time instead of one by one.
- Phones skip the low-altitude warm-up dip, and their models warm one at a time once the globe is showing.
- The cloud shells and the star cube map compile behind the boot screen.
- The Solar System view loads planet maps when a planet is more than a dot, and moon maps near their planet.
- The Milky Way, the 109k stars and the galaxies load once you head out that far, or on a search; desktops fetch them
  in the background.

Known left (emulation can't show a real phone's GPU):
- A ~0.5 s hitch about 3 s after the globe appears, most likely the first draw of the ~12,000 satellite dots.
- Phones preload the Solar System view only once nobody has touched the screen for 3 s. A visitor who pinches straight
  out still gets ~2–5 s of jank during the hand-off.

## What was slow, and the fixes

- **Shader compiles mid-flight (globe).** Cesium compiles a program the first time each globe-tile imagery
  combination, or glTF material, is drawn: ~100 ms each under ANGLE/D3D11, and 27 of them during the flight. Fixes:
  - Hide imagery layers that can't be seen: the Esri base under an opaque Blue Marble, and the Blue Marble at alpha 0.
    That cut the globe variants from 11 to 6.
  - Pre-warm every aircraft and satellite model type at boot (`src/globe/warm.js`).
  - Model shaders still differ near the ground: fog adds an atmosphere stage to them. Those compile once per session.
- **Graphics levels** (`src/core/quality.js` holds the globe's and `src/globe/quality.js` applies them;
  `src/solar/quality.js` defines its own three and its own step-down, below): High, Balanced and Low. Auto starts
  phones and software renderers on Low, everything else on High. A level picked in the dock is kept and never changed
  automatically.
  - Globe levers (a phone's figure in brackets where it differs). Low cuts what every pixel costs, not only tile detail
    and models:

    | Lever | High | Balanced | Low |
    |---|---|---|---|
    | Tile detail (screen-space error) | 2 | 3 | 4 |
    | 3D models: aircraft / satellites | 200 / 40 | 80 / 25 | 30 / 12 |
    | Cloud noise octaves | 4 | 2 | 1 |
    | Cloud relief (four sun-side taps) | on | on | off |
    | Frame cap | none | none | 30 fps |
    | Render scale (× CSS pixels) | 1 | 0.9 | 0.75 (0.66) |
    | FXAA pass | on | on | off |
    | Limb halo (a full-disc pass) | always | fades out between 1,200 and 800 km | off |
    | Shell mesh (stacks × slices) | 256 × 512 (128 × 256) | 128 × 256 | 128 × 256 |

    The shell mesh follows the level the page starts on; rebuilding the shells on a later change would be a stall of its
    own. Starlink (~8,000 dots) is off by default on phones, one tap in the dock to show.
  - Solar levers: pixel ratio (1.5/1/1; 2× on a Retina laptop was four times the pixels), and all 1.57M asteroids or only
    the brightest 300k.
  - The step-down (Auto only, while the page is visible, after the first 10 to 12 s): the median frame of each 3-second
    window is watched. One window over 50 ms steps down one level at once; otherwise two windows in a row over budget
    do. The budget is 28 ms (under ~36 fps), or on the globe the level's frame cap plus 8 ms (41 ms on Low). The
    battery saver's slow idle frames on the globe don't count.
- **Faded point clouds still drawn (Solar System).** From light-years out the 1.57M asteroids land on a few pixels
  and additive blending serialises them: 60 ms frames at any zoom past the Oort cloud. Faded clouds are now hidden.
- **Software WebGL** (hardware acceleration off): detected from the renderer string (`src/core/gpu.js`). The page
  explains how to turn acceleration on, because no quality level makes software rendering usable.

## 2D map: forecast weather playback

The 2D map's forecast washes (temperature, gusts, cloud, rain, waves) are painted per 256 px map tile by
`paintMercatorTile` (`src/core/wxpaint.js`), and `src/map/weather.js` keeps the cost down:
- **Sampled, not painted, per pixel.** A tile is sampled once every 2 px (every 4 px from zoom 7 and on phones) into a
  canvas of that size, and drawn scaled up without smoothing: the same picture as step-sized blocks, a quarter (or a
  sixteenth) of the pixel writes and memory.
- **Kept per field, model moment and tile**, so scrubbing back or a second loop of the animation costs a draw, not a
  paint: up to 320 tiles on a desktop and 600 on a phone (64 KB a tile at step 2, 16 KB at step 4).
- **A few tiles a frame.** Tiles are painted in place within 10 ms a frame (6 ms on phones); the old picture stays until
  the new one is ready, and play waits for a step to finish painting before it takes the next.

The paint path alone (`paintMercatorTile` in Node, a temperature tile at zoom 3, a cheap stand-in for the model
field) costs in proportion to the samples: every 2 px is about a quarter of every pixel, every 4 px about a
sixteenth. The absolute times depend on the PC and the stand-in (a few ms to about 11 ms a tile at every pixel). Reading the real model field
at each sample adds to that; a cache hit is a Map lookup and one small canvas draw.

## The MCP server: "off its coast"

An area tool asked about a country that runs round the world (the United States, Russia, Fiji) counts a quake, storm
or volcano at sea when it is off that country's coast (`offCoast` in `src/core/borders.js`, docs/CORE.md). That walks
the outlines of the country's nearby parts, so it is the dear test: in Node on the owner's PC (2026-10-17), 3,000
random points over the Aleutians and Alaska (50-62° N, 180-140° W), 2,138 of them outside the US outline but near
enough to need the full test, took 120-134 ms over three runs: about 56-63 µs for each of those. `mcp/place.mjs` runs the cheap box test (`nearParts`) first. The Worker's free plan
allows 10 ms of CPU a request, so a long list near such a coast (a week of small Alaskan quakes) is the case to watch
at the next Worker CPU review.

## Load size

- Globe: 16 MB, plus 6.7 MB of satellite models warmed in the background (2 types on phones).
- Solar System: 42 MB on desktop, 19 MB of which is the second asteroid file (`asteroids_b.bin`). It loads only on
  the levels that draw every asteroid, with the asteroid layer on, once the camera first goes past 1.5 AU from the Sun
  or the search box is used (inside the globe: once the view is entered), or straight away for a link that names one
  of its asteroids. 14 MB on phones.
- 2D map: under 1 MB.
