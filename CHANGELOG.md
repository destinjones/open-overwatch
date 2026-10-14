# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are small four-part steps (v0.9.2.11, then v0.9.2.12, …) rather than strict semantic versioning: every release
is a usable site, and every one stays online under `/v/<tag>/` on the website (the landing page's version picker lists
them). The annotated tag messages (`git tag -n99`) are the release notes this file was built from.

## [Unreleased]

### Added
- A contributor on-ramp: CONTRIBUTING.md (run it, test it, the house rules, how a change gets released, good first
  issues), issue templates for bugs, features and data sources, a pull request template, SECURITY.md with a private
  reporting route, a Code of Conduct (Contributor Covenant 2.1), GOVERNANCE.md (what owning the project involves, how
  releases, the relay and the MCP Worker are run), this changelog, and a dev container for one-click setup.
- The Zenodo DOI in the README and CITATION.cff.
- Falling soon: satellites and debris predicted to re-enter in the next 30 days, worked out from the element sets (decay
  from n-dot and drag through a solar-scaled atmosphere), each with a window of ±25% of the time left and its corridor;
  on the globe (list, cards, a corridor layer), the 2D map and the MCP server (`reentries`, the 37th tool).

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
