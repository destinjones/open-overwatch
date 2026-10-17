// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The MCP server as a Cloudflare Worker (mcp/worker.mjs, deployed from mcp-worker/), run here in Node without wrangler:
// the handler gets web Requests, a canned Internet and a stand-in for the Workers Cache API. Who may call (a token in
// the header or the path, or nobody needed), CORS for claude.ai and ChatGPT, the free plan's tool list, answers shared
// through the cache between requests and between isolates, the subrequest budget, the rate limit, and that nothing the
// Worker imports needs Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createWorker, settings, HEAVY, CONNECTOR_ORIGINS, CALL_TTL } from '../mcp/worker.mjs';
import { VERSION } from '../mcp/feeds.mjs';

const root = new URL('../', import.meta.url);
const NOW = Date.parse('2026-10-01T18:00:00Z');
const TOKEN = 'a-long-enough-secret-123';
const quake = (mag, lat, lon, place, mins) => ({ properties: { mag, place, time: NOW - mins * 60e3, type: 'earthquake', tsunami: 0, url: 'https://earthquake.usgs.gov/x' }, geometry: { coordinates: [lon, lat, 10] } });
const QUAKES = { features: [quake(5.1, 35.6, 139.7, '20 km SE of Tokyo, Japan', 30), quake(3.0, 31.6, -102.0, '15 km W of Midland, Texas', 90)] };
const ROUTES = [
  [/earthquake\.usgs\.gov\/.*(2\.5|4\.5)_day\.geojson$/, QUAKES],
  [/seismicportal\.eu\/fdsnws\/event\/1\/query/, { features: [] }],   // EMSC, asked beside USGS by the earthquakes tool
  [/api\.open-meteo\.com\/v1\/forecast\?.*current=is_day/, { timezone: 'Europe/Helsinki' }],
  [/api\.open-meteo\.com\/v1\/forecast/, { status: 503 }],
  [/api\.adsbdb\.com\/v0\/callsign\/BAW15$/, { response: { flightroute: { callsign: 'BAW15', airline: { name: 'British Airways', icao: 'BAW', country: 'United Kingdom' } } } }],
];

function internet(routes = ROUTES) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    for (const [m, b] of routes) if (m.test(url)) return b.status ? new Response('', { status: b.status }) : new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
    return new Response('nothing here', { status: 404 });
  };
  return { fetchImpl, asked };
}
/** The Workers Cache API, enough of it: caches.default.match / put by request URL. */
function cacheStorage() {
  const store = new Map(), ops = [];
  return { store, ops, default: {
    async match(req) { ops.push(['match', req.url]); const e = store.get(req.url); return e ? new Response(e.body.slice(0), { headers: e.headers }) : undefined; },
    async put(req, res) { ops.push(['put', req.url]); store.set(req.url, { body: await res.arrayBuffer(), headers: Object.fromEntries(res.headers) }); },
  } };
}
const ctx = () => { const waits = []; return { waits, waitUntil: p => waits.push(p) }; };
const post = (msg, { path = '/mcp', auth = `Bearer ${TOKEN}`, origin, headers = {} } = {}) => new Request('https://open-overwatch-mcp.example.workers.dev' + path, { method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}), ...(origin ? { origin } : {}), ...headers }, body: JSON.stringify(msg) });
const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const make = (net = internet(), caches = cacheStorage()) => ({ net, caches, worker: createWorker({ fetchImpl: net.fetchImpl, caches, now: () => NOW }) });

test('mcp worker: nothing answers until it has a token or is made public; health and OAuth probes', async () => {
  const { worker } = make();
  assert.equal((await worker.fetch(post(LIST), {})).status, 503, 'no secret set: no answers');
  assert.equal((await worker.fetch(post(LIST), { MCP_TOKEN: 'short' })).status, 503, 'a short secret is no secret');
  assert.equal((await worker.fetch(new Request('https://x.example/health'), {})).status, 200);
  assert.equal((await worker.fetch(new Request('https://x.example/.well-known/oauth-protected-resource'), { MCP_TOKEN: TOKEN })).status, 404, 'no OAuth: connectors go on without it');
  const info = await worker.fetch(new Request('https://x.example/'), { MCP_TOKEN: TOKEN });
  assert.equal(info.status, 200); assert.match(await info.text(), new RegExp(`open-overwatch-mcp ${VERSION.replace(/\./g, '\\.')} \\(free plan, ${HEAVY.length} tools off\\)`));
});

test('mcp worker: the token in the Authorization header or in the path; or no token at all when public', async () => {
  const { worker } = make(), env = { MCP_TOKEN: TOKEN };
  const r = await worker.fetch(post(LIST), env);
  assert.equal(r.status, 200); assert.ok((await r.json()).result.tools.length > 10, 'a real domain is fine (no loopback Host check)');
  const none = await worker.fetch(post(LIST, { auth: null }), env);
  assert.equal(none.status, 401); assert.equal(none.headers.get('www-authenticate'), 'Bearer'); assert.equal((await none.json()).error.code, -32001);
  assert.equal((await worker.fetch(post(LIST, { auth: 'Bearer a-long-enough-secret-124' }), env)).status, 401);
  const viaPath = await worker.fetch(post(call('earthquakes', { min_magnitude: 4 }), { path: `/mcp/${TOKEN}`, auth: null }), env);
  assert.equal(viaPath.status, 200, 'claude.ai connectors: the secret is the URL');
  assert.match((await viaPath.json()).result.content[0].text, /1 earthquake of magnitude 4\+/);
  assert.equal((await worker.fetch(post(LIST, { path: '/mcp/not-the-secret-at-all', auth: null }), env)).status, 404, 'a wrong secret URL is a page that is not there');
  for (const bad of ['/mcp/%zz', '/mcp/%E0%A4%A']) assert.equal((await worker.fetch(post(LIST, { path: bad, auth: null }), env)).status, 404, `${bad}: a malformed escape is a wrong secret, not a crash`);
  assert.equal((await worker.fetch(post(LIST, { path: `/mcp/${TOKEN}`, auth: null }), { PUBLIC: 'true' })).status, 404, 'public without a token: no secret paths');
  const open = await worker.fetch(post(LIST, { auth: null }), { PUBLIC: 'true' });
  assert.equal(open.status, 200);
  assert.equal((await worker.fetch(new Request('https://x.example/mcp', { method: 'GET', headers: { authorization: `Bearer ${TOKEN}` } }), env)).status, 405, 'stateless: no event stream');
});

test('mcp worker: CORS for claude.ai and ChatGPT pages (and listed origins); other origins refused', async () => {
  const { worker } = make(), env = { MCP_TOKEN: TOKEN };
  for (const path of ['/mcp', `/mcp/${TOKEN}`]) {
    const pre = await worker.fetch(new Request('https://x.example' + path, { method: 'OPTIONS', headers: { origin: 'https://claude.ai', 'access-control-request-method': 'POST' } }), env);
    assert.equal(pre.status, 204, path); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://claude.ai');
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/); assert.match(pre.headers.get('access-control-allow-headers'), /MCP-Protocol-Version/);
  }
  const fromChat = await worker.fetch(post(LIST, { origin: 'https://chatgpt.com' }), env);
  assert.equal(fromChat.status, 200); assert.equal(fromChat.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
  assert.equal((await worker.fetch(post(LIST, { origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(post(LIST, { origin: 'https://app.example' }), { ...env, ALLOW_ORIGINS: 'https://app.example' })).status, 200);
  const denied = await worker.fetch(post(LIST, { auth: null, origin: 'https://claude.ai' }), env);
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('access-control-allow-origin'), 'https://claude.ai', 'a browser can read why it was refused');
  assert.deepEqual([...CONNECTOR_ORIGINS], ['https://claude.ai', 'https://chatgpt.com', 'https://chat.openai.com']);
});

test('mcp worker: the free plan leaves the heavy tools out; paid lists all; TOOLS_OFF and TOOLS_ON adjust', async () => {
  const { worker } = make(), names = async env => (await (await worker.fetch(post(LIST), { MCP_TOKEN: TOKEN, ...env })).json()).result.tools.map(t => t.name);
  const free = await names({}), paid = await names({ PLAN: 'paid' });
  assert.equal(paid.length, 38); assert.equal(free.length, 38 - HEAVY.length);
  for (const h of HEAVY) { assert.ok(paid.includes(h), h); assert.ok(!free.includes(h), h); }
  for (const keep of ['earthquakes', 'weather', 'weather_details', 'aircraft_lookup', 'where_in_space', 'show_on_globe']) assert.ok(free.includes(keep), keep);
  const tuned = await names({ TOOLS_OFF: 'aircraft_lookup, bike_share', TOOLS_ON: 'satellite_passes' });
  assert.ok(!tuned.includes('aircraft_lookup') && !tuned.includes('bike_share') && tuned.includes('satellite_passes'));
  const r = await (await worker.fetch(post(call('night_sky', { place: 'Helsinki' })), { MCP_TOKEN: TOKEN })).json();
  assert.equal(r.error.code, -32602, 'a tool that is off is unknown, not a crash');
  assert.deepEqual(settings({ PLAN: 'PAID' }).omit, []); assert.equal(settings({ MCP_TOKEN: 'x'.repeat(15) }).token, '');
});

test('mcp worker: answers are shared through the Cache API: the same question costs nothing, a new isolate reuses the feed', async () => {
  const { worker, net, caches } = make(), env = { MCP_TOKEN: TOKEN }, c1 = ctx();
  const a = await (await worker.fetch(post(call('earthquakes', { min_magnitude: 3, period: 'day' }, 7)), env, c1)).json();
  assert.equal(a.id, 7); assert.equal(a.result.isError, false); assert.equal(net.asked.length, 2, 'USGS and EMSC');
  assert.ok(c1.waits.length >= 1, 'cache writes finish after the answer (waitUntil)'); await Promise.all(c1.waits);
  assert.ok([...caches.store.keys()].every(k => k.startsWith('https://mcp-cache.open-overwatch.invalid/')), 'keys on a host that is never asked');
  const putCall = [...caches.store.entries()].find(([k]) => k.includes('/call/'));
  assert.equal(putCall[1].headers['cache-control'], `public, max-age=${CALL_TTL.default}`);
  const b = await (await worker.fetch(post(call('earthquakes', { period: 'day', min_magnitude: 3 }, 8)), env, ctx())).json();
  assert.equal(b.id, 8, 'its own id'); assert.deepEqual(b.result, a.result, 'the same answer, arguments in any order'); assert.equal(net.asked.length, 2, 'no new look-ups');
  // a fresh isolate (new memory) in the same data centre: the USGS feed comes from the Cache API, not from USGS
  const other = internet(), w2 = createWorker({ fetchImpl: other.fetchImpl, caches, now: () => NOW });
  const c = await (await w2.fetch(post(call('earthquakes', { min_magnitude: 4 })), env, ctx())).json();   // a new question on the same feed
  assert.match(c.result.content[0].text, /1 earthquake of magnitude 4\+/); assert.equal(other.asked.length, 0, 'the feed was in the shared cache');
  // errors are not kept
  const e1 = await (await worker.fetch(post(call('earthquakes', { min_magnitude: 1, period: 'month' })), env, ctx())).json();
  assert.equal(e1.result.isError, true); assert.ok(![...caches.store.values()].some(v => new TextDecoder().decode(v.body).includes('whole month')));
});

test('mcp worker: an answer that would need more look-ups than a request may make says so', async () => {
  const { worker } = make(internet([]), null);   // the third data file it needs is one too many
  const r = await (await worker.fetch(post(call('where_in_space', { name: 'Apophis' })), { MCP_TOKEN: TOKEN, SUBREQUESTS: '2' })).json();
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /more look-ups than this server may make for one question/); assert.equal(r.result.structuredContent.error, 'retry_later');
  assert.equal(settings({ SUBREQUESTS: '5000' }).budget, 45, 'never above the plan'); assert.equal(settings({ PLAN: 'paid' }).budget, 900);
});

test('mcp worker: the rate limit binding turns callers away with 429 and Retry-After', async () => {
  const { worker } = make(), keys = [];
  const LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: keys.length < 2 }; } };
  const req = () => post(LIST, { headers: { 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal((await worker.fetch(req(), { MCP_TOKEN: TOKEN, LIMITER })).status, 200);
  const r = await worker.fetch(req(), { MCP_TOKEN: TOKEN, LIMITER });
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60'); assert.deepEqual(keys, ['203.0.113.9', '203.0.113.9']);
});

test('mcp worker: aircraft_lookup and other light tools answer on the free plan', async () => {
  const { worker } = make();
  const r = await (await worker.fetch(post(call('aircraft_lookup', { callsign: 'BAW15' })), { MCP_TOKEN: TOKEN })).json();
  assert.equal(r.result.isError, false); assert.match(r.result.content[0].text, /BAW15 is flown by British Airways/);
});

test('mcp worker: nothing it imports needs Node (it must bundle for workerd), and the wrangler config matches the code', () => {
  const seen = new Set(), bare = new Set();
  const walk = url => {
    if (seen.has(url.href)) return; seen.add(url.href);
    const src = readFileSync(url, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) { const next = new URL(spec, url); assert.ok(existsSync(next), `${spec} from ${url.pathname}`); walk(next); } else bare.add(spec);
    }
  };
  walk(new URL('mcp-worker/index.mjs', root));
  assert.ok(seen.size > 30, `modules reached: ${seen.size}`);
  assert.deepEqual([...bare].sort(), ['satellite.js'], 'only satellite.js from npm, and no node: built-ins');
  assert.ok(![...seen].some(u => /mcp\/(stdio|http-node|server)\.mjs$/.test(u)), 'the stdio and Node HTTP transports stay out of the bundle');
  const toml = readFileSync(new URL('mcp-worker/wrangler.toml', root), 'utf8');
  assert.match(toml, /^name = "open-overwatch-mcp"$/m); assert.match(toml, /^main = "index.mjs"$/m);
  assert.match(toml, /\[\[ratelimits\]\]\s+name = "LIMITER"/); assert.match(toml, /period = (10|60)\b/);
  assert.match(readFileSync(new URL('mcp/worker.mjs', root), 'utf8'), /env\.LIMITER/);
  for (const v of ['PLAN', 'PUBLIC', 'OO_SITE']) assert.match(toml, new RegExp(`^${v} = "`, 'm'), v);
});
