# Contributing to Open Overwatch

Thanks for looking. Bug reports, fixes, new layers, new data sources, better docs and plain "this confused me" notes are
all welcome. You don't need to ask before starting; for anything big, an issue first saves you work if it clashes with
something already under way.

This page is the short version. The long one, with worked examples for a new globe layer, a 2D map layer and an MCP
tool, is [docs/DEVELOPING.md](docs/DEVELOPING.md).

## Run it

You need Node 20 or newer (CI uses 22). Python 3 is optional (`serve.py` does the same job as `serve.js`). Nothing to
build.

```bash
git clone https://github.com/destinjones/open-overwatch.git
cd open-overwatch
node serve.js
```

That serves the folder on http://127.0.0.1:8787/ and relays the few feeds that send no CORS headers. The pages:

| Page | What | Code | Console handle |
|---|---|---|---|
| `/index.html` | the landing page | plain HTML | |
| `/globe.html` | the 3D globe (CesiumJS) | `src/globe/` | `OO3D` |
| `/solar.html` | Solar System to the Local Group (three.js) | `src/solar/` | `OOSS` |
| `/open-overwatch.html` | the 2D ops map (Leaflet); "Enter silent" skips the audio | `src/map/` | `OW` |
| `/tonight.html` | Tonight above you, without the globe | `src/sky/` | |
| `/guide.html` | the user guide | plain HTML | |

`OW_PORT=8788 node serve.js` runs a second copy on another port. The service worker is off on localhost so you always
see your latest edit (`?sw=1` turns it on).

Prefer one click? Open the folder in VS Code with the Dev Containers extension (or in a GitHub Codespace opened in VS
Code Desktop) and pick "Reopen in Container": [.devcontainer/](.devcontainer/devcontainer.json) has Node 22 and Python 3,
installs the dependencies and starts the helper on port 8787 for you.

## Test it

```bash
npm install          # once: satellite.js (the MCP server's one dependency) and Playwright (dev only)
node --test          # the unit tests: maths against JPL Horizons, parsers, the MCP server, the docs against the code
npm run coverage     # the same tests, failing if coverage of src/core and mcp drops below the floor (CI runs this)
npm run e2e          # the browser tests: every page in headless Chromium, feeds stubbed (~4 minutes)
```

- `node --test test/measure.test.mjs` runs one file.
- The browser tests need a browser: `npx playwright install chromium` (on Linux add `--with-deps`); on Windows they
  fall back to the installed Edge. They start their own helper on port 8805, so your :8787 is left alone.
- `test/docs.test.mjs` checks the docs against the code: a new layer, link parameter or core module fails the tests
  until it has its line in the guide or docs. That's on purpose; the failure message says where.
- More (frame rates, phone journeys, the Android emulator, WebKit) in [docs/TESTING.md](docs/TESTING.md).

CI (`.github/workflows/ci.yml`) runs a syntax check of every module, a check that every module a page loads exists, the
accessibility check, `npm audit` (high or critical fails), a licence check (`brand/tools/license_check.mjs`: permissive
licences only in the production dependencies), `npm run coverage` and, as its own job, the browser tests, on every push
and pull request. CodeQL scans pull requests to `main`, and Dependabot proposes dependency updates weekly. A new
dependency must have a permissive licence; new code in `src/core/` or `mcp/` needs tests so coverage stays above the
floor ([docs/DEVELOPING.md](docs/DEVELOPING.md#3-tests)).

## The few rules that matter

1. **No build step.** Pages load ES modules straight from `src/`; libraries come from CDNs pinned to exact versions. No
   bundler, no transpiler, no framework. If you need a library, pin it in the page's import map or script tag.
2. **`src/core/` has no DOM and no three.js or Cesium imports**, so Node can test it. Shared logic (parsers, maths,
   anything two views or the MCP server both need) goes there, with a test and a section in
   [docs/CORE.md](docs/CORE.md). Space positions are heliocentric ecliptic J2000 in AU, time is a Julian Date, and core
   functions write vectors into an `out` object (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
3. **Escape every upstream string** before it goes into HTML: `esc()` (and `isHttp()` for links). Feeds are other
   people's data and some of it is user-submitted. A host that needs the relay goes into `NEEDS_RELAY` in
   `src/map/util.js` **and** `ALLOWED_HOSTS` in both `serve.js` and `serve.py` (`test/relayhosts.test.mjs` checks the
   lists agree). Putting it on the website's public relay as well needs the feed owner's agreement and a redeploy of the
   Worker, which only the owner does ([GOVERNANCE.md](GOVERNANCE.md#the-relay-and-the-mcp-worker)); until then the
   website says that layer needs the download version.
4. **Never point automated runs at CelesTrak.** It firewalled the owner's network once after a day of renders. The site
   mirrors the element sets; scripts and tests use the mirror or fixtures. Renders go through
   `brand/tools/globe_shot.mjs`, which blocks it.
5. **Be polite to the sources**: sensible refresh rates, credit where they ask, no disguised clients, only feeds whose
   terms allow it. Downloading a new big dataset is the owner's call; ask in an issue.
6. **Every new source file starts with the copyright line** the others carry:
   `// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).`
   (`#` for Python, `<!-- -->` for HTML). You keep the credit for your work in the commit history; the line keeps the
   project's MIT notice intact in copies.
7. **Phones are first-class.** If it adds work per frame, check it in the phone profile too.
8. **Plain English** in the interface and the docs: say what it is, where it comes from and how sure it is.

## From a branch to a release

1. Fork, branch from `main`, make your change, run `node --test` (and `npm run e2e` if you touched a page).
2. Open a pull request. The template asks what changed, how you checked it and which docs you touched. CI runs on it.
3. The owner reviews and merges. Small focused PRs get merged fastest.
4. Releases are small four-part versions (v0.9.2.11, then v0.9.2.12, …), cut by the owner with `Publish Update.bat`: it
   catches up with `origin/main` first (and stops, changing nothing, if that would need a merge), stamps the version,
   tags it and pushes, and takes the tag and commit back if the push fails. The Website workflow then rebuilds the site
   with the newest 6 releases frozen under `/v/<tag>/` (older ones link to their release zip), and the Release workflow
   attaches the download zip and the Claude Desktop extension to a GitHub release. What changed goes into
   [CHANGELOG.md](CHANGELOG.md) under "Unreleased" until then.
5. The site leaves the dev-only folders off (`test/`, `e2e/`, `notes/`, `relay/`, `mcp-worker/`, `brand/clip/`), so a
   file a page loads at run time can't live there unless it is listed in `KEEP_ROOT` in `.github/build_site.py`
   (`test/sitebudget.test.mjs` checks).

The details (what the site build mirrors, how the relays are deployed) are in
[docs/DEVELOPING.md](docs/DEVELOPING.md#10-publishing) and [GOVERNANCE.md](GOVERNANCE.md).

## Where to start

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the shape of it, then the smallest complete example of each kind
of change: `src/globe/volcanoes.js` (a globe layer, 28 lines), `src/map/feeds.js` (2D map layers) and
`mcp/volcanoes.mjs` (an MCP tool). [ROADMAP.md](ROADMAP.md) has everything planned, with `[ ]` for what's still open.

### Good first issues

Real open items from the roadmap, roughly smallest first. Say in an issue which one you're taking so two people don't
do the same one.

- **The globe's zoom pad covers the end of the band at 1366x820** (Measure, Eclipses, Solar system). `#navpad` and
  `#band` in `globe.html`'s styles; the browser tests' desktop window is exactly that size.
- **An `earth_now` MCP tool.** The globe's "Earth now" panel sums are already in `src/core/earthnow.js` (tested); a tool
  in `mcp/` that returns the same summary needs a file like `mcp/volcanoes.mjs`, a test in `test/mcp.test.mjs` and a
  line in `mcp/manifest.json` and `mcp/README.md` ([DEVELOPING.md section 8](docs/DEVELOPING.md#8-adding-an-mcp-tool)).
- **The 2D map's missing aviation bits.** The tower view, the landing watch and the route arc to the destination are
  still globe-only (`src/globe/`); the 2D map has the aircraft cards to hang them on (`src/map/aviation.js`).
- **Uranus, Neptune and the dwarf planets in the Solar System's eclipses and occultations**
  (`src/core/syzygy.js`, `brand/tools/make_ephem.py`). Bigger, and needs a feel for the maths; the tests compare with
  published predictions, so you'll know when it's right.

Docs fixes count too: if something here or in DEVELOPING.md was wrong or unclear when you tried it, a PR that fixes it
is one of the most useful things you can send.

## Asking, reporting, suggesting

- **A bug:** open an issue with the bug template. A share link (the Share button) and the numbers from the "Under the
  hood" panel (the <kbd>`</kbd> key on the globe and in the Solar System) make most bugs quick to find.
- **A data source:** the data source template asks for the licence, whether it sends CORS headers and whether it needs a
  key; those three decide whether the website can use it.
- **A security problem:** please don't open a public issue; see [SECURITY.md](SECURITY.md).

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree that
your contribution is released under the project's [MIT License](LICENSE).
