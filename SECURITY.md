# Security

## Reporting a problem

Please report security problems **privately**, through GitHub's private vulnerability reporting:
[open a private report](https://github.com/destinjones/open-overwatch/security/advisories/new) (the Security tab →
"Report a vulnerability"). Only the maintainer sees it. Please don't open a public issue or pull request for it until a
fix is out.

What helps: what an attacker could do, the page or file and line if you know it, and a share link or request that
shows it. A proof of concept against your own local copy (`node serve.js`) is ideal; please don't test against other
people's browsers or hammer the public relays.

This is a one-person, spare-time project, so there's no bounty and no formal deadline. You should hear back within a
week, and a confirmed problem gets fixed in the next release (they're small and frequent), with credit to you in the
advisory and the changelog unless you'd rather not.

## What's in scope

| Part | Where | What would be a problem |
|---|---|---|
| The pages | `*.html`, `src/` | script injection: an upstream feed string, a share link (`#c=…`, `d=`, `scene=`), a search or a voice command that ends up as live HTML or a `javascript:` link; a share link that does something the visitor didn't ask for; a CDN file loaded without its pinned `integrity` hash, a page's Content-Security-Policy letting in a script that is neither one of its hashed inline scripts nor from the CDN origins it names, or `src/vendor/satellite.min.js` (the satellite workers' copy, which `importScripts` can't check) differing from the release the pages pin |
| The service worker | `sw.js` | serving one page's or one version's content for another, caching something it shouldn't |
| The local helper | `serve.js`, `serve.py` | its relay used by another website or for a host off its allowlist, reading files outside the folder, DNS rebinding, a request that kills it |
| The public relay | `relay/worker.js` (a Cloudflare Worker) | relaying a host or path off its allowlist, use from origins other than the published site, cache poisoning, a way past its size or method limits, a second spelling of the same feed that gets past its one request form (`/?url=` + `encodeURIComponent` of the normalised URL, optionally `&t=<digits>`; anything else is a 400) and so becomes a new cache entry and a new upstream request |
| The MCP server | `mcp/` (stdio and `--http`) | a tool argument that reaches a URL, file or host it shouldn't; the HTTP transport answering other origins or other machines |
| The MCP Worker | `mcp-worker/`, `mcp/worker.mjs` | a way past the token, the rate limit or the free plan's tool list; answers leaking across callers through the cache |
| The site build | `.github/build_site.py`, `.github/workflows/` | a mirrored feed that can inject into the published site, a workflow that runs untrusted code with write access |

The MCP Worker runs on the owner's Cloudflare account, behind a token, since 2026-10-13. It has not been redeployed
since, so the code here can be newer than what runs; reports on either are welcome. The public relay was last
redeployed on 2026-10-17.

## What isn't

- The data being wrong, late or faked. Open Overwatch shows other people's open data as it comes; some of it (weather
  balloons, AIS, ADS-B) is self-reported by anyone. The site's notices say so. A display that makes bad data look
  trustworthy is still worth an ordinary issue.
- Problems in the upstream services, the CDNs or the libraries themselves (report those to them), unless the way
  Open Overwatch uses them makes it worse.
- Rate limits and quotas of the free services it reads.
- Archived versions under `/v/<tag>/` on the website: they are frozen copies of past releases and don't get patched. A
  fix lands in the next release; tell us if an old version is dangerous enough to take down. Only the newest 6
  releases keep a copy online; older ones are a page pointing at their release zip.

## Supported versions

Only the latest release (the website's root, the latest GitHub release and its Claude extension) gets fixes.
