#!/usr/bin/env node
// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The clean-machine install check (.github/workflows/install-test.yml, and test/installsmoke.test.mjs on this repo):
//   node test/helpers/installsmoke.mjs zip-script            print release.yml's "Build the download zip" step as a shell script
//   node test/helpers/installsmoke.mjs site <folder>         start <folder>/serve.js (no npm install, no browser), fetch every
//                                                            page and every local file the pages load, and the data,
//                                                            texture and model files in DATA_FILES
//   node test/helpers/installsmoke.mjs mcp <server.mjs>      initialize + tools/list over stdio against an installed MCP server
// Exits 1 on any problem, printing what failed. Node only (no dependencies), so it runs the same on Linux, Windows and macOS.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Files the views load by paths their JavaScript builds (so the crawl cannot find them): most data files (not
 * data/cities.json, data/solar/apophis.json, asteroids_b.bin or galaxies.json), and one from
 * each texture and model folder release.yml copies, so a dropped `cp` line in its "Build the download zip" step fails here.
 */
export const DATA_FILES = [
  'data/eclipses.json', 'data/countries.json', 'data/airports.json', 'data/runways.json', 'data/borders.json',
  'data/companies.json', 'data/lighthouses.json', 'data/volcanoes.json', 'data/constellations.json',
  'data/deepsky.json', 'data/deepsky.md', 'data/lightpollution.bin', 'data/lightpollution.md',
  'data/solar/stars.bin', 'data/solar/stars.json', 'data/solar/ephem.json', 'data/solar/exoplanets.json',
  'data/solar/moons.json', 'data/solar/small_bodies.json', 'data/solar/spacecraft.json', 'data/solar/galaxies.bin',
  'data/solar/asteroids_a.bin',
  'brand/textures/planets/earth_2k.jpg', 'brand/textures/planets/saturn_ring.png', 'brand/textures/moons/io_1k.jpg',
  'brand/textures/moons/maps.json', 'brand/textures/sky/px.jpg', 'brand/textures/sky_1k/px.jpg',
  'brand/textures/sky_equirect_2k.jpg', 'brand/textures/night/0/0/0.jpg', 'brand/textures/earth_fx_2k.jpg',
  'brand/models/iss.glb', 'brand/models/aircraft/airliner_civ.glb', 'brand/models/tex/skin.png'];

/** The run: | block of release.yml's "Build the download zip" step, dedented, so a CI run can build the same zip. */
export function zipScript(yml) {
  yml = yml.replace(/\r\n/g, '\n');
  const at = yml.indexOf('- name: Build the download zip');
  if (at < 0) throw new Error('release.yml has no "Build the download zip" step');
  const lines = yml.slice(yml.indexOf('run: |', at) + 7).split('\n'), body = [];
  const indent = (lines[0].match(/^ */) || [''])[0].length;
  if (!indent) throw new Error('the step has no indented run: | block');
  for (const l of lines) {
    if (l.trim() && l.length - l.trimStart().length < indent) break;   // the next key or step
    body.push(l.slice(indent));
  }
  return 'set -euo pipefail\n' + body.join('\n').trimEnd() + '\n';
}

/** A port nothing listens on right now (serve.js checks the Host header against its own port, so 0 will not do). */
export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer().once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = /** @type {import('node:net').AddressInfo} */ (s.address()); s.close(() => ok(port)); });
  });
}

/** Start <dir>/serve.js as a user would (node serve.js), without opening a browser. Resolves once it listens. */
export async function startServe(dir, port) {
  port = port || await freePort();
  const p = spawn(process.execPath, ['serve.js'], { cwd: dir, env: { ...process.env, OW_NO_OPEN: '1', OW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('serve.js did not start in 20 s:\n' + log)), 20000);
    const on = b => { log += b; if (/helper on http:\/\/127\.0\.0\.1:\d+\//.test(log)) { clearTimeout(t); ok(); } };
    p.stdout.on('data', on); p.stderr.on('data', b => { log += b; });
    p.on('exit', code => { clearTimeout(t); fail(new Error(`serve.js exited (${code}):\n${log}`)); });
  });
  p.removeAllListeners('exit');
  const stop = () => new Promise(ok => { if (p.exitCode != null) return ok(); p.once('exit', ok); p.kill(); });
  return { url: `http://127.0.0.1:${port}/`, stop, log: () => log };
}

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/|data:|blob:)/i;
// static and dynamic imports with a literal, export ... from, and new URL('./x', import.meta.url) (workers, data next to a module)
const IMPORTS = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/gm;

/** Local URLs an HTML page loads or links to: href, src, poster, srcset, and the imports of its inline module scripts. */
export function pageRefs(html) {
  const out = [];
  for (const [, attr, v] of html.matchAll(/\b(href|src|poster|srcset)\s*=\s*"([^"]*)"/g))
    out.push(...(attr === 'srcset' ? v.split(',').map(s => s.trim().split(/\s+/)[0]) : [v]));
  for (const [, body] of html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)) out.push(...moduleRefs(body));
  return out.filter(u => u && !SKIP.test(u) && !u.includes('${') && !u.startsWith('{{'));
}
/** Relative module specifiers a script imports (bare names come from the import map's CDN, so they are skipped). */
export function moduleRefs(js) {
  return [...js.matchAll(IMPORTS)].map(m => m[1] || m[2] || m[3] || m[4]).filter(s => /^\.{0,2}\//.test(s) && !s.startsWith('//'));
}
/** url(...) in a stylesheet (fonts). */
export const cssRefs = css => [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]).filter(u => !SKIP.test(u));

/**
 * Fetch every entry page and, breadth first, every local file they load: pages they link to, scripts and the modules
 * those import, stylesheets and their fonts, images, the web manifest and its icons. Binary assets are checked with HEAD.
 * @param {string} base  e.g. http://127.0.0.1:8787/
 * @param {string[]} entries  paths relative to base
 * @returns {Promise<{ok: string[], bad: {url: string, status: number|string, from: string}[]}>}
 */
export async function crawl(base, entries) {
  const seen = new Set(), ok = [], bad = [], todo = entries.map(e => ({ url: new URL(e, base).href, from: '(start)' }));
  const origin = new URL(base).origin;
  while (todo.length) {
    const { url, from } = todo.shift();
    const clean = url.split(/[?#]/)[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    const path = new URL(clean).pathname, ext = (path.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const text = ext === '' || ['.html', '.js', '.mjs', '.css', '.webmanifest', '.json'].includes(ext) && !path.startsWith('/data/');
    let r;
    try { r = await fetch(clean, { method: text ? 'GET' : 'HEAD', redirect: 'follow' }); } catch (e) { bad.push({ url: clean, status: e.message, from }); continue; }
    if (r.status !== 200) { bad.push({ url: clean, status: r.status, from }); await r.body?.cancel(); continue; }
    ok.push(clean);
    if (!text) continue;
    const body = await r.text(), at = r.url, type = r.headers.get('content-type') || '';
    let refs = [];
    if (type.startsWith('text/html')) refs = pageRefs(body);
    else if (/\.m?js$/.test(new URL(at).pathname)) refs = moduleRefs(body);
    else if (ext === '.css') refs = cssRefs(body);
    else if (ext === '.webmanifest') {
      try { const m = JSON.parse(body); refs = [...(m.icons || []), ...(m.screenshots || [])].map(i => i.src); } catch { bad.push({ url: clean, status: 'not JSON', from }); }
    }
    for (const ref of refs) {
      const next = new URL(ref, at);
      if (next.origin === origin) todo.push({ url: next.href, from: new URL(at).pathname });
    }
  }
  return { ok, bad };
}

/** The pages a user opens from the folder: every .html at its top (the views link on to the rest). */
export const entryPages = dir => ['', ...readdirSync(dir).filter(f => f.endsWith('.html') && f !== '404.html').sort()];

/** The whole site check against an unzipped download (or this checkout). */
export async function checkSite(dir) {
  for (const f of ['serve.js', 'open-overwatch.html']) if (!existsSync(join(dir, f))) throw new Error(`${f} is not in ${dir}`);
  const s = await startServe(dir);
  try {
    const pages = await crawl(s.url, entryPages(dir));
    const data = await crawl(s.url, DATA_FILES);
    return { ok: [...pages.ok, ...data.ok], bad: [...pages.bad, ...data.bad], log: s.log() };
  } finally { await s.stop(); }
}

/** initialize and tools/list over stdio, as an MCP client does on start, against a server.mjs (installed or in a checkout). */
export async function mcpRoundTrip(server) {
  const p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
  const send = m => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'install-test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  p.stdin.end();
  const code = await new Promise(ok => {
    const t = setTimeout(() => { p.kill(); ok('timeout'); }, 30000);
    p.on('close', c => { clearTimeout(t); ok(c); });
  });
  const lines = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)), byId = id => lines.find(l => l.id === id);
  return { code, err, init: byId(1)?.result, tools: byId(2)?.result?.tools || [] };
}

// ---- command line --------------------------------------------------------------------------------------------------
/** @param {string[]} args */
async function main(args) {
  const [cmd, arg] = args;
  if (cmd === 'zip-script') {
    const yml = readFileSync(arg || fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)), 'utf8');
    process.stdout.write(zipScript(yml));
  } else if (cmd === 'site' && arg) {
    const r = await checkSite(resolve(arg));
    console.log(`${r.ok.length} files answered 200 from serve.js in ${resolve(arg)}`);
    for (const b of r.bad) console.log(`MISSING ${b.status} ${b.url} (from ${b.from})`);
    if (r.bad.length || r.ok.length < 50) { console.log(r.log); process.exitCode = 1; }
  } else if (cmd === 'mcp' && arg) {
    const r = await mcpRoundTrip(resolve(arg));
    const names = r.tools.map(t => t.name);
    console.log(`exit ${r.code}; server ${r.init?.serverInfo?.name} ${r.init?.serverInfo?.version}; ${names.length} tools`);
    if (r.code !== 0 || r.init?.serverInfo?.name !== 'open-overwatch' || names.length < 30 || !names.includes('earthquakes')) {
      console.log(r.err); process.exitCode = 1;
    }
  } else {   // no command (node --test also runs this file, as it runs everything under test/): the usage, and success
    console.error('usage: installsmoke.mjs zip-script [release.yml] | site <folder> | mcp <server.mjs>');
    if (cmd) process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
