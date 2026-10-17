# Governance and hand-off

Open Overwatch has one maintainer: [Destin Jones](https://github.com/destinjones), who started it, decides what goes
in, and runs the website and the two Cloudflare Workers. It is built in public with Claude (an AI) as the building
partner. This page says what owning it involves, so a co-maintainer or a new owner can pick it up without guessing.

The README says it plainly: if you'd like to take the whole project over, a hand-off is what the owner would prefer.
Open an issue and say so.

## How decisions are made

- The maintainer reviews and merges pull requests, and decides what a release contains and when it goes out.
- [ROADMAP.md](ROADMAP.md) is the plan. Anyone can propose changes to it in an issue or a pull request.
- Things that cost money, touch other people's services or are hard to undo are the owner's call alone: downloading a
  new dataset, adding a host to the public relay (it also needs the feed owner's agreement), deploying either Worker,
  publishing to npm, and changing the repository's settings.
- The house rules in [CONTRIBUTING.md](CONTRIBUTING.md#the-few-rules-that-matter) hold for everyone, the owner included.

## What there is to run

| Thing | Where it lives | How it's run | What it needs |
|---|---|---|---|
| The source | github.com/destinjones/open-overwatch (public, MIT) | `main` is what's published | GitHub admin rights |
| The website | GitHub Pages, https://destinjones.github.io/open-overwatch/ | the Website workflow (`.github/workflows/pages.yml` → `.github/build_site.py`) on every push to `main`, every 6 hours, and by hand | nothing besides the repository; no secrets |
| Feed copies on the website | `data/tle/`, `data/launches.json`, `data/astronauts.json`, `data/flybys.json`, `data/socrates.json`, `data/news.json`, `data/wind.json` | made by that same build every 6 hours; a feed it can't refresh keeps the last good copy | nothing; the build is the only automated client of CelesTrak, once per 6 hours |
| Releases | GitHub releases: `open-overwatch.zip` (the download) and `open-overwatch.mcpb` (the Claude Desktop extension) | the Release workflow (`.github/workflows/release.yml`) on every `v*` tag | nothing besides the repository |
| Archived versions | `/v/<tag>/` on the website, one per annotated tag | rebuilt from the tags by every site build | Pages' 1 GB limit: ~25 MB a version |
| The public relay | Cloudflare Worker `open-overwatch-relay` (`relay/`) on the owner's account | `npx wrangler deploy` from `relay/` | the Cloudflare account; free plan; a WAF rate-limit rule on its route |
| The MCP Worker | `mcp-worker/` (code in `mcp/worker.mjs`) | deployed (2026-10-13) as `open-overwatch-mcp` on the owner's Cloudflare account, behind a secret token; [mcp-worker/README.md](mcp-worker/README.md) has the steps | a Cloudflare account and an `MCP_TOKEN` secret |
| The npm package | `open-overwatch-mcp` (`package.json`) | **not published yet**; `npm publish` | an npm account |
| The DOI | Zenodo, [10.5281/zenodo.23348946](https://doi.org/10.5281/zenodo.23348946) | Zenodo's GitHub integration archives each GitHub release | the owner's Zenodo account linked to the repository |

## Cutting a release

1. Work lands on `main` through pull requests (the owner works on a local `rebuild` branch and merges it; a local
   pre-push hook stops accidental pushes).
2. Move CHANGELOG.md's "Unreleased" section under the new version and date. Versions are small four-part steps:
   after v0.9.2.11 comes v0.9.2.12.
3. Run `node --test`; CI must be green on the commit.
4. Run `Publish Update.bat` (Windows; on another system do the same by hand): it writes the version into `OW_VERSION`
   in `src/map/version.js`, commits, creates the annotated tag `v<version>` and pushes `main` with its tags. The tag's
   message is the release note: write a short paragraph a visitor would understand.
5. GitHub then rebuilds the site (about a minute, with the new version at the root and under `/v/<tag>/`) and builds the
   release with its two files. Bump the MCP version (`VERSION` in `mcp/feeds.mjs`, `package.json`,
   `mcp/manifest.json`) when the server changed; the tests check they agree.
6. Afterwards: the status line in `CLAUDE.md` and the boxes in ROADMAP.md, the version and date in `CITATION.cff`.
   (The site build dates each page's `lastmod` in `sitemap.xml` from git; a new page only needs its `<url>` line.)

When a release adds a runtime file (a new data file, texture, module folder), check it is in `APP_PATHS` in
`build_site.py` (or archived versions 404 on it) and in the zip's file list in `release.yml`.

## The relay and the MCP Worker

**The public relay** lets the website read the few feeds that send no CORS headers (NOAA hurricane advisories, some
camera lists and stills, the submarine cable map). It only carries the hosts in `PUBLIC_RELAY_HOSTS`
(`src/core/relay.js`), each limited to its feed paths, GET only, for the published site's origin. To change it:
edit `relay/worker.js`, run `node --test` (`test/relay.test.mjs`), then `npx wrangler login` and `npx wrangler deploy`
from `relay/`. Adding a host needs the feed owner's agreement; the ADS-B networks and OpenSky refuse cloud servers, and
the relay must not be disguised to get past that. If the relay goes down, those layers say they need the download
version; nothing else breaks. Details: docs/NOTES.md, "Public relay".

**The MCP Worker** would serve the MCP tools to claude.ai and ChatGPT connectors. Deploying it is a production change
with a running cost on the free plan's quotas: a token (`MCP_TOKEN`), a rate limit and the free plan's smaller tool list
are built in. Its README has the deploy and the connector steps.

**Accounts.** Both Workers run on the owner's Cloudflare account (`destinjones123.workers.dev`). A new owner deploys
them to their own account and changes the URLs: `PUBLIC_RELAY` in `src/core/relay.js` for the relay (search for
`destinjones123.workers.dev` to catch the rest), and the connector address for the MCP Worker. The website's address is the GitHub Pages address of the repository, so a
transferred repository moves the site too (old links redirect for the repository, not for Pages: keep a note on the old
site).

## Handing it over

What a new owner or co-maintainer gets, and the steps:

1. **Repository**: transfer it (Settings → Transfer) or add the new person as an admin. Issues, stars, forks and
   releases move with a transfer.
2. **Pages**: enable Pages from GitHub Actions on the new home; the Website workflow does the rest. The site address
   is written into the code in many places: search for `destinjones.github.io` (the pages' canonical and social tags,
   `README.md`, `CITATION.cff`, `package.json`, `mcp/manifest.json`, `mcp/feeds.mjs`, `robots.txt`, `sitemap.xml`,
   `onPublishedSite` in `src/core/relay.js`, `SITE` in `relay/worker.js`, a few modules in `src/`).
3. **Workers**: deploy the relay (and, if wanted, the MCP Worker) to the new owner's Cloudflare account, then point
   `src/core/relay.js` at it. Retire the old ones only after the new site is live.
4. **Names and credit**: the code is MIT, so the copyright line and `NOTICE` stay as they are; a new owner adds their
   own name for their own work (a second copyright line, or a line in NOTICE). Zenodo's DOI keeps pointing at the
   archived releases.
5. **Knowledge**: [docs/DEVELOPING.md](docs/DEVELOPING.md) (how), [docs/NOTES.md](docs/NOTES.md) (why, area by area),
   [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) (every source's terms) and [ROADMAP.md](ROADMAP.md) (what's next).
   `CLAUDE.md` is the brief the AI sessions work from; keep it if you build with Claude too.
