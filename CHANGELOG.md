# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are small four-part steps (v0.9.2.11, then v0.9.2.12, …) rather than strict semantic versioning: every release
is a usable site, and the newest six stay online under `/v/<tag>/` on the website (the landing page's version picker
lists them); older ones are their release zip. The annotated tag messages (`git tag -n99`) are the release notes this
file was built from.

## [Unreleased]

## [0.9.2.15] - 2026-10-17

Tonight for any place, and honest about what is live.

### Added
- Tonight for any place: type one in, or open `tonight.html#at=lat,lon&name=…` (a place from a link is shown, never
  saved); an embeddable card (`tonight.html#embed=1&sections=passes,planets,…`); the MCP `night_sky` answer links to it.
- ISRO's missions in the Solar System view from JPL Horizons tracks (Chandrayaan-1, Chandrayaan-2, Chandrayaan-3's
  propulsion module and Vikram, Aditya-L1, Mangalyaan), linked from the India page and placed by MCP `where_in_space`.
- EMSC as a second earthquake catalogue beside USGS (globe, 2D map, MCP `earthquakes`): a quake EMSC solved too reads
  "confirmed" instead of "reported".
- A real Hindi page at `/india/hi/` (made from the English one by `brand/tools/india_hi.mjs`) and the main voice
  commands in Hindi. A "What's new" card once after an update; a maskable icon and screenshots for the install sheet.
- The download zip carries the airport, runway, deep-sky and light-pollution data, the home, about, guide and India
  pages, LICENSE and NOTICE. Browser tests for the zoom into the Solar System and back and the panels that links open.

### Changed
- Honest about what the website carries: the relay (redeployed 2026-10-17) now carries NOAA buoys and DART but no
  aircraft network, so both views say once that live aircraft come with the free download and stop asking, instead of
  "0 AIR" and endless retries. The home page and the README lead with the zoom, satellites, storms, quakes and
  Tonight, and the install sheet no longer promises aircraft. The home page loads its 3D models only when its fleet
  section nears the screen, and the phone clips on the home and India pages wait for a tap.
- A faster globe: Low renders at 0.75 resolution (0.66 on phones) without FXAA, the limb halo or the cloud relief,
  Balanced at 0.9; Starlink is off by default on phones; hover tips pick only at rest; desktops load the 4k cloud
  texture, not the 8k, unless the GPU and screen can show it.
- Solar System orbit lines pass through their bodies close up (Pluto sat 56,000 km off its line); on desktops the
  standalone view's 19 MB faint-asteroid file waits until the camera passes 1.5 AU from the Sun or a search needs it.
- After a publish an open app keeps one version's pages and code together, and other tabs are asked to reload. The
  website keeps the newest six releases under `/v/<tag>/` and no longer publishes e2e/, notes/, relay/, mcp-worker/,
  brand/clip/ or test/ (except the one JPL fixture the Solar System's accuracy table loads).

### Fixed
- Sunrise, sunset, solar noon and the night side ran about 1.6 minutes early; moonrise and moonset include the Moon's
  parallax everywhere; eclipse sub-points were up to ~10 km off; Saturn near quadrature was up to ~0.27 mag too bright.
- A NOAA storm point without a position no longer puts a storm at NaN or empties the storms layer, and a GDACS
  cyclone without coordinates no longer puts a storm at 0,0.
- The globe's boot screen says what failed, with Retry and the 2D map; phone panels no longer cover each other. The
  Solar System's hand-over roll no longer bounces back to the globe, and its flights jump with reduced motion.
- Sky alerts fire once, after the service worker is ready, and up to 2 hours late after a tab slept.
- Passes of decaying satellites no longer throw, 15 near-parabolic comets no longer decode as parabolas, the 2D map's
  phone buttons are 44 px, and `plate_readers` no longer calls a place outside North America an outage.

### Security
- The satellite workers load a self-hosted satellite.js instead of an unchecked CDN file; the relay takes one canonical
  request form per feed (anything else is a 400), so re-spelled requests can't bypass its cache; every workflow action
  is pinned to a commit SHA; a malformed MCP `/mcp/` path is a 404, not a crash (the hosted Worker still runs the
  earlier version until it is redeployed).

## [0.9.2.14] - 2026-10-15

India.

### Added
- An India page at `/india/`, in English and हिन्दी: launches from Sriharikota, India's satellites, the next ISS passes
  over six Indian cities in IST, dark skies from Hanle to India Gate, the monsoon and cyclones over the Bay of Bengal
  and the Arabian Sea, Himalayan quakes, modelled air quality over north India and the 2D map over South Asia, each
  opening the globe already set there; with its own clips and share image. No tracking: campaign tags are removed
  from the address and share links, never read.
- The website's aircraft code can read adsb.lol through the relay on a shared grid (the relay side is not live: adsb.lol
  refuses Cloudflare for now, so the published globe still has no live planes; the download version is unchanged).
- Tools for vertical promo videos (`brand/tools/tiktok_tour.mjs`, `brand/tools/promo_hyper.py`).

## [0.9.2.13] - 2026-10-14

Checked, and darker skies.

### Added
- Provenance on every live layer: each card says which sources reported it, how many agree, how old the data itself is
  (not the download) and a confidence (confirmed, reported, stale, unknown) by a rule written in the guide; the MCP
  answers carry the same line. Export what's on a layer as GeoJSON, CSV or KML.
- The Sun now: solar wind speed and density, Bz, the flare class now and the day's peak, and NOAA's alerts in plain
  words, beside the aurora on the globe and in Tonight (MCP `space_weather`).
- Your sky: the Bortle class and sky brightness where you are (2016 World Atlas of artificial sky brightness, CC BY-NC),
  the nearest darker sky, and a light-pollution layer on the globe and the 2D map.
- Deep sky tonight: Messier, NGC and IC objects well placed tonight for eyes, binoculars or a small telescope
  (OpenNGC, CC-BY-SA-4.0) (MCP `dark_sky`).
- Falling soon: satellites and debris predicted to re-enter in the next 30 days, worked out from the element sets (decay
  from n-dot and drag through a solar-scaled atmosphere), each with a window of ±25% of the time left and its corridor;
  on the globe (list, cards, a corridor layer), the 2D map and the MCP server (`reentries`).
- MCP server 0.4.0: 38 tools.

### Security
- Integrity hashes on every library from a CDN, a Content-Security-Policy on every page (no inline script allowed on
  the 2D map either), and the fonts served from the site instead of Google Fonts.
- Dependabot, CodeQL, `npm audit`, a licence check of the shipped dependencies and a coverage floor in CI; CODEOWNERS,
  topics and a protected main branch.

## [0.9.2.12] - 2026-10-14

Back in time.

### Added
- Time travel with real history: rewinding the globe shows the earthquakes from the USGS catalogue, the storms and
  natural events of that time, and the satellites where they were, from an archive of past orbits.
- The oceans and the air: NOAA buoys, tsunami buoys, tide gauges, sea-surface temperature, modelled air quality, smoke
  and dust.
- A contributor on-ramp: CONTRIBUTING.md (run it, test it, the house rules, how a change gets released, good first
  issues), issue templates for bugs, features and data sources, a pull request template, SECURITY.md with a private
  reporting route, a Code of Conduct (Contributor Covenant 2.1), GOVERNANCE.md (what owning the project involves, how
  releases, the relay and the MCP Worker are run), this changelog, and a dev container for one-click setup.
- The Zenodo DOI in the README and CITATION.cff.

### Fixed
- Browser tests on GitHub's runners: one worker and longer limits on the 2-core machine, one globe per test at a time,
  the 2D map waits for its splash, the first-visit chooser is clicked until it closes, failure reports actually upload,
  and a Linux reference picture for Tonight on a phone.

## [0.9.2.11] - 2026-10-13

A quiet maintenance release.

### Added
- Copyright headers in every source file and a NOTICE file (the credit to keep in copies and forks).
- Copyright metadata in the images and 3D models (PNG text, JPEG comment, glTF `asset.copyright`).
- The first Zenodo archive of the repository.

### Fixed
- A CI test fix; the citation file's version and date.

## [0.9.2.10] - 2026-10-13

Growth round 2: Earth now.

### Added
- **Earth now** on the 3D globe (band button, `E`, `#go=now`): quakes, tropical cyclones, the aurora, launches in the
  next 24 hours, people in space, asteroid flybys, wildfires and the weather's extremes, with short history charts;
  every line flies there.
- Airports: their METAR and TAF in plain words with flight-category colours, arrival and departure estimates with honest
  ranges that keep score, and which runways are in use.
- Solar System: solar and lunar eclipses and lunar occultations 2026-2030 (checked against NASA's canon and published
  predictions), which comets are bright now and when each peaks, Juno around Jupiter through its perijoves.
- The 2D map catches up again: the forecast weather models (wind, temperature, pressure with isobars, gusts, cloud,
  rain, waves; GFS or ECMWF, side by side), aircraft cards with type, owner and route, airport boards, military areas
  and plate readers.
- MCP server 0.3.0: 32 tools (`weather_details`, `aircraft_lookup`, `where_in_space`, `airport_weather` among the new
  ones), and a version for Cloudflare Workers (`mcp-worker/`) so claude.ai and ChatGPT connectors can use it (not
  deployed yet).
- Browser tests: every page in headless Chromium on every push (Playwright, `npm run e2e`), with the feeds stubbed and
  five picture checks.

### Changed
- The weather drawing, model loading, adsbdb client and aircraft card words moved into `src/core/`, shared by the globe
  and the 2D map; the 2D map's own sun model, geodesy and escaper are gone.

### Fixed
- The 2D map's "3D globe" button lost the view on a middle-click.

## [0.9.2.9] - 2026-10-13

The growth push.

### Added
- Weather 2.0: ECMWF beside GFS with a side-by-side slider, sea-level pressure with isobars and highs and lows, gusts,
  and ocean waves.
- Solar System: 22 missions with their real paths and mission cards, comets with proper tails, and a "Where is it now?"
  search with shareable links.
- Aviation: aircraft cards with type, registration and operator, the weather outside in the cockpit, airports with
  arrival and departure boards, runways and crosswinds.
- The site installs as an app and works offline; touch hints and an accessibility pass on every page.
- The Claude extension grows to 29 tools (cameras with pictures, transit, wildfires, country briefings, cables, the
  planets, eclipses, meteor showers and more).
- A user guide (`guide.html`) that explains all of it.

### Changed
- Military areas, licence-plate readers and 3D buildings come from map tiles instead of the overloaded Overpass API.
- The 2D map catches up with the globe (ships, bike share, transit, hurricane cones, fires, draw and measure) on one
  shared, tested feed core in `src/core/`.

## [0.9.2.8] - 2026-10-11

Ask Claude about the Earth.

### Added
- An MCP server (`mcp/`, free, no keys) with fourteen tools over the site's open data: earthquakes, the ISS and when to
  see it, launches, people in space, asteroid flybys, hurricanes, wildfires and eruptions, Baltic ships, bike share, the
  weather, the aurora and tonight's sky. Every answer links into the globe; in Claude Desktop the live globe appears in
  the chat. Claude Desktop installs it from `open-overwatch.mcpb`, attached to the release.
- Share links carry a drawing (pins, lines, areas, distances, country outlines), switch layers on or off and follow a
  satellite; a link pasted into an open globe takes it there.

### Changed
- On phones the measure card shrinks to a strip while you place points; launch pads at one site share a label.

### Fixed
- From a code review: safer camera cards, the cockpit riding the follow camera, pinch zoom in the cockpit, and many
  small guards, with regression tests.

## [0.9.2.7] - 2026-10-11

The globe goes live.

### Added
- Live traffic cameras from twelve regions projected into the 3D city; live buses, trams and trains in Boston,
  Helsinki, Norway, Austin and Minneapolis; simulated cars on real roads (measured speeds in New York and Finland);
  Baltic ships with wakes; bike share worldwide; keyless 3D terrain.
- One weather timeline from two hours back to five days ahead (NOAA GFS, read in the browser), hurricane cones for every
  ocean, wildfires from space, lightning, before/after satellite pictures.
- Tactical looks (night vision, thermal), a HUD and a cockpit; voice with no key; place search, directions you can fly,
  launch replays, a director for clips, draw and measure, world radio, photoreal 3D cities with your own Cesium ion
  token, and a battery saver.

## [0.9.2.6] - 2026-10-09

A landing page with a heartbeat.

### Changed
- The landing page is rewritten around what the map actually showed on 1 October 2026, why the project exists (no
  account, no cookies, no analytics, open data only), what you get and what you don't, and every version still online.

### Fixed
- The page no longer claims the app is a single HTML file; the download size says about 70 MB.

## [0.9.2.5] - 2026-10-06

### Added
- "Tonight above you" (a Tonight button on the globe and `tonight.html`): visible passes, bright planets, meteor
  showers, the Moon, dark times, the cloud forecast, aurora chance, launches near you, the next eclipse, who is in space,
  and reminders.
- Look up: constellation figures, tap to identify, "Find" guidance, the sky on any date 1800-2049, red-light mode,
  pinch to zoom.
- Rocket launches with countdowns, people in space, search everything, find a flight by ticket number, share a picture
  of the view, embed the globe, install as an app, a warning before the weather-balloon layer, footer notices and a
  licence table.

### Fixed
- 80 defects from two review rounds, including a script-injection hole on the 2D map, cards overwriting each other,
  look-up leaks, "AA1234" read as a hex address and meteor peak nights a day off. The site build now keeps the last
  good copy of any feed it cannot refresh.

## [0.9.2.4] - 2026-10-04

### Added
- An About page for the creator, with Ironbound linked from the landing page, the About page and the footers.
- Search tags on every page (descriptions, canonical URLs, social cards, structured data), `robots.txt` and
  `sitemap.xml`.
- An MIT licence for the code and a `CITATION.cff`.

## [0.9.2.3] - 2026-10-04

### Added
- Click any country: facts, what is happening there, its biggest employers and its headlines.
- Layers: big employers as towers, volcanoes, the live aurora oval, the Sun overhead and time zones, asteroid and comet
  flybys with a scale view.
- A guided 80-second tour, links that share a view, and 3D buildings from OpenStreetMap close to the ground.

### Fixed
- Taps on land are no longer stolen by satellites on phones (tested by touch on an Android emulator).

## [0.9.2.2] - 2026-10-03

### Added
- Weather mode: live infrared clouds (GOES and Himawari), rain radar, satellite rain, moving wind and a temperature wash,
  animated over the last hours.
- Lighthouses of the world: 14,901 with height, light and range.
- Phones: a bottom dock (Explore, Layers, Time, Look up, North). Desktop: zoom, north-up, top-down and reset buttons
  with a compass, and `+ - N T R` keys.

### Changed
- Dragging the globe on phones is about 3x smoother, and the zoom out to the Solar System no longer freezes.

## [0.9.2.1] - 2026-10-03

### Added
- Other solar systems: 6,339 NASA exoplanets at their real stars; fly into any of them (TRAPPIST-1 in full).
- Look up: hold the phone to the sky to see the satellites and planets above you, with the next ISS pass.
- Eclipses 2027-2030: the Moon's shadow crossing the globe, matched to NASA's predictions.
- Light delay and our radio bubble in the Solar System; "Under the hood" panels with live accuracy against NASA JPL.

### Changed
- Phones: a smoother zoom from Earth to the Solar System and no grain layer on the 2D map; tested in Android Chrome and
  Safari's engine.

## [0.9.1] - 2026-10-02

The rebuild: one coherent project instead of three big HTML files.

### Added
- One seamless zoom: the globe hands its camera to the Solar System view past the Moon and takes it back near Earth,
  on one clock.
- 20 major moons from Mars to Pluto (orbits fitted to JPL Horizons) with real surface maps for 15 of them.
- The cosmic web finale: 43,480 galaxies from the 2MASS Redshift Survey.
- Near misses: CelesTrak SOCRATES close approaches you can watch happen; all active satellites and three debris clouds.
- Graphics levels with automatic step-down, shader pre-warm, a software-GPU hint.

### Changed
- The code moved onto ES modules: `src/core/` (shared, DOM-free, tested against JPL Horizons), `src/globe/`,
  `src/solar/` and `src/map/`. CI, `docs/ARCHITECTURE.md` and `docs/DATA_SOURCES.md` arrived.
- Phones: half the load time on a first visit, touch that works, layouts that fit.

### Fixed
- The scroll-zoom lag reported on a Mac in Firefox; no "Failed to fetch" pop-up on a first visit.

Older versions (v0.5 to v0.9) came before the rebuild; their tags are still in the repository and on the website.

[Unreleased]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.11...HEAD
[0.9.2.11]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.10...v0.9.2.11
[0.9.2.10]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.9...v0.9.2.10
[0.9.2.9]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.8...v0.9.2.9
[0.9.2.8]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.7...v0.9.2.8
[0.9.2.7]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.6...v0.9.2.7
[0.9.2.6]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.5...v0.9.2.6
[0.9.2.5]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.4...v0.9.2.5
[0.9.2.4]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.3...v0.9.2.4
[0.9.2.3]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.2...v0.9.2.3
[0.9.2.2]: https://github.com/destinjones/open-overwatch/compare/v0.9.2.1...v0.9.2.2
[0.9.2.1]: https://github.com/destinjones/open-overwatch/compare/v0.9.1...v0.9.2.1
[0.9.1]: https://github.com/destinjones/open-overwatch/compare/v0.9...v0.9.1
