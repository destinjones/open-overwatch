#!/usr/bin/env node
// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Open Overwatch helper (Node 18+ or Bun, no dependencies).
// Serves this folder at http://127.0.0.1:8787/ and relays requests to a short list of data sources
// that refuse browser (CORS) requests. The page comes from this same origin, so the relayed answers need no CORS header,
// and only this helper's own pages may use the relay. It also carries aisstream.io's WebSocket for the download's ships
// (ws://127.0.0.1:8787/aisstream, see aisTunnel below): the website never opens that socket.
// Run:  node serve.js   (or double-click "Start Open Overwatch.bat")
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), net = require('net'), tls = require('tls'), { execFile } = require('child_process');

const PORT = +(process.env.OW_PORT || 8787);
const PAGE = 'open-overwatch.html';
const DIR = __dirname;
const ALLOWED_HOSTS = new Set([
  'api.adsb.lol', 'api.airplanes.live', 'opendata.adsb.fi',                // aircraft
  'opensky-network.org',                                                    // aircraft snapshot
  'www.nhc.noaa.gov',                                                       // hurricane advisories
  'webcams.nyctmc.org',                                                     // NYC cameras
  'api.gdeltproject.org',                                                   // news (now sends CORS itself; kept for old pages)
  'firms.modaps.eosdis.nasa.gov',                                           // fires (key)
  'api.windy.com',                                                          // webcams (key)
  'www.submarinecablemap.com',                                              // submarine cables (live TeleGeography data)
  'www.drivebc.ca', 'traveler.modot.org',                                   // camera lists (British Columbia, Missouri)
  'kamera.atlas.vegvesen.no', 'atmsqf.iowadot.gov', 'trafficcam.calgary.ca', 'images.data.gov.sg', // camera stills sent without CORS
  'aviationweather.gov',                                                    // METAR and TAF (the globe's airport cards)
  'www.ndbc.noaa.gov',                                                      // NOAA buoys and DART tsunami buoys
  'www.tsunami.gov',                                                        // the NOAA tsunami warning centres' messages
]); // keep in sync with NEEDS_RELAY in src/map/util.js and ALLOWED_HOSTS in serve.py (test/relayhosts.test.mjs checks)
const FORWARD_HEADERS = ['x-windy-api-key', 'accept'];
const UA = 'OpenOverwatch/1.0 (local helper; personal use)';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.bat': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webm': 'video/webm', '.wasm': 'application/wasm' }; // brand/ assets and the 3D globe (= extensions_map in serve.py; test/serve.test.mjs checks)

// No Access-Control-Allow-Origin: the page is served from this same origin, and other sites must not use the relay.
function reply(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const allowed = u => u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
// only this helper's own pages: a Host other than ours means DNS rebinding, a cross-site fetch carries Sec-Fetch-Site / Origin
const OWN_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function ownRequest(req) {
  if (!OWN_HOSTS.has(req.headers.host)) return false;
  const site = req.headers['sec-fetch-site']; if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin; return !origin || OWN_HOSTS.has(origin.replace(/^http:\/\//, ''));
}

async function proxy(req, res, params) {
  if (params.has('ping')) return reply(res, 200, 'ok');
  let target; try { target = new URL(params.get('url') || ''); } catch (e) { return reply(res, 400, 'bad url'); }
  if (!allowed(target)) return reply(res, 403, "host not in the helper's allowlist: " + target.hostname);
  const headers = { 'User-Agent': UA };
  for (const h of FORWARD_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60000);
  try {
    let r;
    for (let hop = 0; ; hop++) { // follow redirects by hand so every hop is checked against the allowlist
      r = await fetch(target, { headers, signal: ctl.signal, redirect: 'manual' });
      const loc = r.status >= 300 && r.status < 400 && r.headers.get('location'); if (!loc) break;
      const next = new URL(loc, target); if (hop >= 5 || !allowed(next)) return reply(res, 502, 'upstream redirected outside the allowlist: ' + next.hostname);
      if (next.hostname !== target.hostname) delete headers['x-windy-api-key'];
      target = next;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    reply(res, r.status, buf, r.headers.get('content-type') || 'application/octet-stream');
  } catch (e) { reply(res, 502, 'upstream error: ' + (e.name === 'AbortError' ? 'timeout' : e.message)); }
  finally { clearTimeout(t); }
}

function serveFile(req, res, pathname) {
  let rel; try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (e) { return reply(res, 400, 'bad path'); } // a stray % would otherwise kill the helper
  if (rel.includes('\0')) return reply(res, 400, 'bad path');   // fs.stat throws on a NUL byte: any page's <img src=".../%00"> would end the helper
  const file = path.resolve(DIR, rel || PAGE);
  if (!file.startsWith(DIR + path.sep)) return reply(res, 403, 'forbidden'); // with the separator, so ../open-overwatch-other/ is outside too
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory() && fs.existsSync(path.join(file, 'index.html'))) {   // a folder page such as /india/, as GitHub Pages serves it
      if (!pathname.endsWith('/')) { const q = req.url.indexOf('?'); res.writeHead(301, { Location: pathname + '/' + (q < 0 ? '' : req.url.slice(q)) }); return res.end(); }
      return serveFile(req, res, pathname + 'index.html');
    }
    if (err || !st.isFile()) return reply(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res); // e.g. EBUSY while an editor saves the file
  });
}

// ---- aisstream.io for the download's ships: a WebSocket tunnel ------------------------------------------------------
// aisstream.io takes no connection from a web page, so the download's 2D map opens ws://127.0.0.1:8787/aisstream and the
// helper passes the bytes through to wss://stream.aisstream.io/v0/stream unchanged, both ways. The page's own WebSocket
// key and frames go through as they are, so the visitor's API key (in the first frame) is never read, logged or kept
// here. Only this helper's own pages may open it (Host and Origin checked), a query string is refused (a key must not
// ride in a URL that could land in a log), and only a few tunnels are open at once. Keep in step with serve.py.
// OW_AIS_UPSTREAM=ws://127.0.0.1:<port>/<path> points it at a stand-in for test/serve.test.mjs (loopback ws:// only).
const AIS_PATH = '/aisstream', AIS_MAX = 4, AIS_HEAD_MAX = 16384, AIS_HANDSHAKE_MS = 15000;
function aisUpstream() {
  const o = process.env.OW_AIS_UPSTREAM;
  if (o) { try { const u = new URL(o); if (u.protocol === 'ws:' && u.hostname === '127.0.0.1' && u.port) return { host: u.hostname, port: +u.port, path: u.pathname, secure: false }; } catch (e) { /* the real one */ } }
  return { host: 'stream.aisstream.io', port: 443, path: '/v0/stream', secure: true };
}
let aisOpen = 0;
const clean = v => typeof v === 'string' && /^[\x20-\x7e]*$/.test(v);   // header values copied across: printable ASCII only
function refuse(socket, code, text) {
  if (!socket.writable) return socket.destroy();
  socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code] || 'Error'}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${text}`);
}
/** An upgrade request for /aisstream: null when it may open a tunnel, else [status, text]. */
function aisRefusal(req) {
  const u = new URL(req.url, 'http://127.0.0.1'), h = req.headers;
  if (u.pathname !== AIS_PATH) return [404, 'not found'];
  if (!OWN_HOSTS.has(h.host)) return [421, 'wrong host'];
  if (!h.origin || !ownRequest(req)) return [403, 'the aisstream tunnel only serves pages from this helper'];   // a browser always sends Origin on a WebSocket
  if (u.search) return [400, 'no query string: the API key goes in the subscription message'];
  if (String(h.upgrade || '').toLowerCase() !== 'websocket' || h['sec-websocket-version'] !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(h['sec-websocket-key'] || '')) return [400, 'a WebSocket only'];
  for (const k of ['sec-websocket-extensions', 'sec-websocket-protocol']) if (h[k] != null && !clean(h[k])) return [400, 'bad header'];
  if (aisOpen >= AIS_MAX) return [503, 'too many aisstream tunnels open'];
  return null;
}
function aisTunnel(req, socket, head) {
  const no = aisRefusal(req); if (no) return refuse(socket, no[0], no[1]);
  const up = aisUpstream(), h = req.headers, stamp = () => new Date().toISOString().slice(11, 19);
  let done = false, opened = false, buf = Buffer.alloc(0);
  aisOpen++;
  const upstream = up.secure ? tls.connect({ host: up.host, port: up.port, servername: up.host }) : net.connect({ host: up.host, port: up.port });
  const close = why => {
    if (done) return; done = true; aisOpen--; clearTimeout(timer); upstream.destroy();
    if (opened) { socket.destroy(); console.log(stamp(), 'aisstream closed'); } else refuse(socket, 502, why || 'aisstream.io closed the connection');
  };
  const timer = setTimeout(() => close('aisstream.io did not answer'), AIS_HANDSHAKE_MS);
  socket.on('error', () => close()); socket.on('close', () => close());
  upstream.on('error', e => close('aisstream.io: ' + (e.code || e.message))); upstream.on('close', () => close());
  upstream.once(up.secure ? 'secureConnect' : 'connect', () => {
    const lines = [`GET ${up.path} HTTP/1.1`, `Host: ${up.host}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${h['sec-websocket-key']}`, 'Sec-WebSocket-Version: 13', `User-Agent: ${UA}`];
    if (h['sec-websocket-extensions']) lines.push(`Sec-WebSocket-Extensions: ${h['sec-websocket-extensions']}`);
    if (h['sec-websocket-protocol']) lines.push(`Sec-WebSocket-Protocol: ${h['sec-websocket-protocol']}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');   // no Origin, no cookies: aisstream.io sees a plain client
  });
  const onHead = chunk => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) { if (buf.length > AIS_HEAD_MAX) close('aisstream.io sent no handshake'); return; }
    upstream.off('data', onHead); upstream.pause();
    const [status, ...rest] = buf.subarray(0, end).toString('latin1').split('\r\n'), code = +(status.split(' ')[1] || 0);
    if (code !== 101) return close(`aisstream.io refused the connection (HTTP ${code || '?'})`);
    const got = Object.fromEntries(rest.map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
    if (!got['sec-websocket-accept'] || !clean(got['sec-websocket-accept'])) return close('aisstream.io sent a bad handshake');
    const out = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${got['sec-websocket-accept']}`];
    if (got['sec-websocket-extensions'] && clean(got['sec-websocket-extensions'])) out.push(`Sec-WebSocket-Extensions: ${got['sec-websocket-extensions']}`);
    if (got['sec-websocket-protocol'] && clean(got['sec-websocket-protocol'])) out.push(`Sec-WebSocket-Protocol: ${got['sec-websocket-protocol']}`);
    opened = true; clearTimeout(timer);
    socket.write(out.join('\r\n') + '\r\n\r\n');
    const after = buf.subarray(end + 4); if (after.length) socket.write(after);
    if (head && head.length) upstream.write(head);
    socket.setNoDelay(true); upstream.setNoDelay(true);
    socket.pipe(upstream); upstream.pipe(socket);   // the frames themselves, untouched
    console.log(stamp(), 'aisstream open');
  };
  upstream.on('data', onHead);
}

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (!OWN_HOSTS.has(req.headers.host)) return reply(res, 421, 'wrong host'); // DNS rebinding guard
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } // no CORS preflight approval: same-origin pages never need one
    if (u.pathname === '/proxy') {
      if (!ownRequest(req)) return reply(res, 403, 'the relay only serves pages from this helper'); const host = (() => { try { return new URL(u.searchParams.get('url')).hostname; } catch (e) { return '?'; } })(); console.log(new Date().toISOString().slice(11, 19), 'relay', host); return proxy(req, res, u.searchParams); }
    if (u.pathname === AIS_PATH) return reply(res, 426, 'a WebSocket only');
    if (u.pathname === '/') { res.writeHead(302, { Location: '/' + PAGE }); return res.end(); }
    serveFile(req, res, u.pathname);
  } catch (e) {   // any other synchronous throw answers 500 instead of ending the helper
    if (!res.headersSent) reply(res, 500, 'helper error'); else res.destroy();
  }
});
server.on('upgrade', (req, socket, head) => { try { aisTunnel(req, socket, head); } catch (e) { socket.destroy(); } });

if (!fs.existsSync(path.join(DIR, PAGE))) { console.error('Put serve.js in the same folder as ' + PAGE); process.exit(1); }
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy — is the helper already running? Open http://127.0.0.1:${PORT}/${PAGE}` : e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/${PAGE}`;
  console.log(`Open Overwatch helper on ${url}  (Ctrl+C to stop)`);
  console.log('Relaying: ' + [...ALLOWED_HOSTS].sort().join(', '));
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  if (!process.env.OW_NO_OPEN) setTimeout(() => execFile(opener[0], opener[1], () => { }), 600); // OW_NO_OPEN=1: tests and CI, no browser window
});
