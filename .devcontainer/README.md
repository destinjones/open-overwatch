# The dev container

One click from a clone to a running copy: open the folder in VS Code with the
[Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension and
pick **Reopen in Container**. It needs Docker (Docker Desktop, or Podman / Rancher on Linux).

What you get:
- Node 22 (what CI uses) and Python 3, on Debian bookworm.
- `npm ci` done: satellite.js for the MCP server, Playwright for the browser tests.
- The local helper (`node serve.js`) started in a terminal and port 8787 forwarded: open
  http://localhost:8787/globe.html (or `/solar.html`, `/open-overwatch.html`) on your machine.
- `node --test` works straight away.

**Port 8787 must be free on your machine.** The helper only answers requests addressed to `localhost:8787` or
`127.0.0.1:8787` (it guards against DNS rebinding), so the forwarded port has to be the same number. If something else
holds 8787, stop it, or run `OW_PORT=8788 node serve.js` in the container and forward 8788 instead.

**Codespaces:** open the codespace in VS Code Desktop ("Open in VS Code Desktop"), which forwards to `localhost` like a
local container. In the browser-based editor the forwarded address is a `*.app.github.dev` host, which the helper
refuses with "wrong host".

**Browser tests** (optional, a few hundred MB): install headless Chromium and the system libraries it needs once, then run
the suite:

```bash
npx playwright install --with-deps --only-shell chromium
npm run e2e
```

They start their own helper on port 8805 and stub every live feed, so they run fine inside the container.
