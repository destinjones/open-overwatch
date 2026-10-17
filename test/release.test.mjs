// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The download zip against what needs it: the files README.txt lists, every data/ file the views fetch, and the pages
// the shipped pages link to must be in the zip's file list in .github/workflows/release.yml. A data file left out
// quietly loads from the live site instead (or 404s, on the 2D map); a page left out 404s under the local helper.
// The zip list is read from the workflow's "Build the download zip" step: its cp sources, minus its rm -rf.
// Publish Update.bat is checked too: it must catch up with origin/main before it tags, and undo the tag if the push fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const exists = path => existsSync(new URL(path, root));

// data/ files the site build makes every 6 hours (.github/build_site.py) and never commits: the download does without
// them (the views hide what needs them, or fall back to the live feed), so they are not in the zip.
// camera_poses.json is optional shared camera alignments, not made yet.
const SITE_ONLY = ['data/astronauts.json', 'data/flybys.json', 'data/launches.json', 'data/news.json', 'data/socrates.json',
  'data/wind.json', 'data/tle/', 'data/tle/history/', 'data/camera_poses.json'];

// --- the zip list, from the workflow
const yml = read('.github/workflows/release.yml');
const step = yml.slice(yml.indexOf('- name: Build the download zip'), yml.indexOf('- uses:', yml.indexOf('- name: Build the download zip')));
const shell = step.slice(step.indexOf('run: |') + 6).replace(/\\\n\s*/g, ' ').split('\n')
  .map(l => l.replace(/\s#\s.*$/, '').trim()).filter(Boolean).flatMap(l => l.split(/\s*&&\s*/));
const words = cmd => [...cmd.matchAll(/(?:"[^"]*"|[^\s"])+/g)].map(m => m[0].replace(/"/g, ''));   // shell words: "$D/x/"*.png is one
const ship = [], drop = [];
for (const cmd of shell) {
  const [verb, ...args] = words(cmd).filter(w => !w.startsWith('-'));
  if (verb === 'cp') {
    const dest = args.pop();
    for (const src of args) ship.push({ src, dest });
  } else if (verb === 'rm') drop.push(...args.map(a => a.replace(/^\$D\//, '').replace(/\/$/, '')));
}
const glob = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
const zipPath = s => s.src.replace(/\/\.$/, '');
const dropped = path => drop.some(d => glob(d).test(path) || path.startsWith(d + '/'));
const shipped = path => !dropped(path.replace(/\/$/, '')) && ship.some(s => {
  const z = zipPath(s);
  if (path.endsWith('/') && z.startsWith(path)) return true;   // a folder: something inside it ships
  return z.includes('*') ? glob(z).test(path) : path === z || path.startsWith(z.replace(/\/$/, '') + '/');
});
const siteOnly = path => SITE_ONLY.some(s => s === path || (s.endsWith('/') && path.startsWith(s)));

test('release: the zip list was found (so the checks below check something)', () => {
  assert.ok(ship.length >= 30, `cp sources: ${ship.length}`);
  assert.ok(shipped('open-overwatch.html') && shipped('src/core/assets.js') && shipped('data/solar/stars.bin'));
  assert.ok(dropped('brand/sprites/raw') && !shipped('brand/sprites/raw/x.png'));
});

test('release: every cp source exists and lands at the same path in the zip', () => {
  for (const s of ship) {
    const z = zipPath(s);
    if (z.includes('*')) {
      const dir = z.slice(0, z.lastIndexOf('/'));
      assert.ok(readdirSync(new URL(dir + '/', root)).some(f => glob(z).test(dir + '/' + f)), `${s.src} matches nothing`);
    } else assert.ok(exists(z), `${s.src} is not in the repository (the release would fail)`);
    const base = z.slice(0, z.lastIndexOf('/') + 1);
    const into = s.dest.replace(/^\$D\/?/, '');
    if (s.src.endsWith('/.')) assert.equal(into.replace(/\/$/, ''), z, `${s.src} goes to ${s.dest}`);
    else assert.equal(into, base, `${s.src} goes to ${s.dest}, not to its own folder`);
  }
});

test('release: everything README.txt lists under FILES is in the zip', () => {
  const txt = read('README.txt');
  const sec = txt.slice(txt.indexOf('\nFILES\n') + 7).split('\n');
  const end = sec.findIndex(l => /^\S/.test(l));
  const names = [];
  for (const line of sec.slice(0, end)) {
    if (!line.trim()) continue;
    const body = line.slice(2), [first, ...rest] = body.split(/\s{2,}/);
    if (first) names.push(...first.split(/,\s*/));
    for (const m of rest.join(' ').matchAll(/(?:[\w-]+\/)*[\w-]+\.(?:html|md|bin|json)\b|\b[a-z]+\/(?=[\s),])/g)) names.push(m[0]);
  }
  assert.ok(names.length >= 12, `names: ${names}`);
  for (const n of ['open-overwatch.html', 'globe.html', 'index.html', 'guide.html', 'india/', 'data/', 'LICENSE', 'NOTICE']) assert.ok(names.includes(n), `README.txt FILES names ${n}`);
  assert.deepEqual(names.filter(n => !shipped(n)), [], 'README.txt promises these, release.yml does not ship them');
});

test('release: every data/ file the views fetch is in the zip or is a site-only build output', () => {
  const files = dir => readdirSync(new URL(dir, root)).flatMap(f => statSync(new URL(dir + f, root)).isDirectory() ? files(dir + f + '/') : [dir + f]);
  const code = [...files('src/'), ...files('india/'), ...readdirSync(root).filter(f => f.endsWith('.html'))].filter(f => /\.(js|mjs|html)$/.test(f));
  const fetched = new Set(code.flatMap(f => [...read(f).matchAll(/['"`](?:\.\.\/)?(data\/[\w./-]*)/g)].map(m => m[1])));
  assert.ok(fetched.size >= 30, `data paths: ${[...fetched]}`);
  for (const must of ['data/airports.json', 'data/runways.json', 'data/deepsky.json', 'data/lightpollution.bin']) assert.ok(fetched.has(must), must);
  assert.deepEqual([...fetched].filter(p => !shipped(p) && !siteOnly(p)), [], 'fetched by the views, missing from the zip');
  // the site-only list is only for build outputs: a dataset in the repository belongs in the zip
  assert.deepEqual(SITE_ONLY.filter(p => exists(p) && !p.endsWith('/')), [], 'committed, so ship it');
});

test('release: the light-pollution atlas ships with its CC BY-NC licence note', () => {
  assert.ok(shipped('data/lightpollution.bin'));
  assert.ok(shipped('data/lightpollution.md'), 'the .bin is not MIT: its licence note must travel with it');
  assert.match(read('data/lightpollution.md'), /CC BY-NC 4\.0/);
  assert.ok(!shipped('data/deepsky.json') || shipped('data/deepsky.md'), 'deepsky.md credits the catalogue');
});

test('release: the pages the shipped pages link to are in the zip', () => {
  const pages = ['open-overwatch.html', 'globe.html', 'solar.html', 'tonight.html', 'offline.html', 'index.html', 'about.html', 'guide.html', 'india/index.html'];
  const bad = [];
  for (const page of pages) {
    assert.ok(shipped(page), `${page} is in the zip`);
    const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
    const urls = [...read(page).matchAll(/\b(href|src|poster|srcset)="([^"]+)"/g)]   // srcset: the first word of each part
      .flatMap(([, attr, v]) => attr === 'srcset' ? v.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean) : [v]);
    for (const url of urls) {
      if (/^(?:[a-z]+:|#|\/\/|\$\{)/i.test(url) || url.includes('${')) continue;
      let p = new URL(url.split(/[?#]/)[0], 'file:///z/' + dir).pathname.slice(3);
      if (p === '' || p.endsWith('/')) p += 'index.html';
      if (!shipped(p)) bad.push(`${page} -> ${url}`);
    }
  }
  assert.deepEqual(bad, [], 'links and assets the download would 404 on');
  // asset paths the pages build in JS ('brand/lander/clips/' + c, '../brand/india/clips/' + c, 'brand/models/' + f)
  for (const dir of ['brand/lander/clips/', 'brand/india/clips/', 'brand/models/']) {
    assert.ok(exists(dir), `${dir} is in the repository`);
    assert.ok(shipped(dir), `${dir} is in the zip`);
  }
});

test('release: Publish Update.bat catches up with origin/main before it tags, and undoes the tag when the push fails', () => {
  const bat = read('Publish Update.bat');
  const at = s => { const i = bat.indexOf(s); assert.ok(i >= 0, `the script runs: ${s}`); return i; };
  const fetchAt = at('git fetch origin main'), ffAt = at('git merge --ff-only origin/main');
  const bumpAt = at('powershell -NoProfile'), commitAt = at('git commit -m'), tagAt = at('git tag -a'), pushAt = at('git push --atomic origin HEAD:main --follow-tags');
  assert.ok(fetchAt < ffAt && ffAt < bumpAt && bumpAt < commitAt && commitAt < tagAt && tagAt < pushAt, 'fetch, fast-forward, bump, commit, tag, push');
  const line = s => bat.split('\n').find(l => l.startsWith(s)) ?? '';
  assert.match(line('git merge --ff-only'), /\|\| goto :behind\s*$/, 'no fast-forward: stop before the bump');
  assert.match(line('git tag -a'), /\|\| goto :undocommit\s*$/, 'a failed tag takes back the commit');
  assert.match(line('git push'), /\|\| goto :undotag\s*$/, 'a failed push takes back the tag and the commit');
  const undo = bat.slice(bat.indexOf('\n:undotag'));
  assert.ok(undo.indexOf('git tag -d "v%VER%"') > 0 && undo.indexOf('\n:undocommit') > undo.indexOf('git tag -d'), ':undotag deletes the tag, then falls into :undocommit');
  assert.match(undo.slice(undo.indexOf('\n:undocommit')), /^:undocommit\ngit reset --soft HEAD~1\n/m, ':undocommit takes back the version commit');
});
