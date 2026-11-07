// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Preloaded (node --import) into a real `node mcp/server.mjs` by test/mcpfixes.test.mjs: every request fails, shortly after it
// is made, and none leaves this machine. OO_STUB_FETCH=throw fails as a network does; anything else answers HTTP 404.
const mode = process.env.OO_STUB_FETCH;
globalThis.fetch = /** @type {typeof fetch} */ (async () => {
  await new Promise(r => setTimeout(r, 15));
  if (mode === 'throw') throw new TypeError('fetch failed');
  return new Response('nope', { status: 404 });
});
