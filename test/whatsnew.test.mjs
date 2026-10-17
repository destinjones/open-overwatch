// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The "What's new" card (src/core/whatsnew.js, shown by src/app/pwa.js) and the install sheet's images
// (manifest.webmanifest: a maskable icon and screenshots, made by brand/tools/pwa_images.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { RELEASES, MAX_LINES, CHANGELOG_URL, versionOf, compareVersions, releaseFor, notesUrl, tryLink, cardFor, whatsNewDue } from '../src/core/whatsnew.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const NEW = RELEASES[0].version, OLD = RELEASES[1].version;

test('whatsnew: the version part of a build stamp', () => {
  assert.equal(versionOf('0.9.2.15+abc1234def'), '0.9.2.15');
  assert.equal(versionOf('v0.9.2.14'), '0.9.2.14');
  assert.equal(versionOf('dev'), null);
  assert.equal(versionOf('unknown+abc'), null);
  assert.equal(versionOf(null), null);
  assert.equal(compareVersions('0.9.2.15', '0.9.2.9'), 1, 'numbers, not text');
  assert.equal(compareVersions('0.9.2', '0.9.2.0'), 0);
  assert.equal(compareVersions('0.9.1', '0.9.2.14'), -1);
});

test('whatsnew: a returning visitor sees the card once per version', () => {
  const r = whatsNewDue(NEW + '+abc', OLD);
  assert.equal(r.remember, NEW);
  assert.equal(r.card.version, NEW);
  assert.ok(r.card.lines.length > 0 && r.card.lines.length <= MAX_LINES);
  assert.equal(r.card.more, RELEASES[0].lines.length - r.card.lines.length);
  assert.deepEqual(whatsNewDue(NEW + '+abc', NEW), { card: null, remember: null }, 'already seen');
  assert.deepEqual(whatsNewDue(NEW + '+def', NEW + '+abc'), { card: null, remember: null }, 'a commit-only rebuild is not a new version');
});

test('whatsnew: never on a first visit, an archived copy, an embed or a development build', () => {
  assert.deepEqual(whatsNewDue(NEW + '+abc', null), { card: null, remember: NEW }, 'a first visit only remembers');
  assert.equal(whatsNewDue(NEW + '+abc', null, { updated: true }).card.version, NEW, 'unless they came through Reload');
  assert.deepEqual(whatsNewDue(NEW + '+abc', OLD, { archived: true }), { card: null, remember: null });
  assert.deepEqual(whatsNewDue(NEW + '+abc', OLD, { embed: true }), { card: null, remember: null });
  assert.deepEqual(whatsNewDue('dev', OLD), { card: null, remember: null });
  assert.deepEqual(whatsNewDue(OLD + '+abc', NEW), { card: null, remember: OLD }, 'a rollback: remembered, nothing announced');
  assert.deepEqual(whatsNewDue('9.9.9.9+abc', OLD), { card: null, remember: '9.9.9.9' }, 'a version without notes: no empty card');
});

test('whatsnew: ?whatsnew=1 forces the card (for testing), ?whatsnew=0 never', () => {
  assert.equal(whatsNewDue(null, null, { search: '?whatsnew=1' }).card.version, NEW);
  assert.equal(whatsNewDue(OLD + '+x', OLD, { search: '?whatsnew=1' }).card.version, OLD);
  assert.equal(whatsNewDue(NEW + '+x', OLD, { search: '?whatsnew=1' }).remember, null, 'forcing stores nothing');
  assert.equal(whatsNewDue(NEW + '+x', OLD, { search: '?whatsnew=0' }).card, null);
  assert.equal(whatsNewDue(null, null, { search: '?whatsnew=1', archived: true }).card, null);
});

test('whatsnew: links to the full notes and a page to try it on', () => {
  assert.equal(notesUrl(releaseFor('0.9.2.14')), CHANGELOG_URL + '#09214---2026-10-15');
  assert.equal(notesUrl({ version: '0.9.2.99', date: null }), CHANGELOG_URL);
  assert.equal(tryLink('globe.html#go=reentry'), 'globe.html#go=reentry');
  assert.equal(tryLink('india/'), 'india/');
  for (const bad of ['https://example.com/', '//example.com/x', '../x.html', 'javascript:alert(1)', 'globe.html#<b>', '']) assert.equal(tryLink(bad), null, bad);
  assert.equal(cardFor(null), null);
});

test('whatsnew: the releases are newest first, complete, and point at pages that exist', () => {
  for (let i = 1; i < RELEASES.length; i++) assert.equal(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), 1, 'newest first');
  for (const r of RELEASES) {
    assert.ok(r.title && r.lines.length >= 1 && r.lines.every(l => typeof l === 'string' && l.trim()), r.version);
    assert.ok(tryLink(r.go), `${r.version}: go is a page of this site`);
    const page = r.go.split('#')[0];
    assert.ok(existsSync(new URL(page.endsWith('/') ? page + 'index.html' : page, root)), `${r.version}: ${page} exists`);
  }
});

test('whatsnew: the notes agree with CHANGELOG.md, and every published version has an entry', () => {
  const log = read('CHANGELOG.md');
  for (const r of RELEASES.filter(r => r.date)) {
    const at = log.indexOf(`## [${r.version}] - ${r.date}`);
    assert.ok(at >= 0, `CHANGELOG.md has a heading for ${r.version} on ${r.date}`);
    assert.equal(log.slice(at).split('\n')[2].replace(/\.$/, ''), r.title, `${r.version}: the title is the changelog's one-liner`);
  }
  for (const r of RELEASES) if (log.includes(`## [${r.version}]`)) assert.ok(r.date, `${r.version} is in CHANGELOG.md: give it its date in src/core/whatsnew.js`);
  const current = read('src/map/version.js').match(/const OW_VERSION = '([\d.]+)'/)[1];
  assert.ok(compareVersions(RELEASES[0].version, current) >= 0, `src/map/version.js says ${current}: add its notes to RELEASES in src/core/whatsnew.js`);
  assert.ok(releaseFor(current), `${current} has notes`);
});

test('whatsnew: pwa.js shows the card after the build is known and keeps storage in try/catch', () => {
  const src = read('src/app/pwa.js');
  assert.match(src, /import \{ whatsNewDue, SEEN_KEY \} from '\.\.\/core\/whatsnew\.js'/);
  assert.match(src, /Pwa\.build = r\.build; if \(!reg\.waiting\) whatsNew\(r\.build\)/);
  assert.match(src, /try \{ seen = localStorage\.getItem\(SEEN_KEY\); \} catch/);
  assert.doesNotMatch(src.slice(src.indexOf('function showWhatsNew')), /innerHTML/, 'the card is built with textContent');
});

// ---- the install sheet: a maskable icon and screenshots ----

/** Width, height and type from a PNG's IHDR (and its colour type) or a JPEG's start-of-frame. */
function imageInfo(path) {
  const b = readFileSync(new URL(path, root));
  if (b.toString('latin1', 1, 4) === 'PNG') return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25] };
  assert.equal(b.readUInt16BE(0), 0xFFD8, `${path} is a PNG or a JPEG`);
  for (let i = 2; i + 9 < b.length;) {
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return { type: 'image/jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  assert.fail(`${path}: no JPEG frame header`);
}

test('manifest: a maskable icon and narrow and wide screenshots, at the sizes they declare', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  const mask = m.icons.filter(i => i.purpose === 'maskable');
  assert.equal(mask.length, 1, 'one maskable icon');
  assert.ok(m.icons.some(i => (i.purpose || 'any') === 'any'), 'and the plain ones stay');
  for (const i of [...m.icons, ...(m.screenshots || [])]) {
    const [w, h] = i.sizes.split('x').map(Number), got = imageInfo(i.src);
    assert.deepEqual([got.w, got.h], [w, h], `${i.src} is ${i.sizes}`);
    assert.equal(got.type, i.type || 'image/png', `${i.src} is the type it declares`);
  }
  const icon = imageInfo(mask[0].src);
  assert.equal(icon.w, 512);
  assert.equal(icon.colour, 2, 'the maskable icon is opaque RGB (no transparent corners for Android to fill)');
  const shots = m.screenshots || [];
  assert.deepEqual(shots.map(s => s.form_factor).sort(), ['narrow', 'wide']);
  for (const s of shots) {
    assert.ok(s.label && /^image\/(png|jpeg)$/.test(s.type), s.src);
    const [w, h] = s.sizes.split('x').map(Number);
    assert.ok(s.form_factor === 'wide' ? w > h : h > w, `${s.src}: ${s.form_factor} is the right way round`);
    assert.ok(Math.max(w, h) / Math.min(w, h) <= 2.3 && Math.min(w, h) >= 320, `${s.src}: within Chrome's limits`);
  }
});
