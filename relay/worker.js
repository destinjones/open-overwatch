// Open Overwatch public relay, a Cloudflare Worker. A few feeds the website needs send no CORS headers (the ADS-B
// aircraft networks, OpenSky, NOAA's hurricane advisories, NYC cameras, some camera lists and stills, the submarine cable map), so a browser page
// can't read them. This passes those through, and only those, like the download's local helper (serve.js):
//   GET /?url=<encoded https URL>   the feed, with Access-Control-Allow-Origin for the website
//   GET /?ping=1                    "ok"
// Rules: an allowlist of hosts and paths, GET only, an Origin header required (browsers always send one cross-origin;
// a script without one gets nothing), every redirect re-checked against the allowlist, a fixed Accept header (a forwarded
// one could poison the shared cache with an HTML rendering of a JSON feed), no cookies or keys passed on, a byte cap
// enforced on the stream. Rate limiting per address is a Cloudflare WAF rule on the route (free plan: one rule).
// Workers Cache (wrangler.toml [cache]) sits in front: a response is shared for a few seconds (aircraft) to minutes
// (snapshots, advisories), so a thousand visitors cost the volunteer feeds one request per interval, not a thousand.
// Cache hits never reach this code, so the allowed origin is one fixed value (the cache doesn't vary by Origin).

const SITE = 'https://destinjones.github.io';
const ORIGINS = new Set([SITE, 'http://localhost:8787', 'http://127.0.0.1:8787']);   // a cache miss from anywhere else is refused
// host -> seconds a response is shared. Keep in sync with PUBLIC_RELAY_HOSTS (src/core/relay.js).
// The ADS-B networks (adsb.lol 429, airplanes.live / adsb.fi / adsb.one 403) and OpenSky (timeout) refuse Cloudflare's
// servers (2026-10-10), so they are not listed: only with their owners' agreement, e.g. an adsb.lol feeder API key
// ({'api.adsb.lol': 8, 'opensky-network.org': 600}).
const TTL = {
  'www.nhc.noaa.gov': 600,            // hurricane advisories
  'webcams.nyctmc.org': 30,           // NYC traffic camera frames
  'www.submarinecablemap.com': 86400, // cable routes
  'www.drivebc.ca': 3600,             // British Columbia camera list (the pictures themselves send CORS)
  'traveler.modot.org': 3600,         // Missouri camera list (the video streams send CORS)
  'kamera.atlas.vegvesen.no': 60,     // camera stills without CORS headers: Norway, Iowa, Calgary, Singapore
  'atmsqf.iowadot.gov': 60,
  'trafficcam.calgary.ca': 60,
  'images.data.gov.sg': 300,
};
// what each host may be asked for: API hosts only their feed paths; the camera image hosts any picture path (the feeds name them)
const PATHS = {
  'www.nhc.noaa.gov': ['/CurrentStorms.json'],
  'webcams.nyctmc.org': ['/api/cameras'],
  'www.submarinecablemap.com': ['/api/v3/'],
  'www.drivebc.ca': ['/api/webcams/', '/images/'],
  'traveler.modot.org': ['/timconfig/feed/'],
  'kamera.atlas.vegvesen.no': ['/'], 'atmsqf.iowadot.gov': ['/'], 'trafficcam.calgary.ca': ['/'], 'images.data.gov.sg': ['/'],
};
const MAX_BYTES = 30e6;
const ACCEPT = 'application/json, application/geo+json, image/*;q=0.9, */*;q=0.5';
const UA = 'OpenOverwatchRelay/1 (+https://destinjones.github.io/open-overwatch/)';

const allowed = u => u.protocol === 'https:' && !u.port && Object.hasOwn(TTL, u.hostname) && !u.username && !u.password && (PATHS[u.hostname] || []).some(p => u.pathname.startsWith(p));

function reply(status, body, seconds = 0) {
  return new Response(body, { status, headers: {
    'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': SITE,
    'cache-control': seconds ? `public, max-age=${seconds}` : 'no-store', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '86400' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'GET only');
    const u = new URL(req.url), origin = req.headers.get('origin');
    if (u.searchParams.has('ping')) return reply(200, 'ok', 60);
    if (!origin || !ORIGINS.has(origin)) return reply(403, 'this relay only serves Open Overwatch pages');
    let target;
    try { target = new URL(u.searchParams.get('url') || ''); } catch (e) { return reply(400, 'url= must be a full https URL'); }
    if (!allowed(target)) return reply(403, 'host not on the relay allowlist: ' + target.hostname);

    let res;
    try {
      for (let hop = 0; ; hop++) {   // follow redirects by hand so every hop is checked against the allowlist
        res = await fetch(target, { headers: { 'user-agent': UA, accept: ACCEPT }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
        if (res.status < 300 || res.status >= 400) break;
        const loc = res.headers.get('location'); if (!loc) break;
        const next = new URL(loc, target);
        if (hop >= 5 || !allowed(next)) return reply(502, 'upstream redirected outside the allowlist: ' + next.hostname);
        target = next;
      }
    } catch (e) { return reply(502, 'upstream error: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)); }

    const len = +res.headers.get('content-length') || 0, type = res.headers.get('content-type') || '';
    if (len > MAX_BYTES) return reply(502, 'upstream response too large');
    const h = new Headers({ 'access-control-allow-origin': SITE, 'x-content-type-options': 'nosniff', 'x-relay': 'open-overwatch' });
    for (const k of ['content-type', 'content-length', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) h.set(k, v); }
    // only good answers are shared; errors (a 429 from a busy feed) are not, so the next visitor tries again. An HTML
    // page where a feed was expected (a login page, an error page, a content-negotiated rendering) is never shared either
    h.set('cache-control', res.ok && !/text\/html/i.test(type) ? `public, max-age=${TTL[target.hostname]}` : 'no-store');
    // the byte cap holds without a Content-Length too (chunked or compressed answers): count as it streams
    let seen = 0;
    const capped = res.body && res.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { seen += chunk.byteLength; if (seen > MAX_BYTES) ctl.error(new Error('too large')); else ctl.enqueue(chunk); } }));
    return new Response(req.method === 'HEAD' ? null : capped, { status: res.status, headers: h });
  },
};
