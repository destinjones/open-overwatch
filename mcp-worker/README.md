# Open Overwatch MCP on Cloudflare Workers

The same server as `npx open-overwatch-mcp`, as a remote MCP endpoint: stateless Streamable HTTP at `/mcp`, so
claude.ai's custom connectors, ChatGPT's connectors and any other remote MCP client can use it without installing
anything. The Worker is [`mcp/worker.mjs`](../mcp/worker.mjs) (tested in Node with canned feeds:
`test/mcpworker.test.mjs`); this folder is its wrangler config and entry. **Deployed 2026-10-13** on the owner's account (the connector URL, which contains the token, is kept off the repo) — a redeploy is a production
change on the owner's Cloudflare account and waits for the owner's OK.

## Deploy

From this folder, with the repository's `npm install` done (wrangler bundles `satellite.js` and `src/core/` from it):

```bash
npx wrangler login
npx wrangler secret put MCP_TOKEN
npx wrangler deploy
```

`MCP_TOKEN` is a long random secret (16 characters or more; e.g. `node -e "console.log(crypto.randomUUID())"`).
Without it, or `PUBLIC = "true"` in wrangler.toml, the Worker answers 503 to everything. `npx wrangler deploy --dry-run
--outdir dist` builds the bundle without uploading it.

## Add it to claude.ai (or ChatGPT)

The connector URL is the Worker's address with the secret as the last part of the path:

```
https://open-overwatch-mcp.destinjones123.workers.dev/mcp/<MCP_TOKEN>
```

- **claude.ai**: Settings → Connectors → Add custom connector; a name ("Open Overwatch") and the URL above; leave the
  OAuth fields empty. The tools then show in the chat's tools menu.
- **ChatGPT**: the connector settings (developer mode) take the same URL, with no authentication.
- **Clients that send headers** (the MCP Inspector, Claude Code `claude mcp add --transport http`, your own code) can use
  `https://open-overwatch-mcp.destinjones123.workers.dev/mcp` with `Authorization: Bearer <MCP_TOKEN>` instead.

Treat the URL like a password: anyone with it can use the server (read-only public data, but your Cloudflare quota).
To change it, `npx wrangler secret put MCP_TOKEN` again and update the connector.

## What it does differently from the local server

| | Local (`npx open-overwatch-mcp`) | Worker |
|---|---|---|
| Transport | stdio, or Streamable HTTP on loopback | Streamable HTTP at `/mcp` (stateless, JSON answers) |
| Who may call | your own machine | the token (header or path), or anyone with `PUBLIC = "true"` |
| Tools | all of them | all on `PLAN = "paid"`; the free plan leaves out the 13 heaviest (`HEAVY` in mcp/worker.mjs) |
| Caching | in memory | the Workers Cache API (each feed for its own lifetime, each tool answer for 1-60 min) plus the isolate's memory |
| The globe in the chat | Claude Desktop shows it (MCP Apps) | links only, unless the host supports MCP Apps over remote connectors |

**The free plan** gives a Worker 10 ms of CPU and 50 subrequests (fetches and Cache API calls together) per request.
Measured with the canned feeds, most tools answer in 0.1-4 ms once their data is parsed, but SGP4 pass searches,
the planets' look-ahead, vector-tile and fire-tile decoding and the vessel-by-vessel AIS look-ups don't fit, so
`PLAN = "free"` leaves out `satellite_passes`, `night_sky`, `close_approaches`, `reentries`, `where_is_satellite`, `solar_system`,
`wildfires`, `plate_readers`, `military_areas`, `ships_baltic`, `traffic_cameras`, `transit_vehicles` and `dark_sky`
(`TOOLS_ON` puts one back, `TOOLS_OFF` takes more out). A fresh isolate's first call that parses a big data copy
(eclipses, countries, the small-body list: 15-150 ms) can still overrun; a request that does fails with Cloudflare's
CPU error and the next one, with the data cached, answers. Every answer that would need more than 45 look-ups says so
instead of failing halfway. On Workers Paid (`PLAN = "paid"`) every tool is listed.

**Limits**: a rate-limiting binding (`LIMITER`, 30 calls a minute per address) in wrangler.toml; a WAF rate-limit rule
on the route works too. Bodies over 1 MB get 413, browser origins other than claude.ai, ChatGPT and `ALLOW_ORIGINS`
get 403, GET and DELETE on `/mcp` get 405 (no event streams, no sessions).

**Sources that refuse Cloudflare**: the ADS-B networks block Cloudflare's addresses (see docs/NOTES.md, the relay);
no tool here reads them. adsbdb, Open-Meteo, USGS, NOAA, NASA and the website's own data copies answer normally.

## Settings (wrangler.toml `[vars]`, secrets with `wrangler secret put`)

| Name | Default | |
|---|---|---|
| `MCP_TOKEN` (secret) | — | the shared secret: `Authorization: Bearer <token>` or `/mcp/<token>` |
| `PUBLIC` | `false` | `true`: no token needed |
| `PLAN` | `free` | `paid` lists every tool |
| `OO_SITE` | the public website | where links point and the data copies come from |
| `TOOLS_OFF`, `TOOLS_ON` | — | comma-separated tool names to leave out / keep in |
| `ALLOW_ORIGINS` | — | more browser origins (claude.ai, chatgpt.com, chat.openai.com always may) |
| `LOG` | `false` | one line per tool call in `npx wrangler tail` (name and time, never the arguments) |
| `LIMITER` (binding) | 30 / min | the rate limit per caller address |
