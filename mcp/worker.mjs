// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The MCP server as a Cloudflare Worker (or any runtime with web Request/Response and, optionally, the Cache API): the
// same tools over stateless Streamable HTTP at /mcp (mcp/http.mjs), for remote connectors such as claude.ai's custom
// connectors and ChatGPT's. mcp-worker/ holds the wrangler config and the deploy notes; nothing here is deployed.
//
// Who may call it (one of these must be set, or it answers 503):
//   env.MCP_TOKEN    a secret of 16+ characters: clients send "Authorization: Bearer <token>", or put it in the URL as
//                    /mcp/<token> (connectors that can't send headers, like claude.ai's: the URL is the secret)
//   env.PUBLIC       "true": anyone may call /mcp (the data is public; rate-limit it)
// Other settings:
//   env.OO_SITE      the Open Overwatch site to link to and read data copies from (default the public website)
//   env.PLAN         "free" (default) or "paid": the free plan's 10 ms of CPU and 50 subrequests a request leave the
//                    heaviest tools out (HEAVY); "paid" lists them all
//   env.TOOLS_OFF / env.TOOLS_ON   comma-separated tool names to leave out / keep in on top of the plan's list
//   env.ALLOW_ORIGINS               more browser origins that may call it (claude.ai and ChatGPT always may)
//   env.LIMITER      a rate-limiting binding (wrangler.toml [[ratelimits]]): requests per caller address
//   env.LOG          "true": one log line per tool call (name and time, never the arguments)
//   env.SUBREQUESTS  a lower budget of look-ups per request than the plan's (SUBREQUESTS)
//
// Caching, through the Workers Cache API (shared by every request in a data centre): each upstream answer for as long
// as its source takes to change (the feeds' own ttl), and each tool answer for a minute or more (CALL_TTL), so a
// question asked twice costs no CPU and no subrequests the second time. Parsed answers also stay in the isolate.
import { createOverwatchServer, SITE, VERSION } from './index.mjs';
import { createHttpHandler, MAX_BODY } from './http.mjs';
import { ToolError } from './feeds.mjs';

/** Origins of the hosted chat apps whose connectors may call from a browser. */
export const CONNECTOR_ORIGINS = Object.freeze(['https://claude.ai', 'https://chatgpt.com', 'https://chat.openai.com']);
/**
 * Tools left out on the free plan (10 ms of CPU and 50 subrequests a request). Measured in Node with the canned feeds
 * of test/mcp.test.mjs, data already parsed: satellite_passes 13 ms, solar_system 10 ms, night_sky 7 ms on a tiny element
 * set (more on the real ones, as for close_approaches and a where_is_satellite search through the big groups); decoding
 * vector tiles, fire tiles and GTFS-RT feeds grows with the area; ships_baltic and traffic_cameras can need more than 50
 * look-ups. Everything else answers in 0.1-4 ms once its data is in the isolate (where_in_space 1-2 ms, sun_and_moon 4).
 * A fresh isolate's first call that parses a big data copy (eclipses, countries, small bodies: 15-150 ms) can still
 * overrun the free plan; after that the parsed copy stays in the memo and what the tools build from it (prepared borders,
 * eclipse tracks, the cable map, the light pollution grid) in feeds.mjs derive(), so a new question costs 1-3 ms
 * (country_briefing, eclipses with a place), not the build again. PLAN = "paid" lists everything.
 */
export const HEAVY = Object.freeze(['satellite_passes', 'night_sky', 'close_approaches', 'reentries', 'where_is_satellite', 'solar_system', 'wildfires', 'plate_readers', 'military_areas', 'ships_baltic', 'traffic_cameras', 'transit_vehicles', 'dark_sky']);
/** Subrequests (fetches and Cache API calls together) one request may make: Cloudflare's 50 / 10,000, less a margin. */
export const SUBREQUESTS = Object.freeze({ free: 45, paid: 900 });
/** Seconds a tool's answer is shared (default 60: most feeds change by the minute; the answers say "5 min ago"). */
export const CALL_TTL = Object.freeze({ default: 60, show_on_globe: 3600, solar_system: 300, where_in_space: 300, eclipses: 3600, meteor_showers: 3600, sun_and_moon: 900,
  launches: 600, people_in_space: 1800, asteroid_flybys: 1800, country_briefing: 600, submarine_cables: 3600, volcanoes: 600, sea_conditions: 300, air_quality: 900, distance: 3600, aircraft_lookup: 3600, weather: 300, weather_details: 300 });
const CACHE_HOST = 'https://mcp-cache.open-overwatch.invalid';   // the Cache API wants URLs for keys; this host is never asked

const text = (status, body, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } });
const rpcError = (status, code, message, headers = {}) => new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };   // no early exit: no timing hint
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const yes = v => /^(1|true|yes|on)$/i.test(String(v ?? ''));
async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}
/** The same arguments in any order are the same question. */
const canonical = v => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v);

/** The settings a request runs under, from the Worker's environment. */
export function settings(env = {}) {
  const token = typeof env.MCP_TOKEN === 'string' && env.MCP_TOKEN.length >= 16 ? env.MCP_TOKEN : '';
  const plan = String(env.PLAN || 'free').toLowerCase() === 'paid' ? 'paid' : 'free', on = list(env.TOOLS_ON);
  const omit = [...new Set([...(plan === 'free' ? HEAVY : []), ...list(env.TOOLS_OFF)])].filter(n => !on.includes(n));
  const origins = [...new Set([...CONNECTOR_ORIGINS, ...list(env.ALLOW_ORIGINS)])];
  return { token, open: yes(env.PUBLIC), plan, omit, origins, site: env.OO_SITE || SITE, budget: Math.min(SUBREQUESTS[plan], +env.SUBREQUESTS > 0 ? +env.SUBREQUESTS : Infinity), log: yes(env.LOG) };
}

/**
 * A Worker: { fetch(request, env, ctx) }. Options (tests): fetchImpl, caches (a CacheStorage; default the runtime's),
 * sgp4, now. The default export is one with the runtime's own.
 */
export function createWorker({ fetchImpl, caches, sgp4, now = Date.now } = {}) {
  const memo = new Map();   // parsed answers, shared by every request this isolate serves
  const net = fetchImpl || ((url, init) => fetch(url, init));
  const cacheStore = () => caches || globalThis.caches || null;

  return {
    async fetch(request, env = {}, ctx = {}) {
      const cfg = settings(env), url = new URL(request.url), origin = request.headers.get('origin');
      const cors = origin && cfg.origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
      if (url.pathname === '/health') return text(200, 'ok\n', cors);
      if (url.pathname.startsWith('/.well-known/')) return text(404, 'Not found\n', cors);   // no OAuth here: connectors that look for it go on without
      if (!cfg.token && !cfg.open) return text(503, 'This server is not set up: give it an MCP_TOKEN secret of 16 characters or more, or set PUBLIC to "true".\n', cors);

      // who is asking: the token in the path (/mcp/<token>), in the Authorization header, or nobody needed
      let path = url.pathname;
      if (path.startsWith('/mcp/')) {
        let given = null;
        try { given = decodeURIComponent(path.slice(5)); } catch { /* a malformed escape (/mcp/%zz) is a wrong secret too */ }
        if (!cfg.token || given == null || !same(given, cfg.token)) return text(404, 'Not found\n', cors);   // a wrong secret URL is just a page that isn't there
        path = '/mcp';
      } else if (path === '/mcp' && request.method !== 'OPTIONS' && !cfg.open) {
        const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (!cfg.token || !same(got, cfg.token)) return rpcError(401, -32001, 'Unauthorized: send Authorization: Bearer <token>, or use the /mcp/<token> address', { 'WWW-Authenticate': 'Bearer', ...cors });
      }
      if (env.LIMITER && request.method === 'POST') {
        const { success } = await env.LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'anonymous' }).catch(() => ({ success: true }));
        if (!success) return rpcError(429, -32000, 'Too many requests: try again in a minute', { 'Retry-After': '60', ...cors });
      }

      // this request's budget of subrequests, and the shared caches behind it
      let used = 0;
      const spend = () => { if (++used > cfg.budget) throw new ToolError('That answer needs more look-ups than this server may make for one question: ask about a smaller area, or use the full server (npx open-overwatch-mcp)', 'retry_later'); };
      const store = cacheStore(), pending = [];
      const cache = store ? await (store.default ? Promise.resolve(store.default) : store.open('open-overwatch-mcp')) : null;
      const keyUrl = async (kind, key) => new Request(`${CACHE_HOST}/${kind}/${await sha256(key)}`);
      const shared = cache && {
        async match(key) { spend(); return (await cache.match(await keyUrl('feed', key))) || null; },
        put(key, response, seconds) {
          if (used >= cfg.budget) return;   // the answer matters more than keeping a copy
          spend();
          const r = new Response(response.body, { status: 200, headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': `public, max-age=${seconds}` } });
          pending.push(keyUrl('feed', key).then(k => cache.put(k, r)).catch(() => {}));
        },
      };
      const counted = (u, init) => { spend(); return net(u, init); };
      const inner = createOverwatchServer({ site: cfg.site, fetchImpl: counted, sgp4, now, memo, shared, omit: cfg.omit, log: cfg.log ? line => console.log(line) : () => {} });
      const server = {   // tools/call answers are shared for CALL_TTL seconds
        async handle(m, opts) {
          if (!cache || !m || m.method !== 'tools/call' || m.id == null || !m.params || typeof m.params.name !== 'string' || cfg.omit.includes(m.params.name)) return inner.handle(m, opts);
          const ttl = CALL_TTL[m.params.name] ?? CALL_TTL.default;
          const k = await keyUrl('call', JSON.stringify([VERSION, cfg.site, m.params.name, canonical(m.params.arguments ?? {})]));
          if (used + 1 < cfg.budget) {
            spend();
            const hit = await cache.match(k).catch(() => null);
            if (hit) return { jsonrpc: '2.0', id: m.id, result: await hit.json() };
          }
          const res = await inner.handle(m, opts);
          if (res && res.result && res.result.isError === false && used < cfg.budget) {
            spend();
            pending.push(cache.put(k, new Response(JSON.stringify(res.result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } })).catch(() => {}));
          }
          return res;
        },
      };
      const handle = createHttpHandler(server, { hosts: null, origins: cfg.origins, name: 'open-overwatch-mcp', version: `${VERSION} (${cfg.plan} plan${cfg.omit.length ? `, ${cfg.omit.length} tools off` : ''})` });

      let req = request;
      if (path !== url.pathname) {   // the secret left the address: the handler sees plain /mcp
        const tooBig = +request.headers.get('content-length') > MAX_BODY;
        const body = request.method === 'GET' || request.method === 'HEAD' || tooBig ? undefined : await request.arrayBuffer();
        req = new Request(new URL('/mcp' + url.search, url), { method: request.method, headers: request.headers, body, signal: request.signal });
      }
      try {
        return await handle(req);
      } finally {
        if (pending.length) { const all = Promise.allSettled(pending); if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(all); else await all; }
      }
    },
  };
}

export default createWorker();
