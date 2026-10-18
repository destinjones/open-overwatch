// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The download's local helpers (serve.js, and serve.py when Python is here) started for real on a spare loopback port,
// with no browser window (OW_NO_OPEN) and a stand-in for aisstream.io (OW_AIS_UPSTREAM): a NUL byte in a path is a 400,
// not a dead helper; both pin the same MIME types (so the Windows registry can't serve .js as text/plain); and the
// /aisstream WebSocket tunnel passes frames through untouched, only for the helper's own pages, never logging the key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

const root = new URL('../', import.meta.url), dir = fileURLToPath(root);
const read = p => readFileSync(new URL(p, root), 'utf8');
const py = ['python3', 'python'].find(p => spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)']).status === 0);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', KEY = 'dGhlIHNhbXBsZSBub25jZQ==', ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';
const SECRET = 'not-a-real-key-7f3a9c';

test('serve.js and serve.py pin the same MIME types, .js included', () => {
  const js = Object.fromEntries([...(/const MIME = \{([\s\S]*?)\};/.exec(read('serve.js')) || [])[1].matchAll(/'(\.[a-z0-9]+)': '([^']+)'/g)].map(m => [m[1], m[2]]));
  const pyMap = Object.fromEntries([...(/extensions_map = \{([\s\S]*?)\}\n/.exec(read('serve.py')) || [])[1].matchAll(/'(\.[a-z0-9]+)': '([^']+)'/g)].map(m => [m[1], m[2]]));
  for (const ext of ['.html', '.js', '.mjs', '.css', '.json', '.svg', '.woff2', '.webmanifest', '.webm', '.wasm']) assert.ok(js[ext] && pyMap[ext], ext);
  assert.match(pyMap['.js'], /^text\/javascript/);
  assert.deepEqual(pyMap, js);
});

/** A free loopback port (the helper's own-host check needs the port before it starts). */
const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = /** @type {net.AddressInfo} */ (s.address()); s.close(() => ok(port)); }); });

/** A stand-in for wss://stream.aisstream.io: answers the upgrade (or refuses it), then echoes what it gets back with a prefix. */
async function fakeAis(mode = 'ok') {
  const seen = { heads: [], frames: [] };
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0), open = false;
    sock.on('error', () => { });
    sock.on('data', chunk => {
      if (open) { seen.frames.push(chunk); sock.write(Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from('ok')])); return; }
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n'); if (end < 0) return;
      const head = buf.subarray(0, end).toString('latin1'); seen.heads.push(head);
      if (mode !== 'ok') return sock.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      const key = /sec-websocket-key: (\S+)/i.exec(head)[1];
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\nSet-Cookie: x=1\r\n\r\n`);
      open = true;
    });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  return { seen, port: /** @type {net.AddressInfo} */ (srv.address()).port, close: () => new Promise(ok => srv.close(ok)) };
}

/** Starts a helper; resolves once it says it is listening. */
async function start(cmd, args, port, aisPort) {
  const p = spawn(cmd, args, { cwd: dir, env: { ...process.env, OW_PORT: String(port), OW_NO_OPEN: '1', OW_AIS_UPSTREAM: `ws://127.0.0.1:${aisPort}/v0/stream` }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = { text: '' }, gone = new Promise(ok => p.on('exit', code => ok(code)));
  p.stdout.on('data', d => { log.text += d; }); p.stderr.on('data', d => { log.text += d; });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('helper did not start: ' + log.text)), 15000);
    const look = () => { if (/helper on/.test(log.text)) { clearTimeout(t); ok(); } };
    p.stdout.on('data', look); p.on('exit', () => { clearTimeout(t); no(new Error('helper exited: ' + log.text)); });
  });
  return { p, log, gone, stop: async () => { p.kill(); await gone; } };
}

const get = (port, path, headers = {}) => new Promise((ok, no) => {
  const r = http.request({ host: '127.0.0.1', port, path, headers, agent: false }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'] || '', body: b })); });
  r.on('error', no); r.setTimeout(10000, () => r.destroy(new Error('timeout'))); r.end();
});

/** A raw WebSocket handshake to the helper: { status, head, sock, rest }. */
function upgrade(port, { path = '/aisstream', host = `127.0.0.1:${port}`, origin = `http://127.0.0.1:${port}` } = {}) {
  return new Promise((ok, no) => {
    const sock = net.connect(port, '127.0.0.1'); let buf = Buffer.alloc(0);
    sock.on('error', no); sock.setTimeout(10000, () => { sock.destroy(); no(new Error('handshake timeout')); });
    const lines = [`GET ${path} HTTP/1.1`, `Host: ${host}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${KEY}`, 'Sec-WebSocket-Version: 13'];
    if (origin) lines.push(`Origin: ${origin}`);
    sock.write(lines.join('\r\n') + '\r\n\r\n');
    const onData = d => {
      buf = Buffer.concat([buf, d]); const end = buf.indexOf('\r\n\r\n'); if (end < 0) return;
      sock.off('data', onData); sock.setTimeout(0);
      const head = buf.subarray(0, end).toString('latin1');
      ok({ status: +head.split(' ')[1], head, sock, rest: buf.subarray(end + 4) });
    };
    sock.on('data', onData);
  });
}
/** Raw bytes to the helper; resolves with whatever it answers before closing (or after 3 s). */
const raw = (port, bytes) => new Promise((ok, no) => {
  const sock = net.connect(port, '127.0.0.1'); let buf = '';
  sock.on('data', d => { buf += d.toString('latin1'); }); sock.on('error', no); sock.on('close', () => ok(buf));
  sock.setTimeout(3000, () => { sock.destroy(); }); sock.write(bytes);
});
const nextData = (sock, have = Buffer.alloc(0)) => have.length ? Promise.resolve(have) : new Promise((ok, no) => { sock.once('data', ok); sock.once('error', no); setTimeout(() => no(new Error('no data')), 10000); });

/** A masked client text frame, as a browser sends it. */
function frame(text) {
  const body = Buffer.from(text), mask = Buffer.from([1, 2, 3, 4]), out = Buffer.alloc(2 + 4 + body.length);
  out[0] = 0x81; out[1] = 0x80 | body.length; mask.copy(out, 2);
  for (let i = 0; i < body.length; i++) out[6 + i] = body[i] ^ mask[i % 4];
  return out;
}

async function checkHelper(t, cmd, args) {
  const ais = await fakeAis(), refusing = await fakeAis('refuse');
  const port = await freePort(), h = await start(cmd, args, port, ais.port);
  try {
    // a NUL byte: a 400, and the helper is still there for the next request
    assert.equal((await get(port, '/%00')).status, 400);
    assert.equal((await get(port, '/src/%00x.js')).status, 400);
    const page = await get(port, '/index.html');
    assert.equal(page.status, 200); assert.match(page.type, /^text\/html/);
    assert.match((await get(port, '/src/core/cameras.js')).type, /^text\/javascript/);
    assert.match((await get(port, '/manifest.webmanifest')).type, /^application\/manifest\+json/);
    assert.equal((await get(port, '/index.html', { Host: 'evil.example:' + port })).status, 421);
    // a malformed request: a 400 and a closed socket, and the helper carries on
    assert.match(await raw(port, 'NOT A REQUEST\x00\r\n\r\n'), /\b400\b/);   // serve.py answers it HTTP/0.9 style (no status line)
    assert.equal((await get(port, '/index.html')).status, 200);

    // the tunnel: refused for anyone but the helper's own pages, and for anything but a WebSocket
    assert.equal((await get(port, '/aisstream')).status, 426);
    for (const [why, opts, want] of [['no Origin', { origin: '' }, 403], ['another site', { origin: 'https://evil.example' }, 403],
      ['DNS rebinding', { host: 'evil.example:' + port }, 421], ['a key in the URL', { path: `/aisstream?key=${SECRET}` }, 400]]) {
      const r = await upgrade(port, opts); r.sock.destroy();
      assert.equal(r.status, want, why);
    }
    assert.equal(ais.seen.heads.length, 0, 'nothing refused reached aisstream.io');

    // the real thing: the handshake answer the browser needs, then the frames both ways, byte for byte
    const r = await upgrade(port);
    assert.equal(r.status, 101, r.head);
    assert.match(r.head, new RegExp('Sec-WebSocket-Accept: ' + ACCEPT.replace(/[+/=]/g, '\\$&'), 'i'));
    assert.doesNotMatch(r.head, /set-cookie/i, 'only the WebSocket headers come back');
    const up = ais.seen.heads[0];
    assert.match(up, /^GET \/v0\/stream HTTP\/1\.1/); assert.match(up, new RegExp('Sec-WebSocket-Key: ' + KEY.replace(/[+/=]/g, '\\$&')));
    assert.doesNotMatch(up, /^origin:/im, 'aisstream.io sees no Origin');
    const sub = frame(JSON.stringify({ APIKey: SECRET, BoundingBoxes: [[[59, 19], [61, 25]]] }));
    r.sock.write(sub);
    const back = await nextData(r.sock, r.rest);
    assert.deepEqual([...back], [0x81, 0x02, 0x6f, 0x6b], "aisstream.io's frame reaches the page untouched");
    await new Promise(ok => setTimeout(ok, 100));
    assert.deepEqual(Buffer.concat(ais.seen.frames), sub, "the page's frame reaches aisstream.io untouched");
    const sub2 = frame('{"again":true}'); r.sock.write(sub2);   // and it keeps going both ways
    assert.deepEqual([...await nextData(r.sock)], [0x81, 0x02, 0x6f, 0x6b]);
    await new Promise(ok => setTimeout(ok, 100));
    assert.deepEqual(Buffer.concat(ais.seen.frames), Buffer.concat([sub, sub2]));
    r.sock.destroy();
    await new Promise(ok => setTimeout(ok, 200));
    assert.ok(!h.log.text.includes(SECRET), 'the key is never logged');
    assert.match(h.log.text, /aisstream open/);

    // an upstream that refuses: a 502 for the page, not a hang
    await h.stop();
    const h2 = await start(cmd, args, port, refusing.port);
    try {
      const no = await upgrade(port); no.sock.destroy();
      assert.equal(no.status, 502);
      assert.equal((await get(port, '/index.html')).status, 200, 'and the helper carries on');
    } finally { await h2.stop(); }
  } finally {
    await h.stop().catch(() => { });
    await ais.close(); await refusing.close();
  }
  t.diagnostic(cmd + ' ok');
}

test('serve.js: a NUL byte is a 400, MIME types, the aisstream tunnel', { timeout: 60000 }, t => checkHelper(t, process.execPath, ['serve.js']));
test('serve.py: the same', { timeout: 60000, skip: !py && 'no Python 3.9+ here' }, t => checkHelper(t, /** @type {string} */ (py), ['-I', '-u', 'serve.py']));
